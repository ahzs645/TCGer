import copy
import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/card-geometry"))
MODULE_PATH = ROOT / "tools/card-geometry/launch_geometry_exports.py"
SPEC = importlib.util.spec_from_file_location("launch_geometry_exports", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)

from launch_geometry_bakeoff import base_config  # noqa: E402
from run_card_geometry_hf_job import descriptor, resolve_config  # noqa: E402
from test_launch_geometry_bakeoff import CORPUS  # noqa: E402


class LaunchGeometryExportsTests(unittest.TestCase):
    def setUp(self):
        self.raw = base_config(
            candidate="yolo11n-pose",
            corpus=CORPUS,
            tooling_revision="a" * 40,
            epochs=50,
        )
        identity = descriptor(resolve_config(self.raw))
        self.launch = {
            "experiments": {"yolo11n-pose": identity},
        }

    def test_training_identity_accepts_exact_config(self):
        actual = MODULE.validate_training_identity(
            self.launch, "yolo11n-pose", self.raw
        )
        self.assertEqual(
            actual["experimentHash"],
            self.launch["experiments"]["yolo11n-pose"]["experimentHash"],
        )

    def test_training_identity_rejects_regenerated_config(self):
        changed = copy.deepcopy(self.raw)
        changed["fairness"]["budget"]["value"] = 49
        with self.assertRaisesRegex(ValueError, "experimentHash"):
            MODULE.validate_training_identity(self.launch, "yolo11n-pose", changed)


if __name__ == "__main__":
    unittest.main()
