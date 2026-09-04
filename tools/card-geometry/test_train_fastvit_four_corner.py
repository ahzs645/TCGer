import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools/card-geometry/train_fastvit_four_corner.py"
SPEC = importlib.util.spec_from_file_location("train_fastvit_four_corner", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class TrainFastvitFourCornerTests(unittest.TestCase):
    def test_letterbox_round_trip_point(self):
        margins = {"left": 20, "top": 40, "right": 20, "bottom": 40}
        geometry = MODULE.letterbox_geometry(100, 200, margins, 640)
        point = MODULE.input_point(
            {"x": -0.1, "y": 1.1}, 100, 200, margins, geometry, 640
        )
        self.assertGreaterEqual(point[0], 0)
        self.assertLessEqual(point[0], 1)
        self.assertGreaterEqual(point[1], 0)
        self.assertLessEqual(point[1], 1)

    def test_target_keeps_all_four_ordered_corners(self):
        corners = [
            {"point": {"x": x, "y": y}, "coordinateKnown": True, "visibility": "visible"}
            for x, y in ((0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9))
        ]
        target = MODULE.build_targets(
            [{"instanceId": "card", "corners": corners}],
            width=100,
            height=100,
            margins={"left": 20, "top": 20, "right": 20, "bottom": 20},
            resolution=640,
        )
        positions = target["mask"].nonzero()
        self.assertEqual(len(positions[0]), 1)
        y, x = positions[1][0], positions[2][0]
        values = target["corners"][:, y, x].reshape(4, 2)
        self.assertLess(values[0, 0], values[1, 0])
        self.assertLess(values[0, 1], values[3, 1])


if __name__ == "__main__":
    unittest.main()
