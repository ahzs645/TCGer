import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "tools/card-geometry/compositor/build_catalog_card_asset_manifest.py"
SPEC = importlib.util.spec_from_file_location("build_catalog_card_asset_manifest", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class BuildCatalogCardAssetManifestTests(unittest.TestCase):
    def test_builds_split_assigned_content_addressed_pack(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rows = []
            wanted = {"train": 3, "validation": 2}
            found = {"train": 0, "validation": 0}
            index = 0
            while any(found[split] < count for split, count in wanted.items()):
                identity = f"card-{index:03d}"
                split = MODULE.stable_split("yugioh", identity)
                if found[split] < wanted[split]:
                    image = root / f"{identity}.png"
                    Image.new("RGB", (59, 86), (index % 255, 40, 80)).save(image)
                    rows.append(
                        {
                            "game": "yugioh",
                            "cardId": identity,
                            "name": identity,
                            "imageURL": image.as_uri(),
                        }
                    )
                    found[split] += 1
                index += 1
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps(rows), encoding="utf-8")
            card_back = root / "back.png"
            Image.new("RGB", (59, 86), (10, 20, 30)).save(card_back)
            output = root / "output"
            document = MODULE.build_manifest(
                catalog=catalog,
                catalog_revision="a" * 40,
                game="yugioh",
                train_count=3,
                validation_count=2,
                output=output,
                card_back=card_back,
            )
            self.assertEqual(len(document["assets"]), 6)
            face_up = [row for row in document["assets"] if row["side"] == "faceUp"]
            self.assertEqual(
                {split: sum(row["split"] == split for row in face_up) for split in wanted},
                wanted,
            )
            self.assertTrue(all((output / row["path"]).is_file() for row in document["assets"]))
            self.assertTrue(
                all(
                    row["provenance"]["sourceCatalogRevision"] == "a" * 40
                    for row in face_up
                )
            )


if __name__ == "__main__":
    unittest.main()
