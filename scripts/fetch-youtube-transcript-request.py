"""Execute one browser-derived YouTube transcript request without exporting cookies."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ALLOWED_HOST = "www.youtube.com"
ALLOWED_PATHS = {
    "/youtubei/v1/get_transcript",
    "/api/timedtext",
}
ALLOWED_HEADERS = {
    "content-type",
    "x-youtube-client-name",
    "x-youtube-client-version",
}


def _write_atomic(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    try:
        with os.fdopen(file_descriptor, "wb") as handle:
            handle.write(content)
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    request_path = Path(args.request).resolve()
    output_path = Path(args.output).resolve()
    request_deleted = False
    try:
        payload = json.loads(request_path.read_text(encoding="utf-8"))
        url = str(payload.get("url") or "")
        parsed = urlparse(url)
        if (
            parsed.scheme != "https"
            or parsed.hostname != ALLOWED_HOST
            or parsed.path not in ALLOWED_PATHS
        ):
            raise ValueError("Only YouTube transcript endpoints are allowed")
        headers = {
            str(key): str(value)
            for key, value in (payload.get("headers") or {}).items()
            if str(key).lower() in ALLOWED_HEADERS
        }
        if parsed.path == "/api/timedtext":
            if "v=" not in parsed.query:
                raise ValueError("YouTube timedtext request requires a video id")
            request = Request(url, headers=headers, method="GET")
        else:
            body = json.dumps(
                payload.get("body") or {},
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
            request = Request(url, data=body, headers=headers, method="POST")
        try:
            with urlopen(request, timeout=60) as response:
                content = response.read()
                status = int(getattr(response, "status", 200))
        except HTTPError as error:
            error_content = error.read()
            try:
                error_payload = json.loads(error_content.decode("utf-8"))
            except Exception:
                error_payload = {
                    "message": error_content.decode("utf-8", errors="replace")[:500]
                }
            print(json.dumps({
                "ok": False,
                "status": int(error.code),
                "error": error_payload,
                "requestDeleted": True,
            }, ensure_ascii=False))
            return 2
        parsed_response = json.loads(content.decode("utf-8"))
        if not isinstance(parsed_response, dict):
            raise ValueError("Transcript response must be a JSON object")
        _write_atomic(output_path, content)
        print(json.dumps({
            "ok": True,
            "status": status,
            "bytes": len(content),
            "output": str(output_path),
            "topLevelKeys": sorted(parsed_response.keys()),
            "requestDeleted": True,
        }, ensure_ascii=False))
        return 0
    finally:
        try:
            request_path.unlink()
            request_deleted = True
        except FileNotFoundError:
            request_deleted = True
        if not request_deleted:
            raise RuntimeError("Failed to delete the temporary transcript request")


if __name__ == "__main__":
    raise SystemExit(main())
