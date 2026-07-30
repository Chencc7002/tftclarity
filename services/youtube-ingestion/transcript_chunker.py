"""Timestamp-preserving transcript segmentation."""

from __future__ import annotations

from typing import Any


def _format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def _finish_chunk(snippets: list[dict[str, Any]], index: int) -> dict[str, Any]:
    start = float(snippets[0]["start"])
    end = max(float(item["start"]) + float(item.get("duration", 0)) for item in snippets)
    timestamped = "\n".join(
        f"[{_format_timestamp(float(item['start']))}] {str(item['text']).strip()}"
        for item in snippets
    )
    return {
        "index": index,
        "timestampStart": start,
        "timestampEnd": end,
        "text": " ".join(str(item["text"]).strip() for item in snippets),
        "timestampedText": timestamped,
        "snippetCount": len(snippets),
        "snippets": [dict(item) for item in snippets],
    }


def chunk_transcript(
    snippets: list[dict[str, Any]],
    max_duration_seconds: float = 900,
    max_characters: int = 12000,
) -> list[dict[str, Any]]:
    if not snippets:
        raise ValueError("Transcript snippets are required")
    if max_duration_seconds <= 0 or max_characters <= 0:
        raise ValueError("Chunk limits must be positive")
    ordered = sorted(snippets, key=lambda item: float(item.get("start", 0)))
    chunks: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    current_characters = 0

    for snippet in ordered:
        text = str(snippet.get("text") or "").strip()
        start = float(snippet.get("start", 0) or 0)
        duration = float(snippet.get("duration", 0) or 0)
        if not text:
            continue
        if start < 0 or duration < 0:
            raise ValueError("Transcript timestamps must be non-negative")
        normalized = {"text": text, "start": start, "duration": duration}
        exceeds_time = current and start - float(current[0]["start"]) >= max_duration_seconds
        exceeds_size = current and current_characters + len(text) + 1 > max_characters
        if exceeds_time or exceeds_size:
            chunks.append(_finish_chunk(current, len(chunks)))
            current = []
            current_characters = 0
        current.append(normalized)
        current_characters += len(text) + 1

    if current:
        chunks.append(_finish_chunk(current, len(chunks)))
    if not chunks:
        raise ValueError("Transcript contains no usable text")
    return chunks
