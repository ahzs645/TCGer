import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from reference_asset_archive import create,restore,verify,relative_path


class ReferenceArchiveTests(unittest.TestCase):
    def test_deduplication_and_independent_restored_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.mkdir()
            for name,data in [('a.txt',b'one'),('b.txt',b'one'),('c.txt',b'two')]:
                (source/name).write_bytes(data)
            plan=root/'plan.json';plan.write_text(json.dumps(dict(sourceCodeRevision='test',files=[dict(path=p.name,category='fixture',expectedSha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(source.iterdir())])))
            manifest=create(source,plan,root/'archive')
            self.assertEqual(len(manifest['objects']),2)
            result=restore(root/'archive',root/'restore')
            self.assertEqual(result['restoredFiles'],3)
            (root/'restore/a.txt').write_bytes(b'changed')
            self.assertEqual((root/'restore/b.txt').read_bytes(),b'one')
            self.assertEqual(restore(root/'archive',root/'subset','c.txt')['restoredFiles'],1)
            receipt=json.loads((root/'archive/manifest.json').read_text());receipt['objects'].pop(next(iter(receipt['objects'])))
            (root/'archive/manifest.json').write_text(json.dumps(receipt))
            with self.assertRaises(ValueError):verify(root/'archive')
            with self.assertRaises(ValueError):restore(root/'archive',root/'invalid')

    def test_rejects_unsafe_output_paths(self):
        for value in ['../outside','/outside','a/../../outside','a\\outside','']:
            with self.assertRaises(ValueError):relative_path(value)


if __name__=='__main__':unittest.main()
