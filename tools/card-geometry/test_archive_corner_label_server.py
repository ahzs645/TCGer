import json
import copy
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

from archive_corner_label_server import Store, handler, validate_save, image_color_mode  # noqa: E402
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
    def test_layers_persist_for_separate_cards_and_round_trip_into_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, release, queue, aliases, scenes, row = _fixture_release(root)
            journal = root / "journal.jsonl"
            store = Store(queue, release, journal)
            key = store.order[0]
            targets = {"0": {"corners": [[.1,.1],[.4,.1],[.4,.52],[.1,.52]], "cornerSource": "human"},
                       "1": {"corners": [[.55,.1],[.85,.1],[.85,.52],[.55,.52]], "cornerSource": "human"}}
            payload = {"reviewer": "Ahmad", "revision": 0, "targets": targets, "occlusionRelations": [{"above": 0, "below": 1}]}
            first = store.save(key, payload)
            self.assertEqual(first["occlusionRelations"], payload["occlusionRelations"])
            self.assertEqual(first["targets"]["0"]["corners"], targets["0"]["corners"])
            store = Store(queue, release, journal)
            # A legacy client cannot erase layers by omitting the new field.
            second = store.save(key, {"reviewer": "Ahmad", "revision": 1, "targets": targets})
            self.assertEqual(second["occlusionRelations"], first["occlusionRelations"])
            before = journal.read_bytes()
            for relations in ([{"above":0,"below":0}], [{"above":0,"below":2}],
                              [{"above":True,"below":1}], [{"above":0,"below":1}]*2,
                              [{"above":0,"below":1},{"above":1,"below":0}]):
                with self.assertRaises(ValueError):
                    store.save(key, dict(payload, revision=2, occlusionRelations=relations))
            self.assertEqual(journal.read_bytes(), before)
            # A saved corner draft can keep its layer; the whole frame stays out of export.
            draft = dict(copy.deepcopy(first["targets"]["0"]), status="edited")
            third = store.save(key, {"reviewer": "Ahmad", "revision": 2, "targets": {"1": targets["1"]}, "drafts": {"0": draft}})
            self.assertEqual(third["occlusionRelations"], first["occlusionRelations"])
            self.assertEqual(store.export()["frames"], [])
            store.save(key, dict(payload, revision=3, drafts={}))
            sidecar = store.export()
            self.assertEqual(sidecar["frames"][0]["occlusionRelations"], payload["occlusionRelations"])
            sidecar_path = root / "layers.json"
            write_json(sidecar_path, sidecar)
            output = root / "release-with-layers"
            summary = build_release(canonical_corpus=corpus, raw_dir=raw, archive_splits={row["archive"]: "train"}, devmode_sessions=[],
                                    output=output, source_archive_aliases=aliases, scene_assignments_path=scenes,
                                    archive_corner_labels_path=sidecar_path)
            self.assertEqual(summary["stats"]["archiveHumanLayerRelations"], 1)
            manifest = load_json(output / "manifest.json")
            record = load_json(output / manifest["records"][0]["path"])
            a, b = record["instances"]
            self.assertEqual([a["sourceAnnotationIndex"], b["sourceAnnotationIndex"]], [0,1])
            self.assertEqual(b["cardsAbove"], [a["instanceId"]])
            self.assertGreater(a["occlusionOrder"], b["occlusionOrder"])
            # Clearing layers is explicit, and skipping a related card cannot silently break references.
            with self.assertRaises(ValueError):
                store.save(key, {"reviewer":"Ahmad", "revision":4, "targets":{"0":targets["0"],"1":{"skip":"occluded"}}})
            final = store.save(key, {"reviewer":"Ahmad", "revision":4, "targets":{"0":targets["0"],"1":{"skip":"occluded"}}, "occlusionRelations":[]})
            self.assertEqual(final["occlusionRelations"], [])

    def test_save_preserves_drafts_and_blocks_omitted_saved_cards(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, _, release, queue, _, _, _ = _fixture_release(root)
            journal = root / "journal.jsonl"
            store = Store(queue, release, journal)
            key = store.order[0]
            quad = [[.1, .1], [.4, .1], [.4, .52], [.1, .52]]
            first = store.save(key, {"reviewer": "bot", "revision": 0, "targets": {
                "0": {"corners": quad, "cornerSource": "detector"}, "1": {"skip": "unsure"}}})
            before = journal.read_bytes()
            with self.assertRaisesRegex(ValueError, "remove existing cards"):
                store.save(key, {"reviewer": "Ahmad", "revision": 1, "targets": {"1": {"skip": "unsure"}}})
            self.assertEqual(journal.read_bytes(), before)
            edited = dict(copy.deepcopy(first["targets"]["0"]), status="edited")
            edited["corners"][0] = [.12, .11]
            second = store.save(key, {"reviewer": "Ahmad", "revision": 1,
                                      "targets": {"1": {"skip": "unsure"}}, "drafts": {"0": edited}})
            self.assertEqual(second["targets"]["0"], first["targets"]["0"])
            self.assertEqual(second["drafts"]["0"], edited)
            self.assertFalse(second["complete"])
            self.assertEqual(store.progress()["targetsLabeled"], 0)
            self.assertEqual(store.progress()["targetsSkipped"], 1)
            self.assertEqual(store.export()["frames"], [])
            store = Store(queue, release, journal)
            self.assertEqual(store.saved[key]["drafts"]["0"], edited)
            with self.assertRaisesRegex(RuntimeError, "another tab"):
                store.save(key, {"reviewer": "Ahmad", "revision": 1, "targets": {}, "drafts": {"0": edited}})
            with self.assertRaisesRegex(ValueError, "saved drafts"):
                store.save(key, {"reviewer": "Ahmad", "revision": 2, "targets": {"1": {"skip": "unsure"}}})
            with self.assertRaisesRegex(ValueError, "saved drafts"):
                store.save(key, {"reviewer": "old browser", "revision": 2, "targets": first["targets"]})
            with self.assertRaisesRegex(ValueError, "remove existing cards"):
                store.save(key, {"reviewer": "Ahmad", "revision": 2, "targets": {"1": {"skip": "unsure"}}, "drafts": {}})
            confirmed = dict(edited, status="confirmed", cornerSource="human")
            third = store.save(key, {"reviewer": "Ahmad", "revision": 2, "targets": {
                "0": confirmed, "1": {"skip": "unsure"}}, "drafts": {}})
            self.assertTrue(third["complete"])
            self.assertEqual(third["drafts"], {})
            self.assertEqual(store.export()["frames"][0]["instances"][0]["corners"], edited["corners"])
            self.assertEqual(store.export()["frames"][0]["instances"][0]["cornerSource"], "human")

    def test_unfinished_geometry_is_retained_but_cannot_be_exported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, _, release, queue, _, _, _ = _fixture_release(root)
            store = Store(queue, release, root / "journal.jsonl")
            key = store.order[0]
            draft = {"corners": [[.1, .1], [.4, .52], [.4, .1], [.1, .52]], "status": "edited",
                     "cornerVisibility": ["visible"] * 4, "orientationKnown": True}
            row = store.save(key, {"reviewer": "Ahmad", "revision": 0, "targets": {}, "drafts": {"0": draft}})
            self.assertEqual(row["drafts"]["0"]["corners"], draft["corners"])
            self.assertEqual(store.export()["frames"], [])
            with self.assertRaises(ValueError):
                store.save(key, {"reviewer": "Ahmad", "revision": 1, "targets": {"0": dict(draft, status="confirmed")}})
            with self.assertRaisesRegex(ValueError, "queued target"):
                store.save(key, {"reviewer": "Ahmad", "revision": 1, "targets": {}, "drafts": {"999": draft}})
            with self.assertRaisesRegex(ValueError, "finite corners"):
                store.save(key, {"reviewer": "Ahmad", "revision": 1, "targets": {}, "drafts": {"0": dict(draft, corners=[[float('nan'), 0]] * 4)}})

    def test_browser_draft_backup_preserves_raw_edits_without_changing_labels(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, _, release, queue, _, _, _ = _fixture_release(root)
            store = Store(queue, release, root / "journal.jsonl")
            raw = '{"revision":0,"targets":{"0":{"status":"edited"}}}'
            response = store.backup_browser_drafts({"drafts": {store.order[0]: raw}})
            backup = json.loads(Path(response["backupFile"]).read_text())
            self.assertEqual(backup["drafts"][store.order[0]], raw)
            self.assertEqual(backup["pins"], store.pins)
            self.assertFalse(store.journal.exists())
            with self.assertRaises(ValueError):
                store.backup_browser_drafts({"drafts": {"unknown-frame": raw}})

    def test_color_filter_classifies_pixels_without_changing_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name, rgb, expected in [("gray", (70, 70, 70), "grayscale"), ("color", (90, 60, 30), "color")]:
                image = Path(tmp) / (name + ".png")
                image.write_bytes(tiny_png(30, 30, rgb))
                before = sha256_file(image)
                self.assertEqual(image_color_mode(image), expected)
                self.assertEqual(sha256_file(image), before)

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
        # A blank name falls back to the server default so the field is not a per-page chore.
        self.assertEqual(validate_save(frame, {"reviewer": "", "targets": {}}, "ahmadjalil")["reviewer"], "ahmadjalil")
        self.assertEqual(validate_save(frame, {"targets": {}}, "ahmadjalil")["reviewer"], "ahmadjalil")
        self.assertEqual(validate_save(frame, {"reviewer": " Ahmad ", "targets": {}}, "ahmadjalil")["reviewer"], "Ahmad")
        partial = validate_save(frame, {"reviewer": "A", "targets": {}})
        self.assertFalse(partial["complete"])
        skipped = validate_save(frame, {"reviewer": "A", "targets": {"0": {"skip": "cut-off"}}})
        self.assertTrue(skipped["complete"])

    def test_label_winding_status_skip_reason_and_direction_contract(self):
        frame = {"instances": [{"sourceAnnotationIndex": 0, "seedBox": {"left": .1, "top": .1, "right": .4, "bottom": .52}}]}
        base = [[.1, .1], [.4, .1], [.4, .52], [.1, .52]]
        for turn in range(4):
            quad = base[turn:] + base[:turn]
            body = validate_save(frame, {"reviewer": "A", "targets": {"0": {"corners": quad, "status": "confirmed"}}, "direction": turn})
            self.assertTrue(body["complete"])
        with self.assertRaisesRegex(ValueError, "ordered TL, TR, BR, BL"):
            validate_save(frame, {"reviewer": "A", "targets": {"0": {"corners": base[::-1]}}})
        for status in ("seeded", "edited"):
            with self.assertRaisesRegex(ValueError, "confirmed"):
                validate_save(frame, {"reviewer": "A", "targets": {"0": {"corners": base, "status": status}}})
        # Legacy statusless labels remain accepted, while direction is strict
        # about JSON booleans/floats that compare equal to integers in Python.
        validate_save(frame, {"reviewer": "A", "targets": {"0": {"corners": base}}})
        for direction in (True, 1.0, "1", 4):
            with self.assertRaisesRegex(ValueError, "direction"):
                validate_save(frame, {"reviewer": "A", "targets": {"0": {"corners": base}}, "direction": direction})
        skipped = validate_save(frame, {"reviewer": "A", "targets": {"0": {"skip": "reflected-padding"}}})
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
            second = store.save(key, {"reviewer": "Ahmad", "revision": 1, "targets": dict(first["targets"], **{"1": {"skip": "reflected-padding"}})})
            self.assertTrue(second["complete"])
            self.assertEqual(second["targets"]["1"], {"skip": "reflected-padding"})
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
                server.server_close()

    def test_bot_provenance_survives_legacy_resave_export_and_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, release, queue, aliases, scenes, row = _fixture_release(root)
            store = Store(queue, release, root / "journal.jsonl")
            key = store.order[0]
            target = {"corners": [[.1, .1], [.4, .1], [.4, .52], [.1, .52]], "cornerSource": "detector"}
            first = store.save(key, {"reviewer": "Luna bot review", "revision": 0,
                                    "targets": {"0": target, "1": {"skip": "unsure"}}})
            self.assertEqual(first["targets"]["0"]["cornerSource"], "detector")
            legacy = {k: v for k, v in first["targets"]["0"].items() if k != "cornerSource"}
            second = store.save(key, {"reviewer": "Ahmad", "revision": 1,
                                     "targets": {"0": legacy, "1": {"skip": "unsure"}}})
            self.assertEqual(second["targets"]["0"]["cornerSource"], "detector")
            reloaded = Store(queue, release, root / "journal.jsonl")
            sidecar = reloaded.export()
            self.assertEqual(sidecar["frames"][0]["instances"][0]["cornerSource"], "detector")
            sidecar_path = root / "labels.json"
            write_json(sidecar_path, sidecar)
            output = root / "release-with-bot-labels"
            summary = build_release(canonical_corpus=corpus, raw_dir=raw, archive_splits={row["archive"]: "train"},
                                    devmode_sessions=[], output=output, source_archive_aliases=aliases,
                                    scene_assignments_path=scenes, archive_corner_labels_path=sidecar_path)
            self.assertEqual(summary["stats"]["archiveBotCornerInstances"], 1)
            self.assertEqual(summary["stats"].get("archiveHumanCornerInstances", 0), 0)
            self.assertEqual(summary["stats"].get("archiveHumanCornerRecords", 0), 0)
            manifest = load_json(output / "manifest.json")
            record = load_json(output / manifest["records"][0]["path"])
            self.assertTrue(all(c["cornerSource"] == "detector" for c in record["instances"][0]["corners"]))
            # Explicit human confirmation upgrades provenance; legacy omissions do not.
            third = reloaded.save(key, {"reviewer": "Ahmad", "revision": 2,
                                       "targets": {"0": dict(legacy, cornerSource="human"), "1": {"skip": "unsure"}}})
            self.assertEqual(third["targets"]["0"]["cornerSource"], "human")
            with self.assertRaisesRegex(ValueError, "cornerSource"):
                reloaded.save(key, {"reviewer": "A", "revision": 3,
                                    "targets": {"0": dict(target, cornerSource="unknown")}})


if __name__ == "__main__":
    unittest.main()
