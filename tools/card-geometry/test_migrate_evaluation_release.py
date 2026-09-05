import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from benchmark_geometry import benchmark
from corpus_release import RELEASES_DIR, corpus_hash, load_json, write_json
from migrate_evaluation_release import migrate, verify_successor


class EvaluationMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.old = root / "old"
        self.new = root / "new"
        shutil.copytree(RELEASES_DIR / "cross-release-fork-evaluation", self.old)
        self.manifest = load_json(self.old / "manifest.json")
        self.manifest["schema"] = "https://tcger.app/schemas/card-geometry-release-manifest/v1"
        del self.manifest["sourceArchiveAliases"]
        self.manifest["corpusHash"] = corpus_hash(self.manifest)
        write_json(self.old / "manifest.json", self.manifest)
        self.old_bytes = (self.old / "manifest.json").read_bytes()

    def create(self):
        return migrate(self.old, self.new, release_id="evaluation-successor-v2", expected_predecessor_hash=self.manifest["corpusHash"])

    def test_migration_preserves_payload_and_benchmark_carries_both_hashes(self):
        result = self.create()
        new = load_json(self.new / "manifest.json")
        self.assertEqual(new["records"], self.manifest["records"])
        self.assertEqual(result["preflightFailedChecks"], [])
        self.assertEqual((self.old / "manifest.json").read_bytes(), self.old_bytes)
        predictions = self.new.parent / "predictions.jsonl"
        predictions.write_text("".join(json.dumps({"recordId": entry["recordId"], "localizerId": "fixture", "results": []}) + "\n" for entry in new["records"]))
        report = benchmark(release_root=self.new, predictions_path=predictions, expected_corpus_hash=new["corpusHash"], tooling_revision="test")
        self.assertEqual(report["corpusHash"], new["corpusHash"])
        self.assertEqual(report["predecessorCorpusHash"], self.manifest["corpusHash"])
        self.assertEqual(report["supersedes"]["releaseId"], self.manifest["releaseId"])

    def test_changed_declarations_fail_even_after_rehashing(self):
        self.create()
        original = load_json(self.new / "manifest.json")
        for field, value in (("split", "validation"), ("sceneSlice", "binder_page"), ("sha256", "0" * 64)):
            with self.subTest(field=field):
                changed = copy.deepcopy(original)
                changed["records"][0][field] = value
                changed["corpusHash"] = corpus_hash(changed)
                write_json(self.new / "manifest.json", changed)
                with self.assertRaisesRegex(ValueError, "immutable manifest payload changed"):
                    verify_successor(self.old, self.new, expected_predecessor_hash=self.manifest["corpusHash"])

    def test_changed_actual_image_or_record_bytes_fail(self):
        self.create()
        entry = self.manifest["records"][0]
        for relative in (entry["path"], entry["images"][0]["path"]):
            with self.subTest(relative=relative):
                target = self.new / relative
                original = target.read_bytes()
                target.write_bytes(original + b"changed")
                self.assertEqual((self.old / relative).read_bytes(), original)
                with self.assertRaisesRegex(ValueError, "payload hash mismatch"):
                    verify_successor(self.old, self.new, expected_predecessor_hash=self.manifest["corpusHash"])
                target.write_bytes(original)

    def test_wrong_predecessor_pin_fails_before_copy(self):
        with self.assertRaisesRegex(ValueError, "predecessor corpus hash mismatch"):
            migrate(self.old, self.new, release_id="new", expected_predecessor_hash="0" * 64)
        self.assertFalse(self.new.exists())

    def test_forged_lineage_and_non_identity_aliases_fail(self):
        self.create()
        original = load_json(self.new / "manifest.json")
        for field, value in (("supersedes", {"releaseId": "wrong", "corpusHash": self.manifest["corpusHash"]}), ("sourceArchiveAliases", {"card-seg-j74w1": "other", "other": "other"})):
            with self.subTest(field=field):
                changed = copy.deepcopy(original)
                changed[field] = value
                changed["corpusHash"] = corpus_hash(changed)
                write_json(self.new / "manifest.json", changed)
                with self.assertRaises(ValueError):
                    verify_successor(self.old, self.new, expected_predecessor_hash=self.manifest["corpusHash"])


if __name__ == "__main__":
    unittest.main()
