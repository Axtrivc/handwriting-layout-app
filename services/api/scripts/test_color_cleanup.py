import sys
import unittest
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'vision'))
from vision.color_cleanup import clean_colored_ink
from vision.scan import prepare_scan

class ColorTests(unittest.TestCase):
    def fixture(self):
        im=Image.new('RGB',(300,200),'white'); d=ImageDraw.Draw(im)
        d.line((50,30,90,100), fill=(190,30,35),width=4)
        d.line((120,30,150,100),fill=(20,40,180),width=4)
        d.line((0,65,299,65),fill='black',width=2)
        d.text((180,40),'KEEP',fill='black')
        return im
    def test_color_and_black_crossing(self):
        im=self.fixture(); before=np.asarray(im); after=np.asarray(clean_colored_ink(im,im))
        neutral=np.ptp(before.astype(int),axis=2)==0
        np.testing.assert_array_equal(after[neutral],before[neutral])
        self.assertGreater(after[~neutral].mean(),240)
    def test_scan_history_source(self):
        im=self.fixture(); scan=prepare_scan(im); result=clean_colored_ink(scan,im)
        self.assertEqual(result.getpixel((70,65)),(0,0,0))
        self.assertEqual(result.getpixel((50,30)),(255,255,255))
        self.assertIs(clean_colored_ink(scan,scan),scan)
    def test_alpha_blank_and_dimensions(self):
        im=self.fixture().convert('RGBA'); im.putalpha(128)
        result=clean_colored_ink(im,im)
        np.testing.assert_array_equal(np.asarray(im)[:,:,3],np.asarray(result)[:,:,3])
        with self.assertRaises(ValueError): clean_colored_ink(im,Image.new('RGB',(10,10)))
        blank=Image.new('RGB',(200,200),(240,235,220))
        self.assertIs(clean_colored_ink(blank,blank),blank)
if __name__=='__main__': unittest.main()
