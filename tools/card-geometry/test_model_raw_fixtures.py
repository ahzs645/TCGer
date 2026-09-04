import hashlib
import json
import sys
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from decode_geometry_exports import decode_yolo_pose  # noqa: E402


class ModelRawFixturesTests(unittest.TestCase):
    def test_raw_tensors_hash_and_decode_to_expected_results(self):
        fixture_root = ROOT / "fixtures/model-raw"
        manifests = sorted(fixture_root.glob("*/manifest.json"))
        self.assertGreaterEqual(len(manifests), 2)
        for manifest_path in manifests:
            manifest = json.loads(manifest_path.read_text())
            self.assertEqual(
                manifest["schema"],
                "https://tcger.app/fixtures/card-geometry-raw-tensors/v1",
            )
            with np.load(manifest_path.parent / "raw-tensors.npz") as tensors:
                for fixture in manifest["fixtures"]:
                    value = tensors[fixture["rawTensorKey"]]
                    self.assertEqual(list(value.shape), fixture["shape"])
                    self.assertEqual(value.dtype, np.float32)
                    self.assertEqual(
                        hashlib.sha256(value.tobytes()).hexdigest(),
                        fixture["rawTensorSha256"],
                    )
                    if manifest["candidate"].startswith("yolo11"):
                        actual = decode_yolo_pose(
                            value,
                            model_id={
                                "releaseVersion": 1,
                                "artifactSha256": manifest["modelArtifact"]["sha256"],
                            },
                        )
                        self.assertEqual(actual, fixture["expectedResults"])


if __name__ == "__main__":
    unittest.main()
