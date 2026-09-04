import sys
import unittest
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from decode_geometry_exports import (  # noqa: E402
    DEFAULT_DECODER_CONFIG,
    decode_fastvit_four_corner,
    decode_yolox_pose,
    fastvit_candidates,
    decode_yolo_pose,
    model_point_to_source,
    yolo_pose_candidates,
)


def output_with_duplicate_quads():
    raw = np.zeros((1, 17, 2), dtype=np.float32)
    points = [64, 64, 1, 320, 64, 1, 320, 448, 1, 64, 448, 1]
    for index, score in enumerate((0.9, 0.8)):
        raw[0, 4, index] = score
        raw[0, 5:, index] = points
    return raw


class DecodeGeometryExportsTests(unittest.TestCase):
    def test_fastvit_decodes_peak_and_ordered_corners(self):
        heatmap = np.full((1, 1, 2, 2), -20, dtype=np.float32)
        heatmap[0, 0, 0, 1] = 4
        corner_values = np.asarray([0.1, 0.2, 0.8, 0.2, 0.8, 0.9, 0.1, 0.9])
        logits = np.log(corner_values / (1 - corner_values)).astype(np.float32)
        corners = np.zeros((1, 8, 2, 2), dtype=np.float32)
        corners[0, :, 0, 1] = logits
        rows = fastvit_candidates(heatmap, corners, resolution=640)
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0]["corners"][0]["point"]["x"], 0.1, places=6)
        self.assertAlmostEqual(rows[0]["corners"][2]["point"]["y"], 0.9, places=6)
        self.assertEqual(len(decode_fastvit_four_corner(heatmap, corners)), 1)

    def test_yolo_pose_decodes_ordered_normalized_corners(self):
        rows = yolo_pose_candidates(output_with_duplicate_quads(), resolution=640)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["corners"][0]["point"], {"x": 0.1, "y": 0.1})
        self.assertEqual(rows[0]["corners"][2]["point"], {"x": 0.5, "y": 0.7})

    def test_quad_nms_keeps_higher_confidence_duplicate(self):
        rows = decode_yolo_pose(output_with_duplicate_quads())
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0]["confidence"], 0.9)

    def test_inverse_letterbox_and_context_margin(self):
        transform = {
            "sourceWidth": 100,
            "sourceHeight": 200,
            "contextMarginPixels": {"left": 10, "top": 20, "right": 10, "bottom": 20},
            "scale": 2,
            "padLeft": 5,
            "padTop": 7,
        }
        self.assertEqual(model_point_to_source(25, 47, transform), {"x": 0.0, "y": 0.0})
        self.assertEqual(model_point_to_source(225, 447, transform), {"x": 1.0, "y": 1.0})

    def test_invalid_channel_count_fails(self):
        with self.assertRaisesRegex(ValueError, "17 channels"):
            yolo_pose_candidates(np.zeros((1, 16, 10)), resolution=640)

    def test_decodes_flattened_yolox_pose_outputs(self):
        resolution = 32
        shapes = [resolution // stride for stride in (8, 16, 32)]
        classes = [
            np.full((1, 1, size, size), -20, dtype=np.float32) for size in shapes
        ]
        boxes = [np.zeros((1, 4, size, size), dtype=np.float32) for size in shapes]
        objects = [
            np.full((1, 1, size, size), -20, dtype=np.float32) for size in shapes
        ]
        keypoints = [np.zeros((1, 8, size, size), dtype=np.float32) for size in shapes]
        visibility = [
            np.zeros((1, 4, size, size), dtype=np.float32) for size in shapes
        ]
        classes[0][0, 0, 1, 2] = 20
        objects[0][0, 0, 1, 2] = 20
        keypoints[0][0, :, 1, 2] = np.array([0, 0, 1, 0, 1, 1, 0, 1])
        decoded = decode_yolox_pose(
            *(classes + boxes + objects + keypoints + visibility),
            resolution=resolution,
            decoder_config={
                **DEFAULT_DECODER_CONFIG,
                "minimumConfidence": 0.5,
                "minimumQuadArea": 0.001,
            },
        )
        self.assertEqual(len(decoded), 1)
        self.assertEqual(
            decoded[0]["corners"][0]["point"],
            {"x": 0.5, "y": 0.25},
        )
        self.assertEqual(
            decoded[0]["corners"][2]["point"],
            {"x": 0.75, "y": 0.5},
        )


if __name__ == "__main__":
    unittest.main()
