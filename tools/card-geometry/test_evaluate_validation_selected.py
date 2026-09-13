"""Exercise the post-training entry point, including its real module imports."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import evaluate_validation_selected as entry
from corpus_release import sha256_file
from recognition_orientation import POLICY


class SelectedEvaluationTests(unittest.TestCase):
    def test_selects_then_evaluates_only_the_bound_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            checkpoint = root / "selected.pt"
            checkpoint.write_bytes(b"checkpoint fixture")
            calls = []

            def select(release, output, resolution):
                calls.append("select")
                self.assertEqual((release, output, resolution), (root / "release", root, 640))
                destination = output / "validation-selection"
                destination.mkdir()
                (destination / "selection.json").write_text(json.dumps({
                    "testDataUsed": False,
                    "selected": {"checkpoint": "selected.pt", "checkpointSha256": sha256_file(checkpoint)},
                }))

            def evaluate(candidate, **kwargs):
                calls.append("evaluate")
                self.assertEqual(candidate, "yolo11s-pose")
                self.assertEqual(kwargs["checkpoint_path"], checkpoint)
                self.assertEqual(kwargs["checkpoint_sha256"], sha256_file(checkpoint))
                self.assertEqual(kwargs["orientation_policy"], POLICY)

            env = {"TCGER_GEOMETRY_OUTPUT_DIR": directory,
                   "TCGER_GEOMETRY_RELEASE_ROOT": str(root / "release"),
                   "TCGER_GEOMETRY_INPUT_RESOLUTION": "640"}
            with patch.dict(os.environ, env), patch.object(entry, "select", side_effect=select), \
                    patch.object(entry, "evaluate", side_effect=evaluate):
                entry.run()
                self.assertEqual(calls, ["select", "evaluate"])
                checkpoint.write_bytes(b"changed after selection")
                with self.assertRaisesRegex(ValueError, "checkpoint binding"):
                    entry.run()
                self.assertEqual(calls, ["select", "evaluate"])


if __name__ == "__main__":
    unittest.main()
