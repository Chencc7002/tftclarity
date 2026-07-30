"""Evaluate extracted YouTube knowledge against a fixed reviewed annotation set."""

from __future__ import annotations

import argparse
import difflib
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any


_CHINESE_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}


def _chinese_number(value: str) -> str:
    if all(character in _CHINESE_DIGITS for character in value):
        return "".join(str(_CHINESE_DIGITS[character]) for character in value)
    total = 0
    current = 0
    units = {"十": 10, "百": 100, "千": 1000}
    for character in value:
        if character in _CHINESE_DIGITS:
            current = _CHINESE_DIGITS[character]
        elif character in units:
            total += (current or 1) * units[character]
            current = 0
        else:
            return value
    return str(total + current)


def _normalize(value: Any) -> str:
    text = re.sub(
        r"[零〇一二两三四五六七八九十百千]+",
        lambda match: _chinese_number(match.group(0)),
        str(value).lower(),
    )
    return "".join(re.findall(r"[a-z0-9]+|[\u3400-\u9fff]", text))


def _similar(left: Any, right: Any) -> bool:
    a = _normalize(left)
    b = _normalize(right)
    return bool(a and b and (a in b or b in a))


def _tokens(value: Any) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+|[\u3400-\u9fff]", str(value).lower())
        if token not in {
            "a", "an", "and", "are", "as", "at", "be", "because", "by",
            "for", "from", "in", "is", "it", "of", "on", "or", "that",
            "the", "this", "to", "when", "with", "you", "your",
        }
    }


def _text_similarity(left: Any, right: Any) -> float:
    normalized_left = _normalize(left)
    normalized_right = _normalize(right)
    if not normalized_left or not normalized_right:
        return 0.0
    if normalized_left in normalized_right or normalized_right in normalized_left:
        return 1.0
    left_tokens = _tokens(left)
    right_tokens = _tokens(right)
    union = left_tokens | right_tokens
    jaccard = len(left_tokens & right_tokens) / len(union) if union else 0
    sequence = difflib.SequenceMatcher(
        None,
        normalized_left,
        normalized_right,
    ).ratio()
    return max(jaccard, sequence)


def _safe_rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 6) if denominator else 1.0


def _f1(precision: float, recall: float) -> float:
    return round(
        2 * precision * recall / (precision + recall),
        6,
    ) if precision + recall else 0.0


def independent_review_errors(case: dict[str, Any]) -> list[str]:
    provenance = case.get("annotationProvenance") or {}
    errors: list[str] = []
    if case.get("annotationStatus") != "complete":
        errors.append("annotationStatus must be complete")
    if provenance.get("independentHumanReview") is not True:
        errors.append("independentHumanReview must be true")
    if provenance.get("reviewerType") != "human":
        errors.append("reviewerType must be human")
    if provenance.get("transcriptCoverageReviewed") is not True:
        errors.append("transcriptCoverageReviewed must be true")
    if provenance.get("exhaustiveClaimReview") is not True:
        errors.append("exhaustiveClaimReview must be true")
    if not str(provenance.get("reviewer") or "").strip():
        errors.append("reviewer is required")
    reviewed_at = provenance.get("reviewedAt")
    if not reviewed_at:
        errors.append("reviewedAt is required")
    else:
        try:
            datetime.fromisoformat(str(reviewed_at).replace("Z", "+00:00"))
        except ValueError:
            errors.append("reviewedAt must be an ISO timestamp")
    decisions = [
        str(claim.get("reviewDecision") or "")
        for claim in (case.get("annotations") or {}).get("claims", [])
        if isinstance(claim, dict)
    ]
    if not decisions:
        errors.append("at least one reviewed claim is required")
    if any(value not in {"supported", "rejected"} for value in decisions):
        errors.append("every claim reviewDecision must be supported or rejected")
    irrelevant_decisions = [
        str(window.get("reviewDecision") or "")
        for window in (case.get("annotations") or {}).get(
            "irrelevantWindows", []
        )
        if isinstance(window, dict)
    ]
    if any(
        value not in {"confirmed_irrelevant", "rejected"}
        for value in irrelevant_decisions
    ):
        errors.append(
            "every irrelevant window reviewDecision must be "
            "confirmed_irrelevant or rejected"
        )
    return errors


def _claim_score(
    document: dict[str, Any],
    expected: dict[str, Any],
) -> float | None:
    metadata = document.get("metadata") or {}
    if expected.get("type") and expected["type"] not in str(document.get("id") or ""):
        return None
    expected_subjects = expected.get("subjects") or []
    actual_subjects = metadata.get("topics") or []
    actual_surface = [*actual_subjects, document.get("text") or ""]
    subject_matches = sum(
        any(_similar(subject, actual) for actual in actual_surface)
        for subject in expected_subjects
    )
    minimum_subject_matches = int(expected.get(
        "minimumSubjectMatches",
        1 if expected_subjects else 0,
    ))
    if subject_matches < minimum_subject_matches:
        return None
    reviewed_claim = expected.get("reviewedClaim")
    if reviewed_claim:
        similarity = _text_similarity(document.get("text") or "", reviewed_claim)
        if similarity < float(expected.get("minimumClaimSimilarity", 0.35)):
            return None
    else:
        similarity = 1.0
    keywords = expected.get("claimKeywords") or []
    text = document.get("text") or ""
    minimum = int(expected.get("minimumKeywordMatches", len(keywords)))
    if not reviewed_claim and sum(_similar(keyword, text) for keyword in keywords) < minimum:
        return None
    subject_score = _safe_rate(subject_matches, len(expected_subjects))
    return round(similarity * 0.8 + subject_score * 0.2, 6)


def _best_matches(
    documents: list[dict[str, Any]],
    expected_claims: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    candidates_by_expected: list[list[tuple[float, int]]] = []
    for expected in expected_claims:
        candidates = [
            (score, document_index)
            for document_index, document in enumerate(documents)
            if (score := _claim_score(document, expected)) is not None
        ]
        candidates.sort(key=lambda value: (-value[0], value[1]))
        candidates_by_expected.append(candidates)

    document_owner: dict[int, int] = {}
    expected_document: dict[int, int] = {}

    def assign(expected_index: int, seen_documents: set[int]) -> bool:
        for _score, document_index in candidates_by_expected[expected_index]:
            if document_index in seen_documents:
                continue
            seen_documents.add(document_index)
            previous_owner = document_owner.get(document_index)
            if previous_owner is None or assign(previous_owner, seen_documents):
                document_owner[document_index] = expected_index
                expected_document[expected_index] = document_index
                return True
        return False

    expected_order = sorted(
        range(len(expected_claims)),
        key=lambda index: (
            len(candidates_by_expected[index]),
            -candidates_by_expected[index][0][0]
            if candidates_by_expected[index] else 0,
            index,
        ),
    )
    for expected_index in expected_order:
        assign(expected_index, set())

    return [
        (documents[expected_document[index]], expected_claims[index])
        for index in range(len(expected_claims))
        if index in expected_document
    ]


def evaluate_case(case: dict[str, Any], envelope: dict[str, Any]) -> dict[str, Any]:
    documents = [
        value for value in envelope.get("documents", [])
        if isinstance(value, dict) and value.get("documentType") == "video_guide"
    ]
    annotations = case.get("annotations") or {}
    expected_claims = [
        claim
        for claim in (annotations.get("claims") or [])
        if claim.get("reviewDecision") in {
            None,
            "supported",
            "source_window_supported_by_codex",
        }
    ]
    matches = _best_matches(documents, expected_claims)

    expected_entity_count = sum(
        len({
            _normalize(entity)
            for entity in claim.get("subjects", [])
            if _normalize(entity)
        })
        for claim in expected_claims
    )
    actual_entity_count = sum(
        len({
            _normalize(entity)
            for entity in (document.get("metadata") or {}).get("topics", [])
            if _normalize(entity)
        })
        for document in documents
    )
    correct_expected_entity_count = 0
    correct_actual_entity_count = 0
    for document, expected in matches:
        expected_entities = {
            _normalize(entity)
            for entity in expected.get("subjects", [])
            if _normalize(entity)
        }
        actual_entities = {
            _normalize(entity)
            for entity in (document.get("metadata") or {}).get("topics", [])
            if _normalize(entity)
        }
        correct_expected_entity_count += sum(
            any(_similar(entity, actual) for actual in actual_entities)
            for entity in expected_entities
        )
        correct_actual_entity_count += sum(
            any(_similar(entity, expected_entity) for expected_entity in expected_entities)
            for entity in actual_entities
        )
    entity_precision = _safe_rate(
        correct_actual_entity_count,
        actual_entity_count,
    )
    entity_recall = _safe_rate(
        correct_expected_entity_count,
        expected_entity_count,
    )

    matched_document_ids = {
        str(document.get("id") or id(document))
        for document, _expected in matches
    }
    claim_precision = _safe_rate(len(matched_document_ids), len(documents))
    claim_recall = _safe_rate(len(matches), len(expected_claims))

    expected_conditions = [
        condition
        for _document, expected in matches
        for condition in expected.get("conditions", [])
    ]
    matched_conditions = 0
    for document, expected in matches:
        actual = (document.get("metadata") or {}).get("conditions") or []
        matched_conditions += sum(
            any(
                _similar(condition, value)
                or _text_similarity(condition, value) >= 0.45
                for value in actual
            )
            for condition in expected.get("conditions", [])
        )

    timestamp_expected = [
        (document, expected)
        for document, expected in matches
        if expected.get("timestampStart") is not None
    ]
    timestamp_correct = 0
    for document, expected in timestamp_expected:
        metadata = document.get("metadata") or {}
        tolerance = float(expected.get("timestampTolerance", 5))
        actual_start = float(metadata.get("timestampStart", -100000))
        actual_end = float(metadata.get("timestampEnd", actual_start))
        expected_start = float(expected["timestampStart"])
        expected_end = float(expected.get("timestampEnd", expected_start))
        endpoints_correct = (
            abs(actual_start - expected_start) <= tolerance
            and abs(actual_end - expected_end) <= tolerance
        )
        overlap = max(
            0,
            min(actual_end, expected_end) - max(actual_start, expected_start),
        )
        minimum_duration = max(
            1,
            min(actual_end - actual_start, expected_end - expected_start),
        )
        timestamp_correct += int(
            endpoints_correct or overlap / minimum_duration >= 0.5
        )

    irrelevant_windows = [
        window
        for window in (annotations.get("irrelevantWindows") or [])
        if window.get("reviewDecision") in {
            None,
            "confirmed_irrelevant",
            "source_window_supported_by_codex",
        }
    ]
    irrelevant_filtered = 0
    for window in irrelevant_windows:
        start = float(window["timestampStart"])
        end = float(window["timestampEnd"])
        has_claim = any(
            float((document.get("metadata") or {}).get("timestampStart", -1)) <= end
            and float((document.get("metadata") or {}).get(
                "timestampEnd",
                (document.get("metadata") or {}).get("timestampStart", -1),
            )) >= start
            for document in documents
        )
        irrelevant_filtered += int(not has_claim)

    duplicate_document_indexes: set[int] = set()
    for left_index, left in enumerate(documents):
        left_topics = (left.get("metadata") or {}).get("topics", [])
        left_type = str(left.get("id") or "").split(":")[-2]
        for right_index in range(left_index + 1, len(documents)):
            right = documents[right_index]
            right_type = str(right.get("id") or "").split(":")[-2]
            if left_type != right_type:
                continue
            right_topics = (right.get("metadata") or {}).get("topics", [])
            topic_overlap = any(
                _similar(left_topic, right_topic)
                for left_topic in left_topics
                for right_topic in right_topics
            )
            if (
                topic_overlap
                and _text_similarity(left.get("text"), right.get("text")) >= 0.85
            ):
                duplicate_document_indexes.add(right_index)
    duplicate_count = len(duplicate_document_indexes)

    return {
        "caseId": case["id"],
        "category": case.get("category"),
        "sourceUrl": case.get("sourceUrl"),
        "ingestionStatus": envelope.get("status"),
        "documents": len(documents),
        "segments": len(envelope.get("segments") or []),
        "quarantinedSegments": len(envelope.get("quarantine") or []),
        "matchedClaims": len(matches),
        "expectedClaims": len(expected_claims),
        "metrics": {
            "entityPrecision": entity_precision,
            "entityRecall": entity_recall,
            "entityF1": _f1(entity_precision, entity_recall),
            "claimAccuracy": claim_precision,
            "claimRecall": claim_recall,
            "claimF1": _f1(claim_precision, claim_recall),
            "conditionExtractionRate": _safe_rate(
                matched_conditions,
                len(expected_conditions),
            ),
            "timestampAccuracy": _safe_rate(
                timestamp_correct,
                len(timestamp_expected),
            ),
            "irrelevantContentFilteringRate": _safe_rate(
                irrelevant_filtered,
                len(irrelevant_windows),
            ),
            "duplicateKnowledgeRate": _safe_rate(duplicate_count, len(documents)),
        },
        "counts": {
            "expectedEntities": expected_entity_count,
            "actualEntities": actual_entity_count,
            "correctEntities": correct_expected_entity_count,
            "correctActualEntities": correct_actual_entity_count,
            "expectedConditions": len(expected_conditions),
            "correctConditions": matched_conditions,
            "timestampExpected": len(timestamp_expected),
            "timestampCorrect": timestamp_correct,
            "irrelevantWindows": len(irrelevant_windows),
            "irrelevantWindowsFiltered": irrelevant_filtered,
            "duplicates": duplicate_count,
        },
    }


def evaluate_manifest(
    manifest: dict[str, Any],
    outputs_directory: Path,
    manifest_directory: Path | None = None,
) -> dict[str, Any]:
    resolved_cases: list[dict[str, Any]] = []
    for entry in manifest.get("cases") or []:
        case = dict(entry)
        annotation_file = case.pop("annotationFile", None)
        if annotation_file:
            if manifest_directory is None:
                raise ValueError("manifest_directory is required for annotationFile")
            loaded = json.loads(
                (manifest_directory / annotation_file).read_text(encoding="utf-8")
            )
            case = {**loaded, **case}
        resolved_cases.append(case)
    cases: list[dict[str, Any]] = []
    missing: list[str] = []
    accepted_annotation_statuses = {"complete", "provisional"}
    unannotated = [
        case["id"]
        for case in resolved_cases
        if case.get("annotationStatus") not in accepted_annotation_statuses
    ]
    require_independent_human_review = bool(
        (manifest.get("annotationPolicy") or {}).get(
            "requireIndependentHumanReview"
        )
    )
    review_errors = {
        case["id"]: independent_review_errors(case)
        for case in resolved_cases
        if require_independent_human_review
    }
    review_pending = [
        case_id
        for case_id, errors in review_errors.items()
        if errors
    ]
    provisional = [
        case["id"]
        for case in resolved_cases
        if case.get("annotationStatus") == "provisional"
    ]
    for case in resolved_cases:
        if case.get("annotationStatus") not in accepted_annotation_statuses:
            continue
        output_name = case.get("output") or f"{case['id']}.json"
        output_path = outputs_directory / output_name
        if not output_path.exists():
            missing.append(case["id"])
            continue
        envelope = json.loads(output_path.read_text(encoding="utf-8"))
        cases.append(evaluate_case(case, envelope))

    totals = Counter()
    for case in cases:
        counts = case["counts"]
        for key, value in counts.items():
            totals[key] += value
        totals["documents"] += case["documents"]
        totals["matchedClaims"] += case["matchedClaims"]
        totals["expectedClaims"] += case["expectedClaims"]
        totals["quarantinedSegments"] += case["quarantinedSegments"]

    entity_precision = _safe_rate(
        totals["correctActualEntities"], totals["actualEntities"]
    )
    entity_recall = _safe_rate(totals["correctEntities"], totals["expectedEntities"])
    claim_precision = _safe_rate(totals["matchedClaims"], totals["documents"])
    claim_recall = _safe_rate(totals["matchedClaims"], totals["expectedClaims"])
    metrics = {
        "entityPrecision": entity_precision,
        "entityRecall": entity_recall,
        "entityF1": _f1(entity_precision, entity_recall),
        "claimAccuracy": claim_precision,
        "claimRecall": claim_recall,
        "claimF1": _f1(claim_precision, claim_recall),
        "conditionExtractionRate": _safe_rate(
            totals["correctConditions"],
            totals["expectedConditions"],
        ),
        "timestampAccuracy": _safe_rate(
            totals["timestampCorrect"],
            totals["timestampExpected"],
        ),
        "irrelevantContentFilteringRate": _safe_rate(
            totals["irrelevantWindowsFiltered"],
            totals["irrelevantWindows"],
        ),
        "duplicateKnowledgeRate": _safe_rate(
            totals["duplicates"],
            totals["documents"],
        ),
    }
    thresholds = manifest.get("thresholds") or {}
    threshold_results = {
        **{
            name: {
                "operator": ">=",
                "threshold": float(threshold),
                "actual": metrics.get(name),
                "passed": metrics.get(name) is not None
                and metrics[name] >= float(threshold),
            }
            for name, threshold in (thresholds.get("minimum") or {}).items()
        },
        **{
            name: {
                "operator": "<=",
                "threshold": float(threshold),
                "actual": metrics.get(name),
                "passed": metrics.get(name) is not None
                and metrics[name] <= float(threshold),
            }
            for name, threshold in (thresholds.get("maximum") or {}).items()
        },
    }
    complete = not missing and not unannotated and not review_pending
    quality_thresholds_passed = all(
        result["passed"] for result in threshold_results.values()
    )
    threshold_enforcement = str(
        (manifest.get("thresholds") or {}).get("enforcement") or "enforced"
    )
    if threshold_enforcement not in {"enforced", "advisory"}:
        raise ValueError("thresholds.enforcement must be enforced or advisory")
    passed = complete and (
        threshold_enforcement == "advisory"
        or quality_thresholds_passed
    )
    annotation_policy = manifest.get("annotationPolicy") or {}
    annotation_origin = str(
        annotation_policy.get("annotationOrigin") or "unspecified"
    )
    acceptance_level = (
        "human_reviewed"
        if require_independent_human_review and complete
        else "human_review_required"
        if require_independent_human_review
        else "ai_generated_provisional"
        if annotation_origin == "ai_generated_provisional"
        else "standard"
    )
    return {
        "schemaVersion": "youtube_acceptance_report.v1",
        "acceptanceSet": manifest.get("name"),
        "caseCount": len(resolved_cases),
        "evaluatedCaseCount": len(cases),
        "missingCaseIds": missing,
        "unannotatedCaseIds": unannotated,
        "reviewPendingCaseIds": review_pending,
        "reviewErrorsByCase": {
            case_id: errors
            for case_id, errors in review_errors.items()
            if errors
        },
        "provisionalCaseIds": provisional,
        "independentHumanReviewRequired": require_independent_human_review,
        "humanReviewRecommended": bool(
            annotation_policy.get("humanReviewRecommended")
        ),
        "annotationOrigin": annotation_origin,
        "acceptanceLevel": acceptance_level,
        "contentDisclosure": annotation_policy.get("contentDisclosure"),
        "thresholdEnforcement": threshold_enforcement,
        "qualityThresholdsPassed": quality_thresholds_passed,
        "qualityMetricsStatus": (
            "provisional_ai_generated"
            if annotation_origin == "ai_generated_provisional"
            else "human_reviewed"
            if acceptance_level == "human_reviewed"
            else "standard"
        ),
        "complete": complete,
        "passed": passed,
        "metrics": metrics,
        "thresholdResults": threshold_results,
        "totals": dict(totals),
        "cases": cases,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--outputs", required=True)
    parser.add_argument("--report")
    args = parser.parse_args()
    manifest_path = Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    report = evaluate_manifest(
        manifest,
        Path(args.outputs),
        manifest_directory=manifest_path.parent,
    )
    serialized = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(serialized + "\n", encoding="utf-8")
    print(serialized)
    if (
        report["missingCaseIds"]
        or report["unannotatedCaseIds"]
        or report["reviewPendingCaseIds"]
    ):
        return 2
    return 0 if report["passed"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
