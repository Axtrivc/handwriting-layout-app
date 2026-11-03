"""A brush erases its path, never all the printed content inside its bounds."""
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'vision'))
from vision import clean_regions, InpaintOptions, RectRegion
from vision.regions import BrushStroke


def brush_fixture():
    image = Image.new('RGB', (300, 200), 'white')
    draw = ImageDraw.Draw(image)
    draw.line((50, 40, 180, 150), fill='black', width=3)
    draw.rectangle((130, 55, 150, 70), fill='black')  # printed content inside the path's bounds
    draw.rectangle((15, 170, 30, 185), fill='black')
    return image


class BrushTests(unittest.TestCase):
    def test_diagonal_preserves_print_inside_bounding_box(self):
        image = brush_fixture()
        result, count = clean_regions(image, [], strokes=[BrushStroke([(50, 40), (180, 150)], 12)])
        self.assertEqual(count, 1)
        pixels, before = np.asarray(result), np.asarray(image)
        self.assertEqual(pixels[90, 109, 0], 255)
        np.testing.assert_array_equal(pixels[55:71, 130:151], before[55:71, 130:151])
        yy, xx = np.mgrid[:200, :300]
        t = np.clip(((xx - 50) * 130 + (yy - 40) * 110) / (130**2 + 110**2), 0, 1)
        distance = np.hypot(xx - (50 + t * 130), yy - (40 + t * 110))
        np.testing.assert_array_equal(pixels[distance > 7.5], before[distance > 7.5])
        self.assertLessEqual(set(np.unique(pixels)), {0, 255})

    def test_single_click_and_edge_are_round_and_clipped(self):
        image = Image.new('RGB', (100, 100), 'white')
        draw = ImageDraw.Draw(image); draw.rectangle((0, 0, 5, 5), fill='black')
        result, _ = clean_regions(image, [], strokes=[BrushStroke([(0, 0)], 20)])
        self.assertEqual(result.size, image.size)
        self.assertEqual(result.getextrema(), ((255, 255),) * 3)
        result, count = clean_regions(image, [], strokes=[BrushStroke([(110, 110)], 4)])
        self.assertEqual(count, 0); self.assertIs(result, image)

    def test_union_order_and_alpha(self):
        image = brush_fixture().convert('RGBA')
        image.putalpha(Image.fromarray(np.tile(np.arange(200, dtype=np.uint8)[:, None], (1, 300))))
        strokes = [BrushStroke([(50, 40), (180, 150)], 12), BrushStroke([(15, 175), (30, 175)], 8)]
        result, count = clean_regions(image, [RectRegion(100, 50, 8, 8)], strokes=strokes)
        reverse, _ = clean_regions(image, [RectRegion(100, 50, 8, 8)], strokes=strokes[::-1])
        self.assertEqual(count, 3)
        np.testing.assert_array_equal(np.asarray(result), np.asarray(reverse))
        np.testing.assert_array_equal(np.asarray(result)[:, :, 3], np.asarray(image)[:, :, 3])

    def test_horizontal_rule_under_brush_is_preserved(self):
        image = Image.new('RGB', (300, 200), 'white')
        draw = ImageDraw.Draw(image)
        draw.line((0, 100, 299, 100), fill='black', width=2)
        draw.line((140, 70, 140, 130), fill='black', width=3)
        stroke = BrushStroke([(140, 70), (140, 130)], 10)
        result, _ = clean_regions(image, [], strokes=[stroke])
        self.assertTrue((np.asarray(result)[100:102] == 0).all())
        self.assertEqual(result.getpixel((140, 75)), (255, 255, 255))
        without, _ = clean_regions(image, [], strokes=[stroke], options=InpaintOptions(detect_lines=False))
        self.assertEqual(without.getpixel((140, 100)), (255, 255, 255))

    def test_invalid_paths_and_blank_noop(self):
        image = Image.new('RGB', (50, 50), 'white')
        result, count = clean_regions(image, [], strokes=[BrushStroke([(10.25, 10.75)], 3)])
        self.assertIs(result, image); self.assertEqual(count, 1)
        for stroke in [BrushStroke([], 4), BrushStroke([(5, 5)], 0), BrushStroke([(float('inf'), 5)], 4)]:
            with self.assertRaises(ValueError): clean_regions(image, [], strokes=[stroke])

    def test_crossed_grid_and_vertical_dashes(self):
        for dashed in (False, True):
            image = Image.new('RGB', (300, 260), 'white')
            paper = np.array(image)
            paper[129:131, :] = 0
            for y in range(260):
                if not dashed or y % 12 < 7: paper[y, 149:151] = 0
            image = Image.fromarray(paper)
            ImageDraw.Draw(image).line((125, 100, 175, 160), fill='black', width=4)
            result, _ = clean_regions(image, [RectRegion(115, 90, 70, 80)])
            np.testing.assert_array_equal(np.array(result), paper, f'crossing grid, dashed={dashed}')

    def test_vertical_lines_require_evidence_on_both_sides(self):
        image = Image.new('RGB', (260, 260), 'white')
        draw = ImageDraw.Draw(image)
        draw.line((120, 0, 120, 140), fill='black', width=2)  # stops within selection
        result, _ = clean_regions(image, [RectRegion(100, 110, 40, 70)])
        self.assertTrue((np.array(result)[110:180, 100:140] == 255).all(), 'a one-sided stroke is not invented as a table border')


if __name__ == '__main__':
    unittest.main()
