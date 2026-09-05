#!/usr/bin/env python3
"""Score portable card-geometry predictions against a pinned corpus release.

The scorer is deliberately independent of every model and runtime. Producers
write one schema-validated JSONL row per release record; this module performs
the same deterministic matching and metrics for Python, Swift, Kotlin, and
TypeScript decoder output.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus_release import (  # noqa: E402
    MANIFEST_FILENAME,
    load_json,
    load_schema,
    pretty_json,
    sha256_file,
    validation_errors,
)
from preflight import Expectations, detect_tooling_revision, run_preflight  # noqa: E402
from reference_geometry import canonical_round, quad_iou  # noqa: E402

PREDICTIONS_SCHEMA_FILE = "card-geometry-predictions.v1.schema.json"
RESULT_SCHEMA_FILE = "card-geometry-result.v1.schema.json"
REPORT_SCHEMA_ID = "https://tcger.app/schemas/card-geometry-benchmark-report/v1"
MATCH_IOU = 0.5
RECALL_THRESHOLDS = (0.5, 0.75, 0.9)
EPSILON = 1e-12


class BenchmarkError(ValueError):
    pass


@dataclass(frozen=True)
class Truth:
    record_id: str
    instance_index: int
    scene_slice: str
    source_kind: str
    width: int
    height: int
    instance: dict[str, Any]
    geometry: tuple[tuple[float, float], ...] | None
    geometry_source: str | None


@dataclass(frozen=True)
class Prediction:
    index: int
    result: dict[str, Any]
    quad: tuple[tuple[float, float], ...]


@dataclass(frozen=True)
class Match:
    truth: Truth
    prediction: Prediction
    iou: float


def _point(value: dict[str, Any]) -> tuple[float, float]:
    return float(value["x"]), float(value["y"])


def _truth_geometry(instance: dict[str, Any]) -> tuple[tuple[float, float], ...] | None:
    corners = instance.get("corners", [])
    if len(corners) == 4 and all(corner.get("coordinateKnown") for corner in corners):
        return tuple(_point(corner["point"]) for corner in corners)
    mask = instance.get("visibleMask")
    if isinstance(mask, dict) and mask.get("kind") == "polygon":
        points = mask.get("points", [])
        if len(points) >= 3:
            return tuple(_point(point) for point in points)
    return None


def _geometry_source(instance: dict[str, Any]) -> str | None:
    corners = instance.get("corners", [])
    if len(corners) == 4 and all(corner.get("coordinateKnown") for corner in corners):
        return "quad"
    mask = instance.get("visibleMask")
    if isinstance(mask, dict) and mask.get("kind") == "polygon":
        return "visibleMask"
    return None


def _prediction(result: dict[str, Any], index: int) -> Prediction:
    return Prediction(
        index=index,
        result=result,
        quad=tuple(_point(corner["point"]) for corner in result["corners"]),
    )


def _prediction_validator():
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource

    result_schema = load_schema(RESULT_SCHEMA_FILE)
    predictions_schema = load_schema(PREDICTIONS_SCHEMA_FILE)
    registry = Registry().with_resource(
        result_schema["$id"], Resource.from_contents(result_schema)
    )
    Draft202012Validator.check_schema(predictions_schema)
    return Draft202012Validator(predictions_schema, registry=registry)


def load_predictions(
    path: Path, expected_record_ids: set[str]
) -> tuple[str, dict[str, list[dict[str, Any]]]]:
    validator = _prediction_validator()
    rows: dict[str, list[dict[str, Any]]] = {}
    localizer_ids: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise BenchmarkError(f"{path}:{line_number}: {error}") from error
            errors = validation_errors(validator, row)
            if errors:
                raise BenchmarkError(
                    f"{path}:{line_number}: predictions schema violations: "
                    + "; ".join(errors)
                )
            record_id = row["recordId"]
            if record_id in rows:
                raise BenchmarkError(f"duplicate predictions row for {record_id}")
            if record_id not in expected_record_ids:
                raise BenchmarkError(
                    f"predictions contain unknown recordId {record_id}"
                )
            rows[record_id] = row["results"]
            localizer_ids.add(row["localizerId"])
    if len(localizer_ids) != 1:
        raise BenchmarkError(
            "predictions must contain exactly one localizerId; found "
            + repr(sorted(localizer_ids))
        )
    missing = sorted(expected_record_ids - set(rows))
    if missing:
        preview = ", ".join(missing[:5])
        suffix = f" and {len(missing) - 5} more" if len(missing) > 5 else ""
        raise BenchmarkError(
            f"predictions omit {len(missing)} records: {preview}{suffix}"
        )
    return next(iter(localizer_ids)), rows


def _safe_release_path(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError as error:
        raise BenchmarkError(f"release path escapes its root: {relative}") from error
    return path


def load_release(
    release_root: Path,
) -> tuple[dict[str, Any], dict[str, Any], list[Truth]]:
    manifest = load_json(release_root / MANIFEST_FILENAME)
    policy_path = _safe_release_path(
        release_root, manifest["readiness"]["readinessPolicyPath"]
    )
    policy = load_json(policy_path)
    truths: list[Truth] = []
    for entry in manifest["records"]:
        record = load_json(_safe_release_path(release_root, entry["path"]))
        for instance_index, instance in enumerate(record["instances"]):
            truths.append(
                Truth(
                    record_id=entry["recordId"],
                    instance_index=instance_index,
                    scene_slice=entry["sceneSlice"],
                    source_kind=record["source"]["kind"],
                    width=int(record["source"]["width"]),
                    height=int(record["source"]["height"]),
                    instance=instance,
                    geometry=_truth_geometry(instance),
                    geometry_source=_geometry_source(instance),
                )
            )
    return manifest, policy, truths


def _iou(truth: Truth, prediction: Prediction) -> float:
    if truth.geometry is None:
        return 0.0
    # The shared clipper supports an arbitrary subject polygon with a convex
    # clip polygon. Put the prediction quad second so visible-mask polygons can
    # have more than four vertices without another IoU implementation.
    return quad_iou(list(truth.geometry), list(prediction.quad))


def match_record(
    truths: list[Truth], predictions: list[Prediction]
) -> tuple[list[Match], list[Truth], list[Prediction], int, int]:
    scorable = [truth for truth in truths if truth.geometry is not None]
    pairs = sorted(
        (
            (_iou(truth, prediction), prediction, truth)
            for truth in scorable
            for prediction in predictions
        ),
        key=lambda item: (
            -item[0],
            -float(item[1].result["confidence"]),
            item[1].index,
            item[2].instance_index,
        ),
    )
    matched_truths: set[int] = set()
    matched_predictions: set[int] = set()
    matches: list[Match] = []
    for iou, prediction, truth in pairs:
        if iou < MATCH_IOU:
            break
        if (
            truth.instance_index in matched_truths
            or prediction.index in matched_predictions
        ):
            continue
        matched_truths.add(truth.instance_index)
        matched_predictions.add(prediction.index)
        matches.append(Match(truth, prediction, iou))
    unmatched_truths = [
        truth for truth in scorable if truth.instance_index not in matched_truths
    ]
    unmatched_predictions = [
        prediction
        for prediction in predictions
        if prediction.index not in matched_predictions
    ]
    duplicate = 0
    extra = 0
    for prediction in unmatched_predictions:
        maximum = max((_iou(truth, prediction) for truth in scorable), default=0.0)
        if maximum >= MATCH_IOU:
            duplicate += 1
        else:
            extra += 1
    return matches, unmatched_truths, unmatched_predictions, duplicate, extra


def _pixel_points(truth: Truth) -> list[tuple[float, float] | None]:
    points: list[tuple[float, float] | None] = []
    for corner in truth.instance.get("corners", []):
        if not corner.get("coordinateKnown"):
            points.append(None)
            continue
        x, y = _point(corner["point"])
        points.append((x * truth.width, y * truth.height))
    return points


def _prediction_pixel_points(match: Match) -> list[tuple[float, float]]:
    return [
        (point[0] * match.truth.width, point[1] * match.truth.height)
        for point in match.prediction.quad
    ]


def _roll_errors(
    truth_points: list[tuple[float, float] | None],
    prediction_points: list[tuple[float, float]],
) -> list[list[float | None]]:
    rolls = []
    for roll in range(4):
        rolled = prediction_points[roll:] + prediction_points[:roll]
        rolls.append(
            [
                None if truth is None else math.dist(truth, prediction)
                for truth, prediction in zip(truth_points, rolled)
            ]
        )
    return rolls


def _roll_score(errors: list[float | None]) -> float:
    known = [error for error in errors if error is not None]
    return sum(known) / len(known) if known else math.inf


def _mean_truth_side_length(
    truth_points: list[tuple[float, float] | None],
) -> float | None:
    if len(truth_points) != 4 or any(point is None for point in truth_points):
        return None
    points = [point for point in truth_points if point is not None]
    mean = (
        sum(math.dist(points[index], points[(index + 1) % 4]) for index in range(4)) / 4
    )
    return mean if mean > EPSILON else None


def _empty_corner_counts() -> Counter:
    return Counter(
        eligible=0,
        evaluated=0,
        skipped=0,
        metricEligible=0,
        metricExcluded=0,
    )


def _corner_counts(truths: Iterable[Truth], eligible_sources: set[str]) -> Counter:
    counts = _empty_corner_counts()
    for truth in truths:
        for corner in truth.instance.get("corners", []):
            known = bool(corner.get("coordinateKnown"))
            counts["eligible"] += 1
            counts["evaluated" if known else "skipped"] += 1
            if known:
                counts[
                    "metricEligible"
                    if corner.get("cornerSource") in eligible_sources
                    else "metricExcluded"
                ] += 1
    return counts


def _counts_dict(counts: Counter) -> dict[str, int]:
    return {
        key: int(counts[key])
        for key in (
            "eligible",
            "evaluated",
            "skipped",
            "metricEligible",
            "metricExcluded",
        )
    }


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def distribution(values: Iterable[float]) -> dict[str, int | float | None]:
    samples = list(values)
    return {
        "count": len(samples),
        "mean": sum(samples) / len(samples) if samples else None,
        "p50": _percentile(samples, 0.50),
        "p90": _percentile(samples, 0.90),
        "p95": _percentile(samples, 0.95),
    }


def _detection_summary(
    events: list[dict[str, Any]], record_count: int
) -> dict[str, Any]:
    truth_count = sum(event["scorableTruths"] for event in events)
    matches = [match for event in events for match in event["matches"]]
    duplicate = sum(event["duplicate"] for event in events)
    extra = sum(event["extra"] for event in events)
    miss = sum(event["miss"] for event in events)

    def rate(count: int, denominator: int) -> float | None:
        return count / denominator if denominator else None

    recalls = {
        f"recall@{threshold}": rate(
            sum(match.iou >= threshold for match in matches), truth_count
        )
        for threshold in RECALL_THRESHOLDS
    }
    return {
        "records": record_count,
        "truthInstances": truth_count,
        "predictions": sum(event["predictions"] for event in events),
        "matches": len(matches),
        "meanMatchedIoU": (
            sum(match.iou for match in matches) / len(matches) if matches else None
        ),
        **recalls,
        "duplicate": duplicate,
        "duplicatePerImage": rate(duplicate, record_count),
        "extra": extra,
        "extraPerImage": rate(extra, record_count),
        "miss": miss,
        "missPerImage": rate(miss, record_count),
    }


def _error_summary(
    truths: list[Truth],
    observations: list[dict[str, Any]],
    eligible_sources: set[str],
) -> dict[str, Any]:
    return {
        "truthCornerCounts": _counts_dict(_corner_counts(truths, eligible_sources)),
        "pixel": distribution(item["pixel"] for item in observations),
        "normalized": distribution(
            item["normalized"]
            for item in observations
            if item["normalized"] is not None
        ),
        "normalizedSkippedNoFullTruthQuad": sum(
            item["normalized"] is None for item in observations
        ),
    }


def evaluate(
    *,
    manifest: dict[str, Any],
    policy: dict[str, Any],
    truths: list[Truth],
    prediction_rows: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    truths_by_record: dict[str, list[Truth]] = defaultdict(list)
    for truth in truths:
        truths_by_record[truth.record_id].append(truth)
    entries = {entry["recordId"]: entry for entry in manifest["records"]}
    events: list[dict[str, Any]] = []
    all_matches: list[Match] = []
    for record_id in sorted(entries):
        record_truths = truths_by_record.get(record_id, [])
        predictions = [
            _prediction(result, index)
            for index, result in enumerate(prediction_rows[record_id])
        ]
        matches, misses, _, duplicate, extra = match_record(record_truths, predictions)
        entry = entries[record_id]
        event = {
            "recordId": record_id,
            "sceneSlice": entry["sceneSlice"],
            "sourceKind": entry["leakageKeys"]["sourceKind"],
            "scorableTruths": sum(
                truth.geometry is not None for truth in record_truths
            ),
            "predictions": len(predictions),
            "matches": matches,
            "duplicate": duplicate,
            "extra": extra,
            "miss": len(misses),
        }
        events.append(event)
        all_matches.extend(matches)

    eligible_sources = set(policy["metricEligibleCornerSources"])
    observations: list[dict[str, Any]] = []
    orientation = Counter(
        eligiblePairs=0,
        evaluatedPairs=0,
        correctPairs=0,
        excludedUnknownOrientation=0,
        insufficientKnownCorners=0,
    )
    for match in all_matches:
        truth_points = _pixel_points(match.truth)
        prediction_points = _prediction_pixel_points(match)
        rolls = _roll_errors(truth_points, prediction_points)
        scores = [_roll_score(errors) for errors in rolls]
        if all(not math.isfinite(score) for score in scores):
            chosen_roll = 0
            orientation["insufficientKnownCorners"] += 1
        else:
            minimum = min(scores)
            chosen_roll = next(
                index
                for index, score in enumerate(scores)
                if score <= minimum + EPSILON
            )
        if match.truth.instance.get("orientationKnown"):
            orientation["eligiblePairs"] += 1
            if math.isfinite(scores[0]):
                orientation["evaluatedPairs"] += 1
                if scores[0] <= min(scores) + EPSILON:
                    orientation["correctPairs"] += 1
            error_roll = 0
        else:
            orientation["excludedUnknownOrientation"] += 1
            error_roll = chosen_roll
        denominator = _mean_truth_side_length(truth_points)
        for corner_index, (corner, error) in enumerate(
            zip(match.truth.instance.get("corners", []), rolls[error_roll])
        ):
            if error is None or corner.get("cornerSource") not in eligible_sources:
                continue
            observations.append(
                {
                    "recordId": match.truth.record_id,
                    "instanceIndex": match.truth.instance_index,
                    "cornerIndex": corner_index,
                    "sceneSlice": match.truth.scene_slice,
                    "sourceKind": match.truth.source_kind,
                    "visibility": corner.get("visibility"),
                    "pixel": error,
                    "normalized": error / denominator if denominator else None,
                }
            )

    scene_slices = sorted({truth.scene_slice for truth in truths})
    source_kinds = sorted({truth.source_kind for truth in truths})
    visibilities = sorted(
        {
            corner.get("visibility")
            for truth in truths
            for corner in truth.instance.get("corners", [])
        }
    )
    detection = {
        "overall": _detection_summary(events, len(entries)),
        "bySceneSlice": {
            value: _detection_summary(
                [event for event in events if event["sceneSlice"] == value],
                sum(entry["sceneSlice"] == value for entry in entries.values()),
            )
            for value in scene_slices
        },
        "bySourceKind": {
            value: _detection_summary(
                [event for event in events if event["sourceKind"] == value],
                sum(
                    entry["leakageKeys"]["sourceKind"] == value
                    for entry in entries.values()
                ),
            )
            for value in source_kinds
        },
    }

    def truth_filter(attribute: str, value: str) -> list[Truth]:
        return [truth for truth in truths if getattr(truth, attribute) == value]

    corner_error = {
        "overall": _error_summary(truths, observations, eligible_sources),
        "bySceneSlice": {
            value: _error_summary(
                truth_filter("scene_slice", value),
                [item for item in observations if item["sceneSlice"] == value],
                eligible_sources,
            )
            for value in scene_slices
        },
        "bySourceKind": {
            value: _error_summary(
                truth_filter("source_kind", value),
                [item for item in observations if item["sourceKind"] == value],
                eligible_sources,
            )
            for value in source_kinds
        },
        "byTruthVisibility": {},
    }
    for visibility in visibilities:
        scoped_counts = _empty_corner_counts()
        for truth in truths:
            for corner in truth.instance.get("corners", []):
                if corner.get("visibility") != visibility:
                    continue
                known = bool(corner.get("coordinateKnown"))
                scoped_counts["eligible"] += 1
                scoped_counts["evaluated" if known else "skipped"] += 1
                if known:
                    scoped_counts[
                        "metricEligible"
                        if corner.get("cornerSource") in eligible_sources
                        else "metricExcluded"
                    ] += 1
        scoped_observations = [
            item for item in observations if item["visibility"] == visibility
        ]
        corner_error["byTruthVisibility"][visibility] = {
            "truthCornerCounts": _counts_dict(scoped_counts),
            "pixel": distribution(item["pixel"] for item in scoped_observations),
            "normalized": distribution(
                item["normalized"]
                for item in scoped_observations
                if item["normalized"] is not None
            ),
            "normalizedSkippedNoFullTruthQuad": sum(
                item["normalized"] is None for item in scoped_observations
            ),
        }

    orientation_report = dict(orientation)
    orientation_report["accuracy"] = (
        orientation["correctPairs"] / orientation["evaluatedPairs"]
        if orientation["evaluatedPairs"]
        else None
    )
    return {
        "counts": {
            "records": len(entries),
            "truthInstances": len(truths),
            "scorableTruthInstances": sum(
                truth.geometry is not None for truth in truths
            ),
            "unscorableTruthInstances": sum(truth.geometry is None for truth in truths),
            "truthGeometrySource": dict(
                sorted(
                    Counter(
                        truth.geometry_source or "unscorable" for truth in truths
                    ).items()
                )
            ),
        },
        "detection": detection,
        "cornerError": corner_error,
        "orientation": orientation_report,
    }


def benchmark(
    *,
    release_root: Path,
    predictions_path: Path,
    expected_corpus_hash: str,
    tooling_revision: str | None = None,
) -> dict[str, Any]:
    revision = tooling_revision or detect_tooling_revision()
    preflight = run_preflight(
        release_root,
        expectations=Expectations(corpus_hash=expected_corpus_hash),
        tooling_revision=revision,
    )
    if preflight["failedChecks"]:
        raise BenchmarkError(
            "release preflight failed: " + ", ".join(preflight["failedChecks"])
        )
    manifest, policy, truths = load_release(release_root)
    record_ids = {entry["recordId"] for entry in manifest["records"]}
    localizer_id, prediction_rows = load_predictions(predictions_path, record_ids)
    metrics = evaluate(
        manifest=manifest,
        policy=policy,
        truths=truths,
        prediction_rows=prediction_rows,
    )
    report = {
        "schema": REPORT_SCHEMA_ID,
        "corpusHash": manifest["corpusHash"],
        "predecessorCorpusHash": manifest.get("supersedes", {}).get("corpusHash"),
        "supersedes": manifest.get("supersedes"),
        "releaseId": manifest["releaseId"],
        "releasePurpose": manifest["releasePurpose"],
        "predictionsSha256": sha256_file(predictions_path),
        "localizerId": localizer_id,
        "toolingRevision": revision,
        "coordinateConvention": {
            "origin": "topLeft",
            "space": "normalizedSourceImage",
            "pixelMapping": {"x": "x * width", "y": "y * height"},
            "normalizedErrorDenominator": "mean truth-quad side length in source pixels",
            "status": "frozen by crop-parity-2026-09-02",
        },
        "matching": {
            "algorithm": "greedy one-to-one descending quad IoU",
            "matchIouThreshold": MATCH_IOU,
            "recallThresholds": list(RECALL_THRESHOLDS),
            "tieBreak": [
                "prediction confidence descending",
                "prediction index ascending",
                "truth index ascending",
            ],
            "higherRecallThresholdsRematch": False,
        },
        "percentileMethod": "linear interpolation at (n - 1) * p",
        "preflight": {
            "readyFor": preflight["readyFor"],
            "failedChecks": preflight["failedChecks"],
            "cornerCounts": preflight["cornerCounts"],
        },
        **metrics,
    }
    return canonical_round(report, 12)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--expected-corpus-hash", required=True)
    parser.add_argument("--tooling-revision")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = benchmark(
            release_root=args.release_root,
            predictions_path=args.predictions,
            expected_corpus_hash=args.expected_corpus_hash,
            tooling_revision=args.tooling_revision,
        )
    except (BenchmarkError, OSError, json.JSONDecodeError) as error:
        print(f"benchmark failed: {error}", file=sys.stderr)
        return 2
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(pretty_json(report), encoding="utf-8")
    print(args.report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
