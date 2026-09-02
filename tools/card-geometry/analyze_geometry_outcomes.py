#!/usr/bin/env python3
"""Join per-frame geometry error to archived device recognition outcomes."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from benchmark_geometry import (
    BenchmarkError,
    _mean_truth_side_length,
    _pixel_points,
    _prediction,
    _prediction_pixel_points,
    _roll_errors,
    _roll_score,
    load_predictions,
    load_release,
    match_record,
)
from corpus_release import pretty_json, sha256_file
from preflight import Expectations, run_preflight
from reference_geometry import canonical_round

REPORT_SCHEMA_ID = "https://tcger.app/reports/card-geometry-outcome-analysis/v1"
BUCKETS = (
    ("[0.00,0.05)", 0.00, 0.05),
    ("[0.05,0.10)", 0.05, 0.10),
    ("[0.10,0.20)", 0.10, 0.20),
    ("[0.20,infinity)", 0.20, math.inf),
)
POSITIVE_VERDICTS = {"true", "true_margin"}
NEGATIVE_VERDICTS = {"false", "false_margin", "no_card"}


def classify_outcome(*, identified: bool, verdict: str | None) -> str:
    """Map the archived device decision and human identity verdict to an outcome."""
    if not identified:
        return "abstain"
    if verdict in POSITIVE_VERDICTS:
        return "correct"
    if verdict in NEGATIVE_VERDICTS:
        return "wrong"
    return "unknown"


def error_bucket(value: float) -> str:
    for label, lower, upper in BUCKETS:
        if lower <= value < upper:
            return label
    raise ValueError(f"normalized error outside supported range: {value}")


def summarize_outcomes(outcomes: list[str]) -> dict[str, Any]:
    counts = Counter(outcomes)
    known = sum(counts[value] for value in ("correct", "wrong", "abstain"))
    accepts = counts["correct"] + counts["wrong"]
    return {
        "frames": len(outcomes),
        "knownOutcomes": known,
        "unknownOutcomes": counts["unknown"],
        "outcomes": {
            value: counts[value]
            for value in ("correct", "wrong", "abstain", "unknown")
        },
        "abstentionRate": counts["abstain"] / known if known else None,
        "wrongAcceptRate": counts["wrong"] / known if known else None,
        "acceptedAccuracy": counts["correct"] / accepts if accepts else None,
    }


def summarize_buckets(
    frames: list[dict[str, Any]], metric: str
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    result = []
    for label, lower, upper in BUCKETS:
        scoped = [
            frame
            for frame in frames
            if frame[metric] is not None and lower <= frame[metric] < upper
        ]
        result.append(
            {
                "label": label,
                "lowerInclusive": lower,
                "upperExclusive": None if math.isinf(upper) else upper,
                **summarize_outcomes([frame["outcome"] for frame in scoped]),
            }
        )
    unmatched = [frame for frame in frames if frame[metric] is None]
    return result, summarize_outcomes([frame["outcome"] for frame in unmatched])


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _manual_labels(path: Path) -> dict[str, dict[str, Any]]:
    document = _load_json(path)
    if not isinstance(document, list):
        raise BenchmarkError(f"label backup must be a JSON array: {path}")
    labels = {}
    for row in document:
        if row.get("fixed_quad_source") != "manual":
            continue
        key = row.get("key")
        if not isinstance(key, str) or "/" not in key:
            raise BenchmarkError("manual label is missing its session/image key")
        session_id = key.split("/", 1)[0]
        suffix = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
        record_id = f"devmode-{session_id}-{suffix}"
        if record_id in labels:
            raise BenchmarkError(f"duplicate manual label for {record_id}")
        labels[record_id] = row
    return labels


def _session_frames(
    labels: dict[str, dict[str, Any]], sessions_root: Path
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    by_key = {}
    hashes = {}
    session_ids = sorted({row["key"].split("/", 1)[0] for row in labels.values()})
    for session_id in session_ids:
        results_path = sessions_root / session_id / "results.json"
        document = _load_json(results_path)
        hashes[session_id] = sha256_file(results_path)
        for frame in document.get("frames", []):
            image_file = frame.get("imageFile")
            if isinstance(image_file, str):
                by_key[f"{session_id}/{image_file}"] = frame
    missing = sorted(row["key"] for row in labels.values() if row["key"] not in by_key)
    if missing:
        raise BenchmarkError(
            "manual labels missing from session results: " + ", ".join(missing[:5])
        )
    return by_key, hashes


def _frame_errors(match, eligible_sources: set[str]) -> tuple[float, float, int]:
    truth_points = _pixel_points(match.truth)
    prediction_points = _prediction_pixel_points(match)
    rolls = _roll_errors(truth_points, prediction_points)
    scores = [_roll_score(errors) for errors in rolls]
    chosen_roll = (
        0
        if match.truth.instance.get("orientationKnown")
        else min(range(4), key=lambda index: scores[index])
    )
    denominator = _mean_truth_side_length(truth_points)
    if denominator is None:
        raise BenchmarkError(
            f"matched frame has no full truth quad: {match.truth.record_id}"
        )
    errors = [
        error / denominator
        for corner, error in zip(
            match.truth.instance.get("corners", []), rolls[chosen_roll]
        )
        if error is not None and corner.get("cornerSource") in eligible_sources
    ]
    if not errors:
        raise BenchmarkError(
            f"matched frame has no metric-eligible corners: {match.truth.record_id}"
        )
    return sum(errors) / len(errors), max(errors), chosen_roll


def analyze(
    *,
    release_root: Path,
    predictions_path: Path,
    label_backup: Path,
    sessions_root: Path,
    expected_corpus_hash: str,
) -> dict[str, Any]:
    preflight = run_preflight(
        release_root,
        expectations=Expectations(corpus_hash=expected_corpus_hash),
        tooling_revision="geometry-outcome-analysis",
    )
    if preflight["failedChecks"]:
        raise BenchmarkError(
            "release preflight failed: " + ", ".join(preflight["failedChecks"])
        )
    manifest, policy, truths = load_release(release_root)
    record_ids = {entry["recordId"] for entry in manifest["records"]}
    localizer_id, prediction_rows = load_predictions(predictions_path, record_ids)
    if localizer_id != "device":
        raise BenchmarkError(f"outcome join requires device predictions, got {localizer_id}")

    labels = _manual_labels(label_backup)
    unknown_records = sorted(set(labels) - record_ids)
    if unknown_records:
        raise BenchmarkError(
            "manual labels absent from release: " + ", ".join(unknown_records[:5])
        )
    session_frames, session_hashes = _session_frames(labels, sessions_root)
    truths_by_record: dict[str, list[Any]] = defaultdict(list)
    for truth in truths:
        truths_by_record[truth.record_id].append(truth)
    eligible_sources = set(policy["metricEligibleCornerSources"])

    frames = []
    for record_id, label in sorted(labels.items()):
        predictions = [
            _prediction(result, index)
            for index, result in enumerate(prediction_rows[record_id])
        ]
        matches, misses, _, duplicate, extra = match_record(
            truths_by_record[record_id], predictions
        )
        if len(matches) > 1:
            raise BenchmarkError(f"expected one card per Dev Mode frame: {record_id}")
        frame = session_frames[label["key"]]
        outcome = classify_outcome(
            identified=bool(frame.get("identified")), verdict=label.get("verdict")
        )
        mean_error = None
        maximum_error = None
        chosen_roll = None
        matched_iou = None
        if matches:
            mean_error, maximum_error, chosen_roll = _frame_errors(
                matches[0], eligible_sources
            )
            matched_iou = matches[0].iou
        frames.append(
            {
                "recordId": record_id,
                "sessionFrameKey": label["key"],
                "identified": bool(frame.get("identified")),
                "humanVerdict": label.get("verdict"),
                "outcome": outcome,
                "geometryMatched": bool(matches),
                "matchedIoU": matched_iou,
                "meanNormalizedCornerError": mean_error,
                "maximumNormalizedCornerError": maximum_error,
                "minimumErrorCyclicRoll": chosen_roll,
                "miss": len(misses),
                "duplicate": duplicate,
                "extra": extra,
            }
        )

    mean_buckets, mean_unmatched = summarize_buckets(
        frames, "meanNormalizedCornerError"
    )
    maximum_buckets, maximum_unmatched = summarize_buckets(
        frames, "maximumNormalizedCornerError"
    )
    below = [
        frame
        for frame in frames
        if frame["meanNormalizedCornerError"] is not None
        and frame["meanNormalizedCornerError"] < 0.20
    ]
    above = [
        frame
        for frame in frames
        if frame["meanNormalizedCornerError"] is not None
        and frame["meanNormalizedCornerError"] >= 0.20
    ]
    report = {
        "schema": REPORT_SCHEMA_ID,
        "corpusHash": manifest["corpusHash"],
        "releaseId": manifest["releaseId"],
        "localizerId": localizer_id,
        "inputs": {
            "predictionsSha256": sha256_file(predictions_path),
            "labelBackupSha256": sha256_file(label_backup),
            "sessionResultsSha256": session_hashes,
            "analyzerSha256": sha256_file(Path(__file__)),
        },
        "method": {
            "pixelMapping": {"x": "x * width", "y": "y * height"},
            "normalizedErrorDenominator": "mean truth-quad side length in source pixels",
            "frameMean": "arithmetic mean of four metric-eligible normalized corner errors",
            "frameMaximum": "maximum of four metric-eligible normalized corner errors",
            "orientationUnknownHandling": "minimum-error cyclic roll, matching the frozen benchmark",
            "outcome": {
                "abstain": "archived results identified=false, independent of identity verdict",
                "correct": "identified=true and human verdict is true or true_margin",
                "wrong": "identified=true and human verdict is false, false_margin, or no_card",
                "unknown": "identified=true without a human identity verdict",
            },
        },
        "counts": {
            "manualFrames": len(frames),
            "geometryMatched": sum(frame["geometryMatched"] for frame in frames),
            "geometryUnmatched": sum(not frame["geometryMatched"] for frame in frames),
            **summarize_outcomes([frame["outcome"] for frame in frames]),
        },
        "byMeanNormalizedCornerError": mean_buckets,
        "byMaximumNormalizedCornerError": maximum_buckets,
        "unmatchedGeometry": {
            "meanMetric": mean_unmatched,
            "maximumMetric": maximum_unmatched,
        },
        "thresholdObservation": {
            "threshold": 0.20,
            "belowThreshold": summarize_outcomes(
                [frame["outcome"] for frame in below]
            ),
            "atOrAboveThreshold": summarize_outcomes(
                [frame["outcome"] for frame in above]
            ),
            "interpretation": "descriptive only; selected before this join from the proposed geometry budget",
        },
        "runtimeCaveat": (
            "Ground-truth corner error is unavailable on-device. This breakpoint can "
            "calibrate a runtime-observable quality proxy, but cannot itself be enforced."
        ),
        "frames": frames,
    }
    return canonical_round(report, 12)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--label-backup", type=Path, required=True)
    parser.add_argument("--sessions-root", type=Path, required=True)
    parser.add_argument("--expected-corpus-hash", required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = analyze(
            release_root=args.release_root,
            predictions_path=args.predictions,
            label_backup=args.label_backup,
            sessions_root=args.sessions_root,
            expected_corpus_hash=args.expected_corpus_hash,
        )
    except (BenchmarkError, OSError, json.JSONDecodeError, ValueError) as error:
        print(f"outcome analysis failed: {error}", file=sys.stderr)
        return 2
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(pretty_json(report), encoding="utf-8")
    print(args.report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
