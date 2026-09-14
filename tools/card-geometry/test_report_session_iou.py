import unittest
import numpy as np
from report_session_iou import assigned_overlap, distribution


class AssignmentTests(unittest.TestCase):
    def test_one_prediction_cannot_explain_two_cards(self):
        values, assigned = assigned_overlap([[.8], [.7]])
        self.assertEqual(values, [.8, 0.])
        self.assertEqual(assigned, [1, None])

    def test_assignment_is_global_and_preserves_subthreshold_overlap(self):
        values, assigned = assigned_overlap([[.49, .48], [.47, 0.]])
        self.assertEqual(values, [.48, .47])
        self.assertEqual(assigned, [2, 1])

    def test_missing_predictions_remain_in_denominator(self):
        values, _ = assigned_overlap(np.zeros((3, 0)))
        self.assertEqual(distribution(values)['zeroOverlap'], 3)
        self.assertEqual(distribution(values)['count'], 3)

    def test_invalid_overlap_rejected(self):
        with self.assertRaises(ValueError):
            assigned_overlap([[float('nan')]])


if __name__ == '__main__':
    unittest.main()
