import hashlib
import json
import sys
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from decode_geometry_exports import (  # noqa: E402
    decode_fastvit_four_corner,
    decode_yolox_pose,
    decode_yolo_pose,
)


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
                    keys = fixture.get("rawTensorKeys", [fixture.get("rawTensorKey")])
                    shapes = fixture.get("shapes", [fixture.get("shape")])
                    hashes = fixture.get("rawTensorSha256")
                    if isinstance(hashes, str):
                        hashes = [hashes]
                    self.assertNotIn(None, keys)
                    self.assertEqual(len(keys), len(shapes))
                    self.assertEqual(len(keys), len(hashes))
                    values = []
                    for key, shape, expected_hash in zip(keys, shapes, hashes):
                        value = tensors[key]
                        values.append(value)
                        self.assertEqual(list(value.shape), shape)
                        self.assertEqual(value.dtype, np.float32)
                        self.assertEqual(
                            hashlib.sha256(value.tobytes()).hexdigest(),
                            expected_hash,
                        )
                    if manifest["candidate"].startswith("yolo11"):
                        actual = decode_yolo_pose(
                            values[0],
                            model_id={
                                "releaseVersion": 1,
                                "artifactSha256": manifest["modelArtifact"]["sha256"],
                            },
                        )
                        self.assertEqual(actual, fixture["expectedResults"])
                    elif manifest["candidate"] == "fastvit-t8-four-corner":
                        self.assertEqual(len(values), 2)
                        actual = decode_fastvit_four_corner(
                            values[0],
                            values[1],
                            model_id={
                                "releaseVersion": 1,
                                "artifactSha256": manifest["modelArtifact"]["sha256"],
                            },
                        )
                        self.assertEqual(actual, fixture["expectedResults"])
                    elif manifest["candidate"] == "yolox-pose":
                        self.assertEqual(len(values), 15)
                        actual = decode_yolox_pose(
                            *values,
                            model_id={
                                "releaseVersion": 1,
                                "artifactSha256": manifest["modelArtifact"]["sha256"],
                            },
                        )
                        self.assertEqual(actual, fixture["expectedResults"])


if __name__ == "__main__":
    unittest.main()
