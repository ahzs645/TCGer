import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from build_geometry_bakeoff_report import build  # noqa: E402


class BuildGeometryBakeoffReportTests(unittest.TestCase):
    def write_candidate(self, root: Path, candidate: str, recall: float) -> dict:
        root.mkdir()
        common = {
            "corpusHash": "a" * 64,
            "detection": {
                "overall": {
                    "recall@0.5": recall,
                    "recall@0.75": recall,
                    "recall@0.9": recall,
                    "meanMatchedIoU": recall,
                    "duplicate": 0,
                    "extra": 0,
                    "extraPerImage": 0,
                }
            },
            "cornerError": {
                "overall": {"normalized": {"count": 4, "mean": 0, "p50": 0, "p90": 0, "p95": 0}},
                "byTruthVisibility": {"outsideFrame": {"normalized": {"p50": 0}}},
            },
            "orientation": {"accuracy": 1, "eligiblePairs": 1},
        }
        files = {
            "run-train.json": {
                "candidate": candidate,
                "framework": "test",
                "licenseRoute": "permissive",
                "experimentHash": "b" * 64,
                "fairnessHash": "c" * 64,
                "elapsedSeconds": 3600,
            },
            "resolved-config.json": {
                "bakeoffId": "test",
                "corpus": {
                    "datasetRepo": "owner/data",
                    "datasetRevision": "a" * 40,
                    "releasePath": "release",
                    "corpusHash": "d" * 64,
                    "policyId": "policy",
                    "policySha256": "e" * 64,
                    "preflightReport": {"path": "ignored", "sha256": "f" * 64},
                },
                "fairness": {"inputResolution": 640},
                "evaluations": {"real": "frozen"},
                "measurements": ["geometry"],
                "deviations": [],
            },
            "real-v3.benchmark.json": common,
            "synthetic-duel-field.benchmark.json": common,
            "recognition-replay.json": {
                "counts": {"frames": 1, "correct": 1, "wrong": 0, "abstain": 0, "unknown": 0}
            },
        }
        for name, value in files.items():
            (root / name).write_text(json.dumps(value))
        export = root / "export.json"
        export.write_text(
            json.dumps(
                {
                    "artifacts": {"onnx": {"bytes": 1}, "coreml": {"bytes": 2}},
                    "parity": [{"cosine": 1, "maxAbs": 0}],
                    "latency": {},
                    "physicalDeviceLatency": {
                        "ios": {"status": "measured"},
                        "android": {"status": "measured"},
                    },
                }
            )
        )
        decoder = root / "decoder.py"
        decoder.write_text("one\ntwo\n")
        return {
            "reportsRoot": str(root),
            "exportBenchmark": str(export),
            "productionDecodersComplete": True,
            "referenceDecoderSources": [str(decoder)],
            "productionDecoderSources": [str(decoder)],
        }

    def test_recommends_promoting_a_complete_passing_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            candidate = self.write_candidate(Path(temporary) / "winner", "winner", 1)
            report = build(
                {
                    "bakeoffId": "test",
                    "trainingCorpusHash": "d" * 64,
                    "candidates": [candidate],
                }
            )
            self.assertEqual(report["outcome"]["productionReadyCandidates"], ["winner"])
            self.assertTrue(report["candidates"][0]["productionReady"])
            self.assertEqual(report["candidates"][0]["decoder"]["production"]["lines"], 2)

    def test_recommends_shipping_none_when_real_recall_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            candidate = self.write_candidate(Path(temporary) / "loser", "loser", 0.5)
            report = build(
                {
                    "bakeoffId": "test",
                    "trainingCorpusHash": "d" * 64,
                    "candidates": [candidate],
                }
            )
            self.assertEqual(
                report["outcome"]["recommendation"],
                "ship-none-retain-current-detector-and-safety-net",
            )
            self.assertFalse(report["candidates"][0]["checks"]["realRecallAt05"])

    def test_evaluation_only_candidate_cannot_be_production_ready(self):
        with tempfile.TemporaryDirectory() as temporary:
            candidate = self.write_candidate(Path(temporary) / "candidate", "candidate", 1)
            run_path = Path(candidate["reportsRoot"]) / "run-train.json"
            run = json.loads(run_path.read_text())
            run["licenseRoute"] = "evaluation-only"
            run_path.write_text(json.dumps(run))
            report = build(
                {
                    "bakeoffId": "test",
                    "trainingCorpusHash": "d" * 64,
                    "candidates": [candidate],
                }
            )
            self.assertTrue(report["candidates"][0]["passesMeasuredMetricBudgets"])
            self.assertFalse(report["candidates"][0]["checks"]["shippingLicense"])
            self.assertFalse(report["candidates"][0]["productionReady"])

    def test_rejects_mixed_frozen_evaluation_corpora(self):
        with tempfile.TemporaryDirectory() as temporary:
            first = self.write_candidate(Path(temporary) / "one", "one", 1)
            second = self.write_candidate(Path(temporary) / "two", "two", 1)
            path = Path(second["reportsRoot"]) / "real-v3.benchmark.json"
            report = json.loads(path.read_text())
            report["corpusHash"] = "e" * 64
            path.write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, "same frozen evaluation"):
                build(
                    {
                        "bakeoffId": "test",
                        "trainingCorpusHash": "d" * 64,
                        "candidates": [first, second],
                    }
                )

    def test_missing_corner_percentiles_fail_without_crashing(self):
        with tempfile.TemporaryDirectory() as temporary:
            candidate = self.write_candidate(Path(temporary) / "candidate", "candidate", 0)
            path = Path(candidate["reportsRoot"]) / "real-v3.benchmark.json"
            real = json.loads(path.read_text())
            real["cornerError"]["overall"]["normalized"].update(
                {"count": 0, "mean": None, "p50": None, "p90": None, "p95": None}
            )
            real["cornerError"]["byTruthVisibility"] = {}
            path.write_text(json.dumps(real))
            report = build(
                {
                    "bakeoffId": "test",
                    "trainingCorpusHash": "d" * 64,
                    "candidates": [candidate],
                }
            )
            checks = report["candidates"][0]["checks"]
            self.assertFalse(checks["normalizedCornerP50"])
            self.assertFalse(checks["normalizedCornerP90"])
            self.assertFalse(checks["normalizedCornerP95"])
            self.assertFalse(checks["outsideFrameNormalizedP50"])


if __name__ == "__main__":
    unittest.main()
