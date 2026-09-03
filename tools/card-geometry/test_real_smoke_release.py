import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from build_fixture_releases import tiny_png  # noqa: E402
from build_real_smoke_release import (  # noqa: E402
    build_release,
    conservative_mask_quad,
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
                    "geometryQuality": "source-polygon",
                    "segmentation": [[2, 1, 8, 1, 8, 9, 2, 9, 2, 1]],
                },
                {
                    "geometryQuality": "bbox-derived",
                    "segmentation": [[0, 0, 10, 0, 10, 10, 0, 10]],
                },
            ],
        }
        corpus = root / "corpus.jsonl"
        corpus.write_text(json.dumps(row) + "\n", encoding="utf-8")
        return corpus, raw, image

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
            self.assertEqual(len(record["instances"]), 1)
            self.assertEqual(record["instances"][0]["visibleMask"]["kind"], "polygon")
            self.assertEqual(
                {
                    corner["cornerSource"]
                    for corner in record["instances"][0]["corners"]
                },
                {"maskFit"},
            )
            self.assertEqual(summary["stats"]["bboxDerivedExcluded"], 1)

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


if __name__ == "__main__":
    unittest.main()
