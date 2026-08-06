from __future__ import annotations

import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError


CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from cli import _captured_source, _run_comparison, ingest
from acceptance_evaluator import evaluate_case, independent_review_errors
from review_acceptance_annotations import apply_review, export_review
from guide_extractor import (
    ExtractionConfig,
    extract_guide_claims,
    extract_guide_claims_detailed,
    resolve_extraction_config,
)
from metadata_fetcher import fetch_video_metadata
from schema_validator import validate_knowledge_document
from transcript_chunker import chunk_transcript
from youtube_fetcher import (
    extract_video_id,
    fetch_transcript,
    transcript_from_youtube_json3,
)


VIDEO_ID = "abc123xyz00"


class FakeResponse:
    def __init__(self, value):
        self.value = value if isinstance(value, bytes) else value.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.value


class SequenceOpener:
    def __init__(self, values):
        self.values = iter(values)

    def __call__(self, _request, timeout):
        return FakeResponse(json.dumps(next(self.values), ensure_ascii=False))


class CapturingOpener(SequenceOpener):
    def __call__(self, request, timeout):
        self.request_body = json.loads(request.data.decode("utf-8"))
        return super().__call__(request, timeout)


class FlakyOpener:
    def __init__(self, payload):
        self.payload = payload
        self.calls = 0

    def __call__(self, _request, timeout):
        self.calls += 1
        if self.calls == 1:
            raise URLError("transient TLS failure")
        return FakeResponse(json.dumps(self.payload))


class FakeTranscriptApi:
    def fetch(self, video_id, languages):
        self.video_id = video_id
        self.languages = languages
        return [
            {"text": "霞需要攻速", "start": 10, "duration": 2},
            {"text": "优先做羊刀", "start": 20, "duration": 3},
        ]


class YouTubeIngestionTests(unittest.TestCase):
    def test_independent_human_review_gate_requires_explicit_attestation(self):
        provisional = {
            "annotationStatus": "provisional",
            "annotationProvenance": {
                "reviewer": "Codex transcript-window review",
                "reviewerType": "codex",
                "independentHumanReview": False,
            },
            "annotations": {
                "claims": [{"reviewDecision": "source_window_supported_by_codex"}],
            },
        }
        self.assertTrue(independent_review_errors(provisional))

        reviewed = {
            "annotationStatus": "complete",
            "annotationProvenance": {
                "reviewer": "Independent reviewer",
                "reviewerType": "human",
                "independentHumanReview": True,
                "transcriptCoverageReviewed": True,
                "exhaustiveClaimReview": True,
                "reviewedAt": "2026-07-29T00:00:00Z",
            },
            "annotations": {
                "claims": [{"reviewDecision": "supported"}],
            },
        }
        self.assertEqual(independent_review_errors(reviewed), [])

    def test_review_export_and_apply_produces_auditable_reviewed_set(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            annotations = root / "annotations"
            annotations.mkdir()
            annotation = {
                "schemaVersion": "youtube_acceptance_annotation.v1",
                "id": "case-one",
                "videoId": VIDEO_ID,
                "sourceUrl": f"https://youtube.com/watch?v={VIDEO_ID}",
                "annotationStatus": "provisional",
                "annotationProvenance": {
                    "sourceTranscriptHash": "transcript-hash",
                    "seedSource": "model_output",
                },
                "annotations": {
                    "claims": [{
                        "type": "mechanism",
                        "subjects": ["armor"],
                        "conditions": [],
                        "timestampStart": 1,
                        "timestampEnd": 2,
                        "reviewedClaim": "Armor reduces physical damage.",
                        "transcriptExcerpt": "[1.00] Armor reduces physical damage.",
                        "reviewDecision": "source_window_supported_by_codex",
                    }],
                    "irrelevantWindows": [{
                        "timestampStart": 10,
                        "timestampEnd": 12,
                        "reason": "outro",
                    }],
                },
            }
            (annotations / "case-one.json").write_text(
                json.dumps(annotation),
                encoding="utf-8",
            )
            manifest = {
                "name": "review-test",
                "annotationPolicy": {"requireIndependentHumanReview": True},
                "cases": [{
                    "id": "case-one",
                    "annotationFile": "annotations/case-one.json",
                }],
            }
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            review_path = root / "review.json"
            exported = export_review(manifest_path, review_path)
            self.assertEqual(exported["claims"], 1)

            review = json.loads(review_path.read_text(encoding="utf-8"))
            review["reviewer"] = "Independent reviewer"
            review["reviewedAt"] = "2026-07-29T00:00:00Z"
            review["attestation"] = {
                "independentHumanReview": True,
                "transcriptCoverageReviewed": True,
                "exhaustiveClaimReview": True,
            }
            review["cases"][0]["claims"][0]["decision"] = "modified"
            review["cases"][0]["claims"][0]["revision"]["reviewedClaim"] = (
                "Armor mitigates physical damage."
            )
            review["cases"][0]["irrelevantWindows"][0]["decision"] = (
                "confirmed_irrelevant"
            )
            review_path.write_text(json.dumps(review), encoding="utf-8")

            output = root / "reviewed"
            result = apply_review(manifest_path, review_path, output)
            self.assertEqual(result["claims"]["modified"], 1)
            reviewed = json.loads(
                (output / "annotations" / "case-one.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                reviewed["annotations"]["claims"][0]["reviewedClaim"],
                "Armor mitigates physical damage.",
            )
            self.assertEqual(
                reviewed["annotations"]["claims"][0]["reviewDecision"],
                "supported",
            )
            self.assertEqual(
                reviewed["annotations"]["irrelevantWindows"][0][
                    "reviewDecision"
                ],
                "confirmed_irrelevant",
            )
            self.assertEqual(independent_review_errors(reviewed), [])

    def test_review_apply_rejects_unreviewed_or_stale_decisions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            annotations = root / "annotations"
            annotations.mkdir()
            annotation = {
                "id": "case-one",
                "annotationProvenance": {
                    "sourceTranscriptHash": "transcript-hash",
                },
                "annotations": {
                    "claims": [{
                        "type": "mechanism",
                        "subjects": ["armor"],
                        "conditions": [],
                        "timestampStart": 1,
                        "timestampEnd": 2,
                        "reviewedClaim": "Armor reduces damage.",
                        "transcriptExcerpt": "[1.00] Armor reduces damage.",
                    }],
                    "irrelevantWindows": [],
                },
            }
            (annotations / "case-one.json").write_text(
                json.dumps(annotation),
                encoding="utf-8",
            )
            manifest = {
                "name": "review-test",
                "cases": [{
                    "id": "case-one",
                    "annotationFile": "annotations/case-one.json",
                }],
            }
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            review_path = root / "review.json"
            export_review(manifest_path, review_path)
            review = json.loads(review_path.read_text(encoding="utf-8"))
            review["reviewer"] = "Independent reviewer"
            review["reviewedAt"] = "2026-07-29T00:00:00Z"
            review["attestation"] = {
                "independentHumanReview": True,
                "transcriptCoverageReviewed": True,
                "exhaustiveClaimReview": True,
            }
            review_path.write_text(json.dumps(review), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "decision must be one of"):
                apply_review(
                    manifest_path,
                    review_path,
                    root / "reviewed",
                )
            self.assertFalse((root / "reviewed").exists())

            review["cases"][0]["claims"][0]["decision"] = "supported"
            review["cases"][0]["claims"][0]["fingerprint"] = "stale"
            review_path.write_text(json.dumps(review), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "fingerprint is stale"):
                apply_review(
                    manifest_path,
                    review_path,
                    root / "reviewed",
                )

    def test_deepseek_structured_extraction_disables_default_thinking(self):
        config = resolve_extraction_config({
            "TFT_AGENT_YOUTUBE_EXTRACTION_ENDPOINT": "https://api.deepseek.com",
            "TFT_AGENT_YOUTUBE_EXTRACTION_MODEL": "deepseek-v4-flash",
        })
        self.assertEqual(config.thinking_mode, "disabled")

        payload = {
            "choices": [{"message": {"content": json.dumps({
                "knowledge": [{
                    "type": "mechanism",
                    "subjects": ["armor"],
                    "claim": "Armor reduces physical damage.",
                    "conditions": [],
                    "timestampStart": 0,
                    "timestampEnd": 2,
                    "patchSpecific": False,
                    "confidence": "creator_advice",
                }]
            })}}]
        }
        opener = CapturingOpener([payload])
        extract_guide_claims_detailed(
            chunk_transcript([
                {
                    "text": "Armor reduces physical damage.",
                    "start": 0,
                    "duration": 2,
                },
            ])[0],
            config,
            opener=opener,
        )
        self.assertEqual(
            opener.request_body["thinking"],
            {"type": "disabled"},
        )

    def test_language_drift_is_rejected_and_repaired_once(self):
        first = {
            "choices": [{"message": {"content": json.dumps({
                "knowledge": [{
                    "type": "item_priority",
                    "subjects": ["霞", "最后的轻语"],
                    "claim": "霞的核心装备是最后的轻语，因为它可以降低敌人的护甲。",
                    "conditions": [],
                    "timestampStart": 0,
                    "timestampEnd": 2,
                    "patchSpecific": False,
                    "confidence": "creator_advice",
                }]
            }, ensure_ascii=False)}}],
        }
        repaired = {
            "choices": [{"message": {"content": json.dumps({
                "knowledge": [{
                    "type": "item_priority",
                    "subjects": ["Xayah", "Last Whisper"],
                    "claim": (
                        "Last Whisper is a core item for Xayah because it "
                        "reduces enemy armor."
                    ),
                    "conditions": [],
                    "timestampStart": 0,
                    "timestampEnd": 2,
                    "patchSpecific": False,
                    "confidence": "creator_advice",
                }]
            })}}],
        }
        result = extract_guide_claims_detailed(
            {
                "timestampStart": 0,
                "timestampEnd": 3,
                "timestampedText": (
                    "[00:00] Last Whisper is a core item for Xayah because "
                    "it reduces enemy armor."
                ),
            },
            ExtractionConfig(
                endpoint="https://example.com/v1/chat/completions",
                model="test-model",
                api_key=None,
            ),
            opener=SequenceOpener([first, repaired]),
        )
        self.assertEqual(result["status"], "success")
        self.assertTrue(result["repaired"])
        self.assertEqual(
            [attempt["kind"] for attempt in result["attempts"]],
            ["extract", "json_repair"],
        )
        self.assertIn(
            "claim language must match transcript language",
            result["attempts"][0]["rejectedClaims"][0]["errors"],
        )
        self.assertIn("Last Whisper", result["claims"][0]["claim"])

    def test_non_deepseek_endpoint_omits_provider_specific_thinking(self):
        config = resolve_extraction_config({
            "TFT_AGENT_YOUTUBE_EXTRACTION_ENDPOINT": "https://example.com/v1",
            "TFT_AGENT_YOUTUBE_EXTRACTION_MODEL": "test-model",
        })
        self.assertIsNone(config.thinking_mode)

    def test_transient_transport_failure_is_retried_and_traced(self):
        payload = {
            "choices": [{"message": {"content": '{"knowledge":[]}'}}],
        }
        opener = FlakyOpener(payload)
        result = extract_guide_claims_detailed(
            {
                "timestampStart": 0,
                "timestampEnd": 3,
                "timestampedText": "[00:00] channel introduction",
            },
            ExtractionConfig(
                endpoint="https://example.com/v1/chat/completions",
                model="test-model",
                api_key=None,
                retry_empty_once=False,
                transport_retries=1,
                transport_retry_delay_seconds=0,
            ),
            opener=opener,
        )
        self.assertEqual(opener.calls, 2)
        self.assertEqual(result["attempts"][0]["transportRetryCount"], 1)
        self.assertNotIn(
            "_tftAgentTransportRetryCount",
            result["attempts"][0]["rawProviderResponse"],
        )

    def test_extract_video_id_supports_known_forms(self):
        values = [
            VIDEO_ID,
            f"https://www.youtube.com/watch?v={VIDEO_ID}&t=10",
            f"https://youtu.be/{VIDEO_ID}?si=test",
            f"https://www.youtube.com/embed/{VIDEO_ID}",
            f"https://www.youtube.com/shorts/{VIDEO_ID}",
            f"https://www.youtube.com/live/{VIDEO_ID}",
        ]
        self.assertEqual([extract_video_id(value) for value in values], [VIDEO_ID] * len(values))
        with self.assertRaises(ValueError):
            extract_video_id(f"https://example.com/watch?v={VIDEO_ID}")

    def test_fetch_transcript_preserves_timestamps(self):
        api = FakeTranscriptApi()
        result = fetch_transcript(VIDEO_ID, ["zh-Hans", "en"], api=api)
        self.assertEqual(result["videoId"], VIDEO_ID)
        self.assertEqual(result["durationSeconds"], 23)
        self.assertEqual(result["snippets"][1]["start"], 20)

    def test_chunk_transcript_uses_time_window_and_keeps_context(self):
        chunks = chunk_transcript([
            {"text": "第一段", "start": 0, "duration": 2},
            {"text": "仍在第一段", "start": 300, "duration": 2},
            {"text": "第二段", "start": 901, "duration": 2},
        ], max_duration_seconds=900)
        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0]["timestampStart"], 0)
        self.assertEqual(chunks[1]["timestampStart"], 901)
        self.assertIn("[15:01] 第二段", chunks[1]["timestampedText"])

    def test_claim_timestamps_are_anchored_to_real_transcript_snippets(self):
        payload = {
            "choices": [{"message": {"content": json.dumps({
                "knowledge": [{
                    "type": "item_priority",
                    "subjects": ["霞", "最后的轻语"],
                    "claim": "前排护甲高时做最后的轻语",
                    "conditions": ["前排护甲高"],
                    "timestampStart": 61,
                    "timestampEnd": 120,
                    "patchSpecific": False,
                    "confidence": "creator_advice",
                }]
            }, ensure_ascii=False)}}]
        }
        segment = chunk_transcript([
            {"text": "霞优先做鬼索", "start": 45, "duration": 8},
            {"text": "前排护甲高时补最后的轻语", "start": 62, "duration": 10},
            {"text": "闲聊内容", "start": 510, "duration": 9},
        ], max_duration_seconds=600)[0]
        result = extract_guide_claims_detailed(
            segment,
            ExtractionConfig(
                endpoint="https://example.com/v1/chat/completions",
                model="test-model",
                api_key=None,
                retry_empty_once=False,
            ),
            opener=SequenceOpener([payload]),
        )
        claim = result["claims"][0]
        self.assertEqual(claim["timestampStart"], 62)
        self.assertEqual(claim["timestampEnd"], 72)
        self.assertEqual(
            claim["normalizationWarnings"][0]["code"],
            "timestamps_anchored_to_transcript_snippets",
        )

    def test_run_comparison_separates_semantic_and_freshness_changes(self):
        before = {
            "runId": "run-1",
            "documents": [{
                "id": "youtube:test:version:item_priority:claim",
                "documentType": "video_guide",
                "title": "标题",
                "text": "霞优先做鬼索",
                "metadata": {
                    "topics": ["霞", "鬼索的狂暴之刃"],
                    "generatedAt": "2026-07-28T00:00:00Z",
                    "ingestionRunId": "run-1",
                    "ingestionStatus": "success",
                },
            }],
            "segments": [{"segmentId": "segment-1", "status": "success"}],
        }
        after = json.loads(json.dumps(before["documents"]))
        after[0]["metadata"]["generatedAt"] = "2026-07-29T00:00:00Z"
        after[0]["metadata"]["ingestionRunId"] = "run-2"
        comparison = _run_comparison(
            before,
            after,
            [{"segmentId": "segment-1", "status": "success"}],
        )
        self.assertTrue(comparison["stable"])
        self.assertFalse(comparison["recordStable"])
        self.assertEqual(comparison["semanticChangedDocumentIds"], [])
        self.assertEqual(
            comparison["metadataOnlyChangedDocumentIds"],
            ["youtube:test:version:item_priority:claim"],
        )

    def test_unconditional_strategic_advice_is_traceably_normalized(self):
        payload = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "knowledge": [{
                            "type": "mechanism",
                            "subjects": ["armor", "HP"],
                            "claim": "Armor multiplies effective HP.",
                            "conditions": [],
                            "timestampStart": 12,
                            "timestampEnd": 16,
                            "patchSpecific": False,
                            "confidence": "strategic_advice",
                        }]
                    })
                }
            }]
        }
        result = extract_guide_claims_detailed({
            "timestampStart": 10,
            "timestampEnd": 20,
            "timestampedText": "[00:12] Armor multiplies effective HP.",
        }, ExtractionConfig(
            endpoint="https://example.com/v1/chat/completions",
            model="test-model",
            api_key=None,
        ), opener=SequenceOpener([payload]))

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["claims"][0]["confidence"], "creator_advice")
        self.assertEqual(
            result["claims"][0]["normalizationWarnings"][0]["code"],
            "unconditional_strategic_advice_normalized",
        )

    def test_unmarked_speculation_is_traceably_normalized(self):
        payload = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "knowledge": [{
                            "type": "mechanism",
                            "subjects": ["Teemo"],
                            "claim": "Teemo deals stacking magic damage.",
                            "conditions": [],
                            "timestampStart": 0,
                            "timestampEnd": 2,
                            "patchSpecific": False,
                            "confidence": "speculation",
                        }]
                    })
                }
            }]
        }
        result = extract_guide_claims_detailed(
            {
                "timestampStart": 0,
                "timestampEnd": 3,
                "timestampedText": "[00:00] Teemo deals stacking magic damage.",
            },
            ExtractionConfig(
                endpoint="https://example.com/v1/chat/completions",
                model="test-model",
                api_key=None,
            ),
            opener=SequenceOpener([payload]),
        )
        self.assertEqual(result["claims"][0]["confidence"], "creator_advice")
        self.assertEqual(
            result["claims"][0]["normalizationWarnings"][0]["code"],
            "unmarked_speculation_normalized",
        )

    def test_explicit_speculation_remains_speculation(self):
        payload = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "knowledge": [{
                            "type": "risk",
                            "subjects": ["Aatrox"],
                            "claim": "Aatrox will probably use BT and Titan's.",
                            "conditions": [],
                            "timestampStart": 0,
                            "timestampEnd": 2,
                            "patchSpecific": False,
                            "confidence": "speculation",
                        }]
                    })
                }
            }]
        }
        result = extract_guide_claims_detailed(
            {
                "timestampStart": 0,
                "timestampEnd": 3,
                "timestampedText": "[00:00] Aatrox will probably use BT and Titan's.",
            },
            ExtractionConfig(
                endpoint="https://example.com/v1/chat/completions",
                model="test-model",
                api_key=None,
            ),
            opener=SequenceOpener([payload]),
        )
        self.assertEqual(result["claims"][0]["confidence"], "speculation")

    def test_metadata_fetcher_requires_real_title_author_and_date(self):
        def opener(request, timeout):
            if "oembed" in request.full_url:
                return FakeResponse(json.dumps({
                    "title": "霞完整攻略",
                    "author_name": "测试频道",
                }))
            return FakeResponse(
                '<html><script>"uploadDate":"2026-07-20"</script></html>'
            )

        metadata = fetch_video_metadata(VIDEO_ID, opener=opener)
        self.assertEqual(metadata["title"], "霞完整攻略")
        self.assertEqual(metadata["author"], "测试频道")
        self.assertEqual(metadata["publishedAt"], "2026-07-20")

    def test_youtube_json3_transcript_is_normalized(self):
        transcript = transcript_from_youtube_json3({
            "events": [
                {"tStartMs": 0, "dDurationMs": 5000, "segs": []},
                {
                    "tStartMs": 1000,
                    "dDurationMs": 2000,
                    "segs": [{"utf8": "Build "}, {"utf8": "anti-heal"}],
                },
                {
                    "tStartMs": 3000,
                    "dDurationMs": 1000,
                    "aAppend": 1,
                    "segs": [{"utf8": "\n"}],
                },
            ]
        }, VIDEO_ID)

        self.assertEqual(transcript["language"], "en")
        self.assertEqual(transcript["durationSeconds"], 3)
        self.assertEqual(transcript["snippets"], [{
            "text": "Build anti-heal",
            "start": 1.0,
            "duration": 2.0,
        }])

    def test_metadata_fetcher_accepts_watch_page_simple_text_date(self):
        def opener(request, timeout):
            if "oembed" in request.full_url:
                return FakeResponse(json.dumps({
                    "title": "Fixture guide",
                    "author_name": "Fixture channel",
                }))
            return FakeResponse(
                '<script>"publishDate":{"simpleText":"Feb 14, 2026"}</script>'
            )

        metadata = fetch_video_metadata(VIDEO_ID, opener=opener)

        self.assertEqual(metadata["publishedAt"], "2026-02-14")

    def test_metadata_fetcher_falls_back_to_channel_feed(self):
        calls = []

        def opener(request, timeout):
            calls.append(request.full_url)
            if "oembed" in request.full_url:
                return FakeResponse(json.dumps({
                    "title": "Fixture guide",
                    "author_name": "Fixture channel",
                    "author_url": "https://www.youtube.com/@fixture",
                }))
            if request.full_url.endswith("@fixture"):
                return FakeResponse(
                    '<script>"channelId":"UCfixture_channel_123"</script>'
                )
            if "feeds/videos.xml" in request.full_url:
                return FakeResponse(
                    '<?xml version="1.0" encoding="UTF-8"?>'
                    '<feed xmlns="http://www.w3.org/2005/Atom" '
                    'xmlns:yt="http://www.youtube.com/xml/schemas/2015">'
                    '<entry>'
                    f'<yt:videoId>{VIDEO_ID}</yt:videoId>'
                    '<published>2026-07-21T08:30:00+00:00</published>'
                    '</entry>'
                    '</feed>'
                )
            return FakeResponse("<html><body>date temporarily absent</body></html>")

        metadata = fetch_video_metadata(VIDEO_ID, opener=opener)

        self.assertEqual(metadata["publishedAt"], "2026-07-21")
        self.assertIn(
            "youtube_publish_date_from_channel_feed",
            metadata["warnings"],
        )
        self.assertEqual(sum("/watch?v=" in url for url in calls), 3)

    def test_captured_source_replay_loads_and_verifies_raw_transcript(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcript_path = root / "raw-transcript.json"
            transcript = {
                "videoId": VIDEO_ID,
                "language": "en",
                "durationSeconds": 2,
                "snippets": [{"text": "real capture", "start": 0, "duration": 2}],
            }
            transcript_path.write_text(json.dumps({
                "schemaVersion": "youtube_transcript_artifact.v1",
                "transcript": transcript,
            }), encoding="utf-8")
            envelope_path = root / "capture.json"
            envelope_path.write_text(json.dumps({
                "runId": "live-run",
                "source": {
                    "videoId": VIDEO_ID,
                    "videoVersion": "captured-version",
                    "transcriptHash": "captured-hash",
                    "title": "Real capture",
                    "author": "Channel",
                    "publishedAt": "2026-07-20",
                    "sourceUrl": f"https://www.youtube.com/watch?v={VIDEO_ID}",
                },
                "artifacts": {"rawTranscript": str(transcript_path)},
                "warnings": [],
            }), encoding="utf-8")

            metadata, loaded_transcript, capture = _captured_source(
                str(envelope_path)
            )

            self.assertEqual(metadata["publishedAt"], "2026-07-20")
            self.assertEqual(loaded_transcript, transcript)
            self.assertEqual(capture["mode"], "recorded_live_replay")
            self.assertEqual(capture["originalRunId"], "live-run")

    def test_guide_extractor_filters_invalid_or_out_of_range_claims(self):
        payload = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "knowledge": [
                            {
                                "type": "item_priority",
                                "subjects": ["霞", "羊刀"],
                                "claim": "优先制作羊刀",
                                "conditions": ["缺少其他攻速来源"],
                                "timestampStart": 12,
                                "timestampEnd": 20,
                                "patchSpecific": False,
                                "confidence": "creator_advice",
                            },
                            {
                                "type": "item_priority",
                                "subjects": ["霞"],
                                "claim": "越界时间",
                                "conditions": [],
                                "timestampStart": 999,
                                "timestampEnd": 1000,
                                "patchSpecific": False,
                                "confidence": "creator_advice",
                            },
                        ]
                    }, ensure_ascii=False)
                }
            }]
        }

        def opener(_request, timeout):
            return FakeResponse(json.dumps(payload, ensure_ascii=False))

        claims = extract_guide_claims({
            "timestampStart": 10,
            "timestampEnd": 30,
            "timestampedText": "[00:12] 霞优先做羊刀",
        }, ExtractionConfig(
            endpoint="https://example.com/v1/chat/completions",
            model="test-model",
            api_key=None,
        ), opener=opener)
        self.assertEqual(len(claims), 1)
        self.assertEqual(claims[0]["claim"], "优先制作羊刀")

    def test_json_failure_is_repaired_once_and_raw_attempts_are_retained(self):
        valid = {
            "choices": [{"message": {"content": json.dumps({
                "knowledge": [{
                    "type": "item_priority",
                    "subjects": ["霞", "羊刀"],
                    "claim": "霞优先制作羊刀",
                    "conditions": ["需要攻速启动"],
                    "timestampStart": 12,
                    "timestampEnd": 20,
                    "patchSpecific": False,
                    "confidence": "creator_advice",
                }]
            }, ensure_ascii=False)}}]
        }
        invalid = {"choices": [{"message": {"content": "{not-json"}}]}
        result = extract_guide_claims_detailed({
            "timestampStart": 10,
            "timestampEnd": 30,
            "timestampedText": "[00:12] 霞优先做羊刀",
        }, ExtractionConfig(
            endpoint="https://example.com/v1/chat/completions",
            model="test-model",
            api_key=None,
        ), opener=SequenceOpener([invalid, valid]))
        self.assertEqual(result["status"], "success")
        self.assertEqual(len(result["claims"]), 1)
        self.assertTrue(result["repaired"])
        self.assertEqual([value["kind"] for value in result["attempts"]], [
            "extract",
            "json_repair",
        ])
        self.assertIsNotNone(result["attempts"][0]["parseOrContractError"])
        self.assertEqual(result["attempts"][0]["rawModelResponse"], "{not-json")

    def test_valid_empty_response_is_confirmed_once(self):
        empty = {
            "choices": [{"message": {"content": json.dumps({"knowledge": []})}}]
        }
        result = extract_guide_claims_detailed({
            "timestampStart": 10,
            "timestampEnd": 30,
            "timestampedText": "[00:12] 请订阅频道",
        }, ExtractionConfig(
            endpoint="https://example.com/v1/chat/completions",
            model="test-model",
            api_key=None,
        ), opener=SequenceOpener([empty, empty]))
        self.assertEqual(result["status"], "empty")
        self.assertTrue(result["emptyConfirmed"])
        self.assertEqual(len(result["attempts"]), 2)
        self.assertEqual(result["attempts"][1]["kind"], "empty_confirmation")

    def test_all_rejected_claims_trigger_contract_repair_not_empty_confirmation(self):
        rejected = {
            "choices": [{"message": {"content": json.dumps({
                "knowledge": [{
                    "type": "leveling",
                    "subjects": [],
                    "claim": "三杠二升六",
                    "conditions": ["三杠二"],
                    "timestampStart": 12,
                    "timestampEnd": 20,
                    "patchSpecific": False,
                    "confidence": "creator_advice",
                }]
            }, ensure_ascii=False)}}]
        }
        repaired = {
            "choices": [{"message": {"content": json.dumps({
                "knowledge": [{
                    "type": "leveling",
                    "subjects": ["升级节奏"],
                    "claim": "三杠二升六",
                    "conditions": ["三杠二"],
                    "timestampStart": 12,
                    "timestampEnd": 20,
                    "patchSpecific": False,
                    "confidence": "creator_advice",
                }]
            }, ensure_ascii=False)}}]
        }
        result = extract_guide_claims_detailed({
            "timestampStart": 10,
            "timestampEnd": 30,
            "timestampedText": "[00:12] 三杠二升六",
        }, ExtractionConfig(
            endpoint="https://example.com/v1/chat/completions",
            model="test-model",
            api_key=None,
        ), opener=SequenceOpener([rejected, repaired]))
        self.assertEqual(result["status"], "success")
        self.assertTrue(result["repaired"])
        self.assertEqual(result["claims"][0]["subjects"], ["升级节奏"])
        self.assertEqual(
            [attempt["kind"] for attempt in result["attempts"]],
            ["extract", "json_repair"],
        )

    def test_segment_failure_is_quarantined_without_losing_successful_segment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.json"
            output = root / "result.json"
            fixture.write_text(json.dumps({
                "metadata": {
                    "videoId": VIDEO_ID,
                    "title": "霞装备与运营",
                    "author": "测试频道",
                    "publishedAt": "2026-07-20",
                    "sourceUrl": f"https://www.youtube.com/watch?v={VIDEO_ID}",
                    "warnings": [],
                },
                "transcript": {
                    "videoId": VIDEO_ID,
                    "durationSeconds": 25,
                    "language": "zh-Hans",
                    "snippets": [
                        {"text": "霞优先做羊刀", "start": 0, "duration": 2},
                        {"text": "八级补完整阵容", "start": 20, "duration": 2},
                    ],
                },
            }, ensure_ascii=False), encoding="utf-8")
            args = Namespace(
                url=VIDEO_ID,
                output=str(output),
                artifact_dir=None,
                env=None,
                fixture=str(fixture),
                season="set17-live",
                patch="17.7",
                region="global",
                locale="zh-CN",
                expires_at=None,
                languages=["zh-Hans"],
                chunk_seconds=10,
                chunk_characters=12000,
                force=True,
                reextract=False,
            )
            success = {
                "status": "success",
                "claims": [{
                    "type": "item_priority",
                    "subjects": ["霞", "羊刀"],
                    "claim": "霞优先制作羊刀",
                    "conditions": ["需要攻速启动"],
                    "timestampStart": 0,
                    "timestampEnd": 2,
                    "patchSpecific": False,
                    "confidence": "creator_advice",
                }],
                "attempts": [],
                "repaired": False,
                "emptyConfirmed": False,
                "rejectedClaims": [],
            }
            failed = {
                "status": "failed",
                "claims": [],
                "attempts": [{
                    "attempt": 1,
                    "kind": "extract",
                    "status": "failed",
                    "rawProviderResponse": None,
                    "rawModelResponse": "bad",
                    "parseOrContractError": "invalid JSON",
                    "rejectedClaims": [],
                    "usage": None,
                }],
                "repaired": False,
                "emptyConfirmed": False,
                "rejectedClaims": [],
                "error": "invalid JSON after repair",
            }
            config = ExtractionConfig(
                endpoint="https://example.com/v1/chat/completions",
                model="test-model",
                api_key=None,
            )
            with patch("cli.resolve_extraction_config", return_value=config), patch(
                "cli.extract_guide_claims_detailed",
                side_effect=[success, failed],
            ):
                result = ingest(args)
            self.assertEqual(result["status"], "partial_success")
            self.assertEqual(len(result["documents"]), 1)
            self.assertEqual(len(result["quarantine"]), 1)
            self.assertEqual(
                [value["status"] for value in result["segments"]],
                ["success", "quarantined"],
            )
            self.assertTrue(Path(result["artifacts"]["rawTranscript"]).exists())
            self.assertTrue(
                Path(result["quarantine"][0]["artifactPath"]).exists()
            )
            cache_files = list(root.rglob("result-*.json"))
            self.assertEqual(len(cache_files), 2)
            self.assertEqual(
                sorted(
                    json.loads(path.read_text(encoding="utf-8"))["finalStatus"]
                    for path in cache_files
                ),
                ["quarantined", "success"],
            )

    def test_acceptance_evaluator_reports_all_required_quality_metrics(self):
        case = {
            "id": "unit-items",
            "category": "single_unit_item_guide",
            "sourceUrl": f"https://www.youtube.com/watch?v={VIDEO_ID}",
            "annotations": {
                "claims": [{
                    "type": "item_priority",
                    "subjects": ["霞", "羊刀"],
                    "claimKeywords": ["优先", "羊刀"],
                    "conditions": ["需要攻速启动"],
                    "timestampStart": 12,
                    "timestampEnd": 20,
                    "timestampTolerance": 1,
                }],
                "irrelevantWindows": [{
                    "timestampStart": 0,
                    "timestampEnd": 5,
                    "reason": "channel introduction",
                }],
            },
        }
        envelope = {
            "status": "success",
            "segments": [{"status": "success"}],
            "quarantine": [],
            "documents": [{
                "id": f"youtube:{VIDEO_ID}:version:item_priority:claim",
                "documentType": "video_guide",
                "text": "霞需要优先制作羊刀来启动攻速。",
                "metadata": {
                    "topics": ["霞", "羊刀"],
                    "conditions": ["需要攻速启动"],
                    "timestampStart": 12,
                    "timestampEnd": 20,
                },
            }],
        }
        result = evaluate_case(case, envelope)
        self.assertEqual(result["metrics"]["entityF1"], 1)
        self.assertEqual(result["metrics"]["claimAccuracy"], 1)
        self.assertEqual(result["metrics"]["conditionExtractionRate"], 1)
        self.assertEqual(result["metrics"]["timestampAccuracy"], 1)
        self.assertEqual(result["metrics"]["irrelevantContentFilteringRate"], 1)
        self.assertEqual(result["metrics"]["duplicateKnowledgeRate"], 0)

    def test_acceptance_evaluator_uses_one_to_one_claim_and_entity_matching(self):
        case = {
            "id": "one-to-one",
            "annotations": {
                "claims": [
                    {
                        "type": "item_priority",
                        "subjects": ["Xayah"],
                        "reviewedClaim": "Xayah should build Last Whisper.",
                    },
                    {
                        "type": "item_priority",
                        "subjects": ["Last Whisper"],
                        "reviewedClaim": "Xayah should build Last Whisper.",
                    },
                ],
                "irrelevantWindows": [],
            },
        }
        envelope = {
            "status": "success",
            "segments": [{"status": "success"}],
            "quarantine": [],
            "documents": [{
                "id": f"youtube:{VIDEO_ID}:version:item_priority:claim",
                "documentType": "video_guide",
                "text": "Xayah should build Last Whisper.",
                "metadata": {
                    "topics": ["Xayah", "Unrelated Topic"],
                    "conditions": [],
                    "timestampStart": 10,
                    "timestampEnd": 20,
                },
            }],
        }
        result = evaluate_case(case, envelope)
        self.assertEqual(result["matchedClaims"], 1)
        self.assertEqual(result["metrics"]["claimAccuracy"], 1)
        self.assertEqual(result["metrics"]["claimRecall"], 0.5)
        self.assertEqual(result["metrics"]["entityPrecision"], 0.5)
        self.assertEqual(result["metrics"]["entityRecall"], 0.5)

    def test_acceptance_evaluator_detects_irrelevant_window_overlap(self):
        case = {
            "id": "overlap",
            "annotations": {
                "claims": [],
                "irrelevantWindows": [{
                    "timestampStart": 5,
                    "timestampEnd": 7,
                    "reason": "advertisement",
                }],
            },
        }
        envelope = {
            "status": "success",
            "segments": [{"status": "success"}],
            "quarantine": [],
            "documents": [{
                "id": f"youtube:{VIDEO_ID}:version:mechanism:claim",
                "documentType": "video_guide",
                "text": "This overlaps the irrelevant window.",
                "metadata": {
                    "topics": [],
                    "conditions": [],
                    "timestampStart": 4,
                    "timestampEnd": 6,
                },
            }],
        }
        result = evaluate_case(case, envelope)
        self.assertEqual(
            result["metrics"]["irrelevantContentFilteringRate"],
            0,
        )

    def test_same_transcript_reuses_empty_segment_and_reextract_reports_delta(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.json"
            output = root / "result.json"
            fixture.write_text(json.dumps({
                "metadata": {
                    "videoId": VIDEO_ID,
                    "title": "短视频",
                    "author": "测试频道",
                    "publishedAt": "2026-07-20",
                    "sourceUrl": f"https://www.youtube.com/watch?v={VIDEO_ID}",
                    "warnings": [],
                },
                "transcript": {
                    "videoId": VIDEO_ID,
                    "durationSeconds": 10,
                    "language": "zh-Hans",
                    "snippets": [
                        {"text": "霞优先做羊刀", "start": 0, "duration": 2},
                    ],
                },
            }, ensure_ascii=False), encoding="utf-8")
            args = Namespace(
                url=VIDEO_ID,
                output=str(output),
                artifact_dir=None,
                env=None,
                fixture=str(fixture),
                season="set17-live",
                patch="17.7",
                region="global",
                locale="zh-CN",
                expires_at=None,
                languages=["zh-Hans"],
                chunk_seconds=900,
                chunk_characters=12000,
                force=True,
                reextract=False,
            )
            config = ExtractionConfig(
                endpoint="https://example.com/v1/chat/completions",
                model="test-model",
                api_key=None,
            )
            empty = {
                "status": "empty",
                "claims": [],
                "attempts": [],
                "repaired": False,
                "emptyConfirmed": True,
                "rejectedClaims": [],
            }
            with patch("cli.resolve_extraction_config", return_value=config), patch(
                "cli.extract_guide_claims_detailed",
                return_value=empty,
            ) as first_extractor:
                first = ingest(args)
            self.assertEqual(len(first["documents"]), 0)
            self.assertEqual(first_extractor.call_count, 1)

            with patch("cli.resolve_extraction_config", return_value=config), patch(
                "cli.extract_guide_claims_detailed",
                side_effect=AssertionError("cached segment must not call model"),
            ) as cached_extractor:
                repeated = ingest(args)
            self.assertEqual(len(repeated["documents"]), 0)
            self.assertEqual(cached_extractor.call_count, 0)
            self.assertTrue(repeated["segments"][0]["cacheHit"])
            self.assertTrue(repeated["runComparison"]["stable"])

            args.reextract = True
            success = {
                "status": "success",
                "claims": [{
                    "type": "item_priority",
                    "subjects": ["霞", "羊刀"],
                    "claim": "霞优先制作羊刀",
                    "conditions": ["需要攻速启动"],
                    "timestampStart": 0,
                    "timestampEnd": 2,
                    "patchSpecific": False,
                    "confidence": "creator_advice",
                }],
                "attempts": [],
                "repaired": False,
                "emptyConfirmed": False,
                "rejectedClaims": [],
            }
            with patch("cli.resolve_extraction_config", return_value=config), patch(
                "cli.extract_guide_claims_detailed",
                return_value=success,
            ):
                reextracted = ingest(args)
            self.assertEqual(len(reextracted["documents"]), 1)
            self.assertEqual(reextracted["runComparison"]["documentCountDelta"], 1)
            self.assertFalse(reextracted["runComparison"]["stable"])

    def test_reextract_preserves_each_run_raw_attempt_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.json"
            output = root / "result.json"
            fixture.write_text(json.dumps({
                "metadata": {
                    "videoId": VIDEO_ID,
                    "title": "Xayah item guide",
                    "author": "Test channel",
                    "publishedAt": "2026-07-20",
                    "sourceUrl": f"https://www.youtube.com/watch?v={VIDEO_ID}",
                    "warnings": [],
                },
                "transcript": {
                    "videoId": VIDEO_ID,
                    "durationSeconds": 10,
                    "language": "en",
                    "snippets": [{
                        "text": "Build Last Whisper on Xayah.",
                        "start": 0,
                        "duration": 2,
                    }],
                },
            }), encoding="utf-8")
            args = Namespace(
                url=VIDEO_ID,
                output=str(output),
                artifact_dir=None,
                env=None,
                fixture=str(fixture),
                source_envelope=None,
                timedtext_json3=None,
                source_metadata=None,
                season="set17-live",
                patch="17.7",
                region="global",
                locale="en",
                expires_at=None,
                languages=["en"],
                chunk_seconds=900,
                chunk_characters=12000,
                force=True,
                reextract=False,
            )
            config = ExtractionConfig(
                endpoint="https://example.com/v1/chat/completions",
                model="test-model",
                api_key=None,
            )

            def successful_result(marker):
                return {
                    "status": "success",
                    "claims": [{
                        "type": "item_priority",
                        "subjects": ["Xayah", "Last Whisper"],
                        "claim": "Build Last Whisper on Xayah.",
                        "conditions": [],
                        "timestampStart": 0,
                        "timestampEnd": 2,
                        "patchSpecific": False,
                        "confidence": "creator_advice",
                    }],
                    "attempts": [{
                        "attempt": 1,
                        "kind": "extract",
                        "status": "success",
                        "rawProviderResponse": {"marker": marker},
                        "rawModelResponse": marker,
                        "parseOrContractError": None,
                        "rejectedClaims": [],
                        "usage": {"total_tokens": 10},
                        "transportRetryCount": 0,
                    }],
                    "repaired": False,
                    "emptyConfirmed": False,
                    "rejectedClaims": [],
                }

            with patch("cli.resolve_extraction_config", return_value=config), patch(
                "cli.extract_guide_claims_detailed",
                return_value=successful_result("first-run"),
            ):
                first = ingest(args)
            first_attempt_path = Path(
                first["segments"][0]["attempts"][0]["artifactPath"]
            )
            first_envelope_path = Path(first["artifacts"]["runEnvelope"])
            first_transcript_path = Path(first["artifacts"]["rawTranscript"])

            args.reextract = True
            with patch("cli.resolve_extraction_config", return_value=config), patch(
                "cli.extract_guide_claims_detailed",
                return_value=successful_result("second-run"),
            ):
                second = ingest(args)
            second_attempt_path = Path(
                second["segments"][0]["attempts"][0]["artifactPath"]
            )

            self.assertNotEqual(first["runId"], second["runId"])
            self.assertNotEqual(
                first["artifacts"]["runRoot"],
                second["artifacts"]["runRoot"],
            )
            self.assertNotEqual(first_attempt_path, second_attempt_path)
            self.assertNotEqual(
                first_transcript_path,
                Path(second["artifacts"]["rawTranscript"]),
            )
            self.assertTrue(first_envelope_path.exists())
            self.assertTrue(Path(second["artifacts"]["runEnvelope"]).exists())
            self.assertTrue(first_transcript_path.exists())
            self.assertTrue(Path(second["artifacts"]["rawTranscript"]).exists())
            self.assertEqual(
                json.loads(first_attempt_path.read_text(encoding="utf-8"))[
                    "rawModelResponse"
                ],
                "first-run",
            )
            self.assertEqual(
                json.loads(second_attempt_path.read_text(encoding="utf-8"))[
                    "rawModelResponse"
                ],
                "second-run",
            )

    def test_video_document_schema_requires_source_timestamp(self):
        errors = validate_knowledge_document({
            "schemaVersion": "knowledge_document.v1",
            "id": "youtube:test",
            "documentType": "video_guide",
            "title": "测试",
            "text": "测试内容",
            "metadata": {
                "source": "youtube",
                "claimType": "creator_advice",
                "topics": [],
                "conditions": [],
            },
        })
        self.assertIn("video_guide metadata.timestampStart is required", errors)
        self.assertIn("video_guide metadata.sourceId is required", errors)


if __name__ == "__main__":
    unittest.main()
