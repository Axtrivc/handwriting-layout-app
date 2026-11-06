"""RapidOCR 生命周期、区域坐标与 provider 可用性的离线测试。"""
from __future__ import annotations

import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import ModuleType

import pytest
from PIL import Image

_API_DIR = Path(__file__).resolve().parents[1]
_VISION_DIR = _API_DIR.parent / "vision"
for _path in (str(_API_DIR), str(_VISION_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from vision import ocr  # noqa: E402
from vision.ocr import (  # noqa: E402
    RectRegion,
    recognize_single_glyph,
    recognize_text_regions,
)


def _image() -> Image.Image:
    return Image.new("RGB", (20, 20), "white")


@pytest.mark.parametrize(
    "region,expected_shape,expected_bbox",
    [
        (
            RectRegion(x=5, y=7, width=30, height=20),
            (13, 15, 3),
            {"x": 6, "y": 9, "width": 4, "height": 4},
        ),
        (
            RectRegion(x=-5, y=7, width=10, height=10),
            (10, 5, 3),
            {"x": 1, "y": 9, "width": 4, "height": 4},
        ),
    ],
)
def test_region_bbox_uses_original_coordinates_and_actual_clip(
    monkeypatch, region, expected_shape, expected_bbox
):
    calls = []

    class FakeRapidOCR:
        def __call__(self, array):
            calls.append(array.shape)
            return [([[1, 2], [5, 2], [5, 6], [1, 6]], "字", 0.9)], 0

    monkeypatch.setattr(ocr, "_rapidocr_factory", FakeRapidOCR)
    monkeypatch.setattr(ocr, "_rapidocr_engine", None)
    monkeypatch.setattr(
        ocr, "_PROVIDERS", {"rapidocr": ocr._rapidocr_recognize}
    )

    result = recognize_text_regions(_image(), [region])

    assert result.status == "ok"
    assert calls == [expected_shape]
    assert result.candidates[0].bbox == expected_bbox


def test_rapidocr_engine_is_lazy_reused_and_calls_are_serialized(monkeypatch):
    created = 0
    calls = 0
    active = 0
    max_active = 0
    state_lock = threading.Lock()

    class FakeRapidOCR:
        def __init__(self):
            nonlocal created
            created += 1

        def __call__(self, _array):
            nonlocal calls, active, max_active
            with state_lock:
                calls += 1
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.005)
            with state_lock:
                active -= 1
            return [], 0

    monkeypatch.setattr(ocr, "_rapidocr_factory", FakeRapidOCR)
    monkeypatch.setattr(ocr, "_rapidocr_engine", None)
    monkeypatch.setattr(
        ocr, "_PROVIDERS", {"rapidocr": ocr._rapidocr_recognize}
    )
    assert created == 0

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _i: recognize_single_glyph(_image()), range(6)))

    assert all(result.status == "ok" for result in results)
    assert created == 1
    assert calls == 6
    assert max_active == 1


def test_mock_bbox_contract_is_not_translated_twice(monkeypatch):
    monkeypatch.setenv("HW_OCR_MOCK", "1")
    monkeypatch.setattr(ocr, "_PROVIDERS", {})
    ocr.register_mock_provider()

    result = recognize_text_regions(
        _image(), [RectRegion(x=5, y=7, width=30, height=20)]
    )

    assert result.status == "ok"
    assert result.provider == "mock"
    assert result.candidates[0].bbox == {"x": 5, "y": 7, "width": 30, "height": 20}


def test_easyocr_placeholder_is_not_available(monkeypatch):
    monkeypatch.setattr(ocr, "_PROVIDERS", {})
    monkeypatch.setitem(sys.modules, "easyocr", ModuleType("easyocr"))

    ocr._try_import_easyocr()
    result = recognize_text_regions(_image())

    assert "easyocr" not in ocr._PROVIDERS
    assert not ocr.is_ocr_available()
    assert ocr.get_provider_name() == "none"
    assert result.status == "unavailable"
