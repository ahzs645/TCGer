from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "upgrade_singleton_scanner_metadata.py"
SPEC = importlib.util.spec_from_file_location("upgrade_singleton_scanner_metadata", SCRIPT_PATH)
upgrader = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(upgrader)


def row(index: int, card_id: str, family_id: str) -> dict:
    return {
        "annIndex": index,
        "cardId": card_id,
        "exactPrintingId": card_id,
        "recognitionFamilyId": family_id,
        "name": f"Card {index}",
        "game": "pokemon",
        "format": None,
        "setCode": "base",
        "imageURL": f"https://assets.tcgdex.net/en/base/base/{index}/high.webp",
    }


class SingletonScannerMetadataUpgradeTests(unittest.TestCase):
    def test_upgrade_preserves_vector_order_and_adds_one_printing(self):
        source = [row(0, "base-1", "pokemon:printing:base-1"), row(1, "base-2", "pokemon:printing:base-2")]

        result = upgrader.upgrade_rows(source, "pokemon")

        self.assertEqual([item["annIndex"] for item in result], [0, 1])
        self.assertEqual([item["cardId"] for item in result], ["base-1", "base-2"])
        self.assertEqual(result[0]["format"], "paper")
        self.assertEqual(result[0]["indexIdentity"], "recognition_family")
        self.assertEqual(result[0]["printingCount"], 1)
        self.assertEqual(result[0]["printings"][0]["exactPrintingId"], "base-1")
        self.assertEqual(result[0]["printings"][0]["imageURL"], source[0]["imageURL"])

    def test_rejects_a_family_that_would_require_vector_collapse(self):
        source = [row(0, "base-1", "pokemon:visual:shared"), row(1, "base-2", "pokemon:visual:shared")]

        with self.assertRaisesRegex(ValueError, "rebuild family-level vectors"):
            upgrader.upgrade_rows(source, "pokemon")

    def test_rejects_pocket_rows(self):
        source = [row(0, "tcgp-1", "pokemon:printing:tcgp-1")]
        source[0]["imageURL"] = "https://assets.tcgdex.net/en/tcgp/A1/1/high.webp"

        with self.assertRaisesRegex(ValueError, "Pocket"):
            upgrader.upgrade_rows(source, "pokemon")

    def test_rejects_non_contiguous_ann_indices(self):
        source = [row(4, "base-1", "pokemon:printing:base-1")]

        with self.assertRaisesRegex(ValueError, "cannot realign vectors"):
            upgrader.upgrade_rows(source, "pokemon")


if __name__ == "__main__":
    unittest.main()
