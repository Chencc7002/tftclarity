"""Manual YouTube ingestion with segment-level durability and traceability."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

CURRENT_DIR = Path(__file__).resolve().parent
WORKSPACE_DIR = CURRENT_DIR.parent.parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from guide_extractor import (  # noqa: E402
    NORMALIZER_VERSION,
    extract_guide_claims_detailed,
    resolve_extraction_config,
)
from metadata_fetcher import fetch_video_metadata  # noqa: E402
from schema_validator import (  # noqa: E402
    assert_knowledge_document,
    validate_ingestion_envelope,
)
from transcript_chunker import chunk_transcript  # noqa: E402
from youtube_fetcher import (  # noqa: E402
    extract_video_id,
    fetch_transcript,
    transcript_from_youtube_json3,
)


def load_workspace_env(path: Path | None = None) -> None:
    env_path = path or WORKSPACE_DIR / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(value: Any) -> str:
    return hashlib.sha256(
        (value if isinstance(value, str) else _canonical_json(value)).encode("utf-8")
    ).hexdigest()


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{uuid4().hex}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(path)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _claim_title(claim: dict[str, Any], video_title: str) -> str:
    labels = {
        "comp_recommendation": "阵容建议",
        "item_priority": "装备优先级",
        "opener": "开局条件",
        "transition": "过渡路线",
        "leveling": "升级节奏",
        "reroll_timing": "搜牌节奏",
        "positioning": "站位",
        "late_game_pivot": "后期转换",
        "risk": "风险与不适用条件",
        "patch_specific": "版本特定观点",
        "mechanism": "机制解释",
    }
    return f"{video_title} — {labels.get(claim['type'], claim['type'])}"


def _claim_identity(claim: dict[str, Any]) -> str:
    return _sha256({
        "type": claim["type"],
        "subjects": sorted(claim["subjects"]),
        "claim": " ".join(claim["claim"].split()),
        "conditions": sorted(claim["conditions"]),
        "timestampStart": round(float(claim["timestampStart"]), 3),
        "timestampEnd": round(float(claim["timestampEnd"]), 3),
        "confidence": claim["confidence"],
    })[:20]


def create_document(
    video: dict[str, Any],
    claim: dict[str, Any],
    args: argparse.Namespace,
    *,
    video_version: str,
    transcript_hash: str,
    segment: dict[str, Any],
    segment_id: str,
    run_id: str,
    extraction_model: str,
    prompt_version: str,
    generated_at: str,
) -> dict[str, Any]:
    claim_id = _claim_identity(claim)
    document = {
        "schemaVersion": "knowledge_document.v1",
        "id": (
            f"youtube:{video['videoId']}:{video_version}:"
            f"{claim['type']}:{claim_id}"
        ),
        "documentType": "video_guide",
        "title": _claim_title(claim, video["title"]),
        "text": claim["claim"],
        "metadata": {
            "source": "youtube",
            "sourceId": video["videoId"],
            "sourceTitle": video["title"],
            "author": video["author"],
            "publishedAt": video["publishedAt"],
            "season": args.season,
            "patch": args.patch,
            "region": args.region,
            "locale": args.locale,
            "topics": claim["subjects"],
            "timestampStart": claim["timestampStart"],
            "timestampEnd": claim["timestampEnd"],
            "claimType": claim["confidence"],
            "conditions": claim["conditions"],
            "sourceUrl": video["sourceUrl"],
            "generatedAt": generated_at,
            "expiresAt": args.expires_at,
            "namespace": "video_guides",
            "videoVersion": video_version,
            "transcriptHash": transcript_hash,
            "segmentId": segment_id,
            "segmentIndex": segment["index"],
            "segmentStatus": "success",
            "ingestionRunId": run_id,
            "ingestionStatus": "success",
            "extractionModel": extraction_model,
            "extractionPromptVersion": prompt_version,
            "aiGenerated": True,
            "contentOrigin": "ai_generated_transcript_summary",
            "reviewStatus": "ai_generated_unreviewed",
            "contentDisclosure": (
                "AI-generated summary from a YouTube transcript; "
                "not independently human-reviewed."
            ),
            "isCurrentVersion": True,
        },
    }
    return assert_knowledge_document(document)


def _fixture(path: str) -> tuple[dict[str, Any], dict[str, Any]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    metadata = payload.get("metadata")
    transcript = payload.get("transcript")
    if not isinstance(metadata, dict) or not isinstance(transcript, dict):
        raise ValueError("Fixture must contain metadata and transcript objects")
    return metadata, transcript


def _captured_source(path: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    envelope_path = Path(path).resolve()
    envelope = _read_json(envelope_path)
    if not envelope:
        raise ValueError("Captured source envelope is missing or invalid JSON")
    source = envelope.get("source")
    artifacts = envelope.get("artifacts")
    if not isinstance(source, dict) or not isinstance(artifacts, dict):
        raise ValueError("Captured source envelope must contain source and artifacts")
    raw_transcript_value = artifacts.get("rawTranscript")
    if not isinstance(raw_transcript_value, str) or not raw_transcript_value:
        raise ValueError("Captured source envelope is missing artifacts.rawTranscript")
    raw_transcript_path = Path(raw_transcript_value)
    if not raw_transcript_path.is_absolute():
        workspace_candidate = WORKSPACE_DIR / raw_transcript_path
        envelope_candidate = envelope_path.parent / raw_transcript_path
        raw_transcript_path = (
            workspace_candidate
            if workspace_candidate.exists()
            else envelope_candidate
        )
    artifact = _read_json(raw_transcript_path)
    transcript = artifact.get("transcript") if artifact else None
    if not isinstance(transcript, dict):
        raise ValueError("Captured raw transcript artifact is missing transcript")
    metadata = {
        "videoId": source.get("videoId"),
        "title": source.get("title"),
        "author": source.get("author"),
        "publishedAt": source.get("publishedAt"),
        "sourceUrl": source.get("sourceUrl"),
        "warnings": ["youtube_source_replayed_from_live_capture"],
    }
    capture = {
        "mode": "recorded_live_replay",
        "envelopePath": str(envelope_path),
        "rawTranscriptPath": str(raw_transcript_path.resolve()),
        "originalRunId": envelope.get("runId"),
        "originalWarnings": list(envelope.get("warnings") or []),
        "videoVersion": source.get("videoVersion"),
        "transcriptHash": source.get("transcriptHash"),
    }
    return metadata, transcript, capture


def _browser_capture(
    metadata_path_value: str,
    timedtext_path_value: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    metadata_path = Path(metadata_path_value).resolve()
    timedtext_path = Path(timedtext_path_value).resolve()
    metadata = _read_json(metadata_path)
    timedtext = _read_json(timedtext_path)
    if not metadata:
        raise ValueError("Browser-captured source metadata is missing or invalid")
    if not timedtext:
        raise ValueError("Browser-captured timedtext JSON3 is missing or invalid")
    video_id = str(metadata.get("videoId") or "")
    transcript = transcript_from_youtube_json3(
        timedtext,
        video_id,
        language=str(metadata.get("language") or "en"),
    )
    metadata["warnings"] = list(metadata.get("warnings") or []) + [
        "youtube_source_captured_from_authenticated_browser",
    ]
    capture = {
        "mode": "authenticated_browser_capture",
        "metadataPath": str(metadata_path),
        "timedtextPath": str(timedtext_path),
        "timedtextHash": _sha256(timedtext),
    }
    return metadata, transcript, capture


def _run_comparison(
    previous: dict[str, Any] | None,
    current_documents: list[dict[str, Any]],
    current_segments: list[dict[str, Any]],
) -> dict[str, Any]:
    def semantic_projection(document: dict[str, Any]) -> dict[str, Any]:
        metadata = dict(document.get("metadata") or {})
        for key in (
            "generatedAt",
            "expiresAt",
            "ingestionRunId",
            "ingestionStatus",
        ):
            metadata.pop(key, None)
        return {
            "id": document.get("id"),
            "documentType": document.get("documentType"),
            "title": document.get("title"),
            "text": document.get("text"),
            "metadata": metadata,
        }

    previous_documents = previous.get("documents", []) if previous else []
    previous_segments = previous.get("segments", []) if previous else []
    before = {str(value.get("id")): value for value in previous_documents if value.get("id")}
    after = {str(value.get("id")): value for value in current_documents if value.get("id")}
    semantic_changed = [
        key for key in before.keys() & after.keys()
        if _canonical_json(semantic_projection(before[key]))
        != _canonical_json(semantic_projection(after[key]))
    ]
    record_changed = [
        key for key in before.keys() & after.keys()
        if _canonical_json(before[key]) != _canonical_json(after[key])
    ]
    metadata_only_changed = sorted(set(record_changed) - set(semantic_changed))
    previous_status = {
        str(value.get("segmentId") or value.get("index")): value.get("status")
        for value in previous_segments
    }
    current_status = {
        str(value.get("segmentId") or value.get("index")): value.get("status")
        for value in current_segments
    }
    return {
        "previousRunId": previous.get("runId") if previous else None,
        "previousDocumentCount": len(previous_documents),
        "currentDocumentCount": len(current_documents),
        "addedDocumentIds": sorted(after.keys() - before.keys()),
        "removedDocumentIds": sorted(before.keys() - after.keys()),
        "changedDocumentIds": sorted(semantic_changed),
        "semanticChangedDocumentIds": sorted(semantic_changed),
        "recordChangedDocumentIds": sorted(record_changed),
        "metadataOnlyChangedDocumentIds": metadata_only_changed,
        "documentCountDelta": len(current_documents) - len(previous_documents),
        "segmentStatusChanges": [
            {
                "segmentId": key,
                "before": previous_status.get(key),
                "after": current_status.get(key),
            }
            for key in sorted(previous_status.keys() | current_status.keys())
            if previous_status.get(key) != current_status.get(key)
        ],
        "stable": bool(previous) and not (
            after.keys() ^ before.keys()
            or semantic_changed
            or any(
                previous_status.get(key) != current_status.get(key)
                for key in previous_status.keys() | current_status.keys()
            )
        ),
        "recordStable": bool(previous) and not (
            after.keys() ^ before.keys() or record_changed
        ),
    }


def _envelope_status(segments: list[dict[str, Any]], document_count: int) -> str:
    failed = sum(value.get("status") == "quarantined" for value in segments)
    if failed == len(segments):
        return "failed"
    if failed:
        return "partial_success"
    if document_count == 0:
        return "success"
    return "success"


def _public_attempt(attempt: dict[str, Any], artifact_path: Path) -> dict[str, Any]:
    return {
        "attempt": attempt["attempt"],
        "kind": attempt["kind"],
        "status": attempt["status"],
        "parseOrContractError": attempt.get("parseOrContractError"),
        "rejectedClaimCount": len(attempt.get("rejectedClaims") or []),
        "usage": attempt.get("usage"),
        "transportRetryCount": attempt.get("transportRetryCount", 0),
        "artifactPath": str(artifact_path),
    }


def ingest(args: argparse.Namespace) -> dict[str, Any]:
    load_workspace_env(Path(args.env) if args.env else None)
    if not args.season or not args.patch:
        raise ValueError("YouTube ingestion requires explicit season and patch scope")
    video_id = extract_video_id(args.url)
    output_path = (
        Path(args.output)
        if args.output
        else CURRENT_DIR / "output" / f"{video_id}.json"
    )
    previous = _read_json(output_path) if output_path.exists() else None
    if previous and not args.force and not args.reextract:
        errors = validate_ingestion_envelope(previous)
        if errors:
            raise ValueError("Existing output is invalid: " + "; ".join(errors))
        return {**previous, "duplicate": True, "outputPath": str(output_path)}

    source_envelope = getattr(args, "source_envelope", None)
    timedtext_json3 = getattr(args, "timedtext_json3", None)
    source_metadata = getattr(args, "source_metadata", None)
    selected_sources = sum(bool(value) for value in (
        args.fixture,
        source_envelope,
        timedtext_json3 or source_metadata,
    ))
    if selected_sources > 1:
        raise ValueError(
            "--fixture, --source-envelope and browser capture are mutually exclusive"
        )
    if bool(timedtext_json3) != bool(source_metadata):
        raise ValueError(
            "--timedtext-json3 and --source-metadata must be provided together"
        )
    if args.fixture:
        metadata, transcript = _fixture(args.fixture)
        source_acquisition = {
            "mode": "fixture",
            "fixturePath": str(Path(args.fixture).resolve()),
        }
        if metadata.get("videoId") != video_id or transcript.get("videoId") != video_id:
            raise ValueError("Fixture videoId does not match the requested URL")
    elif source_envelope:
        metadata, transcript, source_acquisition = _captured_source(source_envelope)
        if metadata.get("videoId") != video_id or transcript.get("videoId") != video_id:
            raise ValueError("Captured source videoId does not match the requested URL")
    elif timedtext_json3:
        metadata, transcript, source_acquisition = _browser_capture(
            source_metadata,
            timedtext_json3,
        )
        if metadata.get("videoId") != video_id or transcript.get("videoId") != video_id:
            raise ValueError("Browser capture videoId does not match the requested URL")
    else:
        metadata = fetch_video_metadata(args.url)
        transcript = fetch_transcript(args.url, languages=args.languages)
        source_acquisition = {"mode": "live"}

    chunks = chunk_transcript(
        transcript["snippets"],
        max_duration_seconds=args.chunk_seconds,
        max_characters=args.chunk_characters,
    )
    extraction_config = resolve_extraction_config()
    transcript_hash = _sha256({
        "videoId": video_id,
        "language": transcript.get("language"),
        "snippets": transcript["snippets"],
    })
    if source_envelope:
        captured_hash = source_acquisition.get("transcriptHash")
        if captured_hash and captured_hash != transcript_hash:
            raise ValueError("Captured transcriptHash does not match raw transcript")
    video_version = _sha256({
        "videoId": video_id,
        "publishedAt": metadata["publishedAt"],
        "transcriptHash": transcript_hash,
    })[:20]
    if source_envelope:
        captured_version = source_acquisition.get("videoVersion")
        if captured_version and captured_version != video_version:
            raise ValueError("Captured videoVersion does not match source snapshot")
    config_hash = _sha256({
        "endpoint": extraction_config.endpoint,
        "model": extraction_config.model,
        "promptVersion": extraction_config.prompt_version,
        "normalizerVersion": NORMALIZER_VERSION,
        "maxOutputTokens": extraction_config.max_output_tokens,
        "retryEmptyOnce": extraction_config.retry_empty_once,
        "thinkingMode": extraction_config.thinking_mode,
        "chunkSeconds": args.chunk_seconds,
        "chunkCharacters": args.chunk_characters,
    })[:16]
    run_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{uuid4().hex[:8]}"
    generated_at = _utc_now()
    artifact_root = (
        Path(args.artifact_dir)
        if args.artifact_dir
        else output_path.parent / f"{output_path.stem}.artifacts" / video_version
    )
    run_artifact_root = artifact_root / "runs" / run_id
    canonical_transcript_path = artifact_root / "raw-transcript.json"
    transcript_path = run_artifact_root / "raw-transcript.json"
    transcript_artifact = {
        "schemaVersion": "youtube_transcript_artifact.v1",
        "videoId": video_id,
        "videoVersion": video_version,
        "transcriptHash": transcript_hash,
        "transcript": transcript,
    }
    _write_json(canonical_transcript_path, transcript_artifact)
    _write_json(transcript_path, transcript_artifact)

    run_envelope_path = run_artifact_root / "ingestion-envelope.json"
    documents: list[dict[str, Any]] = []
    segments: list[dict[str, Any]] = []
    quarantine: list[dict[str, Any]] = []
    warnings = list(metadata.get("warnings") or [])

    envelope: dict[str, Any] = {
        "schemaVersion": "youtube_ingestion.v2",
        "runId": run_id,
        "status": "processing",
        "source": {
            "type": "youtube",
            "videoId": video_id,
            "videoVersion": video_version,
            "transcriptHash": transcript_hash,
            "title": metadata["title"],
            "author": metadata["author"],
            "publishedAt": metadata["publishedAt"],
            "sourceUrl": metadata["sourceUrl"],
            "durationSeconds": transcript["durationSeconds"],
            "season": args.season,
            "patch": args.patch,
            "region": args.region,
            "locale": args.locale,
        },
        "extraction": {
            "model": extraction_config.model,
            "promptVersion": extraction_config.prompt_version,
            "normalizerVersion": NORMALIZER_VERSION,
            "configHash": config_hash,
            "retryEmptyOnce": extraction_config.retry_empty_once,
            "maxOutputTokens": extraction_config.max_output_tokens,
            "thinkingMode": extraction_config.thinking_mode,
            "transportRetries": extraction_config.transport_retries,
            "transportRetryDelaySeconds": (
                extraction_config.transport_retry_delay_seconds
            ),
        },
        "artifacts": {
            "root": str(artifact_root),
            "runRoot": str(run_artifact_root),
            "rawTranscript": str(transcript_path),
            "canonicalRawTranscript": str(canonical_transcript_path),
            "runEnvelope": str(run_envelope_path),
        },
        "sourceAcquisition": source_acquisition,
        "segments": segments,
        "quarantine": quarantine,
        "documents": documents,
        "warnings": warnings,
        "duplicate": False,
        "generatedAt": generated_at,
    }
    _write_json(output_path, envelope)
    _write_json(run_envelope_path, envelope)

    seen_document_ids: set[str] = set()
    previous_config_hash = (
        (previous.get("extraction") or {}).get("configHash")
        if previous
        else None
    )
    previous_segment_status = {
        str(segment.get("segmentId")): segment.get("status")
        for segment in (previous.get("segments") or [])
        if isinstance(segment, dict) and segment.get("segmentId")
    } if previous else {}
    for chunk in chunks:
        segment_hash = _sha256({
            "timestampStart": chunk["timestampStart"],
            "timestampEnd": chunk["timestampEnd"],
            "timestampedText": chunk["timestampedText"],
        })
        segment_id = f"{video_version}:{chunk['index']:04d}:{segment_hash[:12]}"
        cache_segment_dir = (
            artifact_root / "segments"
            / f"{chunk['index']:04d}-{segment_hash[:12]}"
        )
        run_segment_dir = (
            run_artifact_root / "segments"
            / f"{chunk['index']:04d}-{segment_hash[:12]}"
        )
        cache_path = cache_segment_dir / f"result-{config_hash}.json"
        cached = None if args.reextract else _read_json(cache_path)
        cached_final_status = cached.get("finalStatus") if cached else None
        if (
            cached
            and cached_final_status is None
            and previous_config_hash == config_hash
        ):
            cached_final_status = previous_segment_status.get(segment_id)
        cache_hit = bool(
            cached
            and cached.get("segmentHash") == segment_hash
            and cached_final_status in {"success", "empty"}
            and (cached.get("result") or {}).get("status") in {"success", "empty"}
        )
        result = cached.get("result") if cache_hit else extract_guide_claims_detailed(
            chunk,
            extraction_config,
        )

        public_attempts: list[dict[str, Any]] = []
        for attempt in result.get("attempts", []):
            attempt_path = (
                run_segment_dir
                / f"attempt-{attempt['attempt']}-{attempt['kind']}.json"
            )
            _write_json(attempt_path, {
                "schemaVersion": "youtube_extraction_attempt.v1",
                "runId": run_id,
                "videoId": video_id,
                "videoVersion": video_version,
                "segmentId": segment_id,
                "segmentHash": segment_hash,
                "cacheHit": cache_hit,
                "cacheArtifactPath": str(cache_path) if cache_hit else None,
                "transcript": {
                    "timestampStart": chunk["timestampStart"],
                    "timestampEnd": chunk["timestampEnd"],
                    "timestampedText": chunk["timestampedText"],
                },
                **attempt,
            })
            public_attempts.append(_public_attempt(attempt, attempt_path))

        built_documents: list[dict[str, Any]] = []
        document_validation_errors: list[dict[str, Any]] = []
        if result["status"] == "success":
            for claim_index, claim in enumerate(result.get("claims", [])):
                try:
                    built_documents.append(create_document(
                        metadata,
                        claim,
                        args,
                        video_version=video_version,
                        transcript_hash=transcript_hash,
                        segment=chunk,
                        segment_id=segment_id,
                        run_id=run_id,
                        extraction_model=extraction_config.model,
                        prompt_version=extraction_config.prompt_version,
                        generated_at=generated_at,
                    ))
                except Exception as exc:
                    document_validation_errors.append({
                        "stage": "knowledge_document",
                        "claimIndex": claim_index,
                        "error": str(exc),
                        "claim": claim,
                    })
        status = {
            "success": "success" if built_documents else "quarantined",
            "empty": "empty",
            "failed": "quarantined",
        }[result["status"]]
        if result["status"] == "success" and not built_documents:
            result["error"] = (
                "all extracted claims failed KnowledgeDocument validation"
            )
        if not cache_hit or (cached and cached.get("finalStatus") is None):
            _write_json(cache_path, {
                "schemaVersion": "youtube_segment_extraction_cache.v1",
                "videoVersion": video_version,
                "segmentId": segment_id,
                "segmentHash": segment_hash,
                "configHash": config_hash,
                "finalStatus": status,
                "documentValidationErrors": document_validation_errors,
                "result": result,
            })
        segment_record = {
            "segmentId": segment_id,
            "index": chunk["index"],
            "segmentHash": segment_hash,
            "timestampStart": chunk["timestampStart"],
            "timestampEnd": chunk["timestampEnd"],
            "snippetCount": chunk["snippetCount"],
            "status": status,
            "cacheHit": cache_hit,
            "claimCount": len(built_documents),
            "extractedClaimCount": len(result.get("claims") or []),
            "rejectedClaimCount": (
                len(result.get("rejectedClaims") or [])
                + len(document_validation_errors)
            ),
            "repaired": bool(result.get("repaired")),
            "emptyConfirmed": bool(result.get("emptyConfirmed")),
            "attempts": public_attempts,
            "validationErrors": [
                {
                    "attempt": attempt["attempt"],
                    "error": attempt.get("parseOrContractError"),
                    "rejectedClaims": attempt.get("rejectedClaims") or [],
                }
                for attempt in result.get("attempts", [])
                if attempt.get("parseOrContractError") or attempt.get("rejectedClaims")
            ] + document_validation_errors,
            "normalizationWarnings": [
                warning
                for claim in result.get("claims", [])
                for warning in claim.get("normalizationWarnings", [])
            ],
        }

        if status == "quarantined":
            quarantine_path = (
                run_artifact_root / "quarantine"
                / f"segment-{chunk['index']:04d}-{segment_hash[:12]}.json"
            )
            quarantine_record = {
                "schemaVersion": "youtube_segment_quarantine.v1",
                "runId": run_id,
                "videoId": video_id,
                "videoVersion": video_version,
                "segmentId": segment_id,
                "segmentHash": segment_hash,
                "status": "quarantined",
                "error": result.get("error"),
                "attempts": public_attempts,
                "transcript": chunk,
            }
            _write_json(quarantine_path, quarantine_record)
            quarantine.append({
                "segmentId": segment_id,
                "error": result.get("error"),
                "artifactPath": str(quarantine_path),
            })
            segment_record["quarantineArtifactPath"] = str(quarantine_path)
        else:
            for document in built_documents:
                if document["id"] not in seen_document_ids:
                    seen_document_ids.add(document["id"])
                    documents.append(document)

        segment_path = run_segment_dir / "segment-status.json"
        segment_record["artifactPath"] = str(segment_path)
        _write_json(segment_path, {
            "schemaVersion": "youtube_segment_status.v1",
            "runId": run_id,
            "videoId": video_id,
            "videoVersion": video_version,
            **segment_record,
        })
        segments.append(segment_record)
        envelope["status"] = "processing"
        _write_json(output_path, envelope)
        _write_json(run_envelope_path, envelope)

    envelope["status"] = _envelope_status(segments, len(documents))
    for document in documents:
        document["metadata"]["ingestionStatus"] = envelope["status"]
    if not documents:
        warnings.append("no_actionable_tft_knowledge_extracted")
    if quarantine:
        warnings.append(f"quarantined_segments:{len(quarantine)}")
    envelope["runComparison"] = _run_comparison(previous, documents, segments)
    envelope["duplicate"] = envelope["runComparison"]["stable"]
    envelope["completedAt"] = _utc_now()
    errors = validate_ingestion_envelope(envelope)
    if errors:
        envelope["status"] = "failed"
        envelope["validationErrors"] = errors
        _write_json(output_path, envelope)
        _write_json(run_envelope_path, envelope)
        raise ValueError("Invalid ingestion output: " + "; ".join(errors))
    _write_json(output_path, envelope)
    _write_json(run_envelope_path, envelope)
    return {**envelope, "outputPath": str(output_path)}


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(
        description="Import a TFT YouTube guide as durable KnowledgeDocument JSON"
    )
    value.add_argument("url", help="YouTube URL or 11-character video ID")
    value.add_argument("--output")
    value.add_argument("--artifact-dir")
    value.add_argument("--env")
    value.add_argument(
        "--fixture",
        help="Offline metadata/transcript fixture for deterministic acceptance tests",
    )
    value.add_argument(
        "--source-envelope",
        help=(
            "Replay a previously captured live envelope and its raw transcript "
            "without refetching YouTube"
        ),
    )
    value.add_argument(
        "--timedtext-json3",
        help="Authenticated browser-captured YouTube timedtext JSON3 file",
    )
    value.add_argument(
        "--source-metadata",
        help="Metadata JSON paired with --timedtext-json3",
    )
    value.add_argument(
        "--season",
        default=os.getenv("TFT_AGENT_SEASON_CONTEXT_ID", "set17-live"),
    )
    value.add_argument(
        "--patch",
        default=os.getenv("TFT_AGENT_EFFECTIVE_PATCH") or None,
    )
    value.add_argument("--region", default=None)
    value.add_argument("--locale", default="zh-CN")
    value.add_argument("--expires-at", default=None)
    value.add_argument("--languages", nargs="+", default=["zh-Hans", "zh-Hant", "en"])
    value.add_argument("--chunk-seconds", type=float, default=900)
    value.add_argument("--chunk-characters", type=int, default=12000)
    value.add_argument(
        "--force",
        action="store_true",
        help="Rebuild the envelope while reusing successful segment cache entries",
    )
    value.add_argument(
        "--reextract",
        action="store_true",
        help="Call the model again for every segment and record run-to-run differences",
    )
    return value


def main() -> int:
    try:
        result = ingest(parser().parse_args())
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get("status") != "failed" else 2
    except Exception as exc:
        print(json.dumps({
            "schemaVersion": "youtube_ingestion_error.v1",
            "ok": False,
            "error": str(exc),
            "errorType": type(exc).__name__,
        }, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
