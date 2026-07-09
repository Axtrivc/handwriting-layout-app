"""POST /segment-glyph：从手写样本图裁剪单个字形。"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..schemas import SegmentGlyphRequest, SegmentGlyphResponse

# 把 services/vision 加入 sys.path 以便导入 vision 包
# glyph.py 在 services/api/app/routes/，parents[3] = services
_VISION_PARENT = Path(__file__).resolve().parents[3] / "vision"
if str(_VISION_PARENT) not in sys.path:
    sys.path.insert(0, str(_VISION_PARENT))

from vision import (  # noqa: E402
    GlyphProcessOptions,
    RectRegion,
    b64_to_image,
    image_to_b64,
    process_glyph,
)

router = APIRouter()


@router.post("/segment-glyph", response_model=SegmentGlyphResponse)
def segment_glyph(req: SegmentGlyphRequest) -> SegmentGlyphResponse:
    """裁剪并处理一个字形。

    合规约束：仅处理请求中提供的样本图，不存储、不上传，不涉及他人笔迹。
    """
    try:
        img = b64_to_image(req.image, req.mime)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"图片解码失败: {exc}") from exc

    region = RectRegion(
        x=req.bbox.x,
        y=req.bbox.y,
        width=req.bbox.width,
        height=req.bbox.height,
    )

    opts = GlyphProcessOptions(
        trim=True,
        normalize_size=req.normalizeSize,
        threshold=req.threshold,
        threshold_value=req.thresholdValue,
        transparent=req.transparent,
    )

    try:
        result = process_glyph(img, region, opts)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    out_mime = req.outMime or "image/png"
    out_b64 = image_to_b64(result.image, out_mime)
    return SegmentGlyphResponse(
        image=out_b64,
        mime=out_mime,
        width=result.width,
        height=result.height,
    )
