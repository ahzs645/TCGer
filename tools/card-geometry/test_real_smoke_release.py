import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from build_fixture_releases import tiny_png  # noqa: E402
from build_real_smoke_release import (  # noqa: E402
    _apply_archive_corner_labels,
    build_release,
    add_canonical_archive,
    conservative_mask_quad,
    load_category_contract,
    target_semantics,
)
from corpus_release import load_json, sha256_bytes  # noqa: E402
from preflight import Expectations, run_preflight  # noqa: E402


class MaskFitTests(unittest.TestCase):
    def test_conservative_fit_requires_all_four_quality_gates(self):
        accepted, reason = conservative_mask_quad([(2, 1), (8, 1), (8, 9), (2, 9)])
        self.assertEqual(reason, "accepted")
        self.assertEqual(len(accepted or []), 4)

        self.assertEqual(
            conservative_mask_quad([(2, 1), (8, 1), (8, 9), (5, 8), (2, 9)])[1],
            "residual",
        )
        self.assertEqual(
            conservative_mask_quad([(1, 1), (9, 1), (2, 2), (1, 9)])[1],
            "convexity",
        )
        self.assertEqual(
            conservative_mask_quad([(1, 1), (9, 1), (9, 9), (1, 9)])[1],
            "aspect",
        )


class RealReleaseAdapterTests(unittest.TestCase):
    def test_archive_corner_import_rejects_reversed_winding(self):
        row = {"id": "frame", "sha256": "image"}
        instances = [{
            "sourceAnnotationIndex": 0,
            "box": {"left": .1, "top": .1, "right": .4, "bottom": .5},
        }]
        frame = {
            "imageSha256": "image",
            "instances": [{
                "sourceAnnotationIndex": 0,
                # Same convex outline, but counter-clockwise in image space.
                "corners": [[.1, .1], [.1, .5], [.4, .5], [.4, .1]],
                "cornerVisibility": ["visible"] * 4,
                "orientationKnown": False,
            }],
        }
        with self.assertRaisesRegex(ValueError, "clockwise TL,TR,BR,BL"):
            _apply_archive_corner_labels(row, instances, frame, Counter())

    def test_archive_corner_import_keeps_cyclic_and_out_of_frame_quad(self):
        row = {"id": "frame", "sha256": "image"}
        instances = [{
            "sourceAnnotationIndex": 0,
            "box": {"left": .1, "top": .1, "right": .4, "bottom": 1.0},
        }]
        frame = {
            "imageSha256": "image",
            "instances": [{
                "sourceAnnotationIndex": 0,
                # A cyclic TL/TR/BR/BL rotation with the bottom edge outside.
                "corners": [[.4, .1], [.4, 1.1], [.1, 1.1], [.1, .1]],
                "cornerVisibility": ["visible", "outsideFrame", "outsideFrame", "visible"],
                "orientationKnown": False,
            }],
        }
        _apply_archive_corner_labels(row, instances, frame, Counter())
        self.assertEqual(instances[0]["corners"][0]["point"], {"x": .4, "y": .1})

    def _canonical_source(self, root: Path) -> tuple[Path, Path, bytes]:
        raw = root / "raw"
        raw.mkdir()
        image = tiny_png(10, 10, (20, 40, 60))
        archive_name = "annotations.v7i.coco-segmentation.zip"
        member = "train/card.png"
        with zipfile.ZipFile(raw / archive_name, "w") as archive:
            archive.writestr(member, image)
        row = {
            "id": sha256_bytes(image),
            "sha256": sha256_bytes(image),
            "archive": archive_name,
            "imageMember": member,
            "width": 10,
            "height": 10,
            # This inherited split must not survive the whole-archive mapping.
            "split": "train",
            "provenance": [{"source": "tcgx-annotations", "license": "CC BY 4.0"}],
            "annotations": [
                {
                    "category": "card",
                    "geometryQuality": "source-polygon",
                    "segmentation": [[2, 1, 8, 1, 8, 9, 2, 9, 2, 1]],
                    "provenance": ["tcgx-annotations:Pokemon_Card:1"],
                },
                {
                    "category": "card",
                    "geometryQuality": "bbox-derived",
                    "segmentation": [[0, 0, 10, 0, 10, 10, 0, 10]],
                    "provenance": ["tcgx-annotations:Pokemon_Card:2"],
                },
            ],
        }
        corpus = root / "corpus.jsonl"
        corpus.write_text(json.dumps(row) + "\n", encoding="utf-8")
        return corpus, raw, image

    def test_missing_box_drops_entire_mixed_source_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, _ = self._canonical_source(root)
            row = json.loads(corpus.read_text())
            row["annotations"].append({"category": "card", "geometryQuality": "bbox-derived"})
            stats = Counter()
            entries = add_canonical_archive(root=root / "output", rows=[row],
                archive_path=raw / row["archive"], split="train", stats=stats)
            self.assertEqual(entries, [])
            self.assertEqual(stats["recordsExcludedMissingBox"], 1)

    def test_coco_masks_build_a_test_only_smoke_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, _ = self._canonical_source(root)
            output = root / "release"
            summary = build_release(
                canonical_corpus=corpus,
                raw_dir=raw,
                archive_splits={"annotations.v7i.coco-segmentation.zip": "test"},
                devmode_sessions=[],
                output=output,
            )
            manifest = load_json(output / "manifest.json")
            record = load_json(output / manifest["records"][0]["path"])

            self.assertEqual(manifest["releasePurpose"], "smoke")
            self.assertEqual({item["split"] for item in manifest["records"]}, {"test"})
            self.assertEqual(len(record["instances"]), 2)
            self.assertEqual(record["instances"][0]["visibleMask"]["kind"], "polygon")
            self.assertEqual(
                {
                    corner["cornerSource"]
                    for corner in record["instances"][0]["corners"]
                },
                {"maskFit"},
            )
            self.assertEqual(summary["stats"]["maskFit:box-only"], 1)
            self.assertFalse(any(c["coordinateKnown"] for c in record["instances"][1]["corners"]))
            self.assertNotIn("visibleMask", record["instances"][1])
            self.assertEqual(record["instances"][1]["box"], {"left": 0, "top": 0, "right": 1, "bottom": 1})

            report = run_preflight(
                output,
                expectations=Expectations(
                    policy_sha256=manifest["readiness"]["readinessPolicySha256"],
                    policy_id="real-ingestion-smoke-v1",
                    purpose="smoke",
                ),
                tooling_revision="test",
            )
            self.assertEqual(report["failedChecks"], [])
            self.assertEqual(report["readyFor"], "tooling")
            self.assertEqual(
                report["cornerCounts"]["bySourceKind"]["real"]["metricExcluded"],
                4,
            )

    def test_canonical_adapter_rejects_non_shippable_license(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, _ = self._canonical_source(root)
            row = json.loads(corpus.read_text())
            row["provenance"][0]["license"] = "research-only"
            corpus.write_text(json.dumps(row) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "no single shippable license"):
                build_release(
                    canonical_corpus=corpus,
                    raw_dir=raw,
                    archive_splits={"annotations.v7i.coco-segmentation.zip": "train"},
                    devmode_sessions=[],
                    output=root / "release",
                )

    def test_new_export_requires_an_explicit_canonical_mapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, _ = self._canonical_source(root)
            row = json.loads(corpus.read_text())
            archive_name = "tcgx-reexport.zip"
            (raw / row["archive"]).rename(raw / archive_name)
            row["archive"] = archive_name
            corpus.write_text(json.dumps(row) + "\n")
            args = dict(
                canonical_corpus=corpus, raw_dir=raw,
                archive_splits={archive_name: "test"}, devmode_sessions=[],
                output=root / "release",
            )
            with self.assertRaisesRegex(ValueError, "unmapped sourceArchiveId"):
                build_release(**args)
            aliases = {
                "coco:tcgx-reexport": "tcgx",
                "tcgx": "tcgx",
            }
            build_release(**args, source_archive_aliases=aliases)
            manifest = load_json(args["output"] / "manifest.json")
            self.assertEqual(manifest["sourceArchiveAliases"], aliases)
            self.assertEqual(manifest["records"][0]["leakageKeys"]["sourceArchiveId"], "tcgx")
            self.assertEqual(run_preflight(args["output"])["failedChecks"], [])

    def test_devmode_fixed_quad_provenance_controls_metric_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, image = self._canonical_source(root)
            session = root / "scan-session-20260902-010203"
            session.mkdir()
            (session / "frame.png").write_bytes(image)
            (session / "results.json").write_text(
                json.dumps(
                    {
                        "frames": [
                            {
                                "imageFile": "frame.png",
                                "fixedQuad": [
                                    {"x": 0.2, "y": 0.1},
                                    {"x": 0.8, "y": 0.1},
                                    {"x": 0.8, "y": 0.9},
                                    {"x": 0.2, "y": 0.9},
                                ],
                                "fixedQuadSource": "selected-alt-detector",
                            },
                            {
                                "imageFile": "frame.png",
                                "fixedQuad": [
                                    {"x": 0.2, "y": 0.1},
                                    {"x": 0.8, "y": 0.1},
                                    {"x": 0.8, "y": 0.9},
                                    {"x": 0.2, "y": 0.9},
                                ],
                                "fixedQuadSource": "manual",
                            },
                            {
                                "imageFile": "frame.png",
                                "fixedQuad": [
                                    {"x": 0.2, "y": 0.1},
                                    {"x": 0.8, "y": 0.1},
                                    {"x": 0.8, "y": 0.9},
                                    {"x": 0.2, "y": 0.9},
                                ],
                            },
                            {"imageFile": "frame.png", "expectedCardId": "replay-only"},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            output = root / "release"
            summary = build_release(
                canonical_corpus=corpus,
                raw_dir=raw,
                archive_splits={"annotations.v7i.coco-segmentation.zip": "test"},
                devmode_sessions=[session],
                output=output,
            )
            manifest = load_json(output / "manifest.json")
            self.assertEqual(manifest["evaluationSessionDenylist"], [session.name])
            dev_entries = [
                item
                for item in manifest["records"]
                if item["recordId"].startswith("devmode-")
            ]
            self.assertEqual(len(dev_entries), 2)
            records = [load_json(output / item["path"]) for item in dev_entries]
            self.assertEqual(
                [
                    {
                        corner["cornerSource"]
                        for corner in record["instances"][0]["corners"]
                    }
                    for record in records
                ],
                [{"detector"}, {"human"}],
            )
            self.assertEqual(
                [record["instances"][0]["orientationKnown"] for record in records],
                [False, True],
            )
            self.assertTrue(
                all(
                    "physicalCardId" not in record["instances"][0] for record in records
                )
            )
            self.assertEqual(summary["stats"]["devmodeCornerSource:detector"], 1)
            self.assertEqual(summary["stats"]["devmodeCornerSource:human"], 1)
            self.assertEqual(
                summary["stats"]["devmodeFixedQuadSkippedUnknownSource"], 1
            )
            report = run_preflight(output, tooling_revision="test")
            self.assertEqual(report["failedChecks"], [])
            real_counts = report["cornerCounts"]["bySourceKind"]["real"]
            self.assertEqual(real_counts["metricEligible"], 4)
            self.assertEqual(real_counts["metricExcluded"], 8)

    def test_manual_fiftyone_backup_ingests_without_rewriting_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, image = self._canonical_source(root)
            sessions_root = root / "sessions"
            session = sessions_root / "scan-session-20260902-020304"
            session.mkdir(parents=True)
            (session / "frame.png").write_bytes(image)
            backup = root / "labels.json"
            backup.write_text(
                json.dumps(
                    [
                        {
                            "key": f"{session.name}/frame.png",
                            "fixed_quad_json": json.dumps(
                                [
                                    [-0.1, 0.1],
                                    [0.8, 0.1],
                                    [0.8, 0.9],
                                    [0.2, 0.9],
                                ]
                            ),
                            "fixed_quad_source": "manual",
                        },
                        {
                            "key": f"{session.name}/frame.png",
                            "fixed_quad_json": json.dumps(
                                [
                                    [0.2, 0.1],
                                    [0.8, 0.1],
                                    [0.8, 0.9],
                                    [0.2, 0.9],
                                ]
                            ),
                            "fixed_quad_source": "webobb+sam 1.00",
                        },
                    ]
                ),
                encoding="utf-8",
            )
            output = root / "release"
            summary = build_release(
                canonical_corpus=corpus,
                raw_dir=raw,
                archive_splits={"annotations.v7i.coco-segmentation.zip": "test"},
                devmode_sessions=[],
                output=output,
                devmode_label_backups=[backup],
                devmode_sessions_root=sessions_root,
                release_id="real-geometry-devmode-smoke-v2",
            )
            manifest = load_json(output / "manifest.json")
            self.assertEqual(manifest["releaseId"], "real-geometry-devmode-smoke-v2")
            self.assertEqual(manifest["evaluationSessionDenylist"], [session.name])
            dev_entries = [
                item
                for item in manifest["records"]
                if item["recordId"].startswith("devmode-")
            ]
            self.assertEqual(len(dev_entries), 1)
            record = load_json(output / dev_entries[0]["path"])
            self.assertEqual(
                {
                    corner["cornerSource"]
                    for corner in record["instances"][0]["corners"]
                },
                {"human"},
            )
            self.assertTrue(record["instances"][0]["orientationKnown"])
            self.assertEqual(
                [corner["visibility"] for corner in record["instances"][0]["corners"]],
                ["outsideFrame", "visible", "visible", "visible"],
            )
            self.assertEqual(summary["stats"]["devmodeBackupManualRecords"], 1)
            self.assertEqual(summary["stats"]["devmodeOutsideFrameCorners"], 1)
            self.assertEqual(
                summary["devmodeLabelBackups"][0]["sha256"],
                sha256_bytes(backup.read_bytes()),
            )
            report = run_preflight(output, tooling_revision="test")
            self.assertEqual(report["failedChecks"], [])
            real_counts = report["cornerCounts"]["bySourceKind"]["real"]
            self.assertEqual(real_counts["metricEligible"], 4)
            self.assertEqual(real_counts["metricExcluded"], 4)

    def test_known_forks_cannot_be_assigned_to_different_splits(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "known fork archives"):
                build_release(
                    canonical_corpus=Path(tmp) / "unused.jsonl",
                    raw_dir=Path(tmp),
                    archive_splits={
                        "card-seg-j74w1.v3i.coco-segmentation.zip": "train",
                        "card-seg-j74w1-q8yst.v1i.coco-segmentation.zip": "test",
                    },
                    devmode_sessions=[],
                    output=Path(tmp) / "release",
                )

    def test_manual_multi_instance_sidecar_ingests_all_cards(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, image = self._canonical_source(root)
            sessions_root = root / "sessions"
            session = sessions_root / "scan-session-20260902-binder"
            session.mkdir(parents=True)
            (session / "frame.png").write_bytes(image)
            labels = root / "multi.json"
            labels.write_text(
                json.dumps(
                    {
                        "schema": "https://tcger.app/schemas/card-geometry-manual-multi-instance-labels/v1",
                        "frames": [
                            {
                                "key": f"{session.name}/frame.png",
                                "sceneSlice": "binder_page",
                                "game": "pokemon",
                                "instances": [
                                    {
                                        "instanceId": f"card-{index}",
                                        "physicalCardId": f"binder-card-{index}",
                                        "corners": [
                                            [0.05 + (index % 3) * 0.31, 0.05 + (index // 3) * 0.31],
                                            [0.30 + (index % 3) * 0.31, 0.05 + (index // 3) * 0.31],
                                            [0.30 + (index % 3) * 0.31, 0.30 + (index // 3) * 0.31],
                                            [0.05 + (index % 3) * 0.31, 0.30 + (index // 3) * 0.31],
                                        ],
                                        "cornerVisibility": [
                                            "occluded" if index == 8 else "visible",
                                            "visible",
                                            "visible",
                                            "visible",
                                        ],
                                        "occlusionOrder": index,
                                        "orientationKnown": True,
                                        "side": "faceDown" if index == 8 else "faceUp",
                                    }
                                    for index in range(9)
                                ],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            output = root / "release"
            summary = build_release(
                canonical_corpus=corpus,
                raw_dir=raw,
                archive_splits={"annotations.v7i.coco-segmentation.zip": "test"},
                devmode_sessions=[],
                output=output,
                devmode_sessions_root=sessions_root,
                multi_instance_label_files=[labels],
            )
            manifest = load_json(output / "manifest.json")
            entry = next(
                item for item in manifest["records"] if item["recordId"].startswith("devmode-multi-")
            )
            record = load_json(output / entry["path"])
            self.assertEqual(entry["sceneSlice"], "binder_page")
            self.assertEqual(len(record["instances"]), 9)
            self.assertEqual(
                {corner["cornerSource"] for item in record["instances"] for corner in item["corners"]},
                {"human"},
            )
            self.assertEqual(record["instances"][-1]["side"], "faceDown")
            self.assertEqual(
                record["instances"][-1]["corners"][0]["visibility"], "occluded"
            )
            self.assertEqual(record["instances"][-1]["occlusionOrder"], 8)
            self.assertEqual(summary["stats"]["devmodeMultiInstanceCards"], 9)
            self.assertEqual(summary["instances"], sum(
                len(load_json(output / item["path"])["instances"])
                for item in manifest["records"]
            ))
            self.assertEqual(summary["stats"]["devmodeMultiInstanceFaceDown"], 1)
            self.assertEqual(
                summary["stats"]["devmodeMultiInstanceOccludedCorners"], 1
            )

    def test_fiftyone_backup_carries_saved_multi_card_geometry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, image = self._canonical_source(root)
            sessions_root = root / "sessions"
            session = sessions_root / "scan-session-20260902-binder-backup"
            session.mkdir(parents=True)
            (session / "frame.png").write_bytes(image)
            frame = {
                "key": f"{session.name}/frame.png",
                "sceneSlice": "binder_page",
                "game": "pokemon",
                "instances": [
                    {
                        "instanceId": "card-0",
                        "physicalCardId": "binder-card-0",
                        "corners": [[0.1, 0.1], [0.4, 0.1], [0.4, 0.8], [0.1, 0.8]],
                        "cornerVisibility": ["visible"] * 4,
                        "occlusionOrder": 0,
                        "orientationKnown": True,
                        "side": "faceDown",
                    }
                ],
            }
            backup = root / "labels.json"
            backup.write_text(
                json.dumps(
                    [
                        {
                            "key": frame["key"],
                            "manual_instances_json": json.dumps(frame),
                        }
                    ]
                ),
                encoding="utf-8",
            )
            output = root / "release"
            summary = build_release(
                canonical_corpus=corpus,
                raw_dir=raw,
                archive_splits={"annotations.v7i.coco-segmentation.zip": "test"},
                devmode_sessions=[],
                output=output,
                devmode_label_backups=[backup],
                devmode_sessions_root=sessions_root,
            )
            self.assertEqual(summary["stats"]["devmodeBackupMultiInstanceRecords"], 1)
            manifest = load_json(output / "manifest.json")
            record = load_json(
                output
                / next(
                    entry["path"]
                    for entry in manifest["records"]
                    if entry["recordId"].startswith("devmode-multi-")
                )
            )
            self.assertEqual(record["instances"][0]["side"], "faceDown")

    def test_fiftyone_backup_skips_explicit_no_labelable_card_frame(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, _image = self._canonical_source(root)
            frame = {
                "key": "scan-session-negative/frame.png",
                "sceneSlice": "steep_playmat",
                "game": "magic",
                "instances": [],
                "noLabelableCard": True,
            }
            backup = root / "labels.json"
            backup.write_text(
                json.dumps(
                    [{"key": frame["key"], "manual_instances_json": json.dumps(frame)}]
                ),
                encoding="utf-8",
            )
            output = root / "release"
            summary = build_release(
                canonical_corpus=corpus,
                raw_dir=raw,
                archive_splits={"annotations.v7i.coco-segmentation.zip": "test"},
                devmode_sessions=[],
                output=output,
                devmode_label_backups=[backup],
                devmode_sessions_root=root / "sessions",
            )
            self.assertEqual(
                summary["stats"]["devmodeBackupNoLabelableCardRecords"], 1
            )
            manifest = load_json(output / "manifest.json")
            self.assertFalse(
                any(
                    item["recordId"].startswith("devmode-multi-")
                    for item in manifest["records"]
                )
            )


class CategoryBoundaryTests(unittest.TestCase):
    """Only canonical `card` annotations may become whole-card targets."""

    def _mixed_source(self, root: Path, annotations: list[dict]) -> tuple[Path, Path, dict]:
        raw = root / "raw"
        raw.mkdir(exist_ok=True)
        image = tiny_png(100, 100, (30, 30, 30))
        archive_name = "card-scanner-seg.v3i.coco-segmentation.zip"
        member = "train/slabbed.png"
        with zipfile.ZipFile(raw / archive_name, "w") as archive:
            archive.writestr(member, image)
        row = {
            "id": sha256_bytes(image),
            "sha256": sha256_bytes(image),
            "archive": archive_name,
            "imageMember": member,
            "width": 100,
            "height": 100,
            "provenance": [{"source": "card-scanner-seg", "license": "CC BY 4.0"}],
            "annotations": annotations,
        }
        corpus = root / "corpus.jsonl"
        corpus.write_text(json.dumps(row) + "\n", encoding="utf-8")
        return corpus, raw, row

    @staticmethod
    def _mixed_annotations() -> list[dict]:
        return [
            {
                "category": "slab",
                "geometryQuality": "source-polygon",
                "bbox": [10, 5, 80, 90],
                "segmentation": [[10, 5, 90, 5, 90, 95, 10, 95]],
                "provenance": ["card-scanner-seg:slab:7"],
            },
            {
                "category": "card",
                "geometryQuality": "source-polygon",
                "bbox": [20, 15, 60, 70],
                "segmentation": [[20, 15, 80, 15, 80, 85, 20, 85]],
                "provenance": ["card-scanner-seg:card:8"],
            },
            {
                "category": "title_region",
                "geometryQuality": "bbox-derived",
                "bbox": [22, 17, 56, 8],
                "segmentation": [[22, 17, 78, 17, 78, 25, 22, 25]],
                "provenance": ["card-detector-wmbbb:Name:9"],
            },
            {
                "category": "inner_border",
                "geometryQuality": "source-polygon",
                "bbox": [24, 19, 52, 62],
                "segmentation": [[24, 19, 76, 19, 76, 81, 24, 81]],
                "provenance": ["card-seg-j74w1:inner-border:10"],
            },
        ]

    @staticmethod
    def _aliases() -> dict[str, str]:
        archive_id = "coco:card-scanner-seg.v3i.coco-segmentation"
        return {archive_id: archive_id}

    def _build(self, root: Path, corpus: Path, raw: Path) -> Path:
        output = root / "release"
        build_release(
            canonical_corpus=corpus,
            raw_dir=raw,
            archive_splits={"card-scanner-seg.v3i.coco-segmentation.zip": "train"},
            devmode_sessions=[],
            output=output,
            source_archive_aliases=self._aliases(),
        )
        return output

    def _import(self, root: Path, raw: Path, row: dict) -> tuple[list[dict], Counter]:
        stats = Counter()
        entries = add_canonical_archive(
            root=root / "output", rows=[row], archive_path=raw / row["archive"],
            split="train", stats=stats,
        )
        return entries, stats

    def test_only_the_card_annotation_becomes_a_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, _ = self._mixed_source(root, self._mixed_annotations())
            output = self._build(root, corpus, raw)
            summary = load_json(output / "build-summary.json")
            manifest = load_json(output / "manifest.json")
            record = load_json(output / manifest["records"][0]["path"])
            self.assertEqual(len(record["instances"]), 1)
            instance = record["instances"][0]
            self.assertEqual(instance["instanceId"], "card-0")
            self.assertEqual(instance["occlusionOrder"], 0)
            self.assertEqual(instance["sourceCategory"], "card")
            self.assertEqual(instance["sourceAnnotationIndex"], 1)
            self.assertEqual(instance["sourceProvenance"], ["card-scanner-seg:card:8"])
            # The slab is context: it never becomes a card but does describe the container.
            self.assertEqual(instance["container"], "slab")
            self.assertEqual(
                {corner["cornerSource"] for corner in instance["corners"]}, {"maskFit"}
            )
            self.assertEqual(
                record["source"]["annotationCategories"],
                {"card": 1, "inner_border": 1, "slab": 1, "title_region": 1},
            )
            stats = summary["stats"]
            self.assertEqual(stats["canonicalInstancesRetained"], 1)
            self.assertEqual(stats["annotationsNotTargets:context:slab"], 1)
            self.assertEqual(stats["annotationsNotTargets:auxiliary:title_region"], 1)
            self.assertEqual(stats["annotationsNotTargets:auxiliary:inner_border"], 1)
            self.assertEqual(stats["cardsInsideSlab"], 1)
            self.assertNotIn("recordsWithMultipleCards", stats)
            contract = load_category_contract()
            self.assertEqual(manifest["targetSemantics"], target_semantics(contract))
            self.assertEqual(manifest["targetSemantics"]["primaryCategories"], ["card"])
            self.assertEqual(summary["categoryContract"]["sha256"], contract["sha256"])
            report = run_preflight(output, tooling_revision="test")
            self.assertEqual(report["failedChecks"], [])
            semantics = next(c for c in report["checks"] if c["code"] == "TARGET_SEMANTICS")
            self.assertEqual(semantics["status"], "pass")
            self.assertEqual(semantics["details"]["archiveRecordsChecked"], 1)

    def test_box_only_card_beside_a_slab_keeps_unknown_corners(self):
        annotations = self._mixed_annotations()
        annotations[1] = {**annotations[1], "geometryQuality": "bbox-derived"}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, raw, row = self._mixed_source(root, annotations)
            entries, stats = self._import(root, raw, row)
            instance = load_json(root / "output" / entries[0]["path"])["instances"][0]
            self.assertFalse(any(c["coordinateKnown"] for c in instance["corners"]))
            self.assertNotIn("visibleMask", instance)
            self.assertEqual(instance["box"], {"left": 0.2, "top": 0.15, "right": 0.8, "bottom": 0.85})
            self.assertEqual(instance["sourceCategory"], "card")
            self.assertEqual(instance["container"], "slab")
            self.assertEqual(stats["maskFit:box-only"], 1)

    def test_context_annotation_without_a_box_does_not_drop_the_image(self):
        annotations = self._mixed_annotations()
        annotations[0] = {"category": "slab", "geometryQuality": "source-rle",
                          "provenance": ["card-scanner-seg:slab:7"]}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, raw, row = self._mixed_source(root, annotations)
            entries, stats = self._import(root, raw, row)
            self.assertEqual(len(entries), 1)
            self.assertEqual(stats["contextAnnotationsWithoutBox"], 1)
            self.assertNotIn("recordsExcludedMissingBox", stats)
            record = load_json(root / "output" / entries[0]["path"])
            self.assertEqual(record["instances"][0]["container"], "unknown")

    def test_card_without_a_box_still_drops_the_image(self):
        annotations = self._mixed_annotations()
        annotations.append({"category": "card", "geometryQuality": "bbox-derived",
                            "provenance": ["card-scanner-seg:card:11"]})
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, raw, row = self._mixed_source(root, annotations)
            entries, stats = self._import(root, raw, row)
            self.assertEqual(entries, [])
            self.assertEqual(stats["recordsExcludedMissingBox"], 1)

    def test_record_with_only_auxiliary_annotations_is_excluded(self):
        annotations = [item for item in self._mixed_annotations() if item["category"] != "card"]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, raw, row = self._mixed_source(root, annotations)
            entries, stats = self._import(root, raw, row)
            self.assertEqual(entries, [])
            self.assertEqual(stats["recordsExcludedNoCardAnnotations"], 1)
            self.assertEqual(stats["annotationsNotTargets:context:slab"], 1)

    def test_unknown_or_missing_category_fails_instead_of_guessing(self):
        for category in ("hologram", None):
            annotations = self._mixed_annotations()
            if category is None:
                annotations[2].pop("category")
            else:
                annotations[2]["category"] = category
            with self.subTest(category=category), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                _, raw, row = self._mixed_source(root, annotations)
                with self.assertRaisesRegex(ValueError, "unknown category"):
                    self._import(root, raw, row)

    def test_multiple_cards_are_counted_and_reindexed(self):
        annotations = self._mixed_annotations()
        annotations.append({
            "category": "card",
            "geometryQuality": "bbox-derived",
            "bbox": [0, 0, 10, 14],
            "provenance": ["card-scanner-seg:card:12"],
        })
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, raw, row = self._mixed_source(root, annotations)
            entries, stats = self._import(root, raw, row)
            record = load_json(root / "output" / entries[0]["path"])
            self.assertEqual(
                [(i["instanceId"], i["sourceAnnotationIndex"], i["container"]) for i in record["instances"]],
                [("card-0", 1, "slab"), ("card-1", 4, "unknown")],
            )
            self.assertEqual(stats["recordsWithMultipleCards"], 1)
            self.assertEqual(stats["cardsInsideSlab"], 1)

    def test_preflight_rejects_a_slab_relabeled_as_a_card(self):
        from corpus_release import corpus_hash, sha256_file, write_json

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, _ = self._mixed_source(root, self._mixed_annotations())
            output = self._build(root, corpus, raw)
            manifest = load_json(output / "manifest.json")
            entry = manifest["records"][0]
            record = load_json(output / entry["path"])
            record["instances"][0]["sourceCategory"] = "slab"
            record["instances"][0]["sourceAnnotationIndex"] = 0
            write_json(output / entry["path"], record)
            entry["sha256"] = sha256_file(output / entry["path"])
            manifest["corpusHash"] = corpus_hash(manifest)
            write_json(output / "manifest.json", manifest)
            report = run_preflight(output, tooling_revision="test")
            self.assertEqual(report["failedChecks"], ["TARGET_SEMANTICS"])
            check = next(c for c in report["checks"] if c["code"] == "TARGET_SEMANTICS")
            self.assertIn(
                "is not a primary category",
                " ".join(check["details"]["failures"][entry["recordId"]]),
            )

            # Dropping the declaration is not an escape hatch either.
            manifest.pop("targetSemantics")
            manifest["corpusHash"] = corpus_hash(manifest)
            write_json(output / "manifest.json", manifest)
            report = run_preflight(output, tooling_revision="test")
            self.assertEqual(report["failedChecks"], ["TARGET_SEMANTICS"])

    def test_policy_can_require_the_declaration(self):
        from corpus_release import corpus_hash, sha256_file, write_json

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, _ = self._mixed_source(root, self._mixed_annotations())
            output = self._build(root, corpus, raw)
            policy = load_json(output / "policy.json")
            policy["requireTargetSemantics"] = True
            write_json(output / "policy.json", policy)
            manifest = load_json(output / "manifest.json")
            manifest["readiness"]["readinessPolicySha256"] = sha256_file(output / "policy.json")
            manifest["corpusHash"] = corpus_hash(manifest)
            write_json(output / "manifest.json", manifest)
            self.assertEqual(run_preflight(output, tooling_revision="test")["failedChecks"], [])

            # A legacy manifest without the declaration and without provenance fails.
            for entry in manifest["records"]:
                record = load_json(output / entry["path"])
                record["source"].pop("annotationCategories")
                for instance in record["instances"]:
                    for key in ("sourceCategory", "sourceAnnotationIndex", "sourceProvenance"):
                        instance.pop(key, None)
                write_json(output / entry["path"], record)
                entry["sha256"] = sha256_file(output / entry["path"])
            manifest.pop("targetSemantics")
            manifest["corpusHash"] = corpus_hash(manifest)
            write_json(output / "manifest.json", manifest)
            report = run_preflight(output, tooling_revision="test")
            self.assertEqual(report["failedChecks"], ["TARGET_SEMANTICS"])


class FitAdapterAndSceneSliceTests(CategoryBoundaryTests):
    """Opt-in v2 corner fit and provisional multi-card scene slices."""

    def test_v2_fit_recovers_many_vertex_outline_and_records_adapter(self):
        annotations = self._mixed_annotations()
        card = annotations[1]
        # Many-vertex outline of the same card: extra clicks along every edge.
        card["segmentation"] = [[20, 15, 40, 15, 60, 15, 80, 15, 80, 40, 80, 60, 80, 85,
                                 60, 85, 40, 85, 20, 85, 20, 60, 20, 40]]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, raw, row = self._mixed_source(root, annotations)
            stats = Counter()
            legacy = add_canonical_archive(
                root=root / "legacy", rows=[row], archive_path=raw / row["archive"],
                split="train", stats=stats,
            )
            legacy_instance = load_json(root / "legacy" / legacy[0]["path"])["instances"][0]
            self.assertFalse(any(c["coordinateKnown"] for c in legacy_instance["corners"]))
            self.assertNotIn("cornerFit", legacy_instance)
            self.assertEqual(stats["maskFit:residual"], 1)

            stats = Counter()
            repaired = add_canonical_archive(
                root=root / "v2", rows=[row], archive_path=raw / row["archive"],
                split="train", stats=stats, polygon_fit="polygon-quad-fit-v2",
            )
            instance = load_json(root / "v2" / repaired[0]["path"])["instances"][0]
            self.assertEqual(instance["cornerFit"], "polygon-quad-fit-v2")
            self.assertEqual({c["cornerSource"] for c in instance["corners"]}, {"maskFit"})
            points = [(round(c["point"]["x"], 3), round(c["point"]["y"], 3)) for c in instance["corners"]]
            self.assertEqual(points, [(0.2, 0.15), (0.8, 0.15), (0.8, 0.85), (0.2, 0.85)])
            self.assertEqual(stats["polygonFitV2:accepted"], 1)
            self.assertEqual(stats["maskFit:accepted:polygon-quad-fit-v2"], 1)

    def test_exact_quads_keep_the_conservative_adapter_under_v2(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, raw, row = self._mixed_source(root, self._mixed_annotations())
            entries = add_canonical_archive(
                root=root / "v2", rows=[row], archive_path=raw / row["archive"],
                split="train", stats=Counter(), polygon_fit="polygon-quad-fit-v2",
            )
            instance = load_json(root / "v2" / entries[0]["path"])["instances"][0]
            self.assertEqual(instance["cornerFit"], "conservative-mask-quad-v1")
            with self.assertRaisesRegex(ValueError, "unknown polygon fit adapter"):
                add_canonical_archive(
                    root=root / "bad", rows=[row], archive_path=raw / row["archive"],
                    split="train", stats=Counter(), polygon_fit="guess",
                )

    def test_scene_assignments_bind_to_corpus_and_slice_multi_card_records(self):
        from corpus_release import sha256_file, write_json

        annotations = self._mixed_annotations()
        annotations.append({"category": "card", "geometryQuality": "bbox-derived",
                            "bbox": [0, 0, 10, 14], "provenance": ["card-scanner-seg:card:12"]})
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, row = self._mixed_source(root, annotations)
            report = root / "scenes.json"
            write_json(report, {
                "input": {"name": corpus.name, "sha256": sha256_file(corpus)},
                "heuristic": {"id": "grid-size-overlap-rotation-v1"},
                "assignments": [{"recordId": row["id"], "assignment": "binder_page"}],
            })
            output = root / "release"
            summary = build_release(
                canonical_corpus=corpus, raw_dir=raw,
                archive_splits={"card-scanner-seg.v3i.coco-segmentation.zip": "train"},
                devmode_sessions=[], output=output,
                source_archive_aliases=self._aliases(), scene_assignments_path=report,
            )
            manifest = load_json(output / "manifest.json")
            self.assertEqual(manifest["records"][0]["sceneSlice"], "multi_card_grid_archive")
            self.assertEqual(summary["sceneAssignments"]["sha256"], sha256_file(report))
            self.assertEqual(summary["stats"]["sceneSlice:multi_card_grid_archive"], 1)
            self.assertEqual(run_preflight(output, tooling_revision="test")["failedChecks"], [])

            # Assignments for a different corpus are refused, and a multi-card
            # record without an assignment is an error rather than a default.
            write_json(report, {"input": {"sha256": "0" * 64}, "assignments": []})
            with self.assertRaisesRegex(ValueError, "computed for canonical corpus"):
                build_release(
                    canonical_corpus=corpus, raw_dir=raw,
                    archive_splits={"card-scanner-seg.v3i.coco-segmentation.zip": "train"},
                    devmode_sessions=[], output=root / "r2",
                    source_archive_aliases=self._aliases(), scene_assignments_path=report,
                )
            write_json(report, {"input": {"sha256": sha256_file(corpus)}, "assignments": []})
            with self.assertRaisesRegex(ValueError, "no scene assignment"):
                build_release(
                    canonical_corpus=corpus, raw_dir=raw,
                    archive_splits={"card-scanner-seg.v3i.coco-segmentation.zip": "train"},
                    devmode_sessions=[], output=root / "r3",
                    source_archive_aliases=self._aliases(), scene_assignments_path=report,
                )


class ArchiveCornerLabelTests(CategoryBoundaryTests):
    """Human corner labels attach to canonical archive targets by annotation index."""

    def _labels(self, corpus: Path, row: dict, corners, index=1, image_sha=None, reviewer="Ahmad"):
        from corpus_release import sha256_file
        return {
            "schema": "https://tcger.app/schemas/card-geometry-archive-corner-labels/v1",
            "canonicalCorpusSha256": sha256_file(corpus),
            "frames": [{
                "canonicalRecordId": row["id"],
                "imageSha256": image_sha or row["sha256"],
                "reviewer": reviewer,
                "labeledAt": "2026-09-06T20:00:00Z",
                "instances": [{
                    "sourceAnnotationIndex": index,
                    "corners": corners,
                    "cornerVisibility": ["visible", "visible", "visible", "occluded"],
                    "orientationKnown": True,
                }],
            }],
        }

    def test_labels_replace_box_only_corners_with_human_corners(self):
        from corpus_release import write_json

        annotations = self._mixed_annotations()
        annotations[1] = {**annotations[1], "geometryQuality": "bbox-derived"}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, row = self._mixed_source(root, annotations)
            labels = root / "labels.json"
            quad = [[0.21, 0.16], [0.79, 0.14], [0.81, 0.86], [0.19, 0.84]]
            write_json(labels, self._labels(corpus, row, quad))
            output = root / "release"
            summary = build_release(
                canonical_corpus=corpus, raw_dir=raw,
                archive_splits={"card-scanner-seg.v3i.coco-segmentation.zip": "train"},
                devmode_sessions=[], output=output,
                source_archive_aliases=self._aliases(), archive_corner_labels_path=labels,
            )
            manifest = load_json(output / "manifest.json")
            instance = load_json(output / manifest["records"][0]["path"])["instances"][0]
            self.assertEqual({c["cornerSource"] for c in instance["corners"]}, {"human"})
            self.assertEqual([c["visibility"] for c in instance["corners"]],
                             ["visible", "visible", "visible", "occluded"])
            self.assertEqual(instance["corners"][0]["point"], {"x": 0.21, "y": 0.16})
            self.assertTrue(instance["orientationKnown"])
            self.assertNotIn("cornerFit", instance)
            self.assertEqual(instance["sourceAnnotationIndex"], 1)
            self.assertEqual(summary["stats"]["archiveHumanCornerInstances"], 1)
            self.assertEqual(summary["archiveCornerLabels"]["frames"], 1)
            report = run_preflight(output, tooling_revision="test")
            self.assertEqual(report["failedChecks"], [])
            self.assertEqual(report["cornerCounts"]["bySourceKind"]["real"]["metricEligible"], 4)

    def test_labels_must_bind_to_corpus_image_and_target(self):
        from corpus_release import write_json

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, row = self._mixed_source(root, self._mixed_annotations())
            labels = root / "labels.json"
            quad = [[0.2, 0.15], [0.8, 0.15], [0.8, 0.85], [0.2, 0.85]]
            kwargs = dict(
                canonical_corpus=corpus, raw_dir=raw,
                archive_splits={"card-scanner-seg.v3i.coco-segmentation.zip": "train"},
                devmode_sessions=[], source_archive_aliases=self._aliases(),
                archive_corner_labels_path=labels,
            )
            cases = [
                ({"canonicalCorpusSha256": "0" * 64}, "drawn on canonical corpus"),
                ({"frames": [dict(self._labels(corpus, row, quad)["frames"][0], imageSha256="1" * 64)]},
                 "different image bytes"),
                ({"frames": [dict(self._labels(corpus, row, quad, index=0)["frames"][0])]},
                 "does not name a whole-card target"),
                ({"frames": [dict(self._labels(corpus, row, [[0.0, 0.0], [0.1, 0.0], [0.1, 0.1], [0.0, 0.1]])["frames"][0])]},
                 "does not cover its annotation box"),
                ({"frames": [dict(self._labels(corpus, row, quad)["frames"][0], reviewer="")]},
                 "invalid archive corner labels"),
            ]
            for number, (override, message) in enumerate(cases):
                document = {**self._labels(corpus, row, quad), **override}
                write_json(labels, document)
                with self.subTest(case=message), self.assertRaisesRegex(ValueError, message):
                    build_release(output=root / f"release-{number}", **kwargs)

    def test_queue_lists_box_only_multi_card_train_targets(self):
        from build_archive_corner_label_queue import build_queue
        from corpus_release import sha256_file, write_json

        annotations = self._mixed_annotations()
        annotations.append({"category": "card", "geometryQuality": "bbox-derived",
                            "bbox": [0, 0, 10, 14], "provenance": ["card-scanner-seg:card:12"]})
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus, raw, row = self._mixed_source(root, annotations)
            report = root / "scenes.json"
            write_json(report, {"input": {"sha256": sha256_file(corpus)},
                                "heuristic": {"id": "grid-size-overlap-rotation-v1"},
                                "assignments": [{"recordId": row["id"], "assignment": "duel_field"}]})
            output = root / "release"
            build_release(
                canonical_corpus=corpus, raw_dir=raw,
                archive_splits={"card-scanner-seg.v3i.coco-segmentation.zip": "train"},
                devmode_sessions=[], output=output,
                source_archive_aliases=self._aliases(), scene_assignments_path=report,
            )
            queue = build_queue(output, splits=("train",), slices=("multi_card_scatter_archive",))
            self.assertEqual(len(queue["frames"]), 1)
            frame = queue["frames"][0]
            self.assertEqual(frame["canonicalRecordId"], row["id"])
            self.assertEqual(frame["imageSha256"], row["sha256"])
            # Only the box-only card is queued; the fitted card already has corners.
            self.assertEqual([i["sourceAnnotationIndex"] for i in frame["instances"]], [4])
            self.assertEqual(queue["counts"]["targets:train/multi_card_scatter_archive"], 1)
            empty = build_queue(output, splits=("validation",), slices=("multi_card_scatter_archive",))
            self.assertEqual(empty["frames"], [])


if __name__ == "__main__":
    unittest.main()
