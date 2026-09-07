"""Exercise the shipped v3→v4 SQL against a real SQLite database on the host."""
import json
from pathlib import Path
import re
import sqlite3
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]
ANDROID = ROOT / "mobile-apps/android/app"

class PhysicalCopyMigrationTest(unittest.TestCase):
    def test_stack_split_and_game_scoped_wishlist_index(self):
        schema = json.loads((ANDROID / "schemas/com.ahmadjalil.tcger.data.local.TCGerDatabase/3.json").read_text())["database"]
        db = sqlite3.connect(":memory:")
        for entity in schema["entities"]:
            db.execute(entity["createSql"].replace("${TABLE_NAME}", entity["tableName"]))
            for index in entity["indices"]:
                db.execute(index["createSql"].replace("${TABLE_NAME}", entity["tableName"]))
        columns = [row[1] for row in db.execute("PRAGMA table_info(owned_cards)")]
        values = {"id": "original", "binderId": "binder", "externalId": "001", "name": "Pikachu", "tcg": "pokemon", "quantity": 3, "condition": "LP", "price": 10.5, "createdAt": 0}
        db.execute(f"INSERT INTO owned_cards ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})", [values.get(column) for column in columns])
        source = (ANDROID / "src/main/java/com/ahmadjalil/tcger/data/local/TCGerDatabase.kt").read_text().split("val MIGRATION_3_4", 1)[1].split("fun create", 1)[0]
        statements = re.findall(r'db.execSQL\("([^"]+)"', source)
        for statement in statements:
            if statement.startswith(("ALTER", "DROP", "CREATE")):
                db.execute(statement)
        stacks = list(db.execute("SELECT id, quantity FROM owned_cards WHERE quantity > 1"))
        for copy_id, quantity in stacks:
            db.execute(next(s for s in statements if s.startswith("UPDATE")), [copy_id])
            for _ in range(quantity - 1):
                db.execute(next(s for s in statements if s.startswith("INSERT")), [str(uuid.uuid4()), copy_id])
        rows = list(db.execute("SELECT id, quantity, condition, price, detailsJson FROM owned_cards"))
        self.assertEqual(len(rows), 3)
        self.assertEqual(len({row[0] for row in rows}), 3)
        self.assertIn("original", {row[0] for row in rows})
        self.assertTrue(all(row[1:] == (1, "LP", 10.5, "{}") for row in rows))
        index_columns = [row[2] for row in db.execute("PRAGMA index_info(index_wishlist_cards_tcg_externalId_wishlistId)")]
        self.assertEqual(index_columns, ["tcg", "externalId", "wishlistId"])
        db.close()

if __name__ == "__main__":
    unittest.main()
