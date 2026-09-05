import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
from audit_near_duplicates import perceptual_hashes, POPCOUNT
from train_yolo_pose import sha256_file


class NearDuplicateTests(unittest.TestCase):
    def test_rotated_reencoded_image_is_candidate_despite_different_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pixels = np.random.default_rng(20260904).integers(
                0, 256, (64, 64), dtype=np.uint8
            )
            image = Image.fromarray(pixels).resize((256, 256))
            a = root / "original.png"
            b = root / "rotated.jpg"
            image.save(a)
            image.transpose(Image.Transpose.ROTATE_90).save(b, quality=95)
            self.assertNotEqual(sha256_file(a), sha256_file(b))
            distances = POPCOUNT[
                np.bitwise_xor(perceptual_hashes(a)[0], perceptual_hashes(b))
            ].sum(axis=1)
            self.assertLessEqual(int(distances.min()), 4)
