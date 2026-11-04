"""Photographed paper grain must not become ink; punctuation is still content."""
import io
import sys
import unittest
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'vision'))
from vision.scan import prepare_scan


def textured_page(seed=14, scale=1):
    """Known ink over shaded, fibrous paper, with faint reverse-side printing."""
    h, w = 1000, 800
    ink = np.full((h, w), 255, np.uint8)
    for y, text in [(100, 'A job advertisement. I applied!'),
                    (220, 'i j : ; , .  (3)  Fine print'),
                    (340, 'They edit their content and help'),
                    (460, 'I felt a change in me straight away.'),
                    (580, '0123456789  + - / = ?')]:
        cv2.putText(ink, text, (35, y), cv2.FONT_HERSHEY_SIMPLEX, 0.95, 20, 2, cv2.LINE_AA)
    cv2.line(ink, (40, 650), (760, 650), 25, 1)
    cv2.line(ink, (40, 650), (40, 840), 25, 1)
    ink[700:702, 95:97] = 20  # isolated period, not adjacent to any text
    cv2.line(ink, (200, 710), (600, 710), 160, 2)  # moderately faint pencil
    cv2.putText(ink, 'Shaded text', (35, 930), cv2.FONT_HERSHEY_SIMPLEX, 1, 20, 2, cv2.LINE_AA)

    rng = np.random.default_rng(seed)
    fibers = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 0.8)
    fibers *= 16 / fibers.std()
    coarse = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 3)
    coarse *= 8 / coarse.std()
    texture = np.clip(228 + fibers + coarse, 130, 255)
    # Low-contrast text showing through the paper must not become foreground.
    reverse = np.zeros((h, w), np.uint8)
    for y in (165, 285, 405, 525):
        cv2.putText(reverse, 'faint printing on the reverse of the paper', (40, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, 255, 1, cv2.LINE_AA)
    texture -= reverse[:, ::-1].astype(np.float32) * (25 / 255)
    yy, xx = np.mgrid[:h, :w]
    light = 0.48 + 0.5 * (xx / w) - 0.14 * np.exp(-((yy - 850) / 130) ** 2)
    photo = light * texture * (ink.astype(np.float32) / 255)
    photo += rng.normal(0, 1.5, (h, w))
    photo = np.clip(photo, 0, 255).astype(np.uint8)
    if scale != 1:
        photo = cv2.resize(photo, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
        ink = cv2.resize(ink, (w * scale, h * scale), interpolation=cv2.INTER_NEAREST)
    return Image.fromarray(photo).convert('RGB'), ink


def scan_metrics(result, ink):
    black = np.asarray(result)[:, :, 0] == 0
    # Ignore antialiased edges when measuring background pollution.
    paper = cv2.dilate((ink < 250).astype(np.uint8), np.ones((9, 9), np.uint8)) == 0
    return float(black[paper].mean()), float(black[ink < 60].mean())


class TextureTests(unittest.TestCase):
    def test_standard_rejects_grain_without_losing_print(self):
        for seed in (14, 31, 72):
            with self.subTest(seed=seed):
                photo, ink = textured_page(seed)
                result = prepare_scan(photo)
                noise, recall = scan_metrics(result, ink)
                self.assertLess(noise, 0.0001, f'paper black-pixel fraction: {noise:.4%}')
                self.assertGreater(recall, 0.985, f'ink retained: {recall:.4%}')
                pixels = np.asarray(result)[:, :, 0]
                self.assertTrue((pixels[700:702, 95:97] == 0).all(), 'isolated punctuation is not dirt')
                self.assertGreater((pixels[650, 40:761] == 0).mean(), 0.99, 'retain thin horizontal rules')
                self.assertGreater((pixels[650:841, 40] == 0).mean(), 0.99, 'retain thin vertical rules')
                self.assertGreater((pixels[710, 210:590] == 0).mean(), 0.98, 'retain moderately faint pencil')

    def test_phone_resolution_texture_and_dimensions(self):
        photo, ink = textured_page(scale=3)
        result = prepare_scan(photo)
        self.assertEqual(result.size, photo.size)
        noise, recall = scan_metrics(result, ink)
        self.assertLess(noise, 0.0001)
        self.assertGreater(recall, 0.985)

    def test_jpeg_noise_and_detail_choices(self):
        photo, ink = textured_page()
        raw = io.BytesIO()
        photo.save(raw, format='JPEG', quality=75)
        photo = Image.open(io.BytesIO(raw.getvalue())).convert('RGB')
        noise_by_detail = {}
        for detail in ('faint', 'standard', 'denoise'):
            result = prepare_scan(photo, detail=detail)
            noise, recall = scan_metrics(result, ink)
            noise_by_detail[detail] = noise
            self.assertGreater(recall, 0.985, detail)
        self.assertLess(noise_by_detail['standard'], 0.0001)
        self.assertLessEqual(noise_by_detail['denoise'], noise_by_detail['standard'])
        self.assertGreater(noise_by_detail['faint'], noise_by_detail['standard'])

    def test_dark_one_pixel_punctuation_and_colored_rules_survive(self):
        # An area-only despeckle filter would silently delete these ink marks.
        pixels = np.full((200, 240, 3), 235, np.uint8)
        for x, color in [(20, (0, 0, 0)), (60, (80, 80, 80)),
                         (100, (180, 35, 35)), (140, (30, 50, 180))]:
            pixels[40, x] = color
            pixels[80:160, x] = color
        source = Image.fromarray(pixels)
        for detail in ('faint', 'standard', 'denoise'):
            result = np.asarray(prepare_scan(source, detail=detail))
            for x in (20, 60, 100, 140):
                self.assertEqual(result[40, x, 0], 0, (detail, x))
                self.assertTrue((result[80:160, x, 0] == 0).all(), (detail, x))
            np.testing.assert_array_equal(np.asarray(source), pixels)

    def test_scanning_binary_content_again_does_not_delete_small_marks(self):
        photo, _ = textured_page()
        first = prepare_scan(photo)
        np.testing.assert_array_equal(np.asarray(prepare_scan(first)), np.asarray(first))


if __name__ == '__main__':
    unittest.main()
