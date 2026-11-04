"""Conservative red/blue color cleanup, not a handwriting classifier."""
import cv2
import numpy as np
from PIL import Image


def clean_colored_ink(image: Image.Image, source: Image.Image) -> Image.Image:
    if source.size != image.size:
        raise ValueError('彩色原图与当前画布尺寸不一致，请重新导入原图')
    rgb = np.asarray(source.convert('RGB'))
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hue, saturation, value = cv2.split(hsv)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    paper = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, np.ones((31, 31), np.uint8))
    colored = ((hue <= 12) | (hue >= 168) | ((hue >= 95) & (hue <= 135)))
    seeds = colored & (saturation >= 80) & (value >= 55) & (gray < 210) & (cv2.subtract(paper, gray) > 15)
    # Grow into colored antialiasing only. Neutral black print is never in the mask.
    fringe = ((hue <= 20) | (hue >= 160) | ((hue >= 90) & (hue <= 140))) & (saturation >= 35) & (value >= 50)
    mask = (cv2.dilate(seeds.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0) & fringe
    if 'A' in source.getbands():
        mask &= np.asarray(source.getchannel('A')) > 0
    if not mask.any():
        return image
    if mask.mean() > 0.25:
        raise ValueError('检测到大面积彩色内容，请使用手动选区以保护图表和印刷内容')
    current = np.array(image.convert('RGB'))
    binary = np.all((current == 0) | (current == 255)) and np.all(current[:, :, 0] == current[:, :, 1]) and np.all(current[:, :, 1] == current[:, :, 2])
    repaired = np.full_like(current, 255) if binary else cv2.inpaint(current, mask.astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)
    if not np.any(current[mask] != repaired[mask]):
        return image
    current[mask] = repaired[mask]
    result = Image.fromarray(current)
    if 'A' in image.getbands():
        result.putalpha(image.getchannel('A'))
    return result
