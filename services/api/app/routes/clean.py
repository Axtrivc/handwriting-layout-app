"""POST /clean-region：选区清除、红蓝颜色清除或参考原卷对齐修复。"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..config import DEFAULT_INPAINT_RADIUS
from ..schemas import CleanRegionRequest, CleanRegionResponse
from ..workloads import run_vision

# 把 services/vision 加入 sys.path 以便导入 vision 包
# clean.py 在 services/api/app/routes/，parents[3] = services
_VISION_PARENT = Path(__file__).resolve().parents[3] / "vision"
if str(_VISION_PARENT) not in sys.path:
    sys.path.insert(0, str(_VISION_PARENT))

from vision import (  # noqa: E402  -- sys.path 注入后再导入
    ImageLimitError,
    InpaintOptions,
    RectRegion,
    b64_to_image,
    clean_regions,
    image_to_b64,
)
from vision.regions import BrushStroke
from vision.color_cleanup import clean_colored_ink
from vision.reference_restore import restore_from_reference

router = APIRouter()


@router.post("/clean-region", response_model=CleanRegionResponse)
async def clean_region(req: CleanRegionRequest) -> CleanRegionResponse:
    return await run_vision(_clean_region, req)


def _clean_region(req: CleanRegionRequest) -> CleanRegionResponse:
    """对用户框选或涂选的区域去字迹，可保留有外部证据的横竖线。

    默认处理显式选区；autoColor 显式请求整页红蓝颜色清除，结果供预览。
    """
    if not req.referenceImage and not req.autoColor and not req.regions and not req.strokes:
        raise HTTPException(status_code=400, detail="请先框选或用画笔选择要清除的区域")
    if sum(len(stroke.points) for stroke in req.strokes) > 200_000:
        raise HTTPException(status_code=400, detail="画笔点数过多，请分次处理")

    try:
        img = b64_to_image(req.image, req.mime)
    except ImageLimitError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"图片解码失败: {exc}") from exc

    regions = [
        RectRegion(x=r.x, y=r.y, width=r.width, height=r.height)
        for r in req.regions
    ]
    if req.referenceImage:
        try:
            reference = b64_to_image(req.referenceImage)
            result = restore_from_reference(img, reference)
        except ImageLimitError:
            raise
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return CleanRegionResponse(image=image_to_b64(result), mime='image/png', processed=1, changed=result is not img)
    if req.autoColor:
        try:
            source = b64_to_image(req.colorSource) if req.colorSource else img
            result = clean_colored_ink(img, source)
        except ImageLimitError:
            raise
        except (ValueError, OSError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return CleanRegionResponse(image=image_to_b64(result), mime="image/png", processed=1, changed=result is not img)
    strokes = [BrushStroke(list(zip(stroke.points[::2], stroke.points[1::2])), stroke.width) for stroke in req.strokes]

    result, processed = clean_regions(
        img,
        regions,
        strokes=strokes,
        options=InpaintOptions(
            algorithm="ns", radius=DEFAULT_INPAINT_RADIUS,
            contrast={"gentle": 22, "standard": 12, "strong": 6}[req.strength],
            dilate_iterations=2 if req.strength == "strong" else 1,
            detect_lines=req.preserveRules,
        ),
    )
    if processed == 0:
        raise HTTPException(status_code=400, detail="没有有效的清理区域")

    # Always return lossless pixels, including when the uploaded scan is JPEG.
    out_mime = "image/png"
    out_data = image_to_b64(result, out_mime)
    return CleanRegionResponse(
        image=out_data,
        mime=out_mime,
        processed=processed,
        changed=result is not img,
    )
