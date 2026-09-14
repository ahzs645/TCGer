from argparse import Namespace
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("sync_tcgcsv", Path(__file__).with_name("sync_tcgcsv.py"))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

PRODUCT = {"productId": 10, "categoryId": 3, "groupId": 1, "name": "Test product"}
PRICE = {"productId": 10, "subTypeName": "1st Edition Holofoil", "marketPrice": 12.5, "lowPrice": None}


class TcgCsvTests(unittest.TestCase):
    def test_exact_identity_nulls_and_invalid_prices(self):
        self.assertEqual(sync.prices_for_group(1, [PRODUCT], [PRICE]), [PRICE])
        for rows in [[PRICE, PRICE], [{**PRICE, "productId": 11}], [{**PRICE, "marketPrice": -1}],
                     [{**PRICE, "marketPrice": float("nan")}], [{**PRICE, "subTypeName": ""}]]:
            with self.assertRaises(ValueError):
                sync.prices_for_group(1, [PRODUCT], rows)

    def test_collections_and_coverage_fail_closed(self):
        for payload in [{"success": False, "results": []}, {"success": True, "totalItems": 2, "results": [{}]},
                        {"success": True, "results": [None]}]:
            with self.assertRaises(ValueError):
                sync.response_rows(payload)
        prior = {"kind": "tcgcsv-full-pokemon", "groupCount": 220, "productCount": 1000, "pricedRows": 1500}
        with self.assertRaises(ValueError):
            sync.validate_coverage({**prior, "pricedRows": 100}, prior)

    def test_build_retains_printing_and_source_time(self):
        import sqlite3
        stamp = "2026-09-13T20:05:38+0000"
        class FakeClient:
            def stamp(self): return stamp
            def rows(self, path, directory):
                rows = ([{"groupId": 1, "categoryId": 3, "name": "Test group"}] if path.endswith("groups")
                        else [PRODUCT] if path.endswith("products") else [PRICE])
                return rows, "2026-09-14T01:00:00.000Z", False
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.sqlite"
            exported, summary = sync.build(FakeClient(), stamp, Path(directory), path)
            self.assertEqual(summary["priceRows"], 1)
            self.assertEqual(exported["prices"][0]["subTypeName"], "1st Edition Holofoil")
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute("SELECT market_price,low_price,source_as_of FROM prices").fetchone(),
                                 (12.5, None, "2026-09-13T20:05:38.000Z"))
            with patch.object(FakeClient, "stamp", return_value="2026-09-14T20:00:00+0000"):
                with self.assertRaisesRegex(ValueError, "changed during"):
                    sync.build(FakeClient(), stamp, Path(directory), Path(directory) / "changed.sqlite")

    def test_same_stamp_skips_all_group_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            prior = {"kind": "tcgcsv-full-pokemon", "updateStamp": "2026-09-13T20:05:38+0000"}
            (output / "manifest.json").write_text(json.dumps({"source": prior}))
            args = Namespace(out=output, cache=output / "cache", previous=None, allow_coverage_drop=False)
            with patch.object(sync.Client, "stamp", return_value=prior["updateStamp"]), \
                    patch.object(sync.Client, "rows", side_effect=AssertionError("Unexpected bulk pull")):
                self.assertFalse(sync.sync(args)["changed"])

    def test_resume_reuses_only_validated_cached_responses(self):
        with tempfile.TemporaryDirectory() as directory:
            client = sync.Client(Path(directory))
            body = json.dumps({"success": True, "totalItems": 1, "results": [PRODUCT]}).encode()
            with patch.object(client, "fetch", return_value=body) as fetch:
                first = client.rows("tcgplayer/3/1/products", Path(directory))
                self.assertEqual(client.rows("tcgplayer/3/1/products", Path(directory)), first)
                self.assertEqual(fetch.call_count, 1)

    def test_request_budget_and_long_retry_after_stop_work(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            (cache / "request-budget.json").write_text(json.dumps({
                "day": sync.utc_now().date().isoformat(), "requests": 2000,
            }))
            with self.assertRaisesRegex(RuntimeError, "budget exhausted"):
                sync.Client(cache).fetch("last-updated.txt")
        with self.assertRaisesRegex(RuntimeError, "longer pause"):
            sync.retry_delay("600", 0)

    def test_new_build_within_24_hours_does_not_start_another_pull(self):
        from datetime import timedelta
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            now = sync.utc_now()
            prior = {"kind": "tcgcsv-full-pokemon", "updateStamp": sync.iso(now - timedelta(days=2)),
                     "completedAt": sync.iso(now - timedelta(hours=2))}
            (output / "manifest.json").write_text(json.dumps({"source": prior}))
            args = Namespace(out=output, cache=output / "cache", previous=None, allow_coverage_drop=False)
            with patch.object(sync.Client, "stamp", return_value=sync.iso(now - timedelta(days=1))), \
                    patch.object(sync.Client, "rows", side_effect=AssertionError("Unexpected bulk pull")):
                self.assertEqual(sync.sync(args)["reason"], "daily_pull_cooldown")


if __name__ == "__main__":
    unittest.main()
