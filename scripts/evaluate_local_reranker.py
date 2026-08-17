#!/usr/bin/env python3
"""Evaluate ORB, AKAZE, and SIFT homography reranking over ANN top-five.

Input is the JSON produced by evaluate-full-card-embeddings.ts. The script
uses the exact same labeled cases and downloaded reference images, masks
saturated low-chroma glare in the query, and reports both unconditional
reranking and a conservative evidence-gated policy calibrated on a fixed
half-split and evaluated on the untouched holdout half.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np


@dataclass
class MatchEvidence:
    candidate_id: str
    baseline_similarity: float
    keypoints_query: int
    keypoints_reference: int
    ratio_matches: int
    inliers: int
    inlier_ratio: float
    spatial_coverage: float
    median_reprojection_error: float | None
    sane_homography: bool
    score: float
    elapsed_ms: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--max-side", type=int, default=720)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_gray(path: str, max_side: int, suppress_glare: bool) -> tuple[np.ndarray, np.ndarray]:
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Unable to decode {path}")
    height, width = image.shape[:2]
    scale = min(1.0, max_side / max(height, width))
    if scale < 1:
        image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    mask = np.full(gray.shape, 255, dtype=np.uint8)
    if suppress_glare:
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        glare = ((hsv[:, :, 2] >= 245) & (hsv[:, :, 1] <= 45)).astype(np.uint8) * 255
        glare = cv2.dilate(glare, np.ones((7, 7), np.uint8), iterations=1)
        mask = cv2.bitwise_not(glare)
    border = max(2, round(min(gray.shape[:2]) * 0.02))
    mask[:border, :] = 0
    mask[-border:, :] = 0
    mask[:, :border] = 0
    mask[:, -border:] = 0
    return gray, mask


def detector_factory(name: str) -> tuple[Any, int, float]:
    if name == "orb":
        return cv2.ORB_create(nfeatures=3000, scaleFactor=1.2, nlevels=8, fastThreshold=7), cv2.NORM_HAMMING, 0.78
    if name == "akaze":
        return cv2.AKAZE_create(threshold=0.0005), cv2.NORM_HAMMING, 0.78
    if name == "sift":
        return cv2.SIFT_create(nfeatures=2500, contrastThreshold=0.02, edgeThreshold=12), cv2.NORM_L2, 0.75
    raise ValueError(name)


def polygon_area(points: np.ndarray) -> float:
    return float(abs(cv2.contourArea(points.astype(np.float32))))


def compute_evidence(
    detector_name: str,
    query_path: str,
    reference_path: str,
    candidate_id: str,
    baseline_similarity: float,
    max_side: int,
) -> MatchEvidence:
    started = time.perf_counter()
    query, query_mask = read_gray(query_path, max_side, suppress_glare=True)
    reference, reference_mask = read_gray(reference_path, max_side, suppress_glare=False)
    reference = cv2.resize(reference, (query.shape[1], query.shape[0]), interpolation=cv2.INTER_CUBIC)
    reference_mask = cv2.resize(reference_mask, (query.shape[1], query.shape[0]), interpolation=cv2.INTER_NEAREST)
    detector, norm, ratio_threshold = detector_factory(detector_name)
    query_keypoints, query_descriptors = detector.detectAndCompute(query, query_mask)
    reference_keypoints, reference_descriptors = detector.detectAndCompute(reference, reference_mask)

    empty = query_descriptors is None or reference_descriptors is None
    ratio_matches: list[Any] = []
    if not empty:
        matcher = cv2.BFMatcher(norm, crossCheck=False)
        forward: list[Any] = []
        for pair in matcher.knnMatch(query_descriptors, reference_descriptors, k=2):
            if len(pair) == 2 and pair[0].distance < ratio_threshold * pair[1].distance:
                forward.append(pair[0])
        reverse: dict[int, int] = {}
        for pair in matcher.knnMatch(reference_descriptors, query_descriptors, k=2):
            if len(pair) == 2 and pair[0].distance < ratio_threshold * pair[1].distance:
                reverse[pair[0].queryIdx] = pair[0].trainIdx
        ratio_matches = [match for match in forward if reverse.get(match.trainIdx) == match.queryIdx]

    inliers = 0
    inlier_ratio = 0.0
    coverage = 0.0
    reprojection_error: float | None = None
    sane = False
    if len(ratio_matches) >= 4:
        query_points = np.float32([query_keypoints[match.queryIdx].pt for match in ratio_matches])
        reference_points = np.float32([reference_keypoints[match.trainIdx].pt for match in ratio_matches])
        cv2.setRNGSeed(0)
        homography, inlier_mask = cv2.findHomography(
            reference_points,
            query_points,
            cv2.RANSAC,
            4.0,
            maxIters=3000,
            confidence=0.995,
        )
        if homography is not None and inlier_mask is not None:
            keep = inlier_mask.ravel().astype(bool)
            inliers = int(keep.sum())
            inlier_ratio = inliers / len(ratio_matches)
            if inliers >= 3:
                query_hull = cv2.convexHull(query_points[keep])
                reference_hull = cv2.convexHull(reference_points[keep])
                query_coverage = polygon_area(query_hull) / float(query.shape[0] * query.shape[1])
                reference_coverage = polygon_area(reference_hull) / float(reference.shape[0] * reference.shape[1])
                coverage = min(query_coverage, reference_coverage)
                projected = cv2.perspectiveTransform(reference_points[keep, None, :], homography)[:, 0, :]
                if abs(float(np.linalg.det(homography))) > 1e-9:
                    inverse = np.linalg.inv(homography)
                    reverse_projected = cv2.perspectiveTransform(query_points[keep, None, :], inverse)[:, 0, :]
                    forward_errors = np.linalg.norm(projected - query_points[keep], axis=1)
                    reverse_errors = np.linalg.norm(reverse_projected - reference_points[keep], axis=1)
                    reprojection_error = float(np.median(np.maximum(forward_errors, reverse_errors)))
            reference_corners = np.float32(
                [[0, 0], [reference.shape[1] - 1, 0], [reference.shape[1] - 1, reference.shape[0] - 1], [0, reference.shape[0] - 1]]
            )
            projected_corners = cv2.perspectiveTransform(reference_corners[None, :, :], homography)[0]
            finite = bool(np.isfinite(projected_corners).all())
            area_ratio = polygon_area(projected_corners) / float(query.shape[0] * query.shape[1]) if finite else math.inf
            convex = finite and bool(cv2.isContourConvex(projected_corners.astype(np.float32).reshape(-1, 1, 2)))
            query_frame = np.float32(
                [[0, 0], [query.shape[1] - 1, 0], [query.shape[1] - 1, query.shape[0] - 1], [0, query.shape[0] - 1]]
            )
            intersection = 0.0
            if finite and convex:
                intersection, _ = cv2.intersectConvexConvex(projected_corners.astype(np.float32), query_frame)
            overlap = float(intersection) / max(polygon_area(projected_corners), 1e-9) if finite else 0.0
            reprojection_limit_value = reprojection_error if reprojection_error is not None else math.inf
            sane = finite and convex and 0.20 <= area_ratio <= 4.0 and overlap >= 0.60 and reprojection_limit_value <= 6.0

    score = 0.0
    if sane:
        score = inliers * (0.5 + min(coverage, 1.0)) * (0.5 + inlier_ratio)
    return MatchEvidence(
        candidate_id=candidate_id,
        baseline_similarity=baseline_similarity,
        keypoints_query=len(query_keypoints),
        keypoints_reference=len(reference_keypoints),
        ratio_matches=len(ratio_matches),
        inliers=inliers,
        inlier_ratio=inlier_ratio,
        spatial_coverage=coverage,
        median_reprojection_error=reprojection_error,
        sane_homography=sane,
        score=score,
        elapsed_ms=(time.perf_counter() - started) * 1000,
    )


def gated_choice(
    baseline_id: str | None,
    ranked: list[MatchEvidence],
    minimum_inliers: int,
    minimum_margin: float,
    minimum_coverage: float,
) -> str | None:
    if not ranked:
        return baseline_id
    winner = ranked[0]
    runner_score = ranked[1].score if len(ranked) > 1 else 0.0
    margin = winner.score / max(runner_score, 1e-9)
    if (
        winner.sane_homography
        and winner.inliers >= minimum_inliers
        and winner.spatial_coverage >= minimum_coverage
        and margin >= minimum_margin
    ):
        return winner.candidate_id
    return baseline_id


def policy_metrics(rows: list[dict[str, Any]], detector: str, policy: tuple[int, float, float]) -> dict[str, int]:
    minimum_inliers, minimum_margin, minimum_coverage = policy
    correct = corrections = regressions = changed = 0
    for row in rows:
        ranked = sorted(row["localEvidence"][detector], key=lambda item: item["score"], reverse=True)
        evidence = [MatchEvidence(**item) for item in ranked]
        choice = gated_choice(row["productionTop1"], evidence, minimum_inliers, minimum_margin, minimum_coverage)
        baseline_correct = row["productionTop1"] == row["expectedId"]
        choice_correct = choice == row["expectedId"]
        correct += int(choice_correct)
        changed += int(choice != row["productionTop1"])
        corrections += int(choice_correct and not baseline_correct)
        regressions += int(baseline_correct and not choice_correct)
    return {"correct": correct, "corrections": corrections, "regressions": regressions, "changed": changed}


def calibrate(rows: list[dict[str, Any]], detector: str) -> tuple[tuple[int, float, float], dict[str, int]]:
    candidates = [
        (8, 1.25, 0.03),
        (12, 1.50, 0.03),
        (20, 1.50, 0.06),
        (35, 2.00, 0.06),
        (50, 2.00, 0.06),
        (100, 2.00, 0.06),
    ]
    scored = []
    for policy in candidates:
        metrics = policy_metrics(rows, detector, policy)
        utility = metrics["correct"] * 100 - metrics["regressions"] * 500 + metrics["corrections"]
        scored.append((utility, metrics["correct"], -metrics["regressions"], policy, metrics))
    scored.sort(reverse=True)
    _, _, _, policy, metrics = scored[0]
    return policy, metrics


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    source = json.loads(args.input.read_text())
    rows = source["cases"]
    detectors = ("orb", "akaze", "sift")

    for index, row in enumerate(rows):
        row["localEvidence"] = {}
        for detector in detectors:
            evidence = []
            for candidate in row["candidateReferences"]:
                reference_path = candidate.get("referencePath")
                if not reference_path:
                    continue
                evidence.append(
                    asdict(
                        compute_evidence(
                            detector,
                            row["queryPath"],
                            reference_path,
                            candidate["id"],
                            float(candidate["baselineSimilarity"]),
                            args.max_side,
                        )
                    )
                )
            row["localEvidence"][detector] = evidence
        print(f"[local features] {index + 1}/{len(rows)}", flush=True)

    calibration = [row for row in rows if row["split"] == "calibration"]
    holdout = [row for row in rows if row["split"] == "holdout"]
    summary: dict[str, Any] = {
        "cases": len(rows),
        "calibrationCases": len(calibration),
        "holdoutCases": len(holdout),
        "productionTop1": sum(row["productionTop1"] == row["expectedId"] for row in rows),
        "productionTop5Coverage": sum(row["productionTopKCoverage"] for row in rows),
        "detectors": {},
    }
    for detector in detectors:
        policy, calibration_metrics = calibrate(calibration, detector)
        unconditional_all = sum(
            bool(row["localEvidence"][detector])
            and max(row["localEvidence"][detector], key=lambda item: item["score"])["candidate_id"] == row["expectedId"]
            for row in rows
        )
        elapsed_per_candidate = [
            item["elapsed_ms"]
            for row in rows
            for item in row["localEvidence"][detector]
        ]
        elapsed_per_case = [
            sum(item["elapsed_ms"] for item in row["localEvidence"][detector])
            for row in rows
        ]
        summary["detectors"][detector] = {
            "policy": {
                "minimumInliers": policy[0],
                "minimumWinnerRunnerMargin": policy[1],
                "minimumSpatialCoverage": policy[2],
            },
            "calibration": calibration_metrics,
            "holdout": policy_metrics(holdout, detector, policy),
            "all": policy_metrics(rows, detector, policy),
            "unconditionalTop1All": unconditional_all,
            "medianElapsedMsPerCandidate": float(np.median(elapsed_per_candidate)),
            "p95ElapsedMsPerCandidate": float(np.percentile(elapsed_per_candidate, 95)),
            "medianSequentialTopFiveMs": float(np.median(elapsed_per_case)),
            "p95SequentialTopFiveMs": float(np.percentile(elapsed_per_case, 95)),
        }

    output = {
        "schemaVersion": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "experiment": "top-five-local-feature-homography-reranker",
        "source": str(args.input),
        "sourceSha256": sha256_file(args.input),
        "scriptSha256": sha256_file(Path(__file__)),
        "opencvVersion": cv2.__version__,
        "maxSide": args.max_side,
        "matcher": "mutual bidirectional Lowe-ratio matches; seeded RANSAC homography; symmetric transfer error",
        "masking": "2% border on query/reference; saturated low-chroma glare suppression on query only",
        "detectorParameters": {
            "orb": {"nfeatures": 3000, "scaleFactor": 1.2, "nlevels": 8, "fastThreshold": 7, "ratio": 0.78},
            "akaze": {"threshold": 0.0005, "ratio": 0.78},
            "sift": {"nfeatures": 2500, "contrastThreshold": 0.02, "edgeThreshold": 12, "ratio": 0.75},
        },
        "summary": summary,
        "cases": rows,
    }
    json_path = args.output_dir / "local-reranker-results.json"
    json_path.write_text(json.dumps(output, indent=2))

    csv_path = args.output_dir / "local-reranker-cases.csv"
    with csv_path.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "id", "dataset", "split", "expectedId", "productionTop1",
                "productionTopKCoverage", "orbTop1", "akazeTop1", "siftTop1",
            ],
        )
        writer.writeheader()
        for row in rows:
            record = {
                key: row[key]
                for key in ("id", "dataset", "split", "expectedId", "productionTop1", "productionTopKCoverage")
            }
            for detector in detectors:
                ranked = sorted(row["localEvidence"][detector], key=lambda item: item["score"], reverse=True)
                record[f"{detector}Top1"] = ranked[0]["candidate_id"] if ranked else None
            writer.writerow(record)
    print(json.dumps({"json": str(json_path), "csv": str(csv_path), "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
