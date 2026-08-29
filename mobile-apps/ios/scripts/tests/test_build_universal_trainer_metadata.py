from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "build_universal_trainer_metadata.py"
SPEC = importlib.util.spec_from_file_location("build_universal_trainer_metadata", SCRIPT_PATH)
converter = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(converter)


class TrainerMetadataTests(unittest.TestCase):
    def test_magic_groups_reprints_and_excludes_generic_art_series_back(self):
        normal_a = {
            "object": "card", "id": "printing-a", "oracle_id": "oracle-a",
            "illustration_id": "art-a", "name": "Shared Art", "digital": False,
            "games": ["paper"], "set": "one", "set_name": "One", "set_type": "expansion",
            "released_at": "2020-01-01",
            "collector_number": "10", "layout": "normal", "lang": "en",
            "image_uris": {"normal": "https://cards.scryfall.io/normal/front/a/a/a.jpg"},
        }
        normal_b = dict(normal_a)
        normal_b.update({
            "id": "printing-b", "set": "two", "set_name": "Two",
            "released_at": "2024-02-02",
            "image_uris": {"normal": "https://cards.scryfall.io/normal/front/b/b/b.jpg"},
        })
        art_series = {
            "object": "card", "id": "art-card", "oracle_id": "oracle-art",
            "name": "Art Card", "digital": False, "games": ["paper"],
            "set": "art", "set_name": "Art", "set_type": "memorabilia",
            "collector_number": "1", "layout": "art_series", "lang": "en",
            "card_faces": [
                {
                    "name": "Art Card", "illustration_id": "art-front",
                    "image_uris": {"normal": "https://cards.scryfall.io/normal/front/c/c/c.jpg"},
                },
                {
                    "name": "Art Card", "illustration_id": "art-back",
                    "image_uris": {"normal": "https://cards.scryfall.io/normal/back/c/c/c.jpg"},
                },
            ],
        }
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "cards.json"
            path.write_text(json.dumps([normal_a, normal_b, art_series]), encoding="utf-8")
            rows = converter.mtg_entries(path)

        self.assertEqual(len(rows), 3)
        shared = [row for row in rows if row["name"] == "Shared Art"]
        self.assertEqual({row["exactPrintingId"] for row in shared}, {"printing-a", "printing-b"})
        self.assertEqual({row["recognitionFamilyId"] for row in shared}, {"magic:illustration:art-a"})
        self.assertEqual({row["collectorNumber"] for row in shared}, {"10"})
        self.assertEqual({row["releaseDate"] for row in shared}, {"2020-01-01", "2024-02-02"})
        art_rows = [row for row in rows if row["exactPrintingId"] == "art-card"]
        self.assertEqual(len(art_rows), 1)
        self.assertEqual(art_rows[0]["faceSide"], "front")
        self.assertEqual(art_rows[0]["layout"], "art_series")

    def test_default_games_receive_two_stage_identity_contract(self):
        row = converter.normalize_entry({
            "cardId": "card-1", "name": "One", "imageURL": "https://example.invalid/1.jpg",
        }, "pokemon")
        self.assertEqual(row["exactPrintingId"], "card-1")
        self.assertEqual(row["recognitionFamilyId"], "pokemon:printing:card-1")

    def test_physical_pokemon_profile_excludes_every_pocket_marker(self):
        rows = [
            {"cardId": "paper", "name": "Paper", "format": "paper", "imageURL": "https://assets.tcgdex.net/en/base/base1/1/high.webp"},
            {"cardId": "url", "name": "Pocket URL", "imageURL": "https://assets.tcgdex.net/en/tcgp/A1/1/high.webp"},
            {"cardId": "format", "name": "Pocket Format", "format": "pocket", "imageURL": "https://example.invalid/card.webp"},
            {"cardId": "series", "name": "Pocket Series", "series": {"id": "tcgp"}, "imageURL": "https://example.invalid/other.webp"},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "pokemon.json"
            path.write_text(json.dumps(rows), encoding="utf-8")
            physical = converter.pokemon_entries(path)
            collection = converter.pokemon_entries(path, profile="all")

        self.assertEqual([row["cardId"] for row in physical], ["paper"])
        self.assertEqual(len(collection), 4)
        converter.assert_physical_pokemon_catalog(physical)
        with self.assertRaisesRegex(ValueError, "TCG Pocket"):
            converter.assert_physical_pokemon_catalog(collection)

    def test_pokemon_known_missing_tcgdex_images_use_pinned_fallbacks(self):
        rows = [
            {
                "cardId": "dc1-1",
                "name": "Team Magma's Numel",
                "imageURL": "https://assets.tcgdex.net/en/xy/dc1/1/high.webp",
            },
            {
                "cardId": "base1-1",
                "name": "Alakazam",
                "imageURL": "https://assets.tcgdex.net/en/base/base1/1/high.webp",
            },
        ]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "pokemon.json"
            path.write_text(json.dumps(rows), encoding="utf-8")
            output = converter.pokemon_entries(path)

        self.assertEqual(
            output[0]["imageURL"],
            "https://images.pokemontcg.io/dc1/1_hires.png",
        )
        self.assertEqual(output[0]["sourceProvider"], "pokemontcg.io")
        self.assertEqual(output[0]["sourceImageFallbackReason"], "tcgdex-cdn-404")
        self.assertEqual(output[1]["sourceProvider"], "tcgdex")
        self.assertEqual(output[1]["imageURL"], rows[1]["imageURL"])


if __name__ == "__main__":
    unittest.main()
