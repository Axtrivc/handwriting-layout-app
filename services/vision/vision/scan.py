"""Document scan preparation: paper illumination removal, then gray/B&W.

No OCR, deskew or text/handwriting classification. Geometry is unchanged;
EXIF orientation has already been resolved by the shared decoder.
"""
from typing import Literal

import cv2
import numpy as np
from PIL import Image

ScanMode = Literal["bw", "gray"]
ScanDetail = Literal["faint", "standard", "denoise"]


def prepare_scan(img: Image.Image, mode: ScanMode = "bw", detail: ScanDetail = "standard") -> Image.Image:
    if mode not in ("bw", "gray") or detail not in ("faint", "standard", "denoise"):
        raise ValueError("未知的扫描模式或细节设置")
    rgba = img.convert("RGBA")
    gray = np.array(Image.alpha_composite(Image.new("RGBA", img.size, "white"), rgba).convert("L"))
    # Estimate slow paper shading at bounded resolution, without blurring the
    # full-resolution strokes. Closing removes narrow dark writing from paper.
    h, w = gray.shape
    ratio = min(1.0, 1400 / max(w, h))
    small = cv2.resize(gray, (max(1, round(w * ratio)), max(1, round(h * ratio))), interpolation=cv2.INTER_AREA)
    kernel_size = max(31, min(71, round(min(small.shape) / 25) | 1))
    paper = cv2.morphologyEx(small, cv2.MORPH_CLOSE,
                             cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)))
    paper = cv2.GaussianBlur(paper, (0, 0), kernel_size / 6)
    if paper.shape != gray.shape:
        paper = cv2.resize(paper, (w, h), interpolation=cv2.INTER_LINEAR)
    normalized = np.clip(gray.astype(np.float32) / np.maximum(paper.astype(np.float32), 1) * 255, 0, 255)
    if mode == "bw":
        # Sauvola threshold keeps thin strokes under varying local contrast.
        # Faint mode raises the threshold; denoise mode tolerates more paper grain.
        k = {"faint": 0.05, "standard": 0.12, "denoise": 0.20}[detail]
        mean = cv2.boxFilter(normalized, -1, (41, 41), borderType=cv2.BORDER_REPLICATE)
        variance = cv2.boxFilter(normalized * normalized, -1, (41, 41), borderType=cv2.BORDER_REPLICATE) - mean * mean
        threshold = mean * (1 + k * (np.sqrt(np.maximum(variance, 0)) / 128 - 1))
        pixels = np.where(normalized <= threshold, 0, 255).astype(np.uint8)
    else:
        pixels = normalized.round().astype(np.uint8)
    result = Image.fromarray(pixels).convert("RGB")
    if "A" in img.getbands():
        result.putalpha(img.getchannel("A"))
    return result
