import sys, unittest
from pathlib import Path
import cv2,numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'vision'))
from vision.reference_restore import restore_from_reference
from vision.deskew import rotate_document

def reference_fixture(seed=31):
    rng=np.random.default_rng(seed);p=np.full((900,700,3),255,np.uint8)
    for y in range(70,850,48):
        text=''.join(rng.choice(list('ABCDEFGHabcdefgh123456789'),30))
        cv2.putText(p,text,(35,y),cv2.FONT_HERSHEY_SIMPLEX,.75,(0,0,0),2,cv2.LINE_AA)
    return Image.fromarray(p)

class ReferenceTests(unittest.TestCase):
    def test_annotations_and_hidden_print(self):
        ref=reference_fixture();before=np.asarray(ref).copy();p=before.copy()
        p[240:290,200:390]=0;cv2.line(p,(70,500),(500,650),(190,30,40),5)
        restored=np.asarray(restore_from_reference(Image.fromarray(p),ref))
        self.assertLess(np.abs(restored.astype(float)-before).mean(),2)
        self.assertGreater((restored[240:290,200:390]>200).mean(),.5)
        self.assertGreater((restored[240:290,200:390]<40).sum(),100)
        np.testing.assert_array_equal(np.asarray(ref),before)
    def test_rotation_alignment(self):
        ref=reference_fixture();expected,_=rotate_document(ref,3)
        p=np.array(expected);p[240:290,200:390]=0
        restored=np.asarray(restore_from_reference(Image.fromarray(p),ref))
        self.assertLess(np.abs(restored.astype(float)-np.asarray(expected)).mean(),5)
    def test_wrong_page_blank_and_no_evidence(self):
        with self.assertRaises(ValueError):restore_from_reference(reference_fixture(),reference_fixture(99))
        with self.assertRaises(ValueError):restore_from_reference(reference_fixture(),Image.new('RGB',(700,900),'white'))
        for size in ((1, 1), (1, 100), (10, 10)):
            with self.subTest(size=size):
                tiny = Image.new('RGB', size, 'white')
                with self.assertRaises(ValueError): restore_from_reference(reference_fixture(), tiny)
                with self.assertRaises(ValueError): restore_from_reference(tiny, reference_fixture())
    def test_perspective_and_different_reference_resolution(self):
        ref = reference_fixture()
        transform = cv2.getPerspectiveTransform(
            np.float32([[0, 0], [700, 0], [700, 900], [0, 900]]),
            np.float32([[24, 30], [670, 8], [688, 865], [8, 890]]))
        expected = cv2.warpPerspective(np.asarray(ref), transform, (700, 900), borderValue=(255, 255, 255))
        annotated = expected.copy()
        annotated[240:290, 200:390] = 0
        for original in (ref, ref.resize((1403, 1803))):
            with self.subTest(size=original.size):
                restored = np.asarray(restore_from_reference(Image.fromarray(annotated), original))
                self.assertLess(np.abs(restored.astype(float) - expected).mean(), 5)
    def test_unchanged_and_alpha(self):
        original = reference_fixture()
        self.assertIs(restore_from_reference(original, original), original)
        annotated = np.array(original.convert('RGBA'))
        annotated[240:290, 200:390, :3] = 0
        annotated[:, :, 3] = 230
        result = restore_from_reference(Image.fromarray(annotated), original)
        np.testing.assert_array_equal(np.asarray(result)[:, :, 3], annotated[:, :, 3])
if __name__=='__main__':unittest.main()
