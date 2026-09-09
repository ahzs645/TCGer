#!/usr/bin/env python3
"""Bounded SIFT/RANSAC audit for duplicate variants in queued grid frames.

This is a diagnostic only.  It deliberately does not copy labels: a broad
homography match establishes that two photos may depict the same scene, while
the annotation boxes still need independent review.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image

QUEUE = Path(".artifacts/card-geometry/successor-prep/archive-corner-label-queue.json")
RELEASE = Path(".artifacts/card-geometry/releases/real-geometry-successor-candidate-v1")
ASSIGNMENTS = Path("docs/scanner-system/benchmarks/2026-09-02-canonical-multi-card-scenes.json")
OUTPUT = Path(".artifacts/card-geometry/archive-corner-labels/grid-registration-audit.json")


def _geometry_match(left: dict[str, Any], right: dict[str, Any], tolerance: float = 0.01) -> tuple[int, bool, float]:
    if len(left["instances"]) != len(right["instances"]):
        return 0, False, 0.0
    unused = set(range(len(right["instances"])))
    deviations = []
    for source in left["instances"]:
        candidates = []
        for index in unused:
            target = right["instances"][index]["seedBox"]
            delta = max(abs(float(source["seedBox"][key]) - float(target[key])) for key in ("left", "top", "right", "bottom"))
            candidates.append((delta, index))
        if not candidates:
            return len(deviations), False, max(deviations, default=0.0)
        delta, index = min(candidates)
        deviations.append(delta)
        if delta > tolerance:
            return len(deviations), False, max(deviations)
        unused.remove(index)
    return len(deviations), True, max(deviations, default=0.0)


def _saturation(path: Path) -> float:
    with Image.open(path) as image:
        array = np.asarray(image.convert("RGB"), dtype=np.float32)
    return float(np.mean(array.max(axis=2) - array.min(axis=2)))


def audit(queue_path: Path = QUEUE, release_dir: Path = RELEASE, assignments_path: Path = ASSIGNMENTS) -> dict[str, Any]:
    queue = json.loads(queue_path.read_text())
    assignments = {item["recordId"]: item for item in json.loads(assignments_path.read_text())["assignments"]}
    frames = [frame for frame in queue["frames"] if frame["sceneSlice"] == "multi_card_grid_archive"]
    for frame in frames:
        assignment = assignments.get(frame["canonicalRecordId"], {})
        frame["sourceArchive"] = assignment.get("archive")
        frame["imageMember"] = assignment.get("imageMember")
        frame["sourceSize"] = [frame["width"], frame["height"]]
        frame["saturation"] = _saturation(release_dir / frame["imagePath"])

    sift = cv2.SIFT_create(nfeatures=1400)
    matcher = cv2.BFMatcher()
    features = []
    for frame in frames:
        image = cv2.imread(str(release_dir / frame["imagePath"]), cv2.IMREAD_GRAYSCALE)
        image = cv2.resize(image, (512, 512), interpolation=cv2.INTER_AREA)
        keypoints, descriptors = sift.detectAndCompute(image, None)
        features.append((keypoints, descriptors))

    candidates = []
    strong = []
    for i, left in enumerate(frames):
        for j in range(i + 1, len(frames)):
            right = frames[j]
            pairs = matcher.knnMatch(features[i][1], features[j][1], k=2)
            good = [first for pair in pairs if len(pair) == 2 for first, second in [pair] if first.distance < 0.72 * second.distance]
            if len(good) < 12:
                continue
            source_points = np.float32([features[i][0][match.queryIdx].pt for match in good])
            target_points = np.float32([features[j][0][match.trainIdx].pt for match in good])
            homography, mask = cv2.findHomography(source_points, target_points, cv2.RANSAC, 4.0)
            if homography is None or mask is None:
                continue
            inliers = mask.ravel().astype(bool)
            count = int(inliers.sum())
            points = source_points[inliers]
            spread_x = float(np.ptp(points[:, 0]) / 512.0) if count else 0.0
            spread_y = float(np.ptp(points[:, 1]) / 512.0) if count else 0.0
            coverage = spread_x * spread_y
            if count < 30 or coverage < 0.12:
                continue
            matches, geometry_within_tolerance, geometry_max_deviation = _geometry_match(left, right)
            row = {
                "left": left["canonicalRecordId"], "right": right["canonicalRecordId"],
                "leftImage": left["imagePath"], "rightImage": right["imagePath"],
                "sourceArchives": [left["sourceArchive"], right["sourceArchive"]],
                "sourceImageMembers": [left["imageMember"], right["imageMember"]],
                "meanChannelSpread": [round(left["saturation"], 4), round(right["saturation"], 4)],
                "grayscaleLike": [left["saturation"] < 1.0, right["saturation"] < 1.0],
                "inliers": count, "ratioTestMatches": len(good),
                "coverageX": round(spread_x, 4), "coverageY": round(spread_y, 4), "coverageProduct": round(coverage, 4),
                "geometryMatchCount": matches, "geometryWithinTolerance": geometry_within_tolerance,
                "geometryMaxDeviation": round(geometry_max_deviation, 6),
                "dimensionsEqual": left["sourceSize"] == right["sourceSize"],
                "representative": left["canonicalRecordId"] if left["saturation"] >= right["saturation"] else right["canonicalRecordId"],
                "representativeReason": "higher mean RGB channel spread (color preference)",
                "assessment": "strong candidate" if count >= 100 and coverage >= 0.2 else "uncertain candidate",
            }
            candidates.append(row)
            if row["assessment"] == "strong candidate":
                strong.append(row)

    carddetection = [row for row in candidates if "carddetection-hegxe.v7i.coco.zip" in row["sourceArchives"]]
    return {
        "schema": "tcger-archive-grid-registration-audit/v1",
        "criteria": {
            "scope": "all 90 multi_card_grid_archive queue frames",
            "features": "SIFT on 512x512 grayscale images",
            "match": "0.72 ratio test; homography RANSAC reprojection threshold 4 px",
            "coverageGate": "at least 30 inliers and source inlier spread product >= 0.12",
            "strongCandidate": "at least 100 inliers and spread product >= 0.20",
            "geometryTolerance": 0.01,
            "interpretation": "registration indicates a possible same-scene variant; it never authorizes coordinate copying",
        },
        "counts": {
            "gridFrames": len(frames), "candidatePairs": len(candidates),
            "strongCandidates": len(strong), "carddetectionCandidatePairs": len(carddetection),
            "carddetectionStrongCandidates": sum(row["assessment"] == "strong candidate" for row in carddetection),
        },
        "strongCandidates": strong,
        "candidatePairs": candidates,
        "carddetectionCandidates": carddetection,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    report = audit()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["counts"], sort_keys=True))


if __name__ == "__main__":
    main()
