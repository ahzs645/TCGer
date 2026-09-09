import unittest

import cv2
import numpy as np

from refine_archive_corner_proposals import fit_candidates


class EdgeRefinementTests(unittest.TestCase):
    def test_tilted_card_edges_replace_axis_aligned_box(self):
        image = np.full((220, 200, 3), 25, dtype=np.uint8)
        quad = np.array([[50, 20], [160, 45], [125, 195], [20, 175]], np.int32)
        cv2.fillConvexPoly(image, quad, (225, 225, 225))
        cv2.putText(image, "CARD", (50, 90), cv2.FONT_HERSHEY_SIMPLEX, .7, (40, 40, 40), 2)
        prior = np.array([[20, 20], [160, 20], [160, 195], [20, 195]], float)
        candidates = fit_candidates(image, prior, [20, 20, 160, 195])
        self.assertTrue(candidates)
        self.assertLess(np.linalg.norm(candidates[0][1] - quad, axis=1).max(), 5)

    def test_flat_crop_does_not_manufacture_an_outline(self):
        prior = np.array([[20, 20], [160, 20], [160, 195], [20, 195]], float)
        self.assertEqual(fit_candidates(np.full((220, 200, 3), 100, np.uint8), prior, [20, 20, 160, 195]), [])


if __name__ == "__main__":
    unittest.main()
