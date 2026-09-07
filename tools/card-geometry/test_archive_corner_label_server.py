import json
import sys
import tempfile
import threading
import unittest
import urllib.request
import zipfile
from collections import Counter
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from archive_corner_label_server import Store, handler, validate_save  # noqa: E402
from build_archive_corner_label_queue import build_queue  # noqa: E402
from build_fixture_releases import tiny_png  # noqa: E402
from build_real_smoke_release import build_release  # noqa: E402
from corpus_release import load_json, sha256_bytes, sha256_file, write_json  # noqa: E402


def _fixture_release(root: Path):
    """A one-frame archive release with two box-only cards in a grid layout."""
    raw = root / "raw"
    raw.mkdir()
    image = tiny_png(100, 100, (40, 40, 40))
    archive_name = "pokefolio.v1i.coco.zip"
    with zipfile.ZipFile(raw / archive_name, "w") as archive:
        archive.writestr("train/page.png", image)
    row = {
        "id": sha256_bytes(image), "sha256": sha256_bytes(image), "archive": archive_name,
        "imageMember": "train/page.png", "width": 100, "height": 100,
        "provenance": [{"source": "pokefolio", "license": "CC BY 4.0"}],
        "annotations": [
            {"category": "card", "geometryQuality": "bbox-derived", "bbox": [10, 10, 30, 42], "provenance": ["pokefolio:pokemon_card:1"]},
            {"category": "card", "geometryQuality": "bbox-derived", "bbox": [55, 10, 30, 42], "provenance": ["pokefolio:pokemon_card:2"]},
        ],
    }
    corpus = root / "corpus.jsonl"
    corpus.write_text(json.dumps(row) + "\n")
    scenes = root / "scenes.json"
    write_json(scenes, {"input": {"sha256": sha256_file(corpus)}, "heuristic": {"id": "grid-size-overlap-rotation-v1"},
                        "assignments": [{"recordId": row["id"], "assignment": "binder_page"}]})
    release = root / "release"
    aliases = {"coco:pokefolio.v1i.coco": "coco:pokefolio.v1i.coco"}
    build_release(canonical_corpus=corpus, raw_dir=raw, archive_splits={archive_name: "train"}, devmode_sessions=[],
                  output=release, source_archive_aliases=aliases, scene_assignments_path=scenes)
    queue = root / "queue.json"
    write_json(queue, build_queue(release, splits=("train",), slices=("multi_card_grid_archive",),
                                  canonical_corpus_sha256=sha256_file(corpus)))
    return corpus, raw, release, queue, aliases, scenes, row


class ArchiveCornerLabelServerTests(unittest.TestCase):
    def test_validation_binds_outlines_to_seed_boxes(self):
        frame = {"instances": [{"sourceAnnotationIndex": 0, "seedBox": {"left": .1, "top": .1, "right": .4, "bottom": .52}}]}
        good = {"reviewer": "Ahmad", "targets": {"0": {"corners": [[.1, .1], [.4, .1], [.4, .52], [.1, .52]]}}}
        body = validate_save(frame, good)
        self.assertTrue(body["complete"])
        self.assertEqual(body["targets"]["0"]["cornerVisibility"], ["visible"] * 4)
        with self.assertRaisesRegex(ValueError, "seed box"):
            validate_save(frame, {"reviewer": "A", "targets": {"0": {"corners": [[.6, .6], [.9, .6], [.9, .9], [.6, .9]]}}})
        with self.assertRaisesRegex(ValueError, "outsideFrame"):
            validate_save(frame, {"reviewer": "A", "targets": {"0": {"corners": [[-.1, .1], [.4, .1], [.4, .52], [.1, .52]]}}})
        with self.assertRaisesRegex(ValueError, "Unknown target"):
            validate_save(frame, {"reviewer": "A", "targets": {"7": {"skip": "unsure"}}})
        with self.assertRaisesRegex(ValueError, "reviewer"):
            validate_save(frame, {"reviewer": "", "targets": {}})
        partial = validate_save(frame, {"reviewer": "A", "targets": {}})
        self.assertFalse(partial["complete"])
        skipped = validate_save(frame, {"reviewer": "A", "targets": {"0": {"skip": "cut-off"}}})
        self.assertTrue(skipped["complete"])

    def test_journal_export_and_importer_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, release, queue, aliases, scenes, row = _fixture_release(root)
            journal = root / "journal.jsonl"
            store = Store(queue, release, journal)
            self.assertEqual(store.progress(), {"frames": 1, "framesComplete": 0, "targets": 2, "targetsLabeled": 0, "targetsSkipped": 0})
            key = store.order[0]
            first = store.save(key, {"reviewer": "Ahmad", "revision": 0, "targets": {
                "0": {"corners": [[.11, .1], [.39, .11], [.4, .52], [.1, .51]], "cornerVisibility": ["visible", "visible", "occluded", "visible"], "orientationKnown": True}}})
            self.assertFalse(first["complete"])
            with self.assertRaisesRegex(RuntimeError, "another tab"):
                store.save(key, {"reviewer": "Ahmad", "revision": 0, "targets": {}})
            self.assertEqual(store.export()["frames"], [])
            second = store.save(key, {"reviewer": "Ahmad", "revision": 1, "targets": dict(first["targets"], **{"1": {"skip": "cut-off"}})})
            self.assertTrue(second["complete"])
            self.assertEqual(len(journal.read_text().splitlines()), 2)
            # A fresh store reloads the latest revision and refuses a foreign journal.
            reloaded = Store(queue, release, journal)
            self.assertEqual(reloaded.saved[key]["revision"], 2)
            foreign = root / "foreign.jsonl"
            foreign.write_text(json.dumps(dict(second, pins={"queueSha256": "0" * 64})) + "\n")
            with self.assertRaisesRegex(ValueError, "different queue"):
                Store(queue, release, foreign)
            sidecar = reloaded.export()
            self.assertEqual(sidecar["canonicalCorpusSha256"], sha256_file(corpus))
            self.assertEqual(len(sidecar["frames"]), 1)
            self.assertEqual([i["sourceAnnotationIndex"] for i in sidecar["frames"][0]["instances"]], [0])
            sidecar_path = root / "labels.json"
            write_json(sidecar_path, sidecar)
            output = root / "release-with-labels"
            summary = build_release(canonical_corpus=corpus, raw_dir=raw, archive_splits={row["archive"]: "train"}, devmode_sessions=[],
                                    output=output, source_archive_aliases=aliases, scene_assignments_path=scenes,
                                    archive_corner_labels_path=sidecar_path)
            self.assertEqual(summary["stats"]["archiveHumanCornerInstances"], 1)
            manifest = load_json(output / "manifest.json")
            record = load_json(output / manifest["records"][0]["path"])
            human = [i for i in record["instances"] if i["corners"][0].get("cornerSource") == "human"]
            self.assertEqual(len(human), 1)
            self.assertEqual(human[0]["sourceAnnotationIndex"], 0)
            self.assertEqual([c["visibility"] for c in human[0]["corners"]], ["visible", "visible", "occluded", "visible"])
            self.assertFalse(any(c.get("coordinateKnown") for c in record["instances"][1]["corners"]))

    def test_http_endpoints_serve_frames_and_reject_cross_origin(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, _, release, queue, _, _, _ = _fixture_release(root)
            store = Store(queue, release, root / "journal.jsonl")
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler(store))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base = f"http://127.0.0.1:{server.server_address[1]}"
                frames = json.loads(urllib.request.urlopen(base + "/api/frames").read())
                self.assertEqual(frames["progress"]["targets"], 2)
                key = frames["frames"][0]["id"]
                frame = json.loads(urllib.request.urlopen(f"{base}/api/frame/{key}").read())
                self.assertEqual(len(frame["instances"]), 2)
                self.assertNotIn("imageFile", frame)
                image = urllib.request.urlopen(f"{base}/image/{key}").read()
                self.assertEqual(sha256_bytes(image), frame["imageSha256"])
                page = urllib.request.urlopen(base + "/").read().decode()
                self.assertIn("labeler.js", page)
                body = json.dumps({"reviewer": "Ahmad", "revision": 0, "targets": {"0": {"skip": "unsure"}}}).encode()
                request = urllib.request.Request(f"{base}/api/label/{key}", data=body, method="POST",
                                                 headers={"Content-Type": "application/json", "Origin": "http://evil.example"})
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(request)
                self.assertEqual(caught.exception.code, 403)
                request = urllib.request.Request(f"{base}/api/label/{key}", data=body, method="POST",
                                                 headers={"Content-Type": "application/json"})
                saved = json.loads(urllib.request.urlopen(request).read())
                self.assertEqual(saved["revision"], 1)
                self.assertEqual(Counter(t.get("skip") for t in saved["targets"].values())["unsure"], 1)
            finally:
                server.shutdown()


if __name__ == "__main__":
    unittest.main()
