import json
from pathlib import Path
import tempfile
import unittest
from card_identity_review import Review


class IdentityReviewTests(unittest.TestCase):
    def test_catalog_validation_durable_undo_and_geometry_binding(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);queue=root/'queue.json'
            queue.write_text(json.dumps({'cards':[dict(id='F1-C1',reference='F1 / C1',recordId='photo',
                instanceId='card-0',geometrySha256='a'*64,source={'sha256':'b'*64})]}))
            for game in ('pokemon','magic','yugioh'):
                p=root/'models'/game;p.mkdir(parents=True)
                (p/'CardsIndexMetadata.json').write_text(json.dumps([dict(cardId='one',name='Example',setCode='set')]))
            r=Review(queue,root/'models',root/'storage')
            with self.assertRaisesRegex(ValueError,'catalog'):r.save(dict(id='F1-C1',status='confirmed',game='pokemon',cardId='missing'))
            self.assertFalse(r.journal.exists())
            row=r.save(dict(id='F1-C1',status='confirmed',game='pokemon',cardId='one'))
            self.assertEqual(row['geometrySha256'],'a'*64)
            self.assertEqual(len(json.loads(r.export.read_text())['records']),1)
            r.save(dict(id='F1-C1',status='pending'))
            self.assertEqual(json.loads(r.export.read_text())['records'],[])
            r.storage_lock.close()
            restored=Review(queue,root/'models',root/'storage')
            self.assertEqual(restored.latest['F1-C1']['status'],'pending')
            self.assertEqual(len(restored.journal.read_text().splitlines()),2)
            restored.storage_lock.close()


if __name__=='__main__':unittest.main()
