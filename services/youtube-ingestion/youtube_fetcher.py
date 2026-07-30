"""YouTube ID parsing and timestamped transcript fetching for tftclarity."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Iterable
from urllib.parse import parse_qs, urlparse


VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}


class YouTubeTranscriptError(RuntimeError):
    """Raised when a timestamped transcript cannot be fetched."""


@dataclass(frozen=True)
class TranscriptSnippet:
    text: str
    start: float
    duration: float


def extract_video_id(url_or_id: str) -> str:
    """Return a validated 11-character YouTube video ID."""
    value = str(url_or_id or "").strip()
    if VIDEO_ID_PATTERN.fullmatch(value):
        return value
    parsed = urlparse(value if "://" in value else f"https://{value}")
    host = parsed.hostname.lower() if parsed.hostname else ""
    if host not in YOUTUBE_HOSTS:
        raise ValueError(f"Unsupported YouTube host: {host or 'missing'}")

    candidate = None
    if host.endswith("youtu.be"):
        candidate = parsed.path.strip("/").split("/", 1)[0]
    elif parsed.path.rstrip("/") == "/watch":
        candidate = parse_qs(parsed.query).get("v", [None])[0]
    else:
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) >= 2 and parts[0] in {"embed", "shorts", "live"}:
            candidate = parts[1]
    if candidate and VIDEO_ID_PATTERN.fullmatch(candidate):
        return candidate
    raise ValueError(f"Could not extract a YouTube video ID from: {value}")


def _snippet_value(snippet: Any, key: str, fallback: Any = None) -> Any:
    if isinstance(snippet, dict):
        return snippet.get(key, fallback)
    return getattr(snippet, key, fallback)


def normalize_transcript_snippets(snippets: Iterable[Any]) -> list[TranscriptSnippet]:
    output: list[TranscriptSnippet] = []
    for value in snippets:
        text = str(_snippet_value(value, "text", "") or "").strip()
        start = float(_snippet_value(value, "start", 0) or 0)
        duration = float(_snippet_value(value, "duration", 0) or 0)
        if not text:
            continue
        if start < 0 or duration < 0:
            raise YouTubeTranscriptError("Transcript timestamps must be non-negative")
        output.append(TranscriptSnippet(text=text, start=start, duration=duration))
    output.sort(key=lambda snippet: snippet.start)
    if not output:
        raise YouTubeTranscriptError("YouTube video has no usable transcript snippets")
    return output


def transcript_from_youtube_json3(
    payload: dict[str, Any],
    video_id: str,
    *,
    language: str = "en",
) -> dict[str, Any]:
    """Normalize an authenticated browser-captured YouTube JSON3 transcript."""
    events = payload.get("events")
    if not isinstance(events, list):
        raise YouTubeTranscriptError("YouTube JSON3 transcript has no events array")
    raw_snippets = []
    for event in events:
        if not isinstance(event, dict) or not isinstance(event.get("segs"), list):
            continue
        text = "".join(
            str(segment.get("utf8") or "")
            for segment in event["segs"]
            if isinstance(segment, dict)
        ).strip()
        if not text:
            continue
        raw_snippets.append({
            "text": text,
            "start": float(event.get("tStartMs") or 0) / 1000,
            "duration": float(event.get("dDurationMs") or 0) / 1000,
        })
    snippets = normalize_transcript_snippets(raw_snippets)
    duration = max(snippet.start + snippet.duration for snippet in snippets)
    return {
        "videoId": extract_video_id(video_id),
        "language": language,
        "languagePreferences": [language],
        "durationSeconds": duration,
        "snippets": [asdict(snippet) for snippet in snippets],
    }


def fetch_transcript(
    url_or_id: str,
    languages: list[str] | None = None,
    api: Any = None,
) -> dict[str, Any]:
    """Fetch timestamped transcript data using youtube-transcript-api."""
    video_id = extract_video_id(url_or_id)
    requested_languages = languages or ["zh-Hans", "zh-Hant", "en"]
    if api is None:
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
        except ImportError as exc:
            raise YouTubeTranscriptError(
                "youtube-transcript-api is required; install services/youtube-ingestion/requirements.txt"
            ) from exc
        api = YouTubeTranscriptApi()

    try:
        if hasattr(api, "fetch"):
            fetched = api.fetch(video_id, languages=requested_languages)
        elif hasattr(api, "get_transcript"):
            fetched = api.get_transcript(video_id, languages=requested_languages)
        else:
            raise TypeError("Unsupported youtube-transcript-api client")
        snippets = normalize_transcript_snippets(fetched)
    except YouTubeTranscriptError:
        raise
    except Exception as exc:
        raise YouTubeTranscriptError(
            f"Could not fetch transcript for YouTube video {video_id}: {exc}"
        ) from exc

    duration = max(snippet.start + snippet.duration for snippet in snippets)
    return {
        "videoId": video_id,
        "languagePreferences": requested_languages,
        "durationSeconds": duration,
        "snippets": [asdict(snippet) for snippet in snippets],
    }
