"""Small-angle document deskew with abstention, no OCR or invented content."""
import cv2
import numpy as np
from PIL import Image


def _projection_score(ink: np.ndarray, angle: float) -> float:
    height, width = ink.shape
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1)
    # A zero border has no ink and does not contribute false page-edge lines.
    rotated = cv2.warpAffine(ink, matrix, (width, height), flags=cv2.INTER_NEAREST)
    rows = rotated.sum(axis=1).astype(np.float64)
    return float(np.sum(np.diff(rows) ** 2))


def estimate_skew(image: Image.Image) -> tuple[float, float]:
    """Return clockwise correction and peak strength, not a calibrated probability."""
    rgb = Image.alpha_composite(Image.new('RGBA', image.size, 'white'), image.convert('RGBA'))
    gray = np.asarray(rgb.convert('L'))
    scale = min(1., 1000 / max(gray.shape))
    size = (max(1, round(gray.shape[1] * scale)), max(1, round(gray.shape[0] * scale)))
    gray = cv2.resize(gray, size)
    if min(gray.shape) < 80:
        return 0., 0.
    ink = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 41, 15)
    # Remove isolated noise only from the analysis mask; output punctuation is untouched.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(ink, 8)
    keep = np.zeros(count, np.uint8)
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep[1:] = ((areas >= 5) & (areas < ink.size * .04)).astype(np.uint8)
    ink = keep[labels]
    if ink.sum() < 180 or np.count_nonzero(keep) < 8 or ink.mean() > .3:
        return 0., 0.

    angles = np.arange(-12., 12.01, .5)
    scores = np.array([_projection_score(ink, angle) for angle in angles])
    peak = int(scores.argmax())
    if peak in (0, len(angles) - 1):
        return 0., 0.
    coarse = angles[peak]
    refined = np.arange(coarse - .5, coarse + .501, .1)
    fine = np.array([_projection_score(ink, angle) for angle in refined])
    angle = float(refined[fine.argmax()])
    best, baseline = float(fine.max()), _projection_score(ink, 0)
    confidence = max(0., 1 - float(np.median(scores)) / max(best, 1))
    if abs(angle) < .25 or best < baseline * 1.25 or confidence < .45:
        return 0., confidence

    # A strong peak in one small area (e.g. a mark or drawing) is insufficient.
    height = ink.shape[0]
    for half in (ink[:height // 2], ink[height // 2:]):
        if half.sum() < 80 or _projection_score(half, angle) <= _projection_score(half, 0) * 1.15:
            return 0., confidence
    return round(-angle, 2), confidence


def rotate_document(image: Image.Image, rotation: float, scale: float | None = None) -> tuple[Image.Image, float]:
    """Fit the complete rotated page inside the same canvas. Preserve alpha if present."""
    if not np.isfinite(rotation) or abs(rotation) > 15:
        raise ValueError('校正角度无效')
    width, height = image.size
    radians = np.deg2rad(rotation)
    cosine, sine = abs(np.cos(radians)), abs(np.sin(radians))
    fit = min(width / (width * cosine + height * sine), height / (height * cosine + width * sine)) if scale is None else scale
    if not np.isfinite(fit) or not .5 <= fit <= 1:
        raise ValueError('校正缩放无效')
    if abs(rotation) < .001 and abs(fit - 1) < .001:
        return image, 1.
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), -rotation, fit)
    # Composite RGB over white first; rotating straight-alpha colors would create halos.
    source = Image.alpha_composite(Image.new('RGBA', image.size, 'white'), image.convert('RGBA')).convert('RGB')
    pixels = cv2.warpAffine(np.asarray(source), matrix, image.size, flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))
    if 'A' in image.getbands():
        alpha = cv2.warpAffine(np.asarray(image.getchannel('A')), matrix, image.size, flags=cv2.INTER_LINEAR, borderValue=0)
        weight = alpha.astype(np.float32)[:, :, None] / 255
        straight = (pixels.astype(np.float32) - 255 * (1 - weight)) / np.maximum(weight, 1 / 255)
        pixels = np.dstack([np.clip(straight, 0, 255).round().astype(np.uint8), alpha])
    return Image.fromarray(pixels), float(fit)
