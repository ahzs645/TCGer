import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from build_mobile_backup import build
from test_tcgcsv import sync, PRODUCT, PRICE


class MobileBackupTests(unittest.TestCase):
    def test_shards_keep_source_identity_nulls_and_only_public_fields(self):
        stamp = '2026-09-13T20:05:38+0000'
        class FakeClient:
            def stamp(self): return stamp
            def rows(self, path, directory):
                rows = ([{'groupId': 1, 'categoryId': 3, 'name': 'Test group'}] if path.endswith('groups')
                        else [{**PRODUCT, 'private_future_field': 'exclude', 'extendedData': [{'name': 'Number', 'value': '007/100'}, {'name': 'CardText', 'value': 'exclude'}]}] if path.endswith('products') else [{**PRICE, 'marketPrice': None}])
                return rows, '2026-09-14T01:00:00.000Z', False
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            database = directory / 'catalog.sqlite'
            sync.build(FakeClient(), stamp, directory, database)
            manifest = build(database, directory / 'mobile')
            asset = manifest['sets']['1']
            data = (directory / 'mobile' / asset['file']).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), asset['sha256'])
            self.assertEqual(len(data), asset['bytes'])
            payload = json.loads(data)
            self.assertEqual(payload['sourceAsOf'], '2026-09-13T20:05:38.000Z')
            self.assertEqual(payload['prices'][0]['subTypeName'], '1st Edition Holofoil')
            self.assertIsNone(payload['prices'][0]['marketPrice'])
            self.assertNotIn('exclude', data.decode())
            self.assertEqual(payload['products'][0]['extendedData'], [{'name': 'Number', 'value': '007/100'}])
            self.assertEqual(build(database, directory / 'mobile'), manifest)
