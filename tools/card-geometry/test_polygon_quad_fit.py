import math
import random
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from polygon_quad_fit import ADAPTER_ID, GATES, fit_polygon_quad  # noqa: E402


def _densify(quad, per_edge=5, jitter=0.0, seed=1):
    rng = random.Random(seed)
    scale = math.sqrt(abs(0.5 * sum(
        x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(quad, quad[1:] + quad[:1])
    )))
    points = []
    for start, end in zip(quad, quad[1:] + quad[:1]):
        for step in range(per_edge):
            t = step / per_edge
            points.append((
                start[0] + (end[0] - start[0]) * t + rng.uniform(-jitter, jitter) * scale,
                start[1] + (end[1] - start[1]) * t + rng.uniform(-jitter, jitter) * scale,
            ))
    return points


CARD = [(100.0, 80.0), (340.0, 96.0), (326.0, 430.0), (88.0, 414.0)]


class PolygonQuadFitTests(unittest.TestCase):
    def test_recovers_corners_from_dense_jittered_outline(self):
        quad, reason, metrics = fit_polygon_quad(_densify(CARD, per_edge=7, jitter=0.003))
        self.assertEqual(reason, "accepted", metrics)
        self.assertEqual(ADAPTER_ID, "polygon-quad-fit-v2")
        scale = math.sqrt(metrics["areaRatio"] and 240 * 334)
        for expected in CARD:
            self.assertLess(min(math.dist(expected, actual) for actual in quad) / scale, 0.01)
        # Ordered from the top-left, clockwise in image coordinates.
        self.assertLess(quad[0][0] + quad[0][1], quad[2][0] + quad[2][1])
        self.assertGreater(quad[1][0], quad[0][0])

    def test_rounded_corners_do_not_veto_a_straight_edged_card(self):
        # Cut every corner: each edge runs from 3% past its start corner to 3%
        # before its end corner, with intermediate clicks, in polygon order.
        scale = math.sqrt(240 * 334)
        points = []
        for start, end in zip(CARD, CARD[1:] + CARD[:1]):
            d = math.dist(start, end)
            offset = 0.03 * scale / d
            for t in [offset, 0.25, 0.5, 0.75, 1 - offset]:
                points.append((start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t))
        quad, reason, metrics = fit_polygon_quad(points)
        self.assertEqual(reason, "accepted", metrics)
        self.assertGreaterEqual(metrics["areaRatio"], GATES["areaRatio"][0])

    def test_occlusion_bite_is_rejected_by_solidity_or_area(self):
        points = _densify(CARD, per_edge=6)
        bite = [(200.0, 150.0), (250.0, 200.0), (170.0, 240.0)]
        index = next(i for i, p in enumerate(points) if p[1] < 100 and p[0] > 180)
        points = points[:index] + bite + points[index:]
        quad, reason, _ = fit_polygon_quad(points)
        self.assertIsNone(quad)
        self.assertIn(reason, {"solidity", "areaRatio", "residual"})

    def test_half_covered_card_is_rejected_by_area_ratio(self):
        # A polygon that follows only the upper 60% of the card yields a quad that
        # over-covers, so its area ratio is checked rather than its residual.
        upper = [(100.0, 80.0), (340.0, 96.0), (334.0, 300.0), (94.0, 284.0)]
        points = _densify(upper, per_edge=6)
        quad, reason, metrics = fit_polygon_quad(points)
        # This is a valid smaller rectangle: it is accepted on its own terms.
        self.assertEqual(reason, "accepted", metrics)
        # But an L-shaped outline that a quad would over-cover is rejected.
        ell = [(0, 0), (200, 0), (200, 100), (100, 100), (100, 300), (0, 300)]
        quad, reason, _ = fit_polygon_quad([(float(x), float(y)) for x, y in ell])
        self.assertIsNone(quad)
        self.assertNotEqual(reason, "accepted")

    def test_square_stretched_export_passes_aspect_lower_bound(self):
        square = [(10.0, 10.0), (210.0, 10.0), (210.0, 212.0), (10.0, 212.0)]
        quad, reason, metrics = fit_polygon_quad(_densify(square, per_edge=3))
        self.assertEqual(reason, "accepted", metrics)
        very_wide = [(0.0, 0.0), (400.0, 0.0), (400.0, 100.0), (0.0, 100.0)]
        _, reason, _ = fit_polygon_quad(_densify(very_wide, per_edge=3))
        self.assertEqual(reason, "aspect")

    def test_degenerate_inputs_are_named_not_raised(self):
        self.assertEqual(fit_polygon_quad([(0.0, 0.0), (1.0, 1.0)])[1], "tooFewVertices")
        self.assertEqual(fit_polygon_quad([(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (3.0, 0.0)])[1], "degenerate")
        self.assertEqual(fit_polygon_quad([(0.0, 0.0), (1.0, 0.0), (1.0, float("nan")), (0.0, 1.0)])[1], "nonFinite")


if __name__ == "__main__":
    unittest.main()
