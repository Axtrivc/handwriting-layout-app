"""Document scan preparation: paper illumination removal, then gray/B&W.

This pixel enhancement function does not change geometry or classify writing.
The API composes it with optional deskew from vision.deskew;
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
        # Illumination correction also amplifies fibers and camera noise. Smooth
        # similar paper tones BEFORE thresholding, while preserving ink edges.
        # Median/opening or deleting small components would erase periods and
        # one-pixel rules. All geometry remains at the original resolution.
        scale = max(1.0, min(3.0, min(w, h) / 1000))
        diameter = round((5 if detail == "faint" else 7) * scale) | 1
        color_sigma = {"faint": 8, "standard": 30, "denoise": 36}[detail]
        spatial_sigma = (1.25 if detail == "faint" else 1.8) * scale
        smooth = cv2.bilateralFilter(normalized.round().astype(np.uint8), diameter,
                                     color_sigma, spatial_sigma).astype(np.float32)
        # The previous k=.12 treated ordinary paper texture as ink. Standard
        # now demands stronger contrast; faint remains an explicit opt-in for
        # very light writing. Grow the neighborhood for phone-resolution pages.
        k = {"faint": 0.05, "standard": 0.30, "denoise": 0.36}[detail]
        window = min(121, round(41 * scale) | 1)
        mean = cv2.boxFilter(smooth, -1, (window, window), borderType=cv2.BORDER_REPLICATE)
        variance = cv2.boxFilter(smooth * smooth, -1, (window, window), borderType=cv2.BORDER_REPLICATE) - mean * mean
        threshold = mean * (1 + k * (np.sqrt(np.maximum(variance, 0)) / 128 - 1))
        pixels = np.where(smooth <= threshold, 0, 255).astype(np.uint8)
    else:
        pixels = normalized.round().astype(np.uint8)
    if "A" in img.getbands():
        # The tone operation ran on the visible image over white. Convert that
        # result back to straight-alpha colors before reattaching the alpha;
        # otherwise translucent strokes would be blended with white twice.
        alpha = np.asarray(img.getchannel('A'), dtype=np.float32) / 255
        pixels = np.where(alpha > 0,
            np.clip((pixels.astype(np.float32) - 255 * (1 - alpha)) / np.maximum(alpha, 1 / 255), 0, 255),
            255).round().astype(np.uint8)
    result = Image.fromarray(pixels).convert("RGB")
    if "A" in img.getbands():
        result.putalpha(img.getchannel("A"))
    return result
