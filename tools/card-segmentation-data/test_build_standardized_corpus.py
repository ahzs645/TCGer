#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("build_standardized_corpus.py")
SPEC = importlib.util.spec_from_file_location("build_standardized_corpus", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def coco(images, annotations, categories):
    return {"images": images, "annotations": annotations, "categories": categories}


def write_archive(path: Path, splits: dict[str, dict], image_bytes: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for split, payload in splits.items():
            archive.writestr(f"{split}/_annotations.coco.json", json.dumps(payload))
            for image in payload["images"]:
                archive.writestr(f"{split}/{image['file_name']}", image_bytes[image["file_name"]])


class StandardizedCorpusTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.raw = self.root / "raw"
        self.raw.mkdir()
        self.out = self.root / "out"
        self.config = self.root / "config.json"

    def tearDown(self):
        self.temporary.cleanup()

    def write_config(self, include_unknown=False, shared_origin=False):
        source_a_categories = {"card-mask": "card", "inner": "inner_border"}
        if include_unknown:
            source_a_categories.pop("inner")
        seg_source = {
            "name": "seg-source",
            "archive": "seg.zip",
            "task": "instance-segmentation",
            "license": "CC BY 4.0",
            "categories": source_a_categories,
        }
        box_source = {
            "name": "box-source",
            "archive": "box.zip",
            "task": "object-detection",
            "license": "MIT",
            "categories": {"card": "card", "unused": None},
        }
        if shared_origin:
            seg_source["originNamespace"] = "shared-origin"
            box_source["originNamespace"] = "shared-origin"
        payload = {
            "schemaVersion": 1,
            "canonicalCategories": [
                {"id": 1, "name": "card", "role": "primary"},
                {"id": 2, "name": "inner_border", "role": "auxiliary"},
            ],
            "sources": [seg_source, box_source],
        }
        self.config.write_text(json.dumps(payload))

    def write_fixtures(self, box_name="same.jpg", box_bytes=b"representative-image"):
        seg_categories = [
            {"id": 1, "name": "card-mask"},
            {"id": 2, "name": "inner"},
        ]
        train_image = {"id": 1, "file_name": "photo.rf.aaaa.jpg", "width": 100, "height": 140}
        validation_image = {"id": 2, "file_name": "photo.rf.bbbb.jpg", "width": 100, "height": 140}
        polygon = [10, 10, 90, 10, 90, 130, 10, 130]
        inner = [15, 15, 85, 15, 85, 125, 15, 125]
        write_archive(
            self.raw / "seg.zip",
            {
                "train": coco(
                    [train_image],
                    [
                        {"id": 1, "image_id": 1, "category_id": 1, "bbox": [10, 10, 80, 120], "area": 9600, "segmentation": [polygon]},
                        {"id": 2, "image_id": 1, "category_id": 2, "bbox": [15, 15, 70, 110], "area": 7700, "segmentation": [inner]},
                    ],
                    seg_categories,
                ),
                "valid": coco(
                    [validation_image],
                    [{"id": 3, "image_id": 2, "category_id": 1, "bbox": [11, 11, 78, 118], "area": 9204, "segmentation": [polygon]}],
                    seg_categories,
                ),
            },
            {
                "photo.rf.aaaa.jpg": b"representative-image",
                "photo.rf.bbbb.jpg": b"augmented-image",
            },
        )
        write_archive(
            self.raw / "box.zip",
            {
                "test": coco(
                    [{"id": 9, "file_name": box_name, "width": 100, "height": 140}],
                    [{"id": 9, "image_id": 9, "category_id": 1, "bbox": [10, 10, 80, 120], "area": 9600}],
                    [{"id": 0, "name": "unused"}, {"id": 1, "name": "card"}],
                )
            },
            {box_name: box_bytes},
        )

    def test_representative_policy_merges_forks_and_prefers_polygon(self):
        self.write_config()
        self.write_fixtures()
        report = MODULE.compile_corpus(self.raw, self.config, self.out)
        self.assertEqual(report["candidateImages"], 3)
        self.assertEqual(report["augmentationDeduplication"]["dropped"], 1)
        self.assertEqual(report["canonicalImages"], 1)
        self.assertEqual(report["exactDeduplication"]["exactDuplicateCandidatesMerged"], 1)
        self.assertEqual(report["evaluationEligibleCardMasks"], 1)
        rows = [json.loads(line) for line in (self.out / "corpus.jsonl").read_text().splitlines()]
        self.assertEqual(len(rows), 1)
        card = next(annotation for annotation in rows[0]["annotations"] if annotation["category"] == "card")
        self.assertEqual(card["geometryQuality"], "source-polygon")
        self.assertEqual(len(card["provenance"]), 2)
        self.assertTrue(rows[0]["imageUri"].startswith("zip://"))

    def test_all_policy_keeps_augmentation_siblings_in_one_split(self):
        self.write_config()
        self.write_fixtures()
        report = MODULE.compile_corpus(
            self.raw,
            self.config,
            self.out,
            augmentation_policy="all",
        )
        self.assertEqual(report["canonicalImages"], 2)
        rows = [json.loads(line) for line in (self.out / "corpus.jsonl").read_text().splitlines()]
        self.assertEqual(len({row["groupId"] for row in rows}), 1)
        self.assertEqual(len({row["split"] for row in rows}), 1)

    def test_annotated_unmapped_categories_fail_closed(self):
        self.write_config(include_unknown=True)
        self.write_fixtures()
        with self.assertRaisesRegex(ValueError, "annotated unmapped categories: inner"):
            MODULE.compile_corpus(self.raw, self.config, self.out)

    def test_materialized_images_are_hash_verified(self):
        self.write_config()
        self.write_fixtures()
        MODULE.compile_corpus(self.raw, self.config, self.out, materialize=True)
        row = json.loads((self.out / "corpus.jsonl").read_text().splitlines()[0])
        materialized = self.out / row["imageUri"]
        self.assertEqual(materialized.read_bytes(), b"representative-image")
        coco = json.loads((self.out / "coco" / f"{row['split']}.json").read_text())
        self.assertEqual(coco["images"][0]["file_name"], materialized.name)

    def test_fork_namespace_links_splits_without_discarding_each_sources_labels(self):
        self.write_config(shared_origin=True)
        self.write_fixtures(box_name="photo.jpg", box_bytes=b"independently-encoded-fork-image")
        report = MODULE.compile_corpus(self.raw, self.config, self.out)
        self.assertEqual(report["canonicalImages"], 2)
        rows = [json.loads(line) for line in (self.out / "corpus.jsonl").read_text().splitlines()]
        self.assertEqual(len({row["groupId"] for row in rows}), 1)
        self.assertEqual(len({row["split"] for row in rows}), 1)

    def test_verification_manifest_must_cover_every_configured_archive(self):
        self.write_config()
        self.write_fixtures()
        inventory = self.root / "manifest.json"
        inventory.write_text(json.dumps({"datasets": []}))
        with self.assertRaisesRegex(ValueError, "archive is absent from verification manifest"):
            MODULE.compile_corpus(
                self.raw,
                self.config,
                self.out,
                archive_manifest=inventory,
            )


if __name__ == "__main__":
    unittest.main()
