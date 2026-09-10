import json
from pathlib import Path
import tempfile
import unittest

from studio_backup import Backups, atomic, json_bytes, restore_files, native_bundle


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.source=self.root/'source';self.source.mkdir()
        self.destination=self.root/'backup'
        self.manager=Backups(self.root/'config.json',self.root/'state')
        atomic(self.manager.config_path,json_bytes(dict(folder=str(self.destination),sources=[dict(path=str(self.source),namespace='labels')])) )
        self.manager.configure(str(self.destination))

    def tearDown(self):self.temp.cleanup()

    def test_versions_restore_and_destination_change(self):
        path=self.source/'journal.jsonl';path.write_text('{"corners":[1,2,3,4]}\n')
        self.assertEqual(self.manager.snapshot()['state'],'saved')
        old=json.loads((self.destination/'latest.json').read_text())
        path.write_text('{"corners":[4,3,2,1]}\n')
        self.manager.snapshot()
        self.assertEqual(len(list((self.destination/'snapshots').glob('*'))),2)
        restore_files(self.destination,self.root/'restore')
        self.assertEqual((self.root/'restore/labels/journal.jsonl').read_bytes(),path.read_bytes())
        sha=old['files']['labels/journal.jsonl']['sha256']
        self.assertIn(b'[1,2,3,4]',(self.destination/'objects'/sha[:2]/sha).read_bytes())
        second=self.root/'second';self.manager.configure(str(second));self.manager.snapshot()
        restore_files(second,self.root/'restore-second')
        self.assertEqual((self.root/'restore-second/labels/journal.jsonl').read_bytes(),path.read_bytes())

    def test_partial_journal_and_unavailable_drive_do_not_block_other_files(self):
        (self.source/'journal.jsonl').write_text('{"saved":true}\n')
        self.manager.snapshot()
        (self.source/'journal.jsonl').write_text('{"incomplete":')
        (self.source/'queue.json').write_text('{"new":true}')
        # Restarting the service must still retain the last good journal version.
        self.manager=Backups(self.manager.config_path,self.manager.state)
        result=self.manager.snapshot();self.assertEqual(result['state'],'error');self.assertEqual(result['files'],2)
        restore_files(self.destination,self.root/'restore')
        self.assertEqual(json.loads((self.root/'restore/labels/queue.json').read_text()),{'new':True})
        self.assertIn('saved',(self.root/'restore/labels/journal.jsonl').read_text())
        self.destination.rename(self.root/'disconnected')
        self.assertEqual(self.manager.snapshot()['state'],'error')
        self.assertFalse(self.destination.exists())
        self.assertEqual((self.source/'journal.jsonl').read_text(),'{"incomplete":')

    def test_corrupt_restore_and_recursive_folder_rejected(self):
        (self.source/'state.json').write_text('{}');self.manager.snapshot()
        manifest=json.loads((self.destination/'latest.json').read_text());sha=manifest['files']['labels/state.json']['sha256']
        (self.destination/'objects'/sha[:2]/sha).write_text('corrupt')
        with self.assertRaises(ValueError):restore_files(self.destination,self.root/'restore')
        self.assertEqual(self.manager.snapshot(force=True)['state'],'saved')
        restore_files(self.destination,self.root/'repaired')
        self.assertEqual((self.root/'repaired/labels/state.json').read_text(),'{}')
        with self.assertRaises(ValueError):self.manager.configure(str(self.source/'recursive'))
        manifest['files']['../escape']={};(self.destination/'latest.json').write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):restore_files(self.destination,self.root/'restore-two')

    def test_native_export_bundles_are_deterministic(self):
        (self.source/'metadata.json').write_text('{"name":"tcger-fixture","last_loaded_at":"one"}')
        first=native_bundle(self.source)
        (self.source/'metadata.json').write_text('{"last_loaded_at":"two","name":"tcger-fixture"}')
        self.assertEqual(native_bundle(self.source),first)


if __name__=='__main__':unittest.main()
