import tempfile
import unittest
from pathlib import Path

from prepare_round_two_card_assets import prepare
from corpus_release import corpus_hash, load_json, sha256_bytes, write_json


class PrepareCardAssetsTests(unittest.TestCase):
    def test_evaluation_asset_and_same_bytes_under_new_id_are_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            assets = []
            for i in range(13):
                data = b"evaluation" if i < 2 else str(i).encode()
                path = f"{i}.jpg"
                (source / path).write_bytes(data)
                assets.append(
                    {
                        "assetId": f"asset-{i}",
                        "sha256": sha256_bytes(data),
                        "path": path,
                        "game": "pokemon",
                        "side": "faceUp",
                        "split": "train",
                    }
                )
            write_json(source / "assets.json", {"assets": assets, "role": "card"})
            evaluation = root / "evaluation"
            manifest = {
                "releaseId": "eval",
                "records": [
                    {
                        "leakageKeys": {
                            "sourceAssetIds": ["asset-0"],
                            "physicalCardIds": [],
                        }
                    }
                ],
            }
            manifest["corpusHash"] = corpus_hash(manifest)
            write_json(evaluation / "manifest.json", manifest)
            evidence = prepare(source / "assets.json", [evaluation], root / "output")
            self.assertEqual(evidence["excludedAssetIds"], ["asset-0", "asset-1"])
            result = load_json(root / "output/assets.json")
            self.assertEqual(len(result["assets"]), 11)
            self.assertEqual(
                sum(r["split"] == "validation" for r in result["assets"]), 1
            )
            second = prepare(source / "assets.json", [evaluation], root / "second")
            self.assertEqual(evidence, second)
