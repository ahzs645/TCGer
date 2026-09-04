import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools/card-geometry/train_yolo_pose.py"
SPEC = importlib.util.spec_from_file_location("train_yolo_pose", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class TrainYoloPoseTests(unittest.TestCase):
    def test_context_margin_maps_outside_corner_into_pose_range(self):
        point = MODULE.padded_point(
            {"x": -0.1, "y": 1.1},
            100,
            200,
            {"left": 20, "top": 40, "right": 20, "bottom": 40},
        )
        self.assertAlmostEqual(point[0], 10 / 140)
        self.assertAlmostEqual(point[1], 260 / 280)

    def test_yolo_line_keeps_order_and_visibility(self):
        instance = {
            "instanceId": "card-0",
            "corners": [
                {
                    "point": {"x": 0.1, "y": 0.1},
                    "coordinateKnown": True,
                    "visibility": "visible",
                },
                {
                    "point": {"x": 0.9, "y": 0.1},
                    "coordinateKnown": True,
                    "visibility": "occluded",
                },
                {
                    "point": {"x": 0.9, "y": 1.1},
                    "coordinateKnown": True,
                    "visibility": "outsideFrame",
                },
                {
                    "point": {"x": 0.1, "y": 1.1},
                    "coordinateKnown": True,
                    "visibility": "visible",
                },
            ],
        }
        line = MODULE.yolo_line(
            instance,
            100,
            100,
            {"left": 20, "top": 20, "right": 20, "bottom": 20},
        )
        values = line.split()
        self.assertEqual(len(values), 17)
        self.assertEqual(values[0], "0")
        self.assertEqual([values[index] for index in (7, 10, 13, 16)], ["2", "1", "1", "2"])

    def test_materialize_release_writes_split_images_and_labels(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release = root / "release"
            (release / "records").mkdir(parents=True)
            (release / "images").mkdir()
            Image.new("RGB", (10, 20), (20, 30, 40)).save(release / "images/frame.jpg")
            corners = [
                {
                    "point": {"x": x, "y": y},
                    "coordinateKnown": True,
                    "cornerSource": "synthetic",
                    "visibility": "visible",
                }
                for x, y in ((0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9))
            ]
            record = {
                "source": {"kind": "synthetic", "path": "images/frame.jpg", "width": 10, "height": 20},
                "synthetic": {"contextMarginPixels": {"left": 2, "top": 4, "right": 2, "bottom": 4}},
                "instances": [{"instanceId": "card-0", "corners": corners}],
            }
            (release / "records/train.json").write_text(json.dumps(record))
            validation = dict(record)
            (release / "records/validation.json").write_text(json.dumps(validation))
            manifest = {
                "corpusHash": "a" * 64,
                "records": [
                    {"recordId": "train", "split": "train", "path": "records/train.json"},
                    {"recordId": "validation", "split": "validation", "path": "records/validation.json"},
                ],
            }
            (release / "manifest.json").write_text(json.dumps(manifest))
            output = root / "yolo"
            summary = MODULE.materialize_yolo(release, output)
            self.assertEqual(summary["counts"]["records:train"], 1)
            self.assertEqual(summary["counts"]["instances:validation"], 1)
            with Image.open(output / "images/train/train.jpg") as image:
                self.assertEqual(image.size, (14, 28))
            self.assertEqual(
                len((output / "labels/train/train.txt").read_text().split()), 17
            )


if __name__ == "__main__":
    unittest.main()
