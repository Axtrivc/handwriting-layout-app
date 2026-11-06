"""CORS allows only explicit application origins."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

_API_DIR = Path(__file__).resolve().parents[1]
for _path in (str(_API_DIR), str(_API_DIR.parent / "vision")):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from app.main import app  # noqa: E402


def _preflight(origin: str) -> tuple[int, dict]:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "OPTIONS",
        "scheme": "http",
        "path": "/clean-region",
        "raw_path": b"/clean-region",
        "query_string": b"",
        "headers": [
            (b"host", b"127.0.0.1:8001"),
            (b"origin", origin.encode("ascii")),
            (b"access-control-request-method", b"POST"),
            (b"access-control-request-headers", b"content-type"),
        ],
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8001),
    }
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(app(scope, receive, send))
    start = next(message for message in sent if message["type"] == "http.response.start")
    headers = {
        key.decode("latin1").lower(): value.decode("latin1")
        for key, value in start["headers"]
    }
    return start["status"], headers


def test_electron_custom_origin_is_allowed():
    status, headers = _preflight("hw-app://app")
    assert status == 200
    assert headers["access-control-allow-origin"] == "hw-app://app"


def test_opaque_null_origin_is_not_allowed():
    status, headers = _preflight("null")
    assert status == 400
    assert "access-control-allow-origin" not in headers


def test_arbitrary_web_origin_is_not_allowed():
    status, headers = _preflight("https://example.com")
    assert status == 400
    assert "access-control-allow-origin" not in headers
