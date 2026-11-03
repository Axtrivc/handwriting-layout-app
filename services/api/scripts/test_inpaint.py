"""Pixel-level cleanup regressions. Run with services/api/.venv/bin/python."""
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'vision'))
from vision import RectRegion, clean_regions


class CleanupTests(unittest.TestCase):
    def fixture(self, color=(35, 35, 35), rule=None):
        # Known clean target, shaded paper and nearby unrelated text.
        paper = np.zeros((140, 300, 3), dtype=np.uint8)
        for x in range(300):
            paper[:, x] = (230 + x // 20, 226 + x // 20, 218 + x // 20)
        if rule == 'solid':
            paper[68:70, :] = (150, 160, 180)
        if rule == 'dashed':
            for x in range(300):
                if x % 12 < 7:
                    paper[68:70, x] = (150, 160, 180)
        image = Image.fromarray(paper.copy())
        draw = ImageDraw.Draw(image)
        draw.line([(120, 48), (120, 86), (140, 86)], fill=color, width=3)
        draw.line([(149, 48), (149, 86)], fill=color, width=2)
        draw.line([(110, 55), (160, 55)], fill=color, width=2)
        region = RectRegion(100, 38, 70, 60)
        return paper, image, region

    def check_cleanup(self, color, rule=None):
        paper, image, region = self.fixture(color, rule)
        result, count = clean_regions(image, [region])
        before, after = np.array(image), np.array(result)
        selected = np.zeros(before.shape[:2], dtype=bool)
        selected[38:98, 100:170] = True
        self.assertEqual(count, 1)
        np.testing.assert_array_equal(after[~selected], before[~selected])
        stroke = np.any(before != paper, axis=2)
        error = np.abs(after.astype(float) - paper.astype(float))[stroke].mean()
        self.assertLess(error, 12, f'ink residual error: {error}')
        if rule:
            self.assertLess(np.abs(after[68:70, 100:170].astype(float) - paper[68:70, 100:170]).mean(), 4)

    def test_black_ink(self): self.check_cleanup((30, 30, 30))
    def test_light_pencil(self): self.check_cleanup((175, 175, 175))
    def test_blue_ink(self): self.check_cleanup((100, 150, 220))
    def test_red_ink(self): self.check_cleanup((220, 120, 120))
    def test_solid_rule(self): self.check_cleanup((30, 30, 30), 'solid')
    def test_dashed_rule(self): self.check_cleanup((30, 30, 30), 'dashed')

    def test_empty_and_outside(self):
        _, image, _ = self.fixture()
        for regions in ([], [RectRegion(400, 40, 20, 20)], [RectRegion(-40, -40, 10, 10)], [RectRegion(1, 1, 0, 20)]):
            result, count = clean_regions(image, regions)
            self.assertEqual(count, 0)
            np.testing.assert_array_equal(result, image)

    def test_blank_paper_unchanged(self):
        paper, _, region = self.fixture()
        result, _ = clean_regions(Image.fromarray(paper), [region])
        np.testing.assert_array_equal(result, paper)

    def test_rule_without_text_unchanged(self):
        for rule in ('solid', 'dashed'):
            paper, _, region = self.fixture(rule=rule)
            result, _ = clean_regions(Image.fromarray(paper), [region])
            np.testing.assert_array_equal(result, paper)

    def test_overlap_order_independent(self):
        _, image, region = self.fixture()
        other = RectRegion(130, 50, 60, 55)
        a, _ = clean_regions(image, [region, other])
        b, _ = clean_regions(image, [other, region])
        np.testing.assert_array_equal(a, b)

    def test_alpha_preserved(self):
        _, image, region = self.fixture()
        rgba = image.convert('RGBA')
        rgba.putalpha(Image.fromarray(np.tile(np.arange(140, dtype=np.uint8)[:, None], (1, 300))))
        result, _ = clean_regions(rgba, [region])
        np.testing.assert_array_equal(np.array(result)[:, :, 3], np.array(rgba)[:, :, 3])

    def test_rules_outside_selection_untouched(self):
        paper, image, region = self.fixture()
        pixels = np.array(image)
        pixels[30, :] = 150
        pixels[102, :] = 150
        result, _ = clean_regions(Image.fromarray(pixels), [region])
        after = np.array(result)
        np.testing.assert_array_equal(after[:38], pixels[:38])
        np.testing.assert_array_equal(after[98:], pixels[98:])

    def test_antialiased_ink_on_textured_paper(self):
        rng = np.random.default_rng(42)
        paper, image, region = self.fixture((155, 160, 170))
        # Simulate scanner blur and low-level paper texture with a known target.
        import cv2
        noise = rng.normal(0, 1.5, paper.shape)
        source = np.clip(cv2.GaussianBlur(np.array(image), (3, 3), 0.6) + noise, 0, 255).astype(np.uint8)
        target = np.clip(paper + noise, 0, 255).astype(np.uint8)
        result, _ = clean_regions(Image.fromarray(source), [region])
        stroke = np.any(np.array(image) != paper, axis=2)
        self.assertLess(np.abs(np.array(result).astype(float) - target)[stroke].mean(), 8)

    def test_clipping(self):
        self.assertEqual(RectRegion(-5, -5, 10, 10).clip_to(20, 20), RectRegion(0, 0, 5, 5))
        self.assertFalse(RectRegion(20, 5, 3, 3).clip_to(20, 20).is_valid())


if __name__ == '__main__':
    unittest.main()
