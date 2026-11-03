"""EXIF orientation, scan tone, small strokes and binary erase regressions."""
import base64
import io
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'vision'))
from vision import b64_to_image, image_to_b64, clean_regions, InpaintOptions, RectRegion
from vision.scan import prepare_scan


def oriented_jpeg():
    """A 240x360 displayed page stored sideways with EXIF=6, as on a phone."""
    upright = Image.new('RGB', (240, 360), 'white')
    d = ImageDraw.Draw(upright)
    d.rectangle((5, 5, 25, 25), fill=(220, 30, 30))
    d.rectangle((210, 330, 230, 350), fill=(30, 50, 220))
    d.line([(100, 100), (100, 150), (130, 150)], fill='black', width=4)
    d.line([(130, 100), (130, 150)], fill='black', width=4)
    exif = Image.Exif(); exif[274] = 6
    buffer = io.BytesIO()
    upright.transpose(Image.Transpose.ROTATE_90).save(buffer, format='JPEG', quality=98, subsampling=0, exif=exif)
    return buffer.getvalue()


def scan_fixture():
    ink = Image.new('L', (360, 240), 255)
    draw = ImageDraw.Draw(ink)
    for y in (35, 100, 165):
        for x in (30, 100, 170, 240):
            draw.line([(x, y), (x, y + 22), (x + 20, y + 22)], fill=15, width=2)
            draw.line([(x + 20, y), (x + 20, y + 22)], fill=15, width=2)
    draw.line((20, 210, 330, 210), fill=25, width=1)
    draw.rectangle((40, 70, 41, 71), fill=15)
    reflectance = np.array(ink, dtype=np.float32) / 255
    light = np.tile(np.linspace(105, 245, 360), (240, 1))
    noise = np.random.default_rng(9).normal(0, 1.2, light.shape)
    photo = np.clip(light * reflectance + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(photo).convert('RGB'), reflectance < 0.5


class OrientationTests(unittest.TestCase):
    def test_all_exif_orientations_match_display_coordinates(self):
        colors = [(220, 30, 30), (30, 200, 30), (30, 30, 220), (220, 200, 30)]
        original = Image.new('RGB', (120, 80))
        draw = ImageDraw.Draw(original)
        for color, box in zip(colors, [(0, 0, 59, 39), (60, 0, 119, 39), (0, 40, 59, 79), (60, 40, 119, 79)]):
            draw.rectangle(box, fill=color)
        expected = {1: [0, 1, 2, 3], 2: [1, 0, 3, 2], 3: [3, 2, 1, 0], 4: [2, 3, 0, 1],
                    5: [0, 2, 1, 3], 6: [2, 0, 3, 1], 7: [3, 1, 2, 0], 8: [1, 3, 0, 2]}
        for orientation, indices in expected.items():
            with self.subTest(orientation=orientation):
                exif = Image.Exif(); exif[274] = orientation
                raw = io.BytesIO(); original.save(raw, format='JPEG', quality=98, subsampling=0, exif=exif)
                image = b64_to_image(base64.b64encode(raw.getvalue()).decode(), 'image/jpeg')
                self.assertEqual(image.size, (80, 120) if orientation >= 5 else (120, 80))
                self.assertNotIn(image.getexif().get(274), (2, 3, 4, 5, 6, 7, 8))
                corners = [(10, 10), (image.width - 10, 10), (10, image.height - 10), (image.width - 10, image.height - 10)]
                for (x, y), index in zip(corners, indices):
                    self.assertLess(np.max(np.abs(np.array(image.getpixel((x, y)), dtype=int) - colors[index])), 8)
                restored = b64_to_image(image_to_b64(image))
                np.testing.assert_array_equal(np.asarray(restored), np.asarray(image), 'PNG must not apply EXIF twice')

    def test_oriented_cleanup_uses_the_visible_selection(self):
        image = b64_to_image(base64.b64encode(oriented_jpeg()).decode(), 'image/jpeg')
        result, _ = clean_regions(image, [RectRegion(90, 90, 55, 75)], options=InpaintOptions(detect_lines=False))
        before, after = np.asarray(image), np.asarray(result)
        selection = np.zeros((360, 240), bool); selection[90:165, 90:145] = True
        self.assertEqual(result.size, (240, 360))
        np.testing.assert_array_equal(before[~selection], after[~selection])
        self.assertGreater(float(after[selection].mean()), float(before[selection].mean()) + 10)

    def test_palette_transparency_is_retained(self):
        image = Image.new('P', (10, 10), 0); image.putpalette([30, 40, 50] + [0] * 765)
        raw = io.BytesIO(); image.save(raw, format='PNG', transparency=0)
        decoded = b64_to_image(base64.b64encode(raw.getvalue()).decode())
        self.assertEqual(decoded.mode, 'RGBA')
        self.assertEqual(decoded.getchannel('A').getextrema(), (0, 0))


class ScanTests(unittest.TestCase):
    def test_uneven_paper_becomes_white_without_losing_thin_ink(self):
        photo, ink = scan_fixture()
        result = np.asarray(prepare_scan(photo))[:, :, 0]
        self.assertLessEqual(set(np.unique(result)), {0, 255})
        self.assertGreater((result[ink] == 0).mean(), 0.99)
        self.assertGreater((result[~ink] == 255).mean(), 0.99)
        self.assertTrue((result[210, 20:331] == 0).all(), 'retain 1px rules')
        self.assertTrue((result[70:72, 40:42] == 0).all(), 'retain small punctuation')

    def test_gray_retains_tone_and_faint_option_retains_more_ink(self):
        image = Image.new('RGB', (120, 100), 'white')
        ImageDraw.Draw(image).line((40, 25, 40, 75), fill=(238, 238, 238), width=2)
        gray = np.asarray(prepare_scan(image, mode='gray'))
        standard = np.asarray(prepare_scan(image))
        faint = np.asarray(prepare_scan(image, detail='faint'))
        self.assertTrue(((gray > 0) & (gray < 255)).any())
        self.assertGreater(int((faint == 0).sum()), int((standard == 0).sum()))

    def test_blank_and_tiny_pages_stay_blank(self):
        for size in ((1, 1), (3, 5), (180, 200)):
            for mode in ('bw', 'gray'):
                result = prepare_scan(Image.new('RGB', size, (145, 145, 145)), mode=mode)
                self.assertEqual(result.size, size)
                self.assertEqual(result.getextrema(), ((255, 255),) * 3)

    def test_alpha_and_original_are_unchanged(self):
        image, _ = scan_fixture()
        image.putalpha(Image.fromarray(np.tile(np.arange(240, dtype=np.uint8)[:, None], (1, 360))))
        original = np.array(image)
        result = prepare_scan(image)
        np.testing.assert_array_equal(np.asarray(image), original)
        np.testing.assert_array_equal(np.asarray(result)[:, :, 3], original[:, :, 3])

    def test_binary_erase_has_no_gray_smear_even_for_wide_strokes(self):
        image = Image.new('RGB', (300, 200), 'white')
        draw = ImageDraw.Draw(image)
        draw.rectangle((110, 60, 170, 145), fill='black')
        draw.text((20, 20), 'KEEP', fill='black')
        image = image.convert('1').convert('RGB')
        result, count = clean_regions(image, [RectRegion(100, 50, 85, 110)], options=InpaintOptions(detect_lines=False))
        self.assertEqual(count, 1)
        pixels = np.asarray(result)
        self.assertTrue((pixels[50:160, 100:185] == 255).all())
        self.assertLessEqual(set(np.unique(pixels)), {0, 255})
        np.testing.assert_array_equal(pixels[:50], np.asarray(image)[:50])

    def test_binary_cleanup_retains_supported_horizontal_rule(self):
        image = Image.new('RGB', (300, 140), 'white')
        draw = ImageDraw.Draw(image)
        draw.line((0, 68, 299, 68), fill='black', width=2)
        draw.line((130, 40, 130, 100), fill='black', width=4)
        result, _ = clean_regions(image, [RectRegion(100, 35, 65, 70)])
        self.assertTrue((np.asarray(result)[68:70, :, :] == 0).all())
        self.assertTrue((np.asarray(result)[40:60, 128:133, :] == 255).all())


if __name__ == '__main__':
    unittest.main()
