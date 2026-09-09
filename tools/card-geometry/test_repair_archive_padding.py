import copy
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from audit_reflected_archive_padding import reflected_edges
from archive_corner_label_server import Store
from build_archive_corner_label_queue import build_queue
from corpus_release import corpus_hash, load_json, sha256_file, write_json, load_schema, make_validator
from repair_archive_padding import FILL, clip_box, migrate_journal, repair_record, repair_release
from preflight import _record_category_problems
from test_archive_corner_label_server import _fixture_release


class RepairArchivePaddingTests(unittest.TestCase):
    def test_reflection_detection_rejects_flat_and_unrelated_borders(self):
        rng = np.random.default_rng(12)
        content = rng.integers(0, 256, (120, 160, 3), dtype=np.uint8)
        padded = np.concatenate([content[:20][::-1], content, content[-20:][::-1]], axis=0)
        bounds, evidence = reflected_edges(padded)
        self.assertEqual(bounds, [0, 20, 160, 140])
        self.assertTrue(evidence["top"]["verified"])
        self.assertTrue(evidence["bottom"]["verified"])
        for image in (np.full((160, 160, 3), (100, 140, 180), dtype=np.uint8),
                      rng.integers(0, 256, (160, 160, 3), dtype=np.uint8)):
            bounds, evidence = reflected_edges(image)
            self.assertFalse(any(e["verified"] for e in evidence.values()))

    def test_pixels_targets_and_label_coordinates_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, _, original, _, _, _, _ = _fixture_release(root)
            entry = load_json(original / "manifest.json")["records"][0]
            record = load_json(original / entry["path"])
            correction = {"originalImageSha256": record["source"]["sha256"], "contentBounds": [50, 0, 100, 100],
                          "removeAnnotationIndices": [0]}
            source_hash = sha256_file(original / record["source"]["path"])
            output = root / "clean"
            fixed = repair_record(record, correction, original, output)
            self.assertEqual(fixed["instances"], record["instances"][1:])
            self.assertEqual(fixed["source"]["annotationCategories"]["card"], 2, "original annotation counts retain source index identity")
            self.assertEqual(fixed["source"]["paddingCorrection"]["removedAnnotationIndices"], [0])
            self.assertEqual(sha256_file(original / record["source"]["path"]), source_hash)
            with Image.open(original / record["source"]["path"]) as im:
                before = np.array(im.convert("RGB"))
            with Image.open(output / fixed["source"]["path"]) as im:
                after = np.array(im)
            self.assertTrue(np.array_equal(before[:, 50:], after[:, 50:]))
            self.assertTrue(np.all(after[:, :50] == np.array(FILL)))
            self.assertEqual(after.shape, before.shape)
            make_validator(load_schema("card-geometry-corpus-record.v1.schema.json")).validate(fixed)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                repair_record(record, dict(correction, originalImageSha256="0" * 64), original, output)
            with self.assertRaisesRegex(ValueError, "Removal list"):
                repair_record(record, dict(correction, removeAnnotationIndices=[]), original, output)

    def test_crossing_boxes_clip_without_inventing_corners(self):
        box = {"left": .1, "top": .1, "right": .6, "bottom": .9}
        self.assertEqual(clip_box(box, [50, 0, 100, 100], 100, 100), dict(box, left=.5))
        self.assertIsNone(clip_box(box, [60, 0, 100, 100], 100, 100))

    def test_derived_release_and_history_keep_canonical_export_binding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, _, original, queue, _, _, _ = _fixture_release(root)
            manifest = load_json(original / "manifest.json")
            entry = manifest["records"][0]
            record = load_json(original / entry["path"])
            correction = {"sourceCorpusHash": manifest["corpusHash"],
                          "sourceArchiveId": entry["leakageKeys"]["sourceArchiveId"],
                          "frames": [{"recordId": record["recordId"], "originalImageSha256": record["source"]["sha256"],
                                      "contentBounds": [50, 0, 100, 100], "removeAnnotationIndices": [0]}]}
            path = root / "corrections.json"
            write_json(path, correction)
            journal = root / "original.jsonl"
            old = Store(queue, original, journal)
            target = {"corners": [[.55, .1], [.85, .1], [.85, .52], [.55, .52]], "cornerSource": "detector"}
            old.save(record["recordId"], {"reviewer": "Luna", "revision": 0, "targets": {"0": {"skip": "reflected-padding"}, "1": target}})
            output = root / "clean"
            result = repair_release(original, output, path, "clean-fixture")
            self.assertEqual(result["stats"]["falseTargetsRemoved"], 1)
            updated = load_json(output / "manifest.json")
            self.assertEqual(updated["corpusHash"], corpus_hash(updated))
            repaired = load_json(output / entry["path"])
            self.assertEqual(_record_category_problems(updated["records"][0], repaired, updated["targetSemantics"]), [])
            invalid = copy.deepcopy(repaired)
            invalid["source"]["paddingCorrection"]["removedAnnotationIndices"] = [1]
            self.assertTrue(any("also declared removed" in error for error in _record_category_problems(updated["records"][0], invalid, updated["targetSemantics"])))
            invalid["source"]["paddingCorrection"] = None
            self.assertTrue(any("must be an object" in error for error in _record_category_problems(updated["records"][0], invalid, updated["targetSemantics"])))
            self.assertEqual(load_json(original / "manifest.json"), manifest)
            new_queue = root / "new-queue.json"
            write_json(new_queue, build_queue(output, splits=("train",), slices=("multi_card_grid_archive",)))
            frame = load_json(new_queue)["frames"][0]
            self.assertEqual(frame["instances"][0]["displayCardNumber"], 2)
            self.assertEqual(frame["canonicalImageSha256"], record["source"]["sha256"])
            new_journal = root / "new.jsonl"
            counts = migrate_journal(queue, original, journal, new_queue, output, new_journal)
            self.assertEqual(counts["revisionsMigrated"], 1)
            new = Store(new_queue, output, new_journal)
            self.assertEqual(new.saved[record["recordId"]]["targets"]["1"]["corners"], target["corners"])
            exported = new.export()["frames"][0]
            self.assertEqual(exported["imageSha256"], record["source"]["sha256"])
            self.assertEqual(exported["instances"][0]["cornerSource"], "detector")
            self.assertEqual(old.saved[record["recordId"]]["targets"]["0"], {"skip": "reflected-padding"})
            with self.assertRaises(FileExistsError):
                repair_release(original, output, path, "clean-fixture")
            correction["sourceCorpusHash"] = "0" * 64
            write_json(path, correction)
            with self.assertRaisesRegex(ValueError, "another release"):
                repair_release(original, root / "bad", path, "bad")


if __name__ == "__main__":
    unittest.main()
