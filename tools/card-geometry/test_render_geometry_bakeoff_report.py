import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from render_geometry_bakeoff_report import EXPECTED_SCHEMA, render  # noqa: E402


def candidate() -> dict:
    return {
        "candidate": "candidate-a",
        "framework": "framework-a",
        "licenseRoute": "evaluation-only",
        "experimentHash": "e" * 64,
        "deviations": [],
        "training": {"jobId": "job-a", "l4GpuHours": 1.25},
        "real": {
            "recallAt05": 1.0,
            "recallAt075": 0.9,
            "normalizedCorner": {"p50": 0.01, "p90": 0.02, "p95": 0.03},
            "outsideFrameNormalizedP50": 0.04,
            "duplicates": 0,
            "extras": 1,
        },
        "synthetic": {"recallAt05": 1.0, "recallAt075": 0.9, "recallAt09": 0.8},
        "recognition": {"correct": 3, "wrong": 0, "abstain": 4},
        "export": {
            "onnxBytes": 12,
            "coremlBytes": 13,
            "minimumCosine": 0.999,
            "latency": {"onnxMacCpu": {"meanMs": 3.5}},
            "physicalDeviceLatency": {
                "ios": {"status": "unavailable"},
                "android": {"status": "unavailable"},
            },
        },
        "decoder": {
            "status": "reference-only",
            "reference": {"bytes": 10, "lines": 2},
            "production": {"bytes": 0, "lines": 0},
        },
        "checks": {
            "realRecallAt05": True,
            "shippingLicense": False,
            "physicalIosLatency": False,
        },
        "passesMeasuredMetricBudgets": True,
        "productionReady": False,
    }


class RenderGeometryBakeoffReportTests(unittest.TestCase):
    def report(self) -> dict:
        return {
            "schema": EXPECTED_SCHEMA,
            "bakeoffId": "bakeoff-a",
            "trainingCorpusHash": "a" * 64,
            "realEvaluationCorpusHash": "b" * 64,
            "syntheticEvaluationCorpusHash": "c" * 64,
            "effectiveFairnessHash": "d" * 64,
            "candidates": [candidate()],
            "outcome": {
                "recommendation": "ship-none-retain-current-detector-and-safety-net",
                "humanDecisionRemaining": ["Choose a license route if an Ultralytics model wins."],
            },
            "notes": ["Physical phones were unavailable."],
        }

    def test_renders_scores_and_failed_gates(self):
        output = render(self.report())
        self.assertIn("| candidate-a | evaluation-only | 1.000 | 0.900", output)
        self.assertIn("Failed gates: shippingLicense, physicalIosLatency.", output)
        self.assertIn("iOS unavailable; Android unavailable", output)
        self.assertIn("onnxMacCpu 3.50 ms", output)
        self.assertIn("Choose a license route", output)

    def test_rejects_wrong_schema(self):
        report = self.report()
        report["schema"] = "wrong"
        with self.assertRaisesRegex(ValueError, "not a card-geometry"):
            render(report)


if __name__ == "__main__":
    unittest.main()
