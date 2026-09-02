from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from crop_parity import (  # noqa: E402
    HEIGHT,
    WIDTH,
    inset_quad,
    normalized_quad_to_pixels,
    pixel_metrics,
    warp_reference,
)


class CropParityTests(unittest.TestCase):
    def test_normalized_mappings_are_explicit(self):
        quad = [[0, 0], [1, 0], [1, 1], [0, 1]]
        center = normalized_quad_to_pixels(quad, 10, 20, "pixelCenter")
        edge = normalized_quad_to_pixels(quad, 10, 20, "imageEdge")
        np.testing.assert_array_equal(center[2], [9, 19])
        np.testing.assert_array_equal(edge[2], [10, 20])

    def test_bilinear_inset_preserves_corner_order(self):
        quad = np.asarray([[0, 0], [100, 0], [100, 200], [0, 200]])
        np.testing.assert_allclose(
            inset_quad(quad, 0.01), [[1, 2], [99, 2], [99, 198], [1, 198]]
        )

    def test_full_frame_pixel_center_bilinear_warp_hits_destination_centers(self):
        y, x = np.mgrid[0:40, 0:30]
        image = np.stack([x * 8, y * 6, (x + y) * 3], axis=-1).astype(np.uint8)
        crop = warp_reference(
            image,
            [[0, 0], [1, 0], [1, 1], [0, 1]],
            mapping="pixelCenter",
            kernel="bilinear",
            inset=0,
            border="replicate",
        )
        self.assertEqual(crop.shape, (HEIGHT, WIDTH, 3))
        np.testing.assert_array_equal(crop[0, 0], image[0, 0])
        np.testing.assert_array_equal(crop[-1, -1], image[-1, -1])

    def test_pixel_metrics_use_unit_interval_mae(self):
        reference = np.zeros((2, 2, 3), dtype=np.uint8)
        actual = np.full((2, 2, 3), 51, dtype=np.uint8)
        metrics = pixel_metrics(actual, reference)
        self.assertAlmostEqual(metrics["mae"], 0.2)
        self.assertAlmostEqual(metrics["psnrDb"], 20 * math.log10(5))


if __name__ == "__main__":
    unittest.main()
