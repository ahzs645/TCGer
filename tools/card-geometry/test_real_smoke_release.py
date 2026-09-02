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
        accepted, reason = conservative_mask_quad(
            [(2, 1), (8, 1), (8, 9), (2, 9)], 10, 10
        )
        self.assertEqual(reason, "accepted")
        self.assertEqual(len(accepted or []), 4)

        self.assertEqual(
            conservative_mask_quad([(2, 1), (8, 1), (8, 9), (5, 8), (2, 9)], 10, 10)[1],
            "residual",
        )
        self.assertEqual(
            conservative_mask_quad([(1, 1), (9, 1), (2, 2), (1, 9)], 10, 10)[1],
            "convexity",
        )
        self.assertEqual(
            conservative_mask_quad([(1, 1), (9, 1), (9, 9), (1, 9)], 10, 10)[1],
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

    def test_devmode_fixed_quad_is_human_and_denylisted(self):
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
                            {"imageFile": "frame.png", "expectedCardId": "replay-only"},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            output = root / "release"
            build_release(
                canonical_corpus=corpus,
                raw_dir=raw,
                archive_splits={"annotations.v7i.coco-segmentation.zip": "test"},
                devmode_sessions=[session],
                output=output,
            )
            manifest = load_json(output / "manifest.json")
            self.assertEqual(manifest["evaluationSessionDenylist"], [session.name])
            dev_entry = next(
                item
                for item in manifest["records"]
                if item["recordId"].startswith("devmode-")
            )
            record = load_json(output / dev_entry["path"])
            self.assertEqual(
                {
                    corner["cornerSource"]
                    for corner in record["instances"][0]["corners"]
                },
                {"human"},
            )
            self.assertNotIn("physicalCardId", record["instances"][0])

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


if __name__ == "__main__":
    unittest.main()
