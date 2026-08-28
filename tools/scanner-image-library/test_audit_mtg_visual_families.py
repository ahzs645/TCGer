from __future__ import annotations

import gzip
import importlib.util
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np


SCRIPT = Path(__file__).with_name("audit_mtg_visual_families.py")
SPEC = importlib.util.spec_from_file_location("audit_mtg_visual_families", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def image_url(card_id: str, side: str = "front") -> str:
    return f"https://cards.scryfall.io/normal/{side}/{card_id[0]}/{card_id[1]}/{card_id}.jpg?1"


def source_card(
    card_id: str,
    oracle_id: str,
    illustration_id: str,
    name: str,
    *,
    side: str = "front",
) -> dict:
    return {
        "object": "card",
        "id": card_id,
        "oracle_id": oracle_id,
        "illustration_id": illustration_id,
        "name": name,
        "digital": False,
        "games": ["paper"],
        "set": "tst",
        "set_name": "Test",
        "set_type": "expansion",
        "collector_number": card_id[:2],
        "layout": "normal",
        "image_uris": {"normal": image_url(card_id, side)},
    }


class MTGVisualFamilyAuditTests(unittest.TestCase):
    def test_profiles_reprints_split_leakage_and_vector_collisions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cards = [
                source_card("00111111-1111-1111-1111-111111111111", "oracle-a", "art-a", "One"),
                source_card("00222222-2222-2222-2222-222222222222", "oracle-a", "art-a", "One"),
                source_card("00333333-3333-3333-3333-333333333333", "oracle-b", "art-b", "Two"),
            ]
            bulk = root / "bulk.jsonl.gz"
            with gzip.open(bulk, "wt", encoding="utf-8") as output:
                for card in cards:
                    output.write(json.dumps(card) + "\n")
            metadata = [
                {
                    "annIndex": index,
                    "cardId": card["id"],
                    "name": card["name"],
                    "game": "magic",
                    "setCode": "tst",
                    "imageURL": card["image_uris"]["normal"],
                }
                for index, card in enumerate(cards)
            ]
            metadata_path = root / "metadata.json"
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            vectors_path = root / "vectors.bin"
            vectors = np.array([
                [127, 0, 0, 0],
                [127, 0, 0, 0],
                [0, 127, 0, 0],
            ], dtype=np.int8)
            vectors_path.write_bytes(struct.pack("<II", 3, 4) + vectors.tobytes())

            result = MODULE.audit(metadata_path, bulk, vectors_path)

            self.assertEqual(result["status"], "ready")
            self.assertEqual(result["catalogJoin"]["matchedRows"], 3)
            self.assertEqual(result["quality"]["oracleId"]["repeatedGroups"], 1)
            self.assertEqual(result["quality"]["illustrationId"]["affectedRows"], 2)
            self.assertEqual(result["vectors"]["exactQ8VectorCollisions"]["groups"], 1)
            self.assertEqual(result["vectors"]["sameIllustrationSimilarity"]["pairsAtOrAbove"]["0.99"], 1)

    def test_reports_catalog_drift_without_attempting_vector_alignment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = source_card("00111111-1111-1111-1111-111111111111", "oracle-a", "art-a", "One")
            second = source_card("00222222-2222-2222-2222-222222222222", "oracle-b", "art-b", "Two")
            bulk = root / "bulk.jsonl"
            bulk.write_text(json.dumps(second) + "\n", encoding="utf-8")
            metadata_path = root / "metadata.json"
            metadata_path.write_text(json.dumps([{
                "annIndex": 0,
                "cardId": first["id"],
                "name": first["name"],
                "game": "magic",
                "imageURL": first["image_uris"]["normal"],
            }]), encoding="utf-8")

            result = MODULE.audit(metadata_path, bulk)

            self.assertEqual(result["status"], "needs-review")
            self.assertEqual(result["catalogJoin"]["missingFromCurrentSource"], 1)
            self.assertEqual(result["catalogJoin"]["newCurrentSourceRows"], 1)


if __name__ == "__main__":
    unittest.main()
