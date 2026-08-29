from __future__ import annotations

import importlib.util
import json
import tarfile
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "build_universal_trainer_metadata.py"
SPEC = importlib.util.spec_from_file_location("build_universal_trainer_metadata", SCRIPT_PATH)
converter = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(converter)


class TrainerMetadataTests(unittest.TestCase):
    def test_release_timestamp_is_stable_and_requires_a_timezone(self):
        self.assertEqual(
            converter.normalize_created_at("2026-08-29T14:00:00-07:00"),
            "2026-08-29T21:00:00+00:00",
        )
        with self.assertRaisesRegex(ValueError, "explicit timezone"):
            converter.normalize_created_at("2026-08-29T21:00:00")

    def test_pokemon_source_lock_rejects_changed_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cards_path = root / "cards.json"
            sets_path = root / "sets.json"
            lock_path = root / "lock.json"
            cards_path.write_text("[]", encoding="utf-8")
            sets_path.write_text("[]", encoding="utf-8")
            lock_path.write_text(json.dumps({
                "schema": "tcger-pokemon-metadata-source-lock-v1",
                "profile": "physical",
                "createdAt": "2026-08-29T21:00:00+00:00",
                "builder": {"sha256": converter.sha256(Path(converter.__file__))},
                "inputs": {
                    "pokemonCatalog": {"sha256": converter.sha256(cards_path)},
                    "pokemonSetRegistry": {"sha256": converter.sha256(sets_path)},
                    "pokemonFamilyOverlay": None,
                },
            }), encoding="utf-8")

            converter.validate_pokemon_source_lock(
                lock_path,
                pokemon_path=cards_path,
                pokemon_sets_path=sets_path,
                pokemon_family_overlay_path=None,
                profile="physical",
            )
            cards_path.write_text("[{}]", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "pokemonCatalog SHA-256 mismatch"):
                converter.validate_pokemon_source_lock(
                    lock_path,
                    pokemon_path=cards_path,
                    pokemon_sets_path=sets_path,
                    pokemon_family_overlay_path=None,
                    profile="physical",
                )

    def test_official_tcgdex_archive_supplies_set_release_dates(self):
        set_source = b'''import { Set } from '../../interfaces'\nconst set: Set = {\n  id: "sv01",\n  releaseDate: "2023-03-31",\n}\nexport default set\n'''
        card_source = b'''export default { name: { en: "Bulbasaur" } }\n'''
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_root = root / "source"
            set_path = source_root / "data" / "Scarlet & Violet" / "Scarlet & Violet.ts"
            card_path = source_root / "data" / "Scarlet & Violet" / "Scarlet & Violet" / "001.ts"
            set_path.parent.mkdir(parents=True)
            card_path.parent.mkdir(parents=True)
            set_path.write_bytes(set_source)
            card_path.write_bytes(card_source)
            archive_path = root / "tcgdex.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                archive.add(source_root, arcname="tcgdex-source")

            dates = converter.pokemon_set_release_dates(archive_path)

        self.assertEqual(dates, {"sv01": "2023-03-31"})

    def test_pokemon_set_dates_and_reviewed_families_enrich_runtime_metadata(self):
        cards = [
            {
                "cardId": "old-001", "name": "Crobat", "setCode": "old",
                "imageURL": "https://assets.tcgdex.net/en/x/old/001/high.webp",
            },
            {
                "cardId": "new-051", "name": "Crobat", "setCode": "new",
                "imageURL": "https://assets.tcgdex.net/en/x/new/051/high.webp",
            },
        ]
        sets = [
            {"id": "old", "releaseDate": "2020/01/02"},
            {"id": "new", "releaseDate": "2026-08-29"},
        ]
        overlay = {
            "families": [{
                "recognitionFamilyId": "pokemon:visual:crobat-shared-art",
                "exactPrintingIds": ["old-001", "new-051"],
            }],
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cards_path = root / "cards.json"
            sets_path = root / "sets.json"
            overlay_path = root / "families.json"
            cards_path.write_text(json.dumps(cards), encoding="utf-8")
            sets_path.write_text(json.dumps(sets), encoding="utf-8")
            overlay_path.write_text(json.dumps(overlay), encoding="utf-8")
            dates = converter.pokemon_set_release_dates(sets_path)
            families, cross_name = converter.pokemon_family_overlay(overlay_path)
            rows = converter.assign_indices(converter.pokemon_entries(
                cards_path,
                set_release_dates=dates,
                family_by_printing=families,
                cross_name_families=cross_name,
            ))

        converter.validate_metadata_rows(
            rows,
            "pokemon",
            require_pokemon_runtime_fields=True,
        )
        self.assertEqual({row["format"] for row in rows}, {"paper"})
        self.assertEqual({row["recognitionFamilyId"] for row in rows}, {
            "pokemon:visual:crobat-shared-art",
        })
        self.assertEqual(
            {row["releaseDate"] for row in rows},
            {"2020-01-02", "2026-08-29"},
        )
        self.assertEqual(
            {row["collectorNumber"] for row in rows},
            {"001", "051"},
        )

    def test_pokemon_runtime_validation_rejects_missing_release_date(self):
        row = converter.normalize_entry({
            "cardId": "set-1",
            "name": "One",
            "format": "paper",
            "setCode": "set",
            "collectorNumber": "1",
            "imageURL": "https://example.invalid/one.jpg",
        }, "pokemon")

        with self.assertRaisesRegex(ValueError, "releaseDate"):
            converter.validate_metadata_rows(
                converter.assign_indices([row]),
                "pokemon",
                require_pokemon_runtime_fields=True,
            )

    def test_pokemon_family_overlay_rejects_unreviewed_cross_name_merge(self):
        cards = [
            {"cardId": "set-1", "name": "One", "setCode": "set", "imageURL": "https://example.invalid/1.jpg"},
            {"cardId": "set-2", "name": "Two", "setCode": "set", "imageURL": "https://example.invalid/2.jpg"},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "cards.json"
            path.write_text(json.dumps(cards), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "different names"):
                converter.pokemon_entries(
                    path,
                    family_by_printing={
                        "set-1": "pokemon:visual:bad",
                        "set-2": "pokemon:visual:bad",
                    },
                )

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
        self.assertEqual(len({row["recognitionFamilyId"] for row in shared}), 1)
        self.assertTrue(shared[0]["recognitionFamilyId"].startswith("magic:visual:oracle-a:art-a:"))
        self.assertEqual({row["collectorNumber"] for row in shared}, {"10"})
        self.assertEqual({row["releaseDate"] for row in shared}, {"2020-01-01", "2024-02-02"})
        art_rows = [row for row in rows if row["exactPrintingId"] == "art-card"]
        self.assertEqual(len(art_rows), 1)
        self.assertEqual(art_rows[0]["faceSide"], "front")
        self.assertEqual(art_rows[0]["layout"], "art_series")

    def test_magic_visible_style_and_card_identity_split_families(self):
        base = {
            "visualIdentityId": "magic:printing:a:front",
            "oracleId": "oracle-a",
            "illustrationId": "art-a",
            "layout": "normal",
            "frame": "2015",
            "borderColor": "black",
            "fullArt": False,
            "faceSide": "front",
            "language": "en",
        }
        family = converter.magic_recognition_family_id(base)
        # Exact-print fields do not change retrieval identity.
        reprint = dict(base, setCode="new", collectorNumber="42", releaseDate="2026-01-01")
        self.assertEqual(converter.magic_recognition_family_id(reprint), family)
        for field, value in (
            ("oracleId", "oracle-b"),
            ("frame", "2003"),
            ("borderColor", "white"),
            ("language", "ja"),
            ("fullArt", True),
            ("textless", True),
            ("watermark", "planeswalker"),
        ):
            changed = dict(base)
            changed[field] = value
            self.assertNotEqual(converter.magic_recognition_family_id(changed), family)

    def test_default_games_receive_two_stage_identity_contract(self):
        row = converter.normalize_entry({
            "cardId": "card-1", "name": "One", "imageURL": "https://example.invalid/1.jpg",
        }, "pokemon")
        self.assertEqual(row["exactPrintingId"], "card-1")
        self.assertEqual(row["recognitionFamilyId"], "pokemon:printing:card-1")

    def test_magic_export_requires_exact_print_verification_metadata(self):
        row = converter.normalize_entry({
            "cardId": "printing-a",
            "name": "Shared Art",
            "imageURL": "https://example.invalid/a.jpg",
            "visualIdentityId": "magic:printing:printing-a:front",
            "recognitionFamilyId": "magic:illustration:art-a",
            "setCode": "one",
            "collectorNumber": "10",
            "releaseDate": "2024-02-02",
            "faceSide": "front",
        }, "magic")
        converter.validate_metadata_rows(converter.assign_indices([row]), "magic")

        del row["collectorNumber"]
        with self.assertRaisesRegex(ValueError, "collectorNumber"):
            converter.validate_metadata_rows(converter.assign_indices([row]), "magic")

    def test_magic_export_rejects_duplicate_visible_face_rows(self):
        def row(card_id: str):
            return converter.normalize_entry({
                "cardId": card_id,
                "name": "Shared Art",
                "imageURL": f"https://example.invalid/{card_id}.jpg",
                "visualIdentityId": "magic:printing:duplicate:front",
                "recognitionFamilyId": "magic:illustration:art-a",
                "setCode": "one",
                "collectorNumber": "10",
                "releaseDate": "2024-02-02",
                "faceSide": "front",
            }, "magic")

        rows = converter.assign_indices([row("a"), row("b")])
        with self.assertRaisesRegex(ValueError, "repeats visible identity"):
            converter.validate_metadata_rows(rows, "magic")

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
