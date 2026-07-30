"""Inspect public YouTube candidates without running model extraction."""

from __future__ import annotations

import argparse
import json
from typing import Any

from metadata_fetcher import fetch_video_metadata
from youtube_fetcher import fetch_transcript


def inspect_candidate(video_id: str, languages: list[str]) -> dict[str, Any]:
    result: dict[str, Any] = {"id": video_id}
    try:
        metadata = fetch_video_metadata(video_id)
        result.update({
            "title": metadata["title"],
            "author": metadata["author"],
            "publishedAt": metadata["publishedAt"],
        })
    except Exception as exc:
        result["metadataErrorType"] = type(exc).__name__
        result["metadataError"] = str(exc)
    try:
        transcript = fetch_transcript(video_id, languages=languages)
        result.update({
            "durationSeconds": transcript["durationSeconds"],
            "snippetCount": len(transcript["snippets"]),
            "language": transcript.get("language"),
        })
    except Exception as exc:
        result["transcriptErrorType"] = type(exc).__name__
        result["transcriptError"] = str(exc)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video_ids", nargs="+")
    parser.add_argument("--languages", nargs="+", default=["zh-Hans", "zh-Hant", "en"])
    args = parser.parse_args()
    print(json.dumps(
        [inspect_candidate(video_id, args.languages) for video_id in args.video_ids],
        ensure_ascii=False,
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
