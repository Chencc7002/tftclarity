"""Fetch YouTube title, channel and real publication date without an API key."""

from __future__ import annotations

import html
import json
import re
from datetime import datetime
from typing import Any, Callable
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from youtube_fetcher import extract_video_id


class YouTubeMetadataError(RuntimeError):
    """Raised when required source provenance cannot be obtained."""


def _decode_json_string(value: str) -> str:
    try:
        return json.loads(f'"{value}"')
    except json.JSONDecodeError:
        return html.unescape(value)


def _request_text(
    url: str,
    timeout: float,
    opener: Callable[..., Any] | None = None,
) -> str:
    request = Request(
        url,
        headers={
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/138.0.0.0 Safari/537.36"
            ),
        },
    )
    open_impl = opener or urlopen
    with open_impl(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def _valid_date(value: str | None) -> str | None:
    if not value:
        return None
    candidate = value.strip()
    for date_format in ("%Y-%m-%d", "%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(candidate[:10] if date_format == "%Y-%m-%d" else candidate, date_format).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _channel_id(page: str) -> str | None:
    for pattern in (
        r'"externalChannelId"\s*:\s*"(UC[A-Za-z0-9_-]+)"',
        r'"channelId"\s*:\s*"(UC[A-Za-z0-9_-]+)"',
    ):
        match = re.search(pattern, page)
        if match:
            return match.group(1)
    return None


def _publication_date_from_feed(
    channel_id: str,
    video_id: str,
    timeout: float,
    opener: Callable[..., Any] | None,
) -> str | None:
    feed = _request_text(
        "https://www.youtube.com/feeds/videos.xml?"
        + urlencode({"channel_id": channel_id}),
        timeout,
        opener,
    )
    root = ElementTree.fromstring(feed)
    namespaces = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
    }
    for entry in root.findall("atom:entry", namespaces):
        entry_video_id = entry.findtext("yt:videoId", namespaces=namespaces)
        if entry_video_id != video_id:
            continue
        return _valid_date(entry.findtext("atom:published", namespaces=namespaces))
    return None


def fetch_video_metadata(
    url_or_id: str,
    timeout: float = 15,
    opener: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    video_id = extract_video_id(url_or_id)
    watch_url = f"https://www.youtube.com/watch?v={video_id}"
    title = None
    author = None
    published_at = None
    author_url = None
    channel_id = None
    warnings: list[str] = []

    try:
        oembed_url = "https://www.youtube.com/oembed?" + urlencode({
            "url": watch_url,
            "format": "json",
        })
        payload = json.loads(_request_text(oembed_url, timeout, opener))
        title = str(payload.get("title") or "").strip() or None
        author = str(payload.get("author_name") or "").strip() or None
        author_url = str(payload.get("author_url") or "").strip() or None
    except Exception as exc:
        warnings.append(f"youtube_oembed_failed:{type(exc).__name__}")

    for attempt in range(1, 4):
        try:
            page = _request_text(watch_url, timeout, opener)
            channel_id = channel_id or _channel_id(page)
            if not title:
                match = re.search(
                    r"<title>(.*?)</title>",
                    page,
                    re.IGNORECASE | re.DOTALL,
                )
                if match:
                    title = html.unescape(match.group(1)).replace(
                        " - YouTube",
                        "",
                    ).strip()
            if not author:
                match = re.search(
                    r'"ownerChannelName"\s*:\s*"((?:\\.|[^"])*)"',
                    page,
                )
                if match:
                    author = _decode_json_string(match.group(1)).strip()
            for pattern in (
                r'"uploadDate"\s*:\s*"(\d{4}-\d{2}-\d{2})',
                r'"publishDate"\s*:\s*"(\d{4}-\d{2}-\d{2})',
                r'<meta\s+itemprop="uploadDate"\s+content="(\d{4}-\d{2}-\d{2})',
                r'"publishDate"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"]+)"',
                r'"dateText"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"]+)"',
            ):
                match = re.search(pattern, page, re.IGNORECASE)
                if match:
                    published_at = _valid_date(match.group(1))
                    break
            if published_at:
                break
            warnings.append(f"youtube_page_missing_date_attempt:{attempt}")
        except Exception as exc:
            warnings.append(
                f"youtube_page_failed_attempt:{attempt}:{type(exc).__name__}"
            )

    if not published_at and not channel_id and author_url:
        try:
            channel_page = _request_text(author_url, timeout, opener)
            channel_id = _channel_id(channel_page)
        except Exception as exc:
            warnings.append(f"youtube_channel_page_failed:{type(exc).__name__}")

    if not published_at and channel_id:
        try:
            published_at = _publication_date_from_feed(
                channel_id,
                video_id,
                timeout,
                opener,
            )
            if published_at:
                warnings.append("youtube_publish_date_from_channel_feed")
        except Exception as exc:
            warnings.append(f"youtube_channel_feed_failed:{type(exc).__name__}")

    missing = [
        key for key, value in {
            "title": title,
            "author": author,
            "publishedAt": published_at,
        }.items() if not value
    ]
    if missing:
        raise YouTubeMetadataError(
            f"Required YouTube metadata is unavailable for {video_id}: {', '.join(missing)}"
        )
    return {
        "videoId": video_id,
        "title": title,
        "author": author,
        "publishedAt": published_at,
        "sourceUrl": watch_url,
        "warnings": warnings,
    }
