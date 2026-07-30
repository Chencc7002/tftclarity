"""Deterministic validation for KnowledgeDocument and ingestion envelopes."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import urlparse


SCHEMA_VERSION = "knowledge_document.v1"
DOCUMENT_TYPES = {
    "meta_snapshot",
    "unit_stats",
    "comp_stats",
    "item_stats",
    "trend_snapshot",
    "video_guide",
    "mechanism_knowledge",
    "patch_note",
    "static_game_knowledge",
}
CLAIM_TYPES = {
    "statistics",
    "official_fact",
    "mechanism",
    "creator_advice",
    "strategic_advice",
    "speculation",
}
UNCERTAINTY_MARKERS = (
    "可能",
    "通常",
    "推测",
    "大概",
    "或许",
    "倾向",
    "likely",
    "may",
    "might",
    "could",
    "possibly",
    "probably",
    "perhaps",
    "appears",
    "seems",
)


def _date(value: Any) -> bool:
    try:
        datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return True
    except (TypeError, ValueError):
        return False


def has_explicit_uncertainty(value: Any) -> bool:
    text = str(value or "").lower()
    return any(marker in text for marker in UNCERTAINTY_MARKERS)


def validate_knowledge_document(value: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(value, dict):
        return ["KnowledgeDocument must be an object"]
    if value.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(f"schemaVersion must be {SCHEMA_VERSION}")
    for key in ("id", "title", "text"):
        if not isinstance(value.get(key), str) or not value[key].strip():
            errors.append(f"{key} is required")
    if value.get("documentType") not in DOCUMENT_TYPES:
        errors.append("documentType is invalid")
    metadata = value.get("metadata")
    if not isinstance(metadata, dict):
        return errors + ["metadata must be an object"]
    if not metadata.get("source"):
        errors.append("metadata.source is required")
    if metadata.get("claimType") not in CLAIM_TYPES:
        errors.append("metadata.claimType is invalid")
    for key in ("topics", "conditions"):
        if not isinstance(metadata.get(key), list):
            errors.append(f"metadata.{key} must be an array")
    for key in ("timestampStart", "timestampEnd"):
        timestamp = metadata.get(key)
        if timestamp is not None and (
            not isinstance(timestamp, (int, float)) or timestamp < 0
        ):
            errors.append(f"metadata.{key} must be a non-negative number or null")
    start = metadata.get("timestampStart")
    end = metadata.get("timestampEnd")
    if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end < start:
        errors.append("metadata.timestampEnd must not precede timestampStart")
    if value.get("documentType") == "video_guide":
        if metadata.get("source") != "youtube":
            errors.append("video_guide metadata.source must be youtube")
        for key in (
            "sourceId",
            "sourceTitle",
            "author",
            "publishedAt",
            "timestampStart",
            "sourceUrl",
        ):
            if metadata.get(key) is None or metadata.get(key) == "":
                errors.append(f"video_guide metadata.{key} is required")
        if metadata.get("publishedAt") and not _date(metadata["publishedAt"]):
            errors.append("video_guide metadata.publishedAt must be an ISO date")
        source_url = metadata.get("sourceUrl")
        if source_url:
            parsed = urlparse(str(source_url))
            if parsed.scheme != "https" or not parsed.hostname:
                errors.append("video_guide metadata.sourceUrl must be an HTTPS URL")
        if metadata.get("claimType") not in {
            "creator_advice",
            "strategic_advice",
            "speculation",
        }:
            errors.append("video_guide claimType is invalid")
        for key in ("season", "patch", "videoVersion", "transcriptHash", "segmentId"):
            if not metadata.get(key):
                errors.append(f"video_guide metadata.{key} is required")
        segment_index = metadata.get("segmentIndex")
        if not isinstance(segment_index, int) or segment_index < 0:
            errors.append("video_guide metadata.segmentIndex must be a non-negative integer")
        if metadata.get("ingestionStatus") not in {"success", "partial_success"}:
            errors.append("video_guide metadata.ingestionStatus is invalid")
        if metadata.get("aiGenerated") is not True:
            errors.append("video_guide metadata.aiGenerated must be true")
        if metadata.get("contentOrigin") != "ai_generated_transcript_summary":
            errors.append(
                "video_guide metadata.contentOrigin must be "
                "ai_generated_transcript_summary"
            )
        if metadata.get("reviewStatus") not in {
            "ai_generated_unreviewed",
            "human_reviewed",
        }:
            errors.append("video_guide metadata.reviewStatus is invalid")
        if not str(metadata.get("contentDisclosure") or "").strip():
            errors.append("video_guide metadata.contentDisclosure is required")
    if metadata.get("claimType") == "strategic_advice" and not metadata.get("conditions"):
        errors.append("strategic_advice requires at least one applicable condition")
    if (
        metadata.get("claimType") == "speculation"
        and not has_explicit_uncertainty(value.get("text"))
    ):
        errors.append("speculation must use explicit uncertainty language")
    return errors


def assert_knowledge_document(value: Any) -> dict[str, Any]:
    errors = validate_knowledge_document(value)
    if errors:
        raise ValueError("Invalid KnowledgeDocument: " + "; ".join(errors))
    return value


def validate_ingestion_envelope(value: Any) -> list[str]:
    if not isinstance(value, dict):
        return ["Ingestion envelope must be an object"]
    errors = []
    schema_version = value.get("schemaVersion")
    if schema_version not in {"youtube_ingestion.v1", "youtube_ingestion.v2"}:
        errors.append("schemaVersion must be youtube_ingestion.v1 or youtube_ingestion.v2")
    documents = value.get("documents")
    if not isinstance(documents, list):
        return errors + ["documents must be an array"]
    for index, document in enumerate(documents):
        errors.extend(
            f"documents[{index}]: {error}"
            for error in validate_knowledge_document(document)
        )
    if schema_version == "youtube_ingestion.v2":
        if value.get("status") not in {
            "processing",
            "success",
            "partial_success",
            "failed",
        }:
            errors.append("status is invalid")
        source = value.get("source")
        if not isinstance(source, dict):
            errors.append("source must be an object")
        else:
            for key in (
                "videoId",
                "videoVersion",
                "transcriptHash",
                "title",
                "author",
                "publishedAt",
                "sourceUrl",
                "season",
                "patch",
                "locale",
            ):
                if source.get(key) is None or source.get(key) == "":
                    errors.append(f"source.{key} is required")
        segments = value.get("segments")
        if not isinstance(segments, list) or not segments:
            errors.append("segments must be a non-empty array")
        else:
            segment_ids: set[str] = set()
            for index, segment in enumerate(segments):
                if not isinstance(segment, dict):
                    errors.append(f"segments[{index}] must be an object")
                    continue
                segment_id = segment.get("segmentId")
                if not segment_id:
                    errors.append(f"segments[{index}].segmentId is required")
                elif segment_id in segment_ids:
                    errors.append(f"segments[{index}].segmentId must be unique")
                else:
                    segment_ids.add(segment_id)
                if segment.get("status") not in {"success", "empty", "quarantined"}:
                    errors.append(f"segments[{index}].status is invalid")
                if not segment.get("artifactPath"):
                    errors.append(f"segments[{index}].artifactPath is required")
        quarantine = value.get("quarantine")
        if not isinstance(quarantine, list):
            errors.append("quarantine must be an array")
            quarantine = []
        quarantined_segments = [
            segment for segment in (segments or [])
            if isinstance(segment, dict) and segment.get("status") == "quarantined"
        ]
        if len(quarantine) != len(quarantined_segments):
            errors.append("quarantine count must match quarantined segments")
        if value.get("status") == "partial_success":
            if not quarantine:
                errors.append("partial_success requires quarantined segments")
            if not documents:
                errors.append("partial_success requires at least one valid document")
        if value.get("status") == "success" and quarantine:
            errors.append("success cannot contain quarantined segments")
        for index, document in enumerate(documents):
            metadata = document.get("metadata") or {}
            for key in ("season", "patch", "videoVersion", "transcriptHash"):
                if source and metadata.get(key) != source.get(key):
                    errors.append(
                        f"documents[{index}].metadata.{key} must match source.{key}"
                    )
    return errors
