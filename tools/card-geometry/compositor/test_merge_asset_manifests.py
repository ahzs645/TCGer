import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "tools/card-geometry/compositor/merge_asset_manifests.py"
SPEC = importlib.util.spec_from_file_location("merge_asset_manifests", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class MergeAssetManifestTests(unittest.TestCase):
    def manifest(self, root: Path, name: str, split: str, data: bytes) -> Path:
        source = root / name
        source.mkdir()
        asset = source / f"{name}.bin"
        asset.write_bytes(data)
        digest = MODULE.sha256_file(asset)
        manifest = source / "assets.json"
        manifest.write_text(
            json.dumps(
                {
                    "schema": MODULE.ASSET_MANIFEST_SCHEMA,
                    "role": "card",
                    "assets": [
                        {
                            "assetId": name,
                            "path": asset.name,
                            "sha256": digest,
                            "split": split,
                            "licenseId": "test",
                            "game": name,
                            "side": "faceUp",
                            "provenance": {},
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        return manifest

    def test_merges_unique_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = self.manifest(root, "pokemon", "train", b"pokemon")
            second = self.manifest(root, "magic", "validation", b"magic")
            document = MODULE.merge_manifests([first, second], root / "merged")
            self.assertEqual(len(document["assets"]), 2)
            self.assertEqual({row["game"] for row in document["assets"]}, {"pokemon", "magic"})

    def test_rejects_identical_bytes_across_splits(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = self.manifest(root, "pokemon", "train", b"same")
            second = self.manifest(root, "magic", "validation", b"same")
            with self.assertRaisesRegex(MODULE.CompositorError, "cross splits"):
                MODULE.merge_manifests([first, second], root / "merged")


if __name__ == "__main__":
    unittest.main()
