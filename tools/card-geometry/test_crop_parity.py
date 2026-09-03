from __future__ import annotations

import hashlib
import json
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
    comparable_pixel_metrics,
    inset_quad,
    normalize_query_colors,
    normalized_quad_to_pixels,
    pixel_metrics,
    procedural_fixture_image,
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

    def test_pixel_metrics_skip_size_mismatch(self):
        reference = np.zeros((2, 2, 3), dtype=np.uint8)
        actual = np.zeros((2, 1, 3), dtype=np.uint8)
        self.assertIsNone(comparable_pixel_metrics(actual, reference))

    def test_magic_query_normalization_matches_grey_world_autocontrast_contract(self):
        from PIL import Image

        image = Image.new("RGB", (10, 10), (150, 128, 100))
        image.putpixel((0, 0), (60, 51, 40))
        image.putpixel((9, 9), (240, 205, 160))
        result = normalize_query_colors(image, "grey-world-autocontrast")
        red, green, blue = result.getpixel((5, 5))
        self.assertLessEqual(abs(red - green), 2)
        self.assertLessEqual(abs(green - blue), 2)
        self.assertEqual(result.size, image.size)
        self.assertIs(normalize_query_colors(image, "none"), image)

    def test_frozen_contract_fixtures_reproduce_reference_hashes(self):
        manifest_path = (
            HERE / "fixtures" / "crop-parity.v1" / "manifest.json"
        )
        manifest = json.loads(manifest_path.read_text())
        contract = manifest["contract"]
        self.assertEqual(manifest["hashRepresentation"], "raw-rgb8-row-major")
        self.assertEqual(contract["sourceMapping"], "imageEdge")
        self.assertEqual(
            contract["destinationPixelCenters"],
            [[0, 0], [719, 0], [719, 999], [0, 999]],
        )
        self.assertEqual(contract["insetFraction"], 0)
        self.assertEqual(contract["kernel"], "bilinear")
        self.assertEqual(contract["border"], "black")
        self.assertEqual(contract["color"], "srgb8-rgb")
        for fixture in manifest["fixtures"]:
            source = procedural_fixture_image(
                fixture["sourceWidth"], fixture["sourceHeight"], fixture["seed"]
            )
            self.assertEqual(
                hashlib.sha256(source.tobytes()).hexdigest(), fixture["sourceSha256"]
            )
            crop = warp_reference(
                source,
                fixture["quad"],
                mapping=contract["sourceMapping"],
                kernel=contract["kernel"],
                inset=contract["insetFraction"],
                border=contract["border"],
            )
            self.assertEqual(
                hashlib.sha256(crop.tobytes()).hexdigest(), fixture["referenceCropSha256"]
            )


if __name__ == "__main__":
    unittest.main()
