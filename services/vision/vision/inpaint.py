"""Local scan cleanup. Only pixels inside explicitly selected rectangles may change.

Estimate paper brightness locally instead of assuming black ink on white paper.
Reconstruct a rule only when unselected samples on BOTH sides support it; never
copy arbitrary neighboring text into the selection.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import cv2
import numpy as np
from PIL import Image

from .regions import RectRegion


@dataclass
class InpaintOptions:
    algorithm: str = "ns"
    radius: int = 6
    ink_threshold: int | None = None
    dilate_iterations: int = 1
    detect_lines: bool = True
    contrast: int = 12


def _rule_background(rgb: np.ndarray, paper: np.ndarray, selected: np.ndarray,
                     region: RectRegion) -> tuple[np.ndarray, np.ndarray]:
    """Infer solid/periodic horizontal rules using clean bilateral evidence.

    Periods are fitted in absolute image coordinates, so dashed rules retain
    their phase. Uncertain rows are left to inpainting, not fabricated.
    """
    h, w = selected.shape
    x, y, rw, rh = region.x, region.y, region.width, region.height
    prediction = paper[y:y + rh, x:x + rw].copy()
    supported = np.zeros((rh, rw), dtype=bool)
    margin = 64
    left = np.arange(max(0, x - margin), x)
    right = np.arange(x + rw, min(w, x + rw + margin))
    if len(left) < 12 or len(right) < 12:
        return prediction, supported
    xs = np.concatenate((left, right))
    target = np.arange(x, x + rw)
    for yy in range(y, min(y + rh, h)):
        if selected[yy, xs].any():
            continue
        values = rgb[yy, xs].astype(np.float32)
        deficit = np.max(paper[yy, xs].astype(np.float32) - values, axis=1)
        dark = deficit > 10
        # Both sides must carry a substantial part of the same rule.
        if min(dark[:len(left)].mean(), dark[len(left):].mean()) < 0.22:
            continue
        color = np.median(values[dark], axis=0)
        if np.max(np.std(values[dark], axis=0)) > 18:
            continue
        if dark.mean() > 0.90:
            prediction[yy - y, :] = color
            supported[yy - y, :] = True
            continue
        # At least three observed periods per side, every phase sampled twice.
        for period in range(4, min(len(left), len(right)) // 3 + 1):
            phases = xs % period
            template = np.zeros((period, 3), dtype=np.float32)
            valid = True
            for phase in range(period):
                samples = values[phases == phase]
                if len(samples) < 2:
                    valid = False
                    break
                template[phase] = np.median(samples, axis=0)
            if not valid:
                continue
            residual = np.max(np.abs(values - template[phases]), axis=1)
            if np.quantile(residual, 0.9) <= 8:
                prediction[yy - y] = template[target % period]
                supported[yy - y, :] = True
                break
    return prediction, supported


def clean_regions(img: Image.Image, regions: Sequence[RectRegion], radius: int = 6,
                  options: InpaintOptions | None = None) -> tuple[Image.Image, int]:
    opts = options or InpaintOptions(radius=radius)
    width, height = img.size
    clipped = [r.clip_to(width, height) for r in regions]
    clipped = [r for r in clipped if r.is_valid()]
    if not clipped:
        return img, 0

    # Limit expensive processing to the selection bounding box + context.
    pad = 80
    x0 = max(0, min(r.x for r in clipped) - pad)
    y0 = max(0, min(r.y for r in clipped) - pad)
    x1 = min(width, max(r.x + r.width for r in clipped) + pad)
    y1 = min(height, max(r.y + r.height for r in clipped) + pad)
    rgb = np.array(img.convert("RGB"))[y0:y1, x0:x1].copy()
    local = [RectRegion(r.x - x0, r.y - y0, r.width, r.height) for r in clipped]
    selected = np.zeros(rgb.shape[:2], dtype=np.uint8)
    for r in local:
        selected[r.y:r.y + r.height, r.x:r.x + r.width] = 255

    # Closing removes narrow dark strokes from the background estimate while
    # retaining slow illumination gradients. Per-channel contrast catches color ink.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
    paper = cv2.morphologyEx(rgb, cv2.MORPH_CLOSE, kernel)
    background = paper.copy()
    rules = np.zeros(selected.shape, dtype=bool)
    if opts.detect_lines:
        for r in local:
            pred, supported = _rule_background(rgb, paper, selected, r)
            roi = np.s_[r.y:r.y + r.height, r.x:r.x + r.width]
            background[roi][supported] = pred[supported]
            rules[roi] |= supported

    contrast = np.max(background.astype(np.int16) - rgb.astype(np.int16), axis=2)
    if opts.ink_threshold is None:
        ink = contrast >= opts.contrast
    else:
        ink = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) < opts.ink_threshold
        ink &= (~rules | (contrast >= opts.contrast))
    mask = (ink & (selected > 0)).astype(np.uint8) * 255
    if opts.dilate_iterations > 0:
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
                          iterations=opts.dilate_iterations)
    mask = cv2.bitwise_and(mask, selected)
    if not mask.any():
        return img, len(clipped)

    flag = cv2.INPAINT_NS if opts.algorithm == "ns" else cv2.INPAINT_TELEA
    # Remove rule pixels from the donor image too: otherwise nearby rule fragments
    # bleed into the paper where a character crossed the rule.
    donor = rgb.copy()
    donor[rules] = paper[rules]
    result = cv2.inpaint(donor, mask, max(1, opts.radius), flag)
    restore = rules & (mask > 0)
    result[restore] = background[restore]
    if not np.any(result[mask > 0] != rgb[mask > 0]):
        return img, len(clipped)
    # Preserve ALL non-mask pixels exactly, including alpha and selection exterior.
    output = np.array(img.convert("RGBA") if "A" in img.getbands() else img.convert("RGB"))
    crop = output[y0:y1, x0:x1, :3]
    crop[mask > 0] = result[mask > 0]
    return Image.fromarray(output), len(clipped)
