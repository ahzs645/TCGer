import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from corpus_release import corpus_hash, sha256_bytes
from slice_geometry_release import slice_release


class SliceGeometryReleaseTests(unittest.TestCase):
    def test_keeps_only_requested_split_and_rehashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            (source / "records").mkdir(parents=True)
            (source / "images").mkdir()
            entries = []
            for split in ("train", "validation"):
                image = source / f"images/{split}.jpg"
                Image.new("RGB", (8, 8), (1, 2, 3)).save(image)
                record = source / f"records/{split}.json"
                record.write_text("{}")
                entries.append(
                    {
                        "recordId": split,
                        "path": f"records/{split}.json",
                        "sha256": sha256_bytes(b"{}"),
                        "split": split,
                        "sceneSlice": "duel_field",
                        "sourceTier": "shippable",
                        "leakageKeys": {"sourceKind": "synthetic"},
                        "images": [
                            {
                                "path": f"images/{split}.jpg",
                                "sha256": "a" * 64,
                            }
                        ],
                    }
                )
            manifest = {
                "splitAssignment": {"method": "fixture", "seed": 7},
                "evaluationSessionDenylist": [],
                "records": entries,
            }
            (source / "manifest.json").write_text(json.dumps(manifest))
            output = root / "sliced"
            result = slice_release(
                source=source,
                output=output,
                split="validation",
                release_id="eval-v1",
            )
            self.assertEqual([entry["split"] for entry in result["records"]], ["validation"])
            self.assertEqual(result["corpusHash"], corpus_hash(result))
            self.assertTrue((output / "images/validation.jpg").is_file())
            self.assertFalse((output / "images/train.jpg").exists())


if __name__ == "__main__":
    unittest.main()
