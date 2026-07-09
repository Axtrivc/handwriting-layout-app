"""POST /detect-glyph-candidates：自动检测字形候选区域（不做 OCR）。"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..schemas import (
    DetectGlyphCandidatesRequest,
    DetectGlyphCandidatesResponse,
    GlyphCandidateItem,
)

# 把 services/vision 加入 sys.path
_VISION_PARENT = Path(__file__).resolve().parents[3] / "vision"
if str(_VISION_PARENT) not in sys.path:
    sys.path.insert(0, str(_VISION_PARENT))

from vision import (  # noqa: E402
    DetectParams,
    b64_to_image,
    detect_and_sort,
)

router = APIRouter()


@router.post("/detect-glyph-candidates", response_model=DetectGlyphCandidatesResponse)
def detect_glyph_candidates(
    req: DetectGlyphCandidatesRequest,
) -> DetectGlyphCandidatesResponse:
    """检测样本图中的字形候选区域，返回带阅读顺序的 bbox 列表。

    合规约束：仅检测区域，不识别具体字符；字符标注由用户完成。
    """
    try:
        img = b64_to_image(req.image, req.mime)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"图片解码失败: {exc}") from exc

    params = DetectParams(
        threshold=req.threshold if req.threshold is not None else 180,
        min_width=req.minWidth if req.minWidth is not None else 8,
        min_height=req.minHeight if req.minHeight is not None else 8,
        max_width=req.maxWidth if req.maxWidth is not None else 400,
        max_height=req.maxHeight if req.maxHeight is not None else 400,
        merge_nearby=req.mergeNearby if req.mergeNearby is not None else True,
        row_tolerance=req.rowTolerance if req.rowTolerance is not None else 20,
    )

    candidates = detect_and_sort(img, params)
    items = [
        GlyphCandidateItem(
            x=c.x,
            y=c.y,
            width=c.width,
            height=c.height,
            score=c.score,
            rowIndex=c.row_index,
            orderIndex=c.order_index,
        )
        for c in candidates
    ]
    return DetectGlyphCandidatesResponse(candidates=items, count=len(items))
