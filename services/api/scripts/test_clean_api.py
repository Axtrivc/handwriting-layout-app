"""Live API regression checks; start pnpm dev:api first."""
import base64
import io
import json
import unittest
import urllib.request
import urllib.error

import numpy as np
from PIL import Image
from test_inpaint import CleanupTests


class CleanApiTests(unittest.TestCase):
    def send(self, image, regions, mime='image/png', **options):
        buf = io.BytesIO()
        image.save(buf, format='JPEG' if mime == 'image/jpeg' else 'PNG')
        source = Image.open(io.BytesIO(buf.getvalue())).copy()
        req = urllib.request.Request('http://127.0.0.1:8001/clean-region',
            data=json.dumps(dict(image=base64.b64encode(buf.getvalue()).decode(),
                                 mime=mime, regions=regions, **options)).encode(),
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as response:
            body = json.load(response)
        result = Image.open(io.BytesIO(base64.b64decode(body['image'])))
        self.assertEqual(body['mime'], 'image/png')
        self.assertEqual(result.format, 'PNG')
        self.assertEqual(result.size, image.size)
        return np.array(source), np.array(result)

    def test_strengths_and_lossless_exterior(self):
        _, image, r = CleanupTests().fixture((175, 175, 175), 'solid')
        selected = np.zeros((140, 300), dtype=bool)
        selected[r.y:r.y+r.height, r.x:r.x+r.width] = True
        for mime in ('image/png', 'image/jpeg'):
            for strength in ('gentle', 'standard', 'strong'):
                with self.subTest(mime=mime, strength=strength):
                    before, after = self.send(image, [r.__dict__], mime, strength=strength)
                    np.testing.assert_array_equal(before[~selected], after[~selected])
                    self.assertGreater(np.abs(before.astype(float)-after).sum(), 0)

    def test_invalid_region_and_options(self):
        _, image, _ = CleanupTests().fixture()
        for regions, options, code in [
            ([], {}, 400),
            ([dict(x=500,y=20,width=30,height=30)], {}, 400),
            ([dict(x=10,y=20,width=0,height=30)], {}, 422),
            ([dict(x=10,y=20,width=30,height=30)], dict(strength='unknown'), 422),
        ]:
            with self.subTest(regions=regions, options=options):
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    self.send(image, regions, **options)
                self.assertEqual(ctx.exception.code, code)


if __name__ == '__main__':
    unittest.main()
