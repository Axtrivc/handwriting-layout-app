"""POST /prepare-scan: preview a flattened gray or black-and-white document."""
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..schemas import PrepareScanRequest, PrepareScanResponse
from ..workloads import run_vision

_VISION_PARENT = Path(__file__).resolve().parents[3] / "vision"
if str(_VISION_PARENT) not in sys.path:
    sys.path.insert(0, str(_VISION_PARENT))
from vision.encoding import ImageLimitError, b64_to_image, image_to_b64
from vision.scan import prepare_scan
from vision.deskew import estimate_skew, rotate_document

router = APIRouter()


@router.post("/prepare-scan", response_model=PrepareScanResponse)
async def scan(req: PrepareScanRequest) -> PrepareScanResponse:
    return await run_vision(_scan, req)


def _scan(req: PrepareScanRequest) -> PrepareScanResponse:
    try:
        image = b64_to_image(req.image, req.mime)
        result = prepare_scan(image, req.mode, req.detail)
        transform = None
        color_source = None
        confidence = 0.
        if req.deskew:
            rotation, confidence = estimate_skew(result)
            if rotation:
                corrected, scale = rotate_document(image, rotation)
                result = prepare_scan(corrected, req.mode, req.detail)
                original_color = b64_to_image(req.colorSource) if req.colorSource else image
                if original_color.size != image.size:
                    raise ValueError('彩色原图尺寸与当前画布不一致')
                color_source = image_to_b64(rotate_document(original_color, rotation, scale)[0])
                transform = {'rotation': rotation, 'scale': scale}
    except ImageLimitError:
        raise
    except (ValueError, OSError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return PrepareScanResponse(image=image_to_b64(result), mime="image/png", width=result.width, height=result.height,
        transform=transform, colorSource=color_source, deskewConfidence=confidence)
