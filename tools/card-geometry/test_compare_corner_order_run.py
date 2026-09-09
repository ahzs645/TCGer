import unittest

from compare_corner_order_run import summarize_frames


class ComparisonReportTests(unittest.TestCase):
    def test_zero_error_totals_remain_explicit_in_report(self):
        frames = [{"candidate": {
            "counts": {"truth": 1, "matched": 1, "misses": 0, "extras": 0, "duplicates": 0},
            "matches": [{"iou": iou, "meanCornerFraction": error}],
            "status": "close-agreement",
        }} for iou, error in ((.98, .01), (.94, .03))]
        result = summarize_frames(frames, "candidate")
        self.assertEqual(result["counts"], {
            "truth": 2, "matched": 2, "misses": 0, "extras": 0, "duplicates": 0,
        })
        self.assertEqual(result["matchedAtIou"], {"0.5": 2, "0.75": 2, "0.9": 2})
        self.assertAlmostEqual(result["medianMeanCornerFraction"], .02)


if __name__ == "__main__":
    unittest.main()
