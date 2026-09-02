from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PARENT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(PARENT))

from compositor.compositor import (  # noqa: E402
    ASSET_MANIFEST_SCHEMA,
    CompositorError,
    build_release,
    load_assets,
)
from corpus_release import load_json, pretty_json, sha256_file  # noqa: E402
from preflight import Expectations, run_preflight  # noqa: E402


GIT_SHA = "1" * 40


def write_card(path: Path, color: tuple[int, int, int], title_color=(245, 245, 245)):
    image = Image.new("RGB", (90, 126), color)
    draw = ImageDraw.Draw(image)
    draw.rectangle((4, 4, 85, 121), outline=(240, 230, 190), width=3)
    draw.rectangle((9, 9, 80, 24), fill=title_color)
    draw.rectangle((12, 32, 77, 82), fill=tuple(min(255, value + 35) for value in color))
    image.save(path, format="PNG")


def write_background(path: Path, color: tuple[int, int, int]):
    image = Image.new("RGB", (64, 64), color)
    draw = ImageDraw.Draw(image)
    for offset in range(0, 64, 8):
        draw.line((0, offset, 63, offset + 4), fill=tuple(min(255, value + 15) for value in color), width=2)
    image.save(path, format="PNG")


class CompositorTests(unittest.TestCase):
    def _inputs(self, root: Path):
        assets = root / "assets"
        assets.mkdir()
        files = {
            "train-front-a": ("train-front-a.png", "train", "faceUp", (130, 40, 40)),
            "train-front-b": ("train-front-b.png", "train", "faceUp", (40, 130, 40)),
            "train-back": ("train-back.png", "train", "faceDown", (30, 45, 130)),
            "validation-front": ("validation-front.png", "validation", "faceUp", (130, 90, 30)),
        }
        card_rows = []
        for asset_id, (filename, split, side, color) in files.items():
            path = assets / filename
            write_card(path, color)
            card_rows.append(
                {
                    "assetId": asset_id,
                    "path": f"assets/{filename}",
                    "sha256": sha256_file(path),
                    "split": split,
                    "licenseId": "test-only",
                    "game": "fixture",
                    "side": side,
                }
            )
        background_rows = []
        for asset_id, filename, split, color in (
            ("background-train", "background-train.png", "train", (90, 70, 45)),
            ("background-validation", "background-validation.png", "validation", (45, 70, 95)),
        ):
            path = assets / filename
            write_background(path, color)
            background_rows.append(
                {
                    "assetId": asset_id,
                    "path": f"assets/{filename}",
                    "sha256": sha256_file(path),
                    "split": split,
                    "licenseId": "CC0-1.0",
                }
            )
        card_manifest = root / "card-assets.json"
        background_manifest = root / "background-assets.json"
        card_manifest.write_text(
            pretty_json({"schema": ASSET_MANIFEST_SCHEMA, "role": "card", "assets": card_rows})
        )
        background_manifest.write_text(
            pretty_json({"schema": ASSET_MANIFEST_SCHEMA, "role": "background", "assets": background_rows})
        )
        config = {
            "schema": "https://tcger.app/config/card-geometry-compositor/v1",
            "canvas": {
                "width": 240,
                "height": 320,
                "contextMarginPixels": {"left": 80, "top": 80, "right": 80, "bottom": 80},
                "jpegQuality": 90,
            },
            "generation": {
                "seedBase": 17,
                "recordsPerSplitScene": {
                    "train": {"single_handheld": 1, "binder_page": 0, "duel_field": 1, "steep_playmat": 1},
                    "validation": {"single_handheld": 1, "binder_page": 1, "duel_field": 0, "steep_playmat": 0},
                },
            },
            "photometrics": {
                "brightness": {"minimum": 0.85, "mode": 0.95, "maximum": 1.05},
                "contrast": {"minimum": 0.71, "mode": 0.97, "maximum": 1.28},
                "saturation": {"minimum": 0.56, "mode": 0.90, "maximum": 1.24},
                "sharpness": {"minimum": 0.06, "mode": 0.64, "maximum": 1.67},
                "noiseSigma": {"minimum": 0.0, "mode": 1.5, "maximum": 7.6},
                "colorGainMaximum": 1.25,
                "gamma": {"minimum": 0.8, "maximum": 1.2},
                "intermediateJpegQuality": {"minimum": 72, "maximum": 96},
            },
            "scenes": {
                "single_handheld": {"instances": 1, "longSidePixels": [180, 220], "tiltDegrees": [0, 25], "outsideFrameProbability": 1.0, "handOccluderProbability": 1.0},
                "binder_page": {"instances": 9, "longSidePixels": [82, 92], "tiltDegrees": [0, 10]},
                "duel_field": {"instances": [3, 3], "longSidePixels": [110, 150], "tiltDegrees": [0, 20], "faceDownProbabilityTrain": 1.0, "faceDownProbabilityValidation": 0.0},
                "steep_playmat": {"instances": 1, "longSidePixels": [180, 220], "tiltDegrees": [45, 60], "outsideFrameProbability": 0.0},
            },
        }
        config_path = root / "config.json"
        config_path.write_text(pretty_json(config))
        return config_path, card_manifest, background_manifest

    def test_five_records_regenerate_byte_identically_and_pass_preflight(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config, cards, backgrounds = self._inputs(root)
            first = root / "release-a"
            second = root / "release-b"
            summaries = []
            for output in (first, second):
                summaries.append(
                    build_release(
                        output=output,
                        release_id="synthetic-fixture-smoke-v1",
                        config_path=config,
                        card_manifest_path=cards,
                        background_manifest_path=backgrounds,
                        compositor_git_sha=GIT_SHA,
                    )
                )
            first_files = sorted(path.relative_to(first) for path in first.rglob("*") if path.is_file())
            second_files = sorted(path.relative_to(second) for path in second.rglob("*") if path.is_file())
            self.assertEqual(first_files, second_files)
            for relative in first_files:
                self.assertEqual((first / relative).read_bytes(), (second / relative).read_bytes(), relative)
            self.assertEqual(summaries[0]["counts"]["records"], 5)
            manifest = load_json(first / "manifest.json")
            self.assertEqual({entry["split"] for entry in manifest["records"]}, {"train", "validation"})
            self.assertNotIn("test", {entry["split"] for entry in manifest["records"]})
            records = [load_json(first / entry["path"]) for entry in manifest["records"]]
            self.assertTrue(all(record["synthetic"]["backgroundAssetId"] for record in records))
            manifest_entries = {entry["recordId"]: entry for entry in manifest["records"]}
            for record in records:
                self.assertIn(
                    record["synthetic"]["backgroundAssetId"],
                    manifest_entries[record["recordId"]]["leakageKeys"]["sourceAssetIds"],
                )
            self.assertTrue(
                all(
                    corner["coordinateKnown"]
                    and corner["cornerSource"] == "synthetic"
                    for record in records
                    for instance in record["instances"]
                    for corner in instance["corners"]
                )
            )
            self.assertTrue(
                all(instance["orientationKnown"] for record in records for instance in record["instances"])
            )
            visibilities = {
                corner["visibility"]
                for record in records
                for instance in record["instances"]
                for corner in instance["corners"]
            }
            self.assertIn("outsideFrame", visibilities)
            self.assertIn("occluded", visibilities)
            report = run_preflight(
                first,
                expectations=Expectations(corpus_hash=manifest["corpusHash"], purpose="smoke"),
                tooling_revision="fixture",
            )
            self.assertEqual(report["failedChecks"], [])
            self.assertEqual(report["readyFor"], "tooling")

    def test_asset_bytes_may_not_cross_splits_under_different_ids(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / "same.png"
            write_background(image, (20, 30, 40))
            document = {
                "schema": ASSET_MANIFEST_SCHEMA,
                "role": "background",
                "assets": [
                    {"assetId": "a", "path": "same.png", "sha256": sha256_file(image), "split": "train", "licenseId": "CC0"},
                    {"assetId": "b", "path": "same.png", "sha256": sha256_file(image), "split": "validation", "licenseId": "CC0"},
                ],
            }
            manifest = root / "assets.json"
            manifest.write_text(json.dumps(document))
            with self.assertRaisesRegex(CompositorError, "identical asset bytes"):
                load_assets(manifest, "background")


if __name__ == "__main__":
    unittest.main()
