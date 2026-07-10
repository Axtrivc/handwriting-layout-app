"""POST /clean-region：手动框选区域去字迹。"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from .. import __version__
from ..config import DEFAULT_INPAINT_RADIUS
from ..schemas import CleanRegionRequest, CleanRegionResponse

# 把 services/vision 加入 sys.path 以便导入 vision 包
# clean.py 在 services/api/app/routes/，parents[3] = services
_VISION_PARENT = Path(__file__).resolve().parents[3] / "vision"
if str(_VISION_PARENT) not in sys.path:
    sys.path.insert(0, str(_VISION_PARENT))

from vision import (  # noqa: E402  -- sys.path 注入后再导入
    InpaintOptions,
    RectRegion,
    b64_to_image,
    clean_regions,
    image_to_b64,
)

router = APIRouter()


@router.post("/clean-region", response_model=CleanRegionResponse)
def clean_region(req: CleanRegionRequest) -> CleanRegionResponse:
    """对用户手动框选的区域做 inpaint 去字迹。

    合规约束：仅处理请求中显式给定的区域，不做自动整页识别。
    """
    if not req.regions:
        raise HTTPException(status_code=400, detail="regions 不能为空")

    try:
        img = b64_to_image(req.image, req.mime)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"图片解码失败: {exc}") from exc

    regions = [
        RectRegion(x=r.x, y=r.y, width=r.width, height=r.height)
        for r in req.regions
    ]

    result, processed = clean_regions(
        img,
        regions,
        options=InpaintOptions(algorithm="ns", radius=DEFAULT_INPAINT_RADIUS),
    )
    if processed == 0:
        raise HTTPException(status_code=400, detail="没有有效的清理区域")

    out_data = image_to_b64(result, req.mime)
    return CleanRegionResponse(
        image=out_data,
        mime=req.mime,
        processed=processed,
    )
