"""Align a user-supplied clean original; never infer hidden words from context."""
import cv2
import numpy as np
from PIL import Image


def _alignment_image(image: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    composite = Image.alpha_composite(Image.new('RGBA', image.size, 'white'), image.convert('RGBA'))
    gray = np.asarray(composite.convert('L'))
    ratio = min(1., 1400 / max(gray.shape))
    width, height = max(1, round(image.width * ratio)), max(1, round(image.height * ratio))
    # Actual x/y ratios account for rounding on differently sized references.
    resize = np.diag([width / image.width, height / image.height, 1.])
    return cv2.resize(gray, (width, height)), resize


def restore_from_reference(image: Image.Image, reference: Image.Image) -> Image.Image:
    target, target_resize = _alignment_image(image)
    clean, reference_resize = _alignment_image(reference)
    fail = ValueError('参考原卷无法可靠对齐，请使用同一页清晰、未填写的原卷；当前图片未修改')
    if min(*target.shape, *clean.shape) < 80:
        raise fail
    detector = cv2.ORB_create(nfeatures=6000, edgeThreshold=15)
    reference_points, reference_features = detector.detectAndCompute(clean, None)
    target_points, target_features = detector.detectAndCompute(target, None)
    if reference_features is None or target_features is None:
        raise fail
    matches = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(reference_features, target_features, k=2)
    good = [pair[0] for pair in matches if len(pair) == 2 and pair[0].distance < .7 * pair[1].distance]
    if len(good) < 40:
        raise fail
    source_points = np.float32([reference_points[m.queryIdx].pt for m in good])
    destination_points = np.float32([target_points[m.trainIdx].pt for m in good])
    homography, inliers = cv2.findHomography(source_points, destination_points, cv2.RANSAC, 2.5)
    if homography is None or inliers is None or inliers.sum() < 30 or inliers.mean() < .55:
        raise fail
    accepted = destination_points[inliers.ravel().astype(bool)]
    if cv2.contourArea(cv2.convexHull(accepted)) < target.size * .2:
        raise fail
    height, width = clean.shape
    corners = np.float32([[0, 0], [width, 0], [width, height], [0, height]])
    warped = cv2.perspectiveTransform(corners[None], homography)[0]
    area = cv2.contourArea(warped, oriented=True)
    if not np.isfinite(warped).all() or not cv2.isContourConvex(warped) or not .5 * target.size < area < 2 * target.size:
        raise fail
    target_size = (target.shape[1], target.shape[0])
    aligned = cv2.warpPerspective(clean, homography, target_size, borderValue=255)
    coverage = cv2.warpPerspective(np.full(clean.shape, 255, np.uint8), homography, target_size) > 250
    if coverage.mean() < .75:
        raise fail
    # Most original print must still be supported by the photographed page.
    # This rejects unrelated pages, but is not proof that two editions are identical.
    expected_ink = (aligned < 140) & coverage
    observed_ink = cv2.dilate((target < 170).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    if expected_ink.sum() < 200 or observed_ink[expected_ink].mean() < .92:
        raise fail

    full_transform = np.linalg.inv(target_resize) @ homography @ reference_resize
    reference_rgb = Image.alpha_composite(Image.new('RGBA', reference.size, 'white'), reference.convert('RGBA')).convert('RGB')
    restored = cv2.warpPerspective(np.asarray(reference_rgb), full_transform, image.size,
                                   flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))
    coverage = cv2.warpPerspective(np.full((reference.height, reference.width), 255, np.uint8),
                                  full_transform, image.size) > 250
    output = np.array(image.convert('RGB'))
    if np.array_equal(output[coverage], restored[coverage]):
        return image
    output[coverage] = restored[coverage]
    result = Image.fromarray(output)
    if 'A' in image.getbands():
        result.putalpha(image.getchannel('A'))
    return result
