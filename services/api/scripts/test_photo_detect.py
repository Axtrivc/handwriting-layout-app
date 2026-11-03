"""Photo detection regressions: illumination, noise, neighbors and alpha."""
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'vision'))
from vision.glyph_detect import DetectParams, detect_and_sort
from vision.glyph import GlyphProcessOptions, process_glyph, make_transparent
from vision.regions import RectRegion


def photo_fixture(ink=35):
    background = np.tile(np.linspace(105, 245, 400, dtype=np.uint8), (220, 1))
    image = Image.fromarray(background).convert('RGB')
    draw = ImageDraw.Draw(image)
    for y in (35, 135):
        for x in (30, 130, 230, 330):
            draw.line([(x, y), (x, y + 30), (x + 22, y + 30)], fill=(ink,) * 3, width=4)
            draw.line([(x + 22, y), (x + 22, y + 30)], fill=(ink,) * 3, width=4)
    return image


class PhotoDetectionTests(unittest.TestCase):
    def detect(self, image):
        return detect_and_sort(image, DetectParams(threshold_mode='adaptive'))

    def test_shadowed_photo_recovers_all_characters(self):
        image = photo_fixture()
        fixed = detect_and_sort(image)
        adaptive = self.detect(image)
        self.assertLess(len(fixed), 8)
        self.assertEqual(len(adaptive), 8)
        self.assertEqual([(c.row_index, c.order_index) for c in adaptive], [(r, c) for r in range(2) for c in range(4)])
        for candidate, (x, y) in zip(adaptive, [(x, y) for y in (35, 135) for x in (30, 130, 230, 330)]):
            self.assertLessEqual(candidate.x, x)
            self.assertGreaterEqual(candidate.x + candidate.width, x + 24)
            self.assertLess(candidate.width, 40)
            self.assertLess(candidate.height, 45)
            self.assertLessEqual(candidate.y, y)
            self.assertGreaterEqual(candidate.y + candidate.height, y + 31)

    def test_blank_gradient_and_camera_noise_do_not_create_glyphs(self):
        gray = np.tile(np.linspace(105, 245, 400), (220, 1))
        gray += np.random.default_rng(42).normal(0, 2, gray.shape)
        self.assertEqual(self.detect(Image.fromarray(np.clip(gray, 0, 255).astype('uint8'))), [])

    def test_neighboring_characters_stay_separate(self):
        image = Image.new('RGB', (180, 100), (150, 150, 150))
        draw = ImageDraw.Draw(image)
        for x in (25, 65, 105):
            draw.rectangle((x, 25, x + 28, 60), fill=(50, 50, 50))
        self.assertEqual(len(self.detect(image)), 3)

    def test_noisy_photo_preserves_character_count(self):
        image = np.asarray(photo_fixture(), dtype=float)
        image += np.random.default_rng(12).normal(0, 2, image.shape)
        self.assertEqual(len(self.detect(Image.fromarray(np.clip(image, 0, 255).astype('uint8')))), 8)

    def test_transparent_background_is_paper(self):
        image = Image.new('RGBA', (180, 100), (0, 0, 0, 0))
        ImageDraw.Draw(image).rectangle((30, 25, 55, 60), fill=(20, 20, 20, 255))
        for mode in ('fixed', 'adaptive'):
            self.assertEqual(len(detect_and_sort(image, DetectParams(threshold_mode=mode))), 1)

    def test_small_blank_images_and_unknown_mode(self):
        for size in ((1, 1), (2, 10), (16, 16)):
            self.assertEqual(self.detect(Image.new('RGB', size, 'white')), [])
        with self.assertRaises(ValueError):
            detect_and_sort(photo_fixture(), DetectParams(threshold_mode='misspelled'))

    def test_fixed_default_is_unchanged(self):
        image = photo_fixture()
        self.assertEqual(detect_and_sort(image), detect_and_sort(image, DetectParams(threshold_mode='fixed')))


class PhotoGlyphTests(unittest.TestCase):
    def test_shadow_is_removed_but_strokes_remain(self):
        image = photo_fixture()
        opts = GlyphProcessOptions(trim=False, transparent=True, background_mode='adaptive')
        out = np.asarray(process_glyph(image, RectRegion(20, 25, 50, 50), opts).image)
        source = np.asarray(image)[25:75, 20:70]
        ink = np.all(source == 35, axis=2)
        self.assertTrue((out[:, :, 3][~ink] == 0).all(), 'shadow must not become a translucent rectangle')
        self.assertTrue((out[:, :, 3][ink] > 100).all(), 'retain the complete strokes')

    def test_colored_ink_keeps_its_color(self):
        image = Image.new('RGB', (100, 100), (190, 180, 170))
        ImageDraw.Draw(image).line((40, 30, 40, 65), fill=(30, 40, 160), width=4)
        result = process_glyph(image, RectRegion(25, 20, 40, 60), GlyphProcessOptions(transparent=True, background_mode='adaptive'))
        pixels = np.asarray(result.image)
        ink = pixels[pixels[:, :, 3] > 100]
        self.assertGreater(len(ink), 0)
        self.assertTrue((ink[:, 2] > ink[:, 0] + 80).all(), 'blue ink must not be converted to grayscale')

    def test_alpha_and_normalized_padding_are_preserved(self):
        image = Image.new('RGBA', (100, 100), (0, 0, 0, 0))
        ImageDraw.Draw(image).line((40, 30, 40, 65), fill=(20, 20, 20, 128), width=4)
        for mode in ('fixed', 'adaptive'):
            result = process_glyph(image, RectRegion(25, 20, 40, 60), GlyphProcessOptions(transparent=True, normalize_size=64, background_mode=mode))
            pixels = np.asarray(result.image)
            self.assertEqual(result.image.size, (64, 64))
            self.assertEqual(int(pixels[:, 0, 3].max()), 0)
            self.assertGreater(int(pixels[:, :, 3].max()), 0)
        original = np.asarray(image)
        self.assertTrue((np.asarray(make_transparent(image))[:, :, 3] <= original[:, :, 3]).all())

    def test_photo_pipeline_supports_blank_binary_and_opaque_outputs(self):
        blank = Image.new('RGB', (100, 100), (120, 120, 120))
        result = process_glyph(blank, RectRegion(10, 10, 50, 50), GlyphProcessOptions(transparent=True, background_mode='adaptive'))
        self.assertFalse(np.asarray(result.image)[:, :, 3].any())
        image = photo_fixture()
        for transparent in (True, False):
            result = process_glyph(image, RectRegion(20, 25, 50, 50), GlyphProcessOptions(transparent=transparent, threshold=True, background_mode='adaptive'))
            self.assertEqual(result.image.mode, 'RGBA' if transparent else 'RGB')
            if not transparent:
                self.assertEqual(result.image.getpixel((0, 0)), (255, 255, 255))


if __name__ == '__main__':
    unittest.main()
