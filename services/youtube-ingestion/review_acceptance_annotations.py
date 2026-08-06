"""Export and apply independently reviewed YouTube acceptance annotations.

The export is deliberately separate from the source annotations. Applying a
review writes a complete reviewed acceptance set to a new directory unless the
caller explicitly opts into ``--in-place``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any


REVIEW_SCHEMA_VERSION = "youtube_acceptance_review.v1"
FINAL_CLAIM_DECISIONS = {"supported", "rejected", "modified"}
FINAL_IRRELEVANT_DECISIONS = {"confirmed_irrelevant", "rejected"}


def _read_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def _canonical_hash(value: Any) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _claim_fingerprint(case_id: str, index: int, claim: dict[str, Any]) -> str:
    return _canonical_hash({
        "caseId": case_id,
        "index": index,
        "type": claim.get("type"),
        "subjects": claim.get("subjects") or [],
        "conditions": claim.get("conditions") or [],
        "timestampStart": claim.get("timestampStart"),
        "timestampEnd": claim.get("timestampEnd"),
        "reviewedClaim": claim.get("reviewedClaim"),
        "transcriptExcerpt": claim.get("transcriptExcerpt"),
    })


def _window_fingerprint(case_id: str, index: int, window: dict[str, Any]) -> str:
    return _canonical_hash({
        "caseId": case_id,
        "index": index,
        "timestampStart": window.get("timestampStart"),
        "timestampEnd": window.get("timestampEnd"),
        "reason": window.get("reason"),
    })


def _resolved_cases(
    manifest: dict[str, Any],
    manifest_directory: Path,
) -> list[tuple[dict[str, Any], Path]]:
    result = []
    for entry in manifest.get("cases") or []:
        annotation_file = entry.get("annotationFile")
        if not annotation_file:
            raise ValueError(f"case {entry.get('id')} is missing annotationFile")
        path = manifest_directory / str(annotation_file)
        annotation = _read_object(path)
        if annotation.get("id") != entry.get("id"):
            raise ValueError(
                f"case id mismatch: manifest={entry.get('id')} "
                f"annotation={annotation.get('id')}"
            )
        result.append((annotation, path))
    return result


def export_review(
    manifest_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    manifest = _read_object(manifest_path)
    cases = []
    for annotation, _path in _resolved_cases(manifest, manifest_path.parent):
        case_id = str(annotation["id"])
        annotations = annotation.get("annotations") or {}
        claims = annotations.get("claims") or []
        irrelevant_windows = annotations.get("irrelevantWindows") or []
        cases.append({
            "id": case_id,
            "videoId": annotation.get("videoId"),
            "sourceUrl": annotation.get("sourceUrl"),
            "sourceTranscriptHash": (
                annotation.get("annotationProvenance") or {}
            ).get("sourceTranscriptHash"),
            "claims": [
                {
                    "index": index,
                    "fingerprint": _claim_fingerprint(case_id, index, claim),
                    "decision": None,
                    "revision": {
                        "reviewedClaim": None,
                        "subjects": None,
                        "conditions": None,
                        "timestampStart": None,
                        "timestampEnd": None,
                    },
                    "reviewerNote": "",
                }
                for index, claim in enumerate(claims)
            ],
            "irrelevantWindows": [
                {
                    "index": index,
                    "fingerprint": _window_fingerprint(case_id, index, window),
                    "decision": None,
                    "reviewerNote": "",
                }
                for index, window in enumerate(irrelevant_windows)
            ],
            "additionalClaims": [],
        })
    review = {
        "schemaVersion": REVIEW_SCHEMA_VERSION,
        "manifestHash": _canonical_hash(manifest),
        "manifestName": manifest.get("name"),
        "reviewer": "",
        "reviewedAt": "",
        "attestation": {
            "independentHumanReview": False,
            "transcriptCoverageReviewed": False,
            "exhaustiveClaimReview": False,
        },
        "instructions": {
            "claimDecisions": sorted(FINAL_CLAIM_DECISIONS),
            "irrelevantWindowDecisions": sorted(FINAL_IRRELEVANT_DECISIONS),
            "modifiedClaim": (
                "Use decision=modified and provide every changed field in revision."
            ),
            "additionalClaims": (
                "Add source-supported claims omitted by the seed. Each entry must "
                "contain type, subjects, conditions, timestampStart, timestampEnd, "
                "reviewedClaim, transcriptExcerpt, and reviewDecision=supported."
            ),
        },
        "cases": cases,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(review, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "ok": True,
        "operation": "export",
        "output": str(output_path.resolve()),
        "cases": len(cases),
        "claims": sum(len(case["claims"]) for case in cases),
        "irrelevantWindows": sum(
            len(case["irrelevantWindows"]) for case in cases
        ),
    }


def _iso_timestamp(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("reviewedAt is required")
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("reviewedAt must be an ISO-8601 timestamp") from error
    return text


def _validate_additional_claim(
    case_id: str,
    index: int,
    claim: Any,
) -> dict[str, Any]:
    if not isinstance(claim, dict):
        raise ValueError(f"{case_id} additionalClaims[{index}] must be an object")
    required = {
        "type",
        "subjects",
        "conditions",
        "timestampStart",
        "timestampEnd",
        "reviewedClaim",
        "transcriptExcerpt",
    }
    missing = sorted(
        key for key in required
        if claim.get(key) is None or claim.get(key) == ""
    )
    if missing:
        raise ValueError(
            f"{case_id} additionalClaims[{index}] missing: {', '.join(missing)}"
        )
    if claim.get("reviewDecision", "supported") != "supported":
        raise ValueError(
            f"{case_id} additionalClaims[{index}] must be supported"
        )
    value = deepcopy(claim)
    value["reviewDecision"] = "supported"
    value.setdefault("timestampTolerance", 5)
    value.setdefault("claimKeywords", [value["reviewedClaim"]])
    value.setdefault("minimumKeywordMatches", 1)
    return value


def _apply_claim_review(
    case_id: str,
    index: int,
    claim: dict[str, Any],
    decision: dict[str, Any],
) -> dict[str, Any]:
    expected = _claim_fingerprint(case_id, index, claim)
    if decision.get("fingerprint") != expected:
        raise ValueError(f"{case_id} claim[{index}] fingerprint is stale")
    choice = decision.get("decision")
    if choice not in FINAL_CLAIM_DECISIONS:
        raise ValueError(
            f"{case_id} claim[{index}] decision must be one of "
            f"{sorted(FINAL_CLAIM_DECISIONS)}"
        )
    value = deepcopy(claim)
    if choice == "modified":
        revision = decision.get("revision")
        if not isinstance(revision, dict):
            raise ValueError(f"{case_id} claim[{index}] revision is required")
        changed = False
        for key in (
            "reviewedClaim",
            "subjects",
            "conditions",
            "timestampStart",
            "timestampEnd",
        ):
            if revision.get(key) is not None:
                value[key] = revision[key]
                changed = True
        if not changed:
            raise ValueError(
                f"{case_id} claim[{index}] modified decision has no changes"
            )
        value["claimKeywords"] = [value["reviewedClaim"]]
        value["minimumKeywordMatches"] = 1
        value["reviewDecision"] = "supported"
        value["reviewModification"] = {
            "originalFingerprint": expected,
            "reviewerNote": str(decision.get("reviewerNote") or ""),
        }
    else:
        value["reviewDecision"] = choice
        if decision.get("reviewerNote"):
            value["reviewerNote"] = str(decision["reviewerNote"])
    return value


def apply_review(
    manifest_path: Path,
    review_path: Path,
    output_directory: Path,
) -> dict[str, Any]:
    manifest = _read_object(manifest_path)
    review = _read_object(review_path)
    if review.get("schemaVersion") != REVIEW_SCHEMA_VERSION:
        raise ValueError(f"schemaVersion must be {REVIEW_SCHEMA_VERSION}")
    if review.get("manifestHash") != _canonical_hash(manifest):
        raise ValueError("review manifestHash does not match the current manifest")
    reviewer = str(review.get("reviewer") or "").strip()
    if not reviewer:
        raise ValueError("reviewer is required")
    reviewed_at = _iso_timestamp(review.get("reviewedAt"))
    attestation = review.get("attestation") or {}
    for key in (
        "independentHumanReview",
        "transcriptCoverageReviewed",
        "exhaustiveClaimReview",
    ):
        if attestation.get(key) is not True:
            raise ValueError(f"attestation.{key} must be true")

    review_cases = {
        case.get("id"): case
        for case in (review.get("cases") or [])
        if isinstance(case, dict)
    }
    resolved = _resolved_cases(manifest, manifest_path.parent)
    expected_ids = {annotation["id"] for annotation, _path in resolved}
    if set(review_cases) != expected_ids:
        raise ValueError(
            "review cases must exactly match manifest cases: "
            f"expected={sorted(expected_ids)} actual={sorted(review_cases)}"
        )

    output_annotations = output_directory / "annotations"
    prepared_annotations: list[tuple[Path, dict[str, Any]]] = []
    supported = rejected = modified = additional = 0
    confirmed_irrelevant = rejected_irrelevant = 0
    for annotation, source_path in resolved:
        case_id = str(annotation["id"])
        case_review = review_cases[case_id]
        source_hash = (
            annotation.get("annotationProvenance") or {}
        ).get("sourceTranscriptHash")
        if case_review.get("sourceTranscriptHash") != source_hash:
            raise ValueError(f"{case_id} sourceTranscriptHash is stale")
        annotations = annotation.get("annotations") or {}
        source_claims = annotations.get("claims") or []
        claim_reviews = case_review.get("claims") or []
        if len(claim_reviews) != len(source_claims):
            raise ValueError(
                f"{case_id} claim count changed: "
                f"expected={len(source_claims)} actual={len(claim_reviews)}"
            )
        reviewed_claims = []
        for index, (claim, decision) in enumerate(
            zip(source_claims, claim_reviews, strict=True)
        ):
            if decision.get("index") != index:
                raise ValueError(f"{case_id} claim[{index}] index mismatch")
            choice = decision.get("decision")
            reviewed_claims.append(
                _apply_claim_review(case_id, index, claim, decision)
            )
            if choice == "supported":
                supported += 1
            elif choice == "rejected":
                rejected += 1
            else:
                modified += 1
        for index, claim in enumerate(case_review.get("additionalClaims") or []):
            reviewed_claims.append(
                _validate_additional_claim(case_id, index, claim)
            )
            additional += 1

        source_windows = annotations.get("irrelevantWindows") or []
        window_reviews = case_review.get("irrelevantWindows") or []
        if len(window_reviews) != len(source_windows):
            raise ValueError(
                f"{case_id} irrelevant window count changed: "
                f"expected={len(source_windows)} actual={len(window_reviews)}"
            )
        reviewed_windows = []
        for index, (window, decision) in enumerate(
            zip(source_windows, window_reviews, strict=True)
        ):
            if decision.get("index") != index:
                raise ValueError(
                    f"{case_id} irrelevantWindows[{index}] index mismatch"
                )
            if decision.get("fingerprint") != _window_fingerprint(
                case_id, index, window
            ):
                raise ValueError(
                    f"{case_id} irrelevantWindows[{index}] fingerprint is stale"
                )
            choice = decision.get("decision")
            if choice not in FINAL_IRRELEVANT_DECISIONS:
                raise ValueError(
                    f"{case_id} irrelevantWindows[{index}] decision must be one "
                    f"of {sorted(FINAL_IRRELEVANT_DECISIONS)}"
                )
            reviewed_window = deepcopy(window)
            reviewed_window["reviewDecision"] = choice
            if decision.get("reviewerNote"):
                reviewed_window["reviewerNote"] = str(decision["reviewerNote"])
            reviewed_windows.append(reviewed_window)
            if choice == "confirmed_irrelevant":
                confirmed_irrelevant += 1
            else:
                rejected_irrelevant += 1

        reviewed_annotation = deepcopy(annotation)
        reviewed_annotation["annotationStatus"] = "complete"
        reviewed_annotation["annotationProvenance"] = {
            **(annotation.get("annotationProvenance") or {}),
            "reviewer": reviewer,
            "reviewerType": "human",
            "method": "independent transcript and claim review",
            "independentHumanReview": True,
            "transcriptCoverageReviewed": True,
            "exhaustiveClaimReview": True,
            "reviewedAt": reviewed_at,
            "reviewArtifactHash": _canonical_hash(review),
            "seedSource": (
                annotation.get("annotationProvenance") or {}
            ).get("seedSource"),
            "note": "Independently reviewed acceptance ground truth.",
        }
        reviewed_annotation["annotations"] = {
            **annotations,
            "claims": reviewed_claims,
            "irrelevantWindows": reviewed_windows,
        }
        prepared_annotations.append((source_path, reviewed_annotation))

    reviewed_manifest = deepcopy(manifest)
    reviewed_manifest["annotationPolicy"] = {
        **(manifest.get("annotationPolicy") or {}),
        "reviewArtifactHash": _canonical_hash(review),
        "reviewedAt": reviewed_at,
        "reviewer": reviewer,
    }
    # Do not emit a partial reviewed set: every case is validated and prepared
    # before the first output file is written.
    output_annotations.mkdir(parents=True, exist_ok=True)
    written = []
    for source_path, reviewed_annotation in prepared_annotations:
        destination = output_annotations / source_path.name
        destination.write_text(
            json.dumps(reviewed_annotation, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        written.append(str(destination.resolve()))
    manifest_output = output_directory / "manifest.json"
    manifest_output.write_text(
        json.dumps(reviewed_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "ok": True,
        "operation": "apply",
        "outputManifest": str(manifest_output.resolve()),
        "annotationFiles": written,
        "cases": len(written),
        "claims": {
            "supported": supported,
            "rejected": rejected,
            "modified": modified,
            "additional": additional,
        },
        "irrelevantWindows": {
            "confirmed": confirmed_irrelevant,
            "rejected": rejected_irrelevant,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    export_parser = subparsers.add_parser("export")
    export_parser.add_argument("--manifest", required=True)
    export_parser.add_argument("--output", required=True)
    apply_parser = subparsers.add_parser("apply")
    apply_parser.add_argument("--manifest", required=True)
    apply_parser.add_argument("--review", required=True)
    apply_parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    if args.command == "export":
        summary = export_review(Path(args.manifest), Path(args.output))
    else:
        summary = apply_review(
            Path(args.manifest),
            Path(args.review),
            Path(args.output_dir),
        )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
