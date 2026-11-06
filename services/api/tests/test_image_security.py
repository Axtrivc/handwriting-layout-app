"""图片资源限制与 API 边界的离线回归测试。"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import ValidationError

_API_DIR = Path(__file__).resolve().parents[1]
_VISION_DIR = _API_DIR.parent / "vision"
for _path in (str(_API_DIR), str(_VISION_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from app.config import MAX_REQUEST_BODY_BYTES  # noqa: E402
from app.main import RequestBodyLimitMiddleware, app  # noqa: E402
from app.schemas import (  # noqa: E402
    OcrSampleRequest,
    SegmentGlyphRequest,
    SuggestGlyphLabelsRequest,
)
from vision import encoding  # noqa: E402
from vision.encoding import ImageLimitError, b64_to_image, image_to_b64  # noqa: E402


async def _asgi_request(
    application,
    path: str = "/health",
    method: str = "POST",
    body: bytes = b"",
    *,
    chunks: list[bytes] | None = None,
    content_length: int | None = None,
) -> tuple[int, dict]:
    """不依赖 httpx/TestClient 的最小 ASGI 请求驱动。"""
    headers = [(b"host", b"testserver"), (b"content-type", b"application/json")]
    if content_length is not None:
        headers.append((b"content-length", str(content_length).encode("ascii")))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "headers": headers,
        "client": ("testclient", 123),
        "server": ("testserver", 80),
    }
    request_chunks = chunks if chunks is not None else [body]
    sent = []

    async def receive():
        if request_chunks:
            chunk = request_chunks.pop(0)
            return {
                "type": "http.request",
                "body": chunk,
                "more_body": bool(request_chunks),
            }
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    await application(scope, receive, send)
    start = next(message for message in sent if message["type"] == "http.response.start")
    response_body = b"".join(
        message.get("body", b"")
        for message in sent
        if message["type"] == "http.response.body"
    )
    return start["status"], json.loads(response_body or b"{}")


def _post_json(path: str, payload: dict) -> tuple[int, dict]:
    body = json.dumps(payload).encode("utf-8")
    return asyncio.run(
        _asgi_request(app, path, body=body, content_length=len(body))
    )


def test_base64_length_is_checked_before_decode(monkeypatch):
    monkeypatch.setattr(encoding, "MAX_IMAGE_B64_CHARS", 4)
    with pytest.raises(ImageLimitError, match="base64"):
        b64_to_image("AAAAA")


def test_decoded_byte_limit(monkeypatch):
    monkeypatch.setattr(encoding, "MAX_IMAGE_BYTES", 2)
    data = base64.b64encode(b"abc").decode("ascii")
    with pytest.raises(ImageLimitError, match="解码数据"):
        b64_to_image(data)


class _FakeSource:
    def __init__(self, size):
        self.size = size

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


@pytest.mark.parametrize("size", [(16384, 1), (8000, 8000)])
def test_pixel_limits_accept_exact_boundaries_without_large_allocation(
    monkeypatch, size
):
    monkeypatch.setattr(encoding.Image, "open", lambda _raw: _FakeSource(size))
    monkeypatch.setattr(
        encoding.ImageOps,
        "exif_transpose",
        lambda _source: Image.new("RGB", (1, 1), "white"),
    )
    assert b64_to_image("eA==").size == (1, 1)


@pytest.mark.parametrize("size", [(16385, 1), (1, 16385), (8000, 8001)])
def test_pixel_limits_run_before_exif_or_convert(monkeypatch, size):
    monkeypatch.setattr(encoding.Image, "open", lambda _raw: _FakeSource(size))

    def unexpected_exif(_source):
        raise AssertionError("超限图片不得进入 EXIF/convert")

    monkeypatch.setattr(encoding.ImageOps, "exif_transpose", unexpected_exif)
    with pytest.raises(ImageLimitError, match="画布尺寸"):
        b64_to_image("eA==")


def test_pillow_decompression_bomb_maps_to_image_limit(monkeypatch):
    def raise_bomb(_raw):
        raise Image.DecompressionBombError("test bomb")

    monkeypatch.setattr(encoding.Image, "open", raise_bomb)
    with pytest.raises(ImageLimitError, match="Pillow"):
        b64_to_image("eA==")


@pytest.mark.parametrize("fmt,mime", [("PNG", "image/png"), ("JPEG", "image/jpeg")])
def test_small_png_and_jpeg_decode_still_work(fmt, mime):
    buf = io.BytesIO()
    Image.new("RGB", (3, 2), "white").save(buf, format=fmt)
    image = b64_to_image(base64.b64encode(buf.getvalue()).decode("ascii"), mime)
    assert image.size == (3, 2)
    assert image.mode == "RGB"


@pytest.mark.parametrize(
    "mime", ["image/gif", "image/jpg", "image/png; charset=binary", "PNG"]
)
def test_output_mime_requires_exact_supported_value(mime):
    with pytest.raises(ValueError, match="不支持的输出 MIME"):
        image_to_b64(Image.new("RGB", (1, 1)), mime)


def _transparent_image(mode: str) -> Image.Image:
    if mode == "RGBA":
        return Image.new("RGBA", (2, 2), (255, 0, 0, 0))
    if mode == "LA":
        return Image.new("LA", (2, 2), (0, 0))
    image = Image.new("P", (2, 2), 0)
    image.putpalette([255, 0, 0] + [0, 0, 0] * 255)
    image.info["transparency"] = 0
    return image


@pytest.mark.parametrize("mode", ["RGBA", "LA", "P"])
def test_jpeg_composites_transparency_onto_white(mode):
    data = image_to_b64(_transparent_image(mode), "image/jpeg")
    with Image.open(io.BytesIO(base64.b64decode(data))) as result:
        assert result.mode == "RGB"
        assert min(result.getpixel((0, 0))) >= 250


def test_jpeg_blends_partial_alpha_with_white():
    image = Image.new("RGBA", (2, 2), (255, 0, 0, 128))
    data = image_to_b64(image, "image/jpeg")
    with Image.open(io.BytesIO(base64.b64decode(data))) as result:
        red, green, blue = result.convert("RGB").getpixel((0, 0))
    assert red > 240
    assert 110 <= green <= 145
    assert 110 <= blue <= 145


def _glyph_payload(**overrides) -> dict:
    payload = {
        "image": "eA==",
        "bbox": {"x": 0, "y": 0, "width": 1, "height": 1},
    }
    payload.update(overrides)
    return payload


def test_segment_glyph_options_have_bounds():
    assert SegmentGlyphRequest(**_glyph_payload(normalizeSize=2048)).normalizeSize == 2048
    assert SegmentGlyphRequest(**_glyph_payload(outMime="image/jpeg")).outMime == "image/jpeg"
    with pytest.raises(ValidationError):
        SegmentGlyphRequest(**_glyph_payload(normalizeSize=2049))
    with pytest.raises(ValidationError):
        SegmentGlyphRequest(**_glyph_payload(outMime="image/gif"))


@pytest.mark.parametrize("count", [512, 513])
def test_ocr_region_and_candidate_limits(count):
    regions = [{"x": 0, "y": 0, "width": 1, "height": 1}] * count
    if count <= 512:
        assert len(OcrSampleRequest(image="eA==", regions=regions).regions) == count
        assert len(SuggestGlyphLabelsRequest(image="eA==", candidates=regions).candidates) == count
    else:
        with pytest.raises(ValidationError):
            OcrSampleRequest(image="eA==", regions=regions)
        with pytest.raises(ValidationError):
            SuggestGlyphLabelsRequest(image="eA==", candidates=regions)


def test_app_rejects_large_declared_body_without_allocating_it():
    status, _body = asyncio.run(
        _asgi_request(app, content_length=MAX_REQUEST_BODY_BYTES + 1)
    )
    assert status == 413


def test_actual_streamed_body_limit_returns_413():
    downstream = FastAPI()
    downstream.add_middleware(RequestBodyLimitMiddleware, max_bytes=8)

    @downstream.post("/read")
    async def read(request: Request):
        return JSONResponse({"size": len(await request.body())})

    status, _body = asyncio.run(
        _asgi_request(downstream, "/read", chunks=[b"1234", b"5678", b"9"])
    )
    assert status == 413


@pytest.mark.parametrize(
    "path,payload",
    [
        ("/clean-region", {"image": "eA==", "regions": [{"x": 0, "y": 0, "width": 1, "height": 1}]}),
        ("/segment-glyph", _glyph_payload()),
        ("/detect-glyph-candidates", {"image": "eA=="}),
        ("/ocr-glyph", {"image": "eA=="}),
        ("/ocr-sample", {"image": "eA=="}),
        ("/suggest-glyph-labels", {"image": "eA==", "candidates": []}),
        ("/prepare-scan", {"image": "eA=="}),
    ],
)
def test_every_image_route_preserves_image_limit_as_413(monkeypatch, path, payload):
    monkeypatch.setattr(encoding, "MAX_IMAGE_B64_CHARS", 0)
    status, body = _post_json(path, payload)
    assert status == 413
    assert "base64" in body["detail"]


def test_non_limit_decode_error_remains_400():
    status, _body = _post_json("/detect-glyph-candidates", {"image": "eA=="})
    assert status == 400
