import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools/card-geometry/benchmark_geometry_exports.py"
SPEC = importlib.util.spec_from_file_location("benchmark_geometry_exports", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class BenchmarkGeometryExportsTests(unittest.TestCase):
    def test_procedural_fixtures_are_repeatable(self):
        first = MODULE.fixture_pixels(MODULE.FIXTURE_SPECS[-1], 16)
        second = MODULE.fixture_pixels(MODULE.FIXTURE_SPECS[-1], 16)
        self.assertEqual(first.tobytes(), second.tobytes())
        self.assertEqual(first.shape, (16, 16, 3))

    def test_output_metrics_detect_exact_and_shifted_values(self):
        import numpy as np

        value = np.arange(12, dtype=np.float32).reshape(1, 3, 4)
        exact = MODULE.output_metrics(value, value)
        self.assertEqual(exact["maxAbs"], 0.0)
        self.assertAlmostEqual(exact["cosine"], 1.0)
        shifted = MODULE.output_metrics(value, value + 2)
        self.assertEqual(shifted["meanAbs"], 2.0)
        self.assertEqual(shifted["p99Abs"], 2.0)

    def test_artifact_identity_uses_paths_and_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "a").write_bytes(b"same")
            first = MODULE.artifact_identity(root)
            (root / "b").write_bytes(b"same")
            second = MODULE.artifact_identity(root)
            self.assertNotEqual(first["sha256"], second["sha256"])
            self.assertEqual(second["files"], 2)
            self.assertEqual(second["bytes"], 8)

    def test_latency_percentiles_use_linear_interpolation(self):
        summary = MODULE.latency_summary([1.0, 2.0, 3.0, 4.0])
        self.assertEqual(summary["count"], 4)
        self.assertEqual(summary["p50Ms"], 2.5)
        self.assertAlmostEqual(summary["p90Ms"], 3.7)


if __name__ == "__main__":
    unittest.main()
