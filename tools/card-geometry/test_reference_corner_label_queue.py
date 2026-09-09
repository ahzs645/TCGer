import copy
import json
import tempfile
import unittest
from pathlib import Path

from archive_corner_label_server import Store, validate_label_quad
from build_reference_corner_label_queue import build_queue, reference_seed
from build_real_smoke_release import _annotation_mask
from build_fixture_releases import tiny_png
from corpus_release import sha256_bytes, sha256_file, write_json


class ReferenceCornerQueueTests(unittest.TestCase):
    def test_seed_preserves_geometry_without_mirrored_winding(self):
        points = [[.1,.1],[.12,.8],[.8,.75],[.85,.15]]
        instance = {"corners": [{"point": {"x": x, "y": y}, "coordinateKnown": True} for x,y in points],
                    "orientationKnown": False}
        before = copy.deepcopy(instance)
        seed = reference_seed(instance, 100, 100)
        validate_label_quad(seed["seedCorners"])
        self.assertCountEqual(seed["seedCorners"], points)
        self.assertFalse(seed["seedOrientationKnown"])
        self.assertEqual(instance, before)

    def test_queue_binding_and_review_round_trip_preserve_frozen_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = tiny_png(100, 100, (30, 80, 110))
            image_sha = sha256_bytes(image)
            (root / "photo.png").write_bytes(image)
            annotation = {"bbox": [10,10,70,70], "segmentation": [[10,10,80,10,80,80,10,80]],
                          "geometryQuality": "source-polygon"}
            canonical = {"id": image_sha, "sha256": image_sha, "width": 100, "height": 100,
                         "annotations": [annotation]}
            corpus = root / "corpus.jsonl"
            corpus.write_text(json.dumps(canonical) + "\n")
            mask, _ = _annotation_mask(annotation, 100, 100)
            record = {"recordId": "coco-"+image_sha,
                      "source": {"path": "photo.png", "sha256": image_sha, "width": 100, "height": 100},
                      "instances": [{"instanceId": "card-0", "corners": [], "visibleMask": mask}]}
            write_json(root / "record.json", record)
            write_json(root / "manifest.json", {"releaseId": "frozen", "corpusHash": "corpus-pin", "records": [
                {"recordId": record["recordId"], "split": "test", "sceneSlice": "single_card_archive",
                 "path": "record.json", "sha256": sha256_file(root / "record.json"),
                 "leakageKeys": {"sourceArchiveId": "archive"}}]})
            pins = {p: sha256_file(root / p) for p in ("record.json", "manifest.json", "photo.png", "corpus.jsonl")}
            queue = build_queue(root, corpus)
            write_json(root / "queue.json", queue)
            journal = root / "reviews.jsonl"
            store = Store(root / "queue.json", root, journal)
            self.assertFalse(journal.exists())
            self.assertEqual(store.progress()["targetsLabeled"], 0)
            key = store.order[0]
            seed = store.frames[key]["instances"][0]
            label = {"corners": seed["seedCorners"], "cornerVisibility": seed["seedCornerVisibility"],
                     "orientationKnown": False, "cornerSource": "human"}
            store.save(key, {"revision": 0, "reviewer": "test reviewer", "targets": {"0": label}})
            reopened = Store(root / "queue.json", root, journal)
            self.assertEqual(reopened.export()["frames"][0]["instances"][0]["corners"], label["corners"])
            self.assertEqual(reopened.progress()["targetsLabeled"], 1)
            self.assertEqual(pins, {p: sha256_file(root / p) for p in pins})
            canonical["annotations"][0]["segmentation"][0][0] = 11
            corpus.write_text(json.dumps(canonical))
            with self.assertRaisesRegex(ValueError, "annotation binding"):
                build_queue(root, corpus)


if __name__ == "__main__":
    unittest.main()
