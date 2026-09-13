import unittest
import numpy as np
from run_sam31_card_pilot import reference_agreement, four_corner_draft


class PilotMetricTests(unittest.TestCase):
    def test_duplicate_mask_is_an_extra_and_empty_detection_is_a_miss(self):
        cards = [dict(quad=[[0,0],[1,0],[1,1],[0,1]])]
        m = np.ones((20,20),dtype=bool)
        r = reference_agreement([m,m], cards, 20,20)
        self.assertEqual((r['matchedAt50'],r['extraMasks']), (1,1))
        r = reference_agreement([], cards, 20,20)
        self.assertEqual((r['matchedAt50'],r['unmatchedCards']), (0,1))

    def test_contour_draft_requires_four_convex_points(self):
        m = np.zeros((100,100),dtype=bool);m[20:80,30:70]=True
        self.assertEqual(len(four_corner_draft(m)),4)
        self.assertIsNone(four_corner_draft(np.zeros_like(m)))
        yy,xx=np.mgrid[:100,:100];circle=(xx-50)**2+(yy-50)**2<30**2
        self.assertIsNone(four_corner_draft(circle))


if __name__ == '__main__':
    unittest.main()
