from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from benchmark_geometry import (  # noqa: E402
    BenchmarkError,
    Truth,
    benchmark,
    evaluate,
    load_predictions,
)
from reference_geometry import RESULT_SCHEMA  # noqa: E402

ARTIFACT_SHA256 = "0" * 64
QUAD = ((0.1, 0.1), (0.6, 0.1), (0.6, 0.8), (0.1, 0.8))


def result(points, confidence=0.9):
    minimum_x = max(0.0, min(point[0] for point in points))
    minimum_y = max(0.0, min(point[1] for point in points))
    maximum_x = min(1.0, max(point[0] for point in points))
    maximum_y = min(1.0, max(point[1] for point in points))
    return {
        "schema": RESULT_SCHEMA,
        "detectionClass": "card",
        "corners": [
            {"point": {"x": x, "y": y}, "confidence": confidence} for x, y in points
        ],
        "confidence": confidence,
        "cornerOrderConfidence": None,
        "containment": (
            "inside"
            if all(0 <= value <= 1 for point in points for value in point)
            else "partiallyOutside"
        ),
        "side": "unknown",
        "container": "unknown",
        "boundingBox": {
            "x": minimum_x,
            "y": minimum_y,
            "width": max(0.0, maximum_x - minimum_x),
            "height": max(0.0, maximum_y - minimum_y),
        },
        "releaseVersion": 1,
        "artifactSha256": ARTIFACT_SHA256,
    }


def truth(
    record_id,
    points=QUAD,
    *,
    instance_index=0,
    orientation_known=False,
    corner_source="human",
    known=True,
    visible_mask=None,
):
    corners = []
    for x, y in points:
        if known:
            corners.append(
                {
                    "point": {"x": x, "y": y},
                    "visibility": (
                        "visible" if 0 <= x <= 1 and 0 <= y <= 1 else "outsideFrame"
                    ),
                    "coordinateKnown": True,
                    "cornerSource": corner_source,
                }
            )
        else:
            corners.append({"visibility": "unlabeled", "coordinateKnown": False})
    instance = {
        "instanceId": f"card-{instance_index}",
        "detectionClass": "card",
        "corners": corners,
        "orientationKnown": orientation_known,
        "side": "unknown",
        "container": "unknown",
        "occlusionOrder": instance_index,
    }
    if visible_mask is not None:
        instance["visibleMask"] = visible_mask
    geometry = tuple(points) if known else None
    geometry_source = "quad" if known else None
    if not known and visible_mask is not None:
        geometry = tuple((point["x"], point["y"]) for point in visible_mask["points"])
        geometry_source = "visibleMask"
    return Truth(
        record_id=record_id,
        instance_index=instance_index,
        scene_slice="synthetic_fixture",
        source_kind="synthetic",
        width=100,
        height=100,
        instance=instance,
        geometry=geometry,
        geometry_source=geometry_source,
    )


def evaluate_fixture(truths, predictions_by_record):
    record_ids = sorted(
        {item.record_id for item in truths} | set(predictions_by_record)
    )
    manifest = {
        "records": [
            {
                "recordId": record_id,
                "sceneSlice": "synthetic_fixture",
                "leakageKeys": {"sourceKind": "synthetic"},
            }
            for record_id in record_ids
        ]
    }
    rows = {
        record_id: predictions_by_record.get(record_id, []) for record_id in record_ids
    }
    return evaluate(
        manifest=manifest,
        policy={"metricEligibleCornerSources": ["human", "synthetic"]},
        truths=truths,
        prediction_rows=rows,
    )


class BenchmarkGeometryTests(unittest.TestCase):
    def test_predictions_wrapper_validates_inner_results(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "invalid.jsonl"
            path.write_text(
                json.dumps(
                    {"recordId": "record-1", "localizerId": "fixture", "results": [{}]}
                )
                + "\n"
            )
            with self.assertRaisesRegex(BenchmarkError, "schema violations"):
                load_predictions(path, {"record-1"})

    def test_benchmark_requires_and_records_preflighted_corpus_hash(self):
        release = (
            Path(__file__).resolve().parent / "fixtures" / "releases" / "valid-fixture"
        )
        manifest = json.loads((release / "manifest.json").read_text())
        with tempfile.TemporaryDirectory() as temporary:
            predictions = Path(temporary) / "empty.jsonl"
            predictions.write_text(
                "".join(
                    json.dumps(
                        {
                            "recordId": entry["recordId"],
                            "localizerId": "empty-fixture",
                            "results": [],
                        },
                        sort_keys=True,
                    )
                    + "\n"
                    for entry in manifest["records"]
                )
            )
            report = benchmark(
                release_root=release,
                predictions_path=predictions,
                expected_corpus_hash=manifest["corpusHash"],
                tooling_revision="fixture-revision",
            )
            self.assertEqual(report["corpusHash"], manifest["corpusHash"])
            self.assertEqual(report["preflight"]["failedChecks"], [])
            self.assertEqual(report["toolingRevision"], "fixture-revision")
            self.assertEqual(
                report["coordinateConvention"]["pixelMapping"],
                {"x": "x * width", "y": "y * height"},
            )
            self.assertEqual(
                report["coordinateConvention"]["status"],
                "frozen by crop-parity-2026-09-02",
            )

    def test_exact_prediction_has_zero_error(self):
        metrics = evaluate_fixture([truth("exact")], {"exact": [result(QUAD)]})
        overall = metrics["cornerError"]["overall"]
        self.assertEqual(metrics["detection"]["overall"]["recall@0.5"], 1.0)
        self.assertEqual(overall["pixel"]["count"], 4)
        self.assertEqual(overall["pixel"]["mean"], 0.0)
        self.assertEqual(overall["normalized"]["mean"], 0.0)

    def test_k_pixel_shift_reports_k(self):
        shifted = tuple((x + 0.05, y) for x, y in QUAD)
        metrics = evaluate_fixture([truth("shift")], {"shift": [result(shifted)]})
        pixel = metrics["cornerError"]["overall"]["pixel"]
        self.assertAlmostEqual(pixel["mean"], 5.0)
        self.assertAlmostEqual(pixel["p50"], 5.0)
        self.assertAlmostEqual(pixel["p90"], 5.0)
        self.assertAlmostEqual(pixel["p95"], 5.0)

    def test_roll_is_aligned_only_when_orientation_unknown(self):
        rolled = QUAD[1:] + QUAD[:1]
        unknown = evaluate_fixture(
            [truth("unknown", orientation_known=False)],
            {"unknown": [result(rolled)]},
        )
        self.assertEqual(unknown["cornerError"]["overall"]["pixel"]["mean"], 0.0)
        self.assertEqual(unknown["orientation"]["excludedUnknownOrientation"], 1)
        self.assertEqual(unknown["orientation"]["evaluatedPairs"], 0)

        known = evaluate_fixture(
            [truth("known", orientation_known=True)],
            {"known": [result(rolled)]},
        )
        self.assertGreater(known["cornerError"]["overall"]["pixel"]["mean"], 0)
        self.assertEqual(known["orientation"]["evaluatedPairs"], 1)
        self.assertEqual(known["orientation"]["correctPairs"], 0)
        self.assertEqual(known["orientation"]["accuracy"], 0.0)

    def test_duplicate_extra_and_miss_are_distinct(self):
        second_quad = tuple((x + 0.35, y) for x, y in QUAD)
        duplicate = tuple((x + 0.01, y) for x, y in QUAD)
        extra = ((0.0, 0.85), (0.08, 0.85), (0.08, 0.98), (0.0, 0.98))
        metrics = evaluate_fixture(
            [truth("mixed"), truth("mixed", second_quad, instance_index=1)],
            {"mixed": [result(QUAD, 0.9), result(duplicate, 0.8), result(extra, 0.7)]},
        )
        detection = metrics["detection"]["overall"]
        self.assertEqual(detection["matches"], 1)
        self.assertEqual(detection["duplicate"], 1)
        self.assertEqual(detection["extra"], 1)
        self.assertEqual(detection["miss"], 1)
        self.assertEqual(detection["recall@0.5"], 0.5)
        self.assertEqual(detection["duplicatePerImage"], 1.0)
        self.assertEqual(detection["extraPerImage"], 1.0)
        self.assertEqual(detection["missPerImage"], 1.0)

    def test_mask_fit_quad_matches_but_has_no_corner_error(self):
        metrics = evaluate_fixture(
            [truth("mask-fit", corner_source="maskFit")],
            {"mask-fit": [result(QUAD)]},
        )
        self.assertEqual(metrics["detection"]["overall"]["matches"], 1)
        self.assertEqual(metrics["cornerError"]["overall"]["pixel"]["count"], 0)
        counts = metrics["cornerError"]["overall"]["truthCornerCounts"]
        self.assertEqual(counts["metricEligible"], 0)
        self.assertEqual(counts["metricExcluded"], 4)

    def test_unscorable_truth_does_not_enter_recall_denominator(self):
        metrics = evaluate_fixture(
            [truth("unscorable", known=False)],
            {"unscorable": []},
        )
        self.assertEqual(metrics["counts"]["truthInstances"], 1)
        self.assertEqual(metrics["counts"]["scorableTruthInstances"], 0)
        self.assertEqual(metrics["counts"]["unscorableTruthInstances"], 1)
        detection = metrics["detection"]["overall"]
        self.assertEqual(detection["truthInstances"], 0)
        self.assertIsNone(detection["recall@0.5"])
        self.assertEqual(detection["miss"], 0)


if __name__ == "__main__":
    unittest.main()
