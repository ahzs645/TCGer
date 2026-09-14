import importlib.util
from datetime import datetime, timezone
import gzip
import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("snapshot", Path(__file__).with_name("build_snapshot.py"))
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)
capture_spec = importlib.util.spec_from_file_location("capture", Path(__file__).with_name("capture_iphone.py"))
capture = importlib.util.module_from_spec(capture_spec)
capture_spec.loader.exec_module(capture)


class SnapshotTests(unittest.TestCase):
    def test_iphone_filter_only_preserves_tin_catalog(self):
        def file(**kwargs):
            return SimpleNamespace(**dict({"file_name": None, "device_name": None, "domain": None, "relative_path": None}, **kwargs))
        for identifier in capture.FILE_IDS:
            self.assertTrue(capture.selected(file(file_name="device/Snapshot/" + identifier)))
        path = "Library/Application Support/Catalog/catalog.sqlite"
        self.assertTrue(capture.selected(file(domain=capture.DOMAIN, relative_path=path)))
        self.assertFalse(capture.selected(file(domain="AppDomain-other.app", relative_path=path)))
        self.assertFalse(capture.selected(file(domain=capture.DOMAIN, relative_path="Library/collection.sqlite")))
        self.assertFalse(capture.selected(file(file_name="device/" + "0" * 40, device_name="unrelated")))

    def test_variants_dates_and_missing_values(self):
        card = {"id": "base1-4", "pricing": {"tcgplayer": {
            "unit": "USD", "updated": "2026-09-01T00:00:00Z",
            "normal": {"marketPrice": 5.5, "productId": 1},
            "holofoil": {"marketPrice": 12, "productId": 2},
            "reverse": {"marketPrice": None, "productId": 3},
        }}}
        rows = snapshot.card_quotes(card, datetime(2026, 9, 2, tzinfo=timezone.utc))
        self.assertEqual([r["finishCode"] for r in rows], ["normal", "holofoil"])
        self.assertEqual(rows[0]["observedAt"], "2026-09-01T00:00:00.000Z")
        self.assertNotIn("condition", rows[0])
        with self.assertRaises(ValueError):
            snapshot.card_quotes(card, datetime(2026, 8, 1, tzinfo=timezone.utc))

    def test_backup_includes_committed_wal_and_package_round_trips(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, target = root / "source.sqlite", root / "copy.sqlite"
            with sqlite3.connect(source) as live:
                live.execute("PRAGMA journal_mode=WAL")
                live.execute("CREATE TABLE prices (amount REAL)")
                live.execute("INSERT INTO prices VALUES (12.5)")
                live.commit()
                snapshot.copy_database(source, target)
            with sqlite3.connect(target) as copied:
                self.assertEqual(copied.execute("SELECT amount FROM prices").fetchone(), (12.5,))
            manifest = snapshot.package(target, root / "output")
            asset = manifest["assets"][0]
            compressed = (root / "output" / asset["file"]).read_bytes()
            self.assertEqual(hashlib.sha256(compressed).hexdigest(), asset["sha256"])
            self.assertEqual(gzip.decompress(compressed), target.read_bytes())


if __name__ == "__main__":
    unittest.main()
