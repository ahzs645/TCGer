from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from analyze_geometry_outcomes import (  # noqa: E402
    classify_outcome,
    error_bucket,
    summarize_buckets,
)


class GeometryOutcomeAnalysisTests(unittest.TestCase):
    def test_archived_abstain_does_not_require_an_identity_verdict(self):
        self.assertEqual(classify_outcome(identified=False, verdict=None), "abstain")
        self.assertEqual(
            classify_outcome(identified=False, verdict="false_margin"), "abstain"
        )

    def test_identified_result_uses_human_identity_verdict(self):
        self.assertEqual(classify_outcome(identified=True, verdict="true"), "correct")
        self.assertEqual(
            classify_outcome(identified=True, verdict="false_margin"), "wrong"
        )
        self.assertEqual(classify_outcome(identified=True, verdict=None), "unknown")

    def test_error_buckets_have_stable_half_open_boundaries(self):
        self.assertEqual(error_bucket(0.0), "[0.00,0.05)")
        self.assertEqual(error_bucket(0.049999), "[0.00,0.05)")
        self.assertEqual(error_bucket(0.05), "[0.05,0.10)")
        self.assertEqual(error_bucket(0.10), "[0.10,0.20)")
        self.assertEqual(error_bucket(0.20), "[0.20,infinity)")

    def test_bucket_rates_exclude_unknown_outcomes(self):
        frames = [
            {"error": 0.02, "outcome": "abstain"},
            {"error": 0.03, "outcome": "correct"},
            {"error": 0.04, "outcome": "unknown"},
            {"error": None, "outcome": "wrong"},
        ]
        buckets, unmatched = summarize_buckets(frames, "error")
        self.assertEqual(buckets[0]["frames"], 3)
        self.assertEqual(buckets[0]["knownOutcomes"], 2)
        self.assertEqual(buckets[0]["abstentionRate"], 0.5)
        self.assertEqual(unmatched["outcomes"]["wrong"], 1)


if __name__ == "__main__":
    unittest.main()
