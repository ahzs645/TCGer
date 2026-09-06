import copy
import unittest

from audit_geometry_failures import rejection_reasons
from evaluate_geometry_candidate import candidate_result, DECODER_CONFIG


class RejectionTests(unittest.TestCase):
    def test_trace_distinguishes_confidence_and_geometry(self):
        candidate = candidate_result(
            [(0.2, 0.1), (0.7, 0.1), (0.7, 0.8), (0.2, 0.8)], 0.8, [0.9] * 4
        )
        self.assertEqual(rejection_reasons(candidate, DECODER_CONFIG), [])
        low = copy.deepcopy(candidate)
        low["confidence"] = 0.01
        self.assertEqual(rejection_reasons(low, DECODER_CONFIG), ["confidence"])
        crossed = copy.deepcopy(candidate)
        crossed["corners"][1], crossed["corners"][2] = (
            crossed["corners"][2],
            crossed["corners"][1],
        )
        self.assertIn("nonconvex", rejection_reasons(crossed, DECODER_CONFIG))
        exterior = candidate_result(
            [(-0.4, 0.1), (0.7, 0.1), (0.7, 0.8), (-0.4, 0.8)], 0.8, [0.9] * 4
        )
        self.assertIn("outside-margin", rejection_reasons(exterior, DECODER_CONFIG))

    def test_invalid_corner_confidence_is_traced(self):
        candidate = candidate_result(
            [(0.2, 0.1), (0.7, 0.1), (0.7, 0.8), (0.2, 0.8)], 0.8, [float("nan")] * 4
        )
        self.assertEqual(
            rejection_reasons(candidate, DECODER_CONFIG), ["other-validity"]
        )
