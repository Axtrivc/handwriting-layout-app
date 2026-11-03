"""POST /prepare-scan: preview a flattened gray or black-and-white document."""
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..schemas import PrepareScanRequest, PrepareScanResponse

_VISION_PARENT = Path(__file__).resolve().parents[3] / "vision"
if str(_VISION_PARENT) not in sys.path:
    sys.path.insert(0, str(_VISION_PARENT))
from vision.encoding import b64_to_image, image_to_b64
from vision.scan import prepare_scan

router = APIRouter()


@router.post("/prepare-scan", response_model=PrepareScanResponse)
def scan(req: PrepareScanRequest) -> PrepareScanResponse:
    try:
        image = b64_to_image(req.image, req.mime)
        if max(image.size) > 16384 or image.width * image.height > 64_000_000:
            raise ValueError("图片超过当前画布尺寸上限")
        result = prepare_scan(image, req.mode, req.detail)
    except (ValueError, OSError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return PrepareScanResponse(image=image_to_b64(result), mime="image/png", width=result.width, height=result.height)
