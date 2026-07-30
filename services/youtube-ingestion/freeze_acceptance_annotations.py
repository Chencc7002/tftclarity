"""Freeze reviewed live YouTube outputs into an auditable acceptance baseline."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
OUTPUTS = ROOT / ".cache" / "youtube-acceptance" / "outputs"
ANNOTATIONS = Path(__file__).resolve().parent / "acceptance" / "annotations"

CASES = [
    {
        "id": "short-fundamentals",
        "category": "short_video",
        "videoId": "BpFL4kmfp1Q",
        "output": "BpFL4kmfp1Q-v5.json",
        "season": "set17-live",
        "patch": "17.7",
        "irrelevantWindows": [
            {
                "timestampStart": 273.68,
                "timestampEnd": 290.88,
                "reason": "site promotion and outro",
            },
        ],
    },
    {
        "id": "long-video",
        "category": "video_over_30_minutes",
        "videoId": "FkDvDkdid_w",
        "output": "FkDvDkdid_w.json",
        "season": "set17-live",
        "patch": "17.7",
        "irrelevantWindows": [
            {
                "timestampStart": 2559.2,
                "timestampEnd": 2575.88,
                "reason": "closing remarks and call for comments",
            },
        ],
    },
    {
        "id": "poor-auto-captions",
        "category": "poor_subtitle_quality",
        "videoId": "K0LJ1j1xANc",
        "output": "K0LJ1j1xANc.json",
        "season": "set17-live",
        "patch": "17.7",
        "irrelevantWindows": [
            {
                "timestampStart": 4.56,
                "timestampEnd": 15.9,
                "reason": "pre-guide banter and laughter",
            },
            {
                "timestampStart": 2349.3,
                "timestampEnd": 2358.96,
                "reason": "subscribe call and outro",
            },
        ],
    },
    {
        "id": "single-unit-items",
        "category": "single_unit_item_guide",
        "videoId": "ag_FVgVScMk",
        "output": "ag_FVgVScMk.json",
        "season": "set3-historical",
        "patch": "10.11",
        "irrelevantWindows": [
            {
                "timestampStart": 1224.7,
                "timestampEnd": 1243.13,
                "reason": "comments request and outro",
            },
        ],
    },
    {
        "id": "comp-operations",
        "category": "comp_operations_guide",
        "videoId": "Bv3nJAHUeLA",
        "output": "Bv3nJAHUeLA.json",
        "season": "set17-live",
        "patch": "17.7",
        "irrelevantWindows": [
            {
                "timestampStart": 1355.2,
                "timestampEnd": 1367.92,
                "reason": "channel plans and outro",
            },
        ],
    },
    {
        "id": "mixed-gameplay-chatter",
        "category": "tft_with_unrelated_chatter",
        "videoId": "aSW-okm70Ns",
        "output": "aSW-okm70Ns.json",
        "season": "set17-live",
        "patch": "17.7",
        "irrelevantWindows": [
            {
                "timestampStart": 8.6,
                "timestampEnd": 40,
                "reason": "merchandise promotion before set discussion",
            },
        ],
    },
]


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def transcript_excerpt(
    snippets: list[dict[str, Any]],
    start: float,
    end: float,
) -> str:
    selected = [
        f"[{float(value['start']):.2f}] {str(value.get('text') or '').strip()}"
        for value in snippets
        if float(value.get("start") or 0) < end + 3
        and float(value.get("start") or 0)
        + float(value.get("duration") or 0) >= start - 3
    ]
    return "\n".join(selected)[:4000]


def freeze_case(config: dict[str, Any]) -> dict[str, Any]:
    output_path = OUTPUTS / config["output"]
    envelope = read_json(output_path)
    artifact_path = Path(envelope["artifacts"]["rawTranscript"])
    if not artifact_path.is_absolute():
        artifact_path = ROOT / artifact_path
    transcript_artifact = read_json(artifact_path)
    snippets = transcript_artifact["transcript"]["snippets"]
    claims = []
    for document in envelope["documents"]:
        metadata = document["metadata"]
        start = float(metadata["timestampStart"])
        end = float(metadata["timestampEnd"])
        excerpt = transcript_excerpt(snippets, start, end)
        if not excerpt:
            raise ValueError(f"{document['id']} has no overlapping transcript excerpt")
        claims.append({
            "type": document["id"].split(":")[-2],
            "subjects": metadata["topics"],
            "claimKeywords": [document["text"]],
            "minimumKeywordMatches": 1,
            "conditions": metadata.get("conditions") or [],
            "timestampStart": start,
            "timestampEnd": end,
            "timestampTolerance": 5,
            "reviewDecision": "source_window_supported_by_codex",
            "reviewedClaim": document["text"],
            "transcriptExcerpt": excerpt,
        })
    source = envelope["source"]
    return {
        "schemaVersion": "youtube_acceptance_annotation.v1",
        "id": config["id"],
        "category": config["category"],
        "sourceUrl": source["sourceUrl"],
        "videoId": config["videoId"],
        "season": config["season"],
        "patch": config["patch"],
        "locale": source["locale"],
        "output": config["output"],
        "annotationStatus": "provisional",
        "annotationProvenance": {
            "reviewer": "Codex transcript-window review",
            "reviewerType": "codex",
            "method": "claim-by-claim source transcript window review",
            "independentHumanReview": False,
            "seedSource": "model_output",
            "sourceTranscriptHash": source["transcriptHash"],
            "videoVersion": source["videoVersion"],
            "note": (
                "This is a model-output-derived review seed, not independent "
                "human ground truth. A human reviewer must verify, correct, "
                "and explicitly sign it before the acceptance gate can pass."
            ),
        },
        "annotations": {
            "claims": claims,
            "irrelevantWindows": config["irrelevantWindows"],
        },
    }


def main() -> int:
    ANNOTATIONS.mkdir(parents=True, exist_ok=True)
    summary = []
    for config in CASES:
        annotation = freeze_case(config)
        path = ANNOTATIONS / f"{config['id']}.json"
        path.write_text(
            json.dumps(annotation, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        summary.append({
            "caseId": config["id"],
            "claims": len(annotation["annotations"]["claims"]),
            "irrelevantWindows": len(
                annotation["annotations"]["irrelevantWindows"]
            ),
            "path": str(path),
        })
    print(json.dumps({"ok": True, "cases": summary}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
