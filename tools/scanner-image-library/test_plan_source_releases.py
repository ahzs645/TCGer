#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import unittest
from datetime import date
from pathlib import Path


SCRIPT = Path(__file__).with_name("plan_source_releases.py")
SPEC = importlib.util.spec_from_file_location("plan_source_releases", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class SourceReleasePlannerTests(unittest.TestCase):
    def test_pokemon_maps_release_and_total_signals(self):
        config = {
            "game": "pokemon", "provider": "pokemon-tcg-api",
            "setsURL": "sets", "catalogURL": "cards",
        }
        payload = {"data": [{
            "id": "sv1", "name": "Scarlet & Violet", "series": "Scarlet & Violet",
            "printedTotal": 198, "total": 258,
            "releaseDate": "2023/03/31", "updatedAt": "2023/04/01 00:00:00",
        }]}
        snapshot = MODULE.pokemon_snapshot(config, lambda *_args, **_kwargs: payload)
        self.assertEqual(snapshot.sets[0]["releaseDate"], "2023-03-31")
        self.assertEqual(snapshot.sets[0]["expectedCards"], 258)
        self.assertEqual(snapshot.catalog["kind"], "paginated-json-api")

    def test_pokemon_paginates_the_small_set_registry(self):
        config = {
            "game": "pokemon", "provider": "pokemon-tcg-api",
            "setsURL": "https://example.test/sets?pageSize=1", "catalogURL": "cards",
        }
        pages = {
            "https://example.test/sets?pageSize=1": {
                "data": [{"id": "a", "name": "A"}], "page": 1, "pageSize": 1, "totalCount": 2,
            },
            "https://example.test/sets?pageSize=1&page=2": {
                "data": [{"id": "b", "name": "B"}], "page": 2, "pageSize": 1, "totalCount": 2,
            },
        }
        snapshot = MODULE.pokemon_snapshot(config, lambda url, **_: pages[url])
        self.assertEqual([row["setId"] for row in snapshot.sets], ["a", "b"])

    def test_pokemon_can_use_the_official_data_repository_fallback(self):
        config = {
            "game": "pokemon", "provider": "pokemon-tcg-api",
            "setsURL": "api", "setsFallbackURL": "repository", "catalogURL": "cards",
        }

        def fetch(url, **_):
            if url == "api":
                raise MODULE.PlannerError("temporary outage")
            return [{"id": "a", "name": "A", "total": 1}]

        snapshot = MODULE.pokemon_snapshot(config, fetch)
        self.assertEqual(snapshot.sets[0]["setId"], "a")
        self.assertEqual(snapshot.signals[0]["value"], "repository")

    def test_scryfall_separates_bulk_revision_from_set_registry(self):
        config = {
            "game": "magic", "provider": "scryfall",
            "catalogMetadataURL": "bulk", "setsURL": "sets",
        }
        fixtures = {
            "bulk": {"updated_at": "2026-01-02T00:00:00Z", "jsonl_download_uri": "https://data/cards.jsonl.gz", "compressed_size": 123},
            "sets": {"data": [
                {"id": "paper", "code": "abc", "name": "Paper", "released_at": "2026-01-03", "card_count": 10, "digital": False, "set_type": "expansion"},
                {"id": "digital", "code": "dgt", "name": "Digital", "released_at": "2026-01-03", "card_count": 20, "digital": True, "set_type": "alchemy"},
            ]},
        }
        snapshot = MODULE.scryfall_snapshot(config, lambda url, **_: fixtures[url])
        self.assertEqual(snapshot.revision, "2026-01-02T00:00:00Z")
        self.assertEqual(snapshot.catalog["bytes"], 123)
        self.assertEqual([row["setId"] for row in snapshot.sets], ["paper"])

    def test_ygoprodeck_uses_database_version_and_set_counts(self):
        config = {
            "game": "yugioh", "provider": "ygoprodeck",
            "revisionURL": "version", "setsURL": "sets", "catalogURL": "cards",
        }
        fixtures = {
            "version": [{"database_version": "146.68", "last_update": "2026-08-21 00:00:28"}],
            "sets": [
                {"set_code": "LOB", "set_name": "Legend of Blue Eyes", "num_of_cards": 126, "tcg_date": "2002-03-08"},
                {"set_code": "LOB", "set_name": "Legend of Blue Eyes Promo", "num_of_cards": 1, "tcg_date": "2002-03-01"},
            ],
        }
        snapshot = MODULE.ygoprodeck_snapshot(config, lambda url, **_: fixtures[url])
        self.assertEqual(snapshot.revision, "146.68")
        self.assertEqual(len(snapshot.sets), 2)
        self.assertEqual({row["setCode"] for row in snapshot.sets}, {"LOB"})
        self.assertEqual({row["expectedCards"] for row in snapshot.sets}, {1, 126})

    def test_plan_downloads_catalog_for_set_change_but_not_images_yet(self):
        current = {
            "game": "future", "provider": "provider", "revision": "2",
            "catalog": {"revision": "2"},
            "sets": [MODULE.normalized_set(setId="a", name="A", expectedCards=11, releaseDate="2026-08-27")],
        }
        previous = {
            "game": "future", "provider": "provider", "revision": "1",
            "catalog": {"revision": "1"},
            "sets": [MODULE.normalized_set(setId="a", name="A", expectedCards=10, releaseDate="2026-08-27")],
        }
        plan = MODULE.build_plan(current, previous, {"unchangedImageAuditPercent": 3}, date(2026, 8, 27))
        actions = {row["action"]: row for row in plan["actions"]}
        self.assertEqual(actions["download-catalog"]["priority"], "required")
        self.assertIn("probe-image-delta", actions)
        self.assertIn("materialize-image-delta", actions)
        self.assertEqual(actions["sample-unchanged-images"]["percent"], 3)
        self.assertEqual(plan["setDiff"]["countChanged"], ["a"])

    def test_unchanged_sources_reuse_now_but_keep_periodic_catalog_diff(self):
        current = {
            "game": "future", "provider": "provider", "revision": "1",
            "catalog": {"revision": "1"},
            "sets": [MODULE.normalized_set(setId="a", name="A")],
        }
        plan = MODULE.build_plan(current, current, {"catalogRefreshHours": 72}, date(2026, 8, 27), "1")
        actions = {row["action"]: row for row in plan["actions"]}
        self.assertIn("reuse-catalog", actions)
        self.assertEqual(actions["refresh-catalog-on-cadence"]["everyHours"], 72)
        self.assertEqual(actions["refresh-catalog-on-cadence"]["then"][-1], "materialize-image-delta")

    def test_unchanged_ledger_without_library_contract_fails_closed(self):
        current = {
            "game": "future", "provider": "provider", "revision": "1",
            "catalog": {"revision": "1"}, "sets": [],
        }
        plan = MODULE.build_plan(current, current, {}, date(2026, 8, 27))
        self.assertEqual(plan["actions"][0]["action"], "download-catalog")
        self.assertFalse(plan["currentRevisionIsMaterialized"])


if __name__ == "__main__":
    unittest.main()
