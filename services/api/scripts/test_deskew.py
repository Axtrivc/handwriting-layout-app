import sys,unittest
from pathlib import Path
import cv2,numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'vision'))
from vision.deskew import estimate_skew,rotate_document
from vision.scan import prepare_scan

def page_fixture(angle=0):
    p=np.full((900,700,3),255,np.uint8)
    for i,y in enumerate(range(100,820,65)):
        cv2.putText(p,f'The document line {i}: print, 12345.',(45,y),cv2.FONT_HERSHEY_SIMPLEX,.75,(20,20,20),2,cv2.LINE_AA)
    return rotate_document(Image.fromarray(p),angle)[0]

class DeskewTests(unittest.TestCase):
    def test_known_angles(self):
        for angle in (-9,-4,2.5,7):
            with self.subTest(angle=angle):
                im=page_fixture(angle); found,confidence=estimate_skew(im)
                self.assertAlmostEqual(found,-angle,delta=.35)
                corrected,scale=rotate_document(im,found)
                self.assertEqual(corrected.size,im.size)
                self.assertLessEqual(abs(estimate_skew(corrected)[0]),.3)
                self.assertGreater(confidence,.45);self.assertLessEqual(scale,1)
    def test_abstain_on_upright_blank_sparse_and_diagonal(self):
        for im in (page_fixture(),Image.new('RGB',(700,900),'white'),Image.new('RGB',(1,1),'white')):
            self.assertEqual(estimate_skew(im)[0],0)
        p=np.full((900,700,3),255,np.uint8);cv2.line(p,(50,50),(600,750),(0,0,0),3)
        self.assertEqual(estimate_skew(Image.fromarray(p))[0],0)
    def test_whole_page_and_alpha(self):
        p=Image.new('RGBA',(700,900),(255,255,255,0));a=np.array(p)
        a[2:15,2:15]=(255,0,0,255);a[-15:-2,-15:-2]=(0,0,255,255)
        im=Image.fromarray(a);out,scale=rotate_document(im,10);b=np.array(out)
        self.assertGreater(((b[:,:,0]>200)&(b[:,:,1]<80)&(b[:,:,3]>200)).sum(),50)
        self.assertGreater(((b[:,:,2]>200)&(b[:,:,0]<80)&(b[:,:,3]>200)).sum(),50)
        np.testing.assert_array_equal(np.asarray(im),a)
        self.assertEqual(out.mode,'RGBA')
    def test_shaded_noisy_photos(self):
        for seed, angle in ((10, -6), (20, 3), (30, 8)):
            with self.subTest(seed=seed, angle=angle):
                rgb = np.asarray(page_fixture(angle)).astype(float)
                h, w = rgb.shape[:2]
                y, x = np.mgrid[:h, :w]
                light = .64 + .25 * x / w + .06 * y / h
                rng = np.random.default_rng(seed)
                photo = np.clip(rgb * light[:, :, None] + rng.normal(0, 3, rgb.shape), 0, 255).astype('uint8')
                scanned = prepare_scan(Image.fromarray(photo))
                self.assertAlmostEqual(estimate_skew(scanned)[0], -angle, delta=.4)
if __name__=='__main__':unittest.main()
