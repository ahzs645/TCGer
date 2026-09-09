import unittest
from unittest.mock import patch

import numpy as np

from recognition_orientation import choose_family, cyclic_crops, recognize_quad


def phase(family, score, rival, index=0):
    return dict(family=family, topScore=score, rivalMargin=score-rival, phase=index)


class RecognitionOrientationTests(unittest.TestCase):
    def test_individually_confident_conflicting_rotations_abstain(self):
        decision = choose_family([phase("A", .85, .6), phase("B", .83, .5, 1)], .65)
        self.assertFalse(decision["accepted"])
        self.assertAlmostEqual(decision["rivalMargin"], .02)

    def test_same_family_across_rotations_does_not_compete(self):
        result = choose_family([phase("A", .85, .6), phase("A", .84, .5, 1)], .65)
        self.assertTrue(result["accepted"])
        self.assertAlmostEqual(result["rivalMargin"], .25)

    def test_runner_up_from_other_rotation_is_considered(self):
        result = choose_family([phase("A", .85, .5), phase("A", .84, .82, 1)], .65)
        self.assertFalse(result["accepted"])
        self.assertAlmostEqual(result["rivalMargin"], .03)

    def test_empty_ties_low_scores_and_nonfinite_fail_closed(self):
        self.assertFalse(choose_family([], .65)["accepted"])
        self.assertFalse(choose_family([phase("A", .64, .1)], .65)["accepted"])
        tied = choose_family([phase("A", .8, .6), phase("B", .8, .6, 1)], .65)
        self.assertEqual(tied["phase"], 0)
        self.assertFalse(tied["accepted"])
        with self.assertRaises(ValueError):
            choose_family([phase("A", float("nan"), .5)], .65)

    def test_four_warps_preserve_corner_colors_and_winding(self):
        image = np.zeros((100, 72, 3), dtype=np.uint8)
        colors = [[240, 0, 0], [0, 240, 0], [0, 0, 240], [240, 240, 0]]
        image[:50, :36], image[:50, 36:] = colors[:2]
        image[50:, 36:], image[50:, :36] = colors[2:]
        quad = [[0,0], [1,0], [1,1], [0,1]]
        crops = cyclic_crops(image, quad)
        self.assertEqual([p for p, _ in crops], [0,2,1,3])
        for phase_id, crop in crops:
            pixels = np.asarray(crop)
            observed = [pixels[30,30], pixels[30,-30], pixels[-30,-30], pixels[-30,30]]
            np.testing.assert_array_equal(observed, colors[phase_id:]+colors[:phase_id])
        for bad in (quad[::-1], [quad[i] for i in (0,2,1,3)], [[0,0]]*4):
            with self.assertRaises(ValueError):
                cyclic_crops(image, bad)

    def test_invalid_quad_abstains_without_running_encoder(self):
        from types import SimpleNamespace
        with patch("recognition_orientation.warp_reference") as warp:
            result = recognize_quad(SimpleNamespace(threshold=.65), None, [[0,0]]*4)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "invalid-quad")
        warp.assert_not_called()

    def test_invalid_index_rows_are_excluded_but_bad_queries_raise(self):
        from types import SimpleNamespace
        runtime = SimpleNamespace(threshold=.65, families=["A","B","invalid"],
            vectors=np.array([[.9,0],[.5,0],[float("nan"),float("nan")]]),
            embed=lambda crop: np.array([1,0]))
        with patch("recognition_orientation.cyclic_crops", return_value=[(0,None)]):
            result=recognize_quad(runtime,None,None)
            self.assertTrue(result["accepted"])
            self.assertEqual(result["family"],"A")
            runtime.embed=lambda crop: np.array([float("nan"),0])
            with self.assertRaisesRegex(ValueError,"query embedding"):
                recognize_quad(runtime,None,None)


if __name__ == "__main__":
    unittest.main()
