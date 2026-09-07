import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import replay_label_crop_recognition as replay_module  # noqa: E402
from replay_label_crop_recognition import replay, trusted_label_quad  # noqa: E402


def _corner(x, y, source="human", known=True):
    corner = {"visibility": "visible", "coordinateKnown": known}
    if known:
        corner["point"] = {"x": x, "y": y}
        corner["cornerSource"] = source
    return corner


class FakeRuntime:
    """Deterministic stand-in for the ONNX encoder: family depends on crop brightness."""

    def __init__(self, threshold):
        self.threshold = threshold
        self.families = ["expected-family", "rival-family"]
        self.vectors = np.eye(2, dtype=np.float32)
        self.embedded = []

    def embed(self, image):
        self.embedded.append(image.size)
        bright = np.asarray(image).mean() > 128
        return np.asarray([0.95, 0.05] if bright else [0.30, 0.20], dtype=np.float32)


class LabelCropReplayTests(unittest.TestCase):
    def test_trusted_quad_requires_one_instance_with_four_human_corners(self):
        record = {"instances": [{"corners": [_corner(0, 0), _corner(1, 0), _corner(1, 1), _corner(0, 1)]}]}
        self.assertEqual(trusted_label_quad(record), [[0, 0], [1, 0], [1, 1], [0, 1]])
        detector = {"instances": [{"corners": [_corner(0, 0, "detector"), _corner(1, 0), _corner(1, 1), _corner(0, 1)]}]}
        self.assertIsNone(trusted_label_quad(detector))
        partial = {"instances": [{"corners": [_corner(0, 0), _corner(1, 0), _corner(1, 1), _corner(0, 1, known=False)]}]}
        self.assertIsNone(trusted_label_quad(partial))
        two = {"instances": [record["instances"][0], record["instances"][0]]}
        self.assertIsNone(trusted_label_quad(two))

    def test_replay_uses_label_quads_and_never_invents_truth(self):
        with tempfile.TemporaryDirectory() as temporary:
            release = Path(temporary) / "release"
            (release / "records").mkdir(parents=True)
            (release / "images").mkdir()
            frames = {
                "bright": ((250, 250, 250), "identify", "card-1", None),
                "dark": ((10, 10, 10), "identify", "card-1", None),
                "mystery": ((250, 250, 250), "unknown", None, None),
                "detector": ((250, 250, 250), "identify", "card-1", None),
            }
            entries = []
            cases = []
            for name, (rgb, expectation, expected, forbidden) in frames.items():
                record_id = f"devmode-session-{name}"
                Image.new("RGB", (40, 60), rgb).save(release / "images" / f"{record_id}.png")
                source = "detector" if name == "detector" else "human"
                record = {
                    "recordId": record_id,
                    "source": {"kind": "real", "path": f"images/{record_id}.png", "width": 40, "height": 60},
                    "instances": [{
                        "corners": [_corner(0.1, 0.1, source), _corner(0.9, 0.1, source),
                                    _corner(0.9, 0.9, source), _corner(0.1, 0.9, source)],
                    }],
                }
                (release / "records" / f"{record_id}.json").write_text(json.dumps(record))
                entries.append({"recordId": record_id, "path": f"records/{record_id}.json"})
                cases.append({"recordId": record_id, "game": "pokemon", "expectation": expectation,
                              "expectedCardId": expected, "forbiddenCardId": forbidden})
            (release / "manifest.json").write_text(json.dumps({
                "releaseId": "fixture", "corpusHash": "0" * 64, "records": entries}))
            (release / "recognition-replay.json").write_text(json.dumps({"records": cases}))
            runtime = FakeRuntime(0.65)
            fake_loader = lambda root: (  # noqa: E731
                {"pokemon": runtime, "magic": runtime, "yugioh": runtime},
                {"pokemon": {"card-1": {"expected-family"}}, "magic": {}, "yugioh": {}},
                {"pokemon": {"onnxSha256": "fixture"}},
            )
            with patch.object(replay_module, "load_runtimes", fake_loader):
                report = replay(release=release, models_root=Path(temporary) / "models")
            outcomes = {row["recordId"].split("-")[-1]: row["outcome"] for row in report["frames"]}
            self.assertEqual(outcomes, {
                "bright": "correct",
                "dark": "abstain",
                "mystery": "unknown",
                "detector": "noTrustedLabel",
            })
            self.assertEqual(report["counts"]["correct"], 1)
            self.assertEqual(report["counts"]["noTrustedLabel"], 1)
            self.assertTrue(report["diagnosticOnly"])
            # Two orientations per trusted frame, all at the 720x1000 crop contract.
            self.assertEqual(len(runtime.embedded), 6)
            self.assertEqual(set(runtime.embedded), {(720, 1000)})
            self.assertEqual(report["cropContract"]["destination"], [720, 1000])


if __name__ == "__main__":
    unittest.main()
