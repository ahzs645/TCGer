import unittest
from inspect_history import select_price


class HistoryTests(unittest.TestCase):
    def test_exact_product_and_printing_only(self):
        payload = {"success": True, "results": [
            {"productId": 10, "subTypeName": "Holofoil", "marketPrice": 12, "lowPrice": None},
            {"productId": 10, "subTypeName": "Reverse Holofoil", "marketPrice": 4},
            {"productId": 11, "subTypeName": "Holofoil", "marketPrice": 99},
        ]}
        self.assertEqual(select_price(payload, 10, "Holofoil")["marketPrice"], 12)
        self.assertIsNone(select_price(payload, 10, "Holofoil")["lowPrice"])
        self.assertIsNone(select_price(payload, 10, "Normal"))
        self.assertIsNone(select_price(payload, 20, "Holofoil"))
        payload["results"].append(payload["results"][0])
        with self.assertRaises(ValueError):
            select_price(payload, 10, "Holofoil")
