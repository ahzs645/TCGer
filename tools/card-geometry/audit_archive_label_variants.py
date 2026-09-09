#!/usr/bin/env python3
"""Audit queued archive-label frames for duplicate image variants.

The audit is deliberately narrow: it reads one label queue and its release,
uses manifest ``sourceAssetIds`` as the first signal, then compares resized
grayscale images for color/grayscale siblings.  A sibling is safe to collapse
for labeling only when every queued seed box matches exactly; image similarity
alone is not enough because differently shaped spatial transforms can share the
same scene content while moving the annotation geometry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


DEFAULT_QUEUE = Path(".artifacts/card-geometry/successor-prep/archive-corner-label-queue.json")
DEFAULT_RELEASE = Path(".artifacts/card-geometry/releases/real-geometry-successor-candidate-v1")
DEFAULT_OUTPUT = Path(".artifacts/card-geometry/archive-corner-labels/variant-audit.json")
DEFAULT_SCENE_ASSIGNMENTS = Path("docs/scanner-system/benchmarks/2026-09-02-canonical-multi-card-scenes.json")
FINGERPRINT_SIZE = 64
IDENTITY_THRESHOLD = 0.995
TRANSFORM_THRESHOLD = 0.995


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _fingerprint(path: Path) -> tuple[np.ndarray, float, str, tuple[int, int]]:
    with Image.open(path) as opened:
        rgb = opened.convert("RGB")
        source_size = (rgb.width, rgb.height)
        image = np.asarray(rgb, dtype=np.float32)
    saturation = float(np.mean(image.max(axis=2) - image.min(axis=2)))
    gray = np.asarray(
        Image.fromarray(image.astype(np.uint8), mode="RGB").convert("L").resize(
            (FINGERPRINT_SIZE, FINGERPRINT_SIZE), Image.Resampling.BILINEAR
        ),
        dtype=np.float32,
    )
    gray = (gray - gray.mean()) / max(float(gray.std()), 1e-6)
    return gray, saturation, hashlib.sha256(gray.tobytes()).hexdigest(), source_size


def _geometry_summary(frame: dict[str, Any]) -> tuple[str, int]:
    boxes = [item["seedBox"] for item in frame["instances"]]
    return _canonical(boxes), len(boxes)


def _geometry_match(left: dict[str, Any], right: dict[str, Any], tolerance: float) -> tuple[int, bool, list[float]]:
    """Greedily match each left seed box to one right box within tolerance."""
    if len(left["instances"]) != len(right["instances"]):
        return 0, False, []
    unused = set(range(len(right["instances"])))
    deviations = []
    for source in left["instances"]:
        best = None
        for index in unused:
            target = right["instances"][index]
            delta = max(
                abs(float(source["seedBox"][key]) - float(target["seedBox"][key]))
                for key in ("left", "top", "right", "bottom")
            )
            if best is None or delta < best[0]:
                best = (delta, index)
        if best is None or best[0] > tolerance:
            return len(deviations), False, deviations + ([best[0]] if best else [])
        deviations.append(best[0])
        unused.remove(best[1])
    return len(deviations), True, deviations


def _pair_record(
    left: dict[str, Any],
    right: dict[str, Any],
    score: float,
    relation: str,
    geometry_exact: bool,
    geometry_match_count: int,
    geometry_within_tolerance: bool,
    geometry_deviations: list[float],
    dimensions_equal: bool,
    family: str | None = None,
) -> dict[str, Any]:
    return {
        "left": left["canonicalRecordId"],
        "right": right["canonicalRecordId"],
        "leftImage": left["imagePath"],
        "rightImage": right["imagePath"],
        "sourceArchives": [left.get("sourceArchive"), right.get("sourceArchive")],
        "sourceFilenames": [left.get("sourceFilename"), right.get("sourceFilename")],
        "sceneSlices": [left["sceneSlice"], right["sceneSlice"]],
        "relation": relation,
        "grayscaleCorrelation": round(score, 8),
        "geometryExact": geometry_exact,
        "geometryMatchCount": geometry_match_count,
        "geometryWithinTolerance": geometry_within_tolerance,
        "geometryMaxDeviation": round(max(geometry_deviations, default=0.0), 8),
        "dimensionsEqual": dimensions_equal,
        "sourceFilenameFamily": family,
        "instanceCounts": [len(left["instances"]), len(right["instances"])],
        "representative": left["canonicalRecordId"] if left["saturation"] >= right["saturation"] else right["canonicalRecordId"],
        "representativeReason": "higher mean RGB channel spread (color preference)",
    }


def audit(queue_path: Path, release_dir: Path, scene_assignments_path: Path) -> dict[str, Any]:
    queue = json.loads(queue_path.read_text(encoding="utf-8"))
    manifest = json.loads((release_dir / "manifest.json").read_text(encoding="utf-8"))
    assignments = json.loads(scene_assignments_path.read_text(encoding="utf-8")).get("assignments", [])
    assignment_by_record = {item["recordId"]: item for item in assignments}
    by_image = {entry["images"][0]["path"]: entry for entry in manifest["records"]}
    frames = []
    missing = []
    for raw in queue["frames"]:
        entry = by_image.get(raw["imagePath"])
        image_path = release_dir / raw["imagePath"]
        if entry is None or not image_path.is_file():
            missing.append(raw["canonicalRecordId"])
            continue
        vector, saturation, gray_hash, source_size = _fingerprint(image_path)
        frames.append({
            **raw,
            "sourceAssetIds": entry.get("leakageKeys", {}).get("sourceAssetIds", []),
            "vector": vector,
            "saturation": saturation,
            "grayHash": gray_hash,
            "sourceSize": list(source_size),
            "geometryKey": _geometry_summary(raw)[0],
            "sourceFilename": assignment_by_record.get(raw["canonicalRecordId"], {}).get("imageMember"),
            "sourceArchive": assignment_by_record.get(raw["canonicalRecordId"], {}).get("archive"),
        })

    asset_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for frame in frames:
        for asset in frame["sourceAssetIds"]:
            asset_groups[asset].append(frame)
    asset_duplicates = [
        {"sourceAssetId": asset, "recordIds": [f["canonicalRecordId"] for f in group]}
        for asset, group in asset_groups.items() if len(group) > 1
    ]

    def family_name(frame: dict[str, Any]) -> str | None:
        filename = frame.get("sourceFilename")
        archive = frame.get("sourceArchive")
        if not filename or not archive:
            return None
        filename = filename.rsplit("/", 1)[-1]
        stem = filename.split(".rf.", 1)[0]
        if "." in stem:
            stem = stem.rsplit(".", 1)[0]
        return f"{archive}::{stem}"

    filename_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for frame in frames:
        family = family_name(frame)
        if family:
            filename_groups[family].append(frame)
    source_filename_groups = [
        {
            "family": family,
            "archive": group[0]["sourceArchive"],
            "filenameStem": family.split("::", 1)[1],
            "recordIds": [f["canonicalRecordId"] for f in group],
            "representative": max(group, key=lambda f: f["saturation"])["canonicalRecordId"],
            "representativeReason": "highest mean RGB channel spread (color preference)",
        }
        for family, group in sorted(filename_groups.items()) if len(group) > 1
    ]

    identity_pairs = []
    transform_pairs = []
    for i, left in enumerate(frames):
        for j in range(i + 1, len(frames)):
            right = frames[j]
            geometry_match_count, geometry_within_tolerance, geometry_deviations = _geometry_match(left, right, 0.005)
            geometry_exact = (
                len(left["instances"]) == len(right["instances"])
                and left["geometryKey"] == right["geometryKey"]
            )
            score = float(np.mean(left["vector"] * right["vector"]))
            family = family_name(left) if family_name(left) == family_name(right) else None
            if score >= IDENTITY_THRESHOLD:
                identity_pairs.append(_pair_record(left, right, score, "identity", geometry_exact, geometry_match_count, geometry_within_tolerance, geometry_deviations, left["sourceSize"] == right["sourceSize"], family))
            for relation, transformed in (
                ("rot90", np.rot90(right["vector"].reshape(FINGERPRINT_SIZE, FINGERPRINT_SIZE), 1)),
                ("rot180", np.rot90(right["vector"].reshape(FINGERPRINT_SIZE, FINGERPRINT_SIZE), 2)),
                ("rot270", np.rot90(right["vector"].reshape(FINGERPRINT_SIZE, FINGERPRINT_SIZE), 3)),
                ("flipHorizontal", right["vector"].reshape(FINGERPRINT_SIZE, FINGERPRINT_SIZE)[:, ::-1]),
            ):
                transformed_score = float(np.mean(left["vector"].reshape(FINGERPRINT_SIZE, FINGERPRINT_SIZE) * transformed))
                if transformed_score >= TRANSFORM_THRESHOLD:
                    transform_pairs.append(_pair_record(left, right, transformed_score, relation, geometry_exact, geometry_match_count, geometry_within_tolerance, geometry_deviations, left["sourceSize"] == right["sourceSize"], family))
                    break

    safe_pairs = [pair for pair in identity_pairs if pair["geometryWithinTolerance"] and pair["dimensionsEqual"]]
    report = {
        "schema": "tcger-archive-label-variant-audit/v1",
        "inputs": {"queue": str(queue_path), "release": str(release_dir)},
        "criteria": {
            "grayscaleFingerprint": f"{FINGERPRINT_SIZE}x{FINGERPRINT_SIZE} z-score normalized luminance",
            "identityThreshold": IDENTITY_THRESHOLD,
            "transformedThreshold": TRANSFORM_THRESHOLD,
            "geometryTolerance": 0.005,
            "safeSameGeometry": "identity grayscale pair plus one-to-one seedBox matches within tolerance and equal source dimensions; metadata alone is insufficient",
            "representative": "member with highest mean RGB channel spread",
        },
        "counts": {
            "queueFrames": len(queue["frames"]),
            "auditedFrames": len(frames),
            "missingFrames": len(missing),
            "sourceAssetDuplicateGroups": len(asset_duplicates),
            "identityVariantPairs": len(identity_pairs),
            "safeSameGeometryPairs": len(safe_pairs),
            "spatialTransformPairs": len(transform_pairs),
            "sourceFilenameDuplicateGroups": len(source_filename_groups),
        },
        "sourceAssetDuplicateGroups": asset_duplicates,
        "sourceFilenameGroups": source_filename_groups,
        "identityVariantPairs": identity_pairs,
        "safeSameGeometryPairs": safe_pairs,
        "spatialTransformPairs": transform_pairs,
        "missingRecordIds": missing,
        "caveats": [
            "SourceAssetIds are authoritative metadata when present; grayscale similarity is only a candidate signal.",
            "No pair is safe to collapse unless every ordered normalized seedBox matches exactly.",
            "The fingerprint audit can miss crops, heavy edits, or variants below its correlation threshold.",
            "A duplicate image with changed annotation geometry remains a separate labeling task.",
        ],
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--queue", type=Path, default=DEFAULT_QUEUE)
    parser.add_argument("--release", type=Path, default=DEFAULT_RELEASE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--scene-assignments", type=Path, default=DEFAULT_SCENE_ASSIGNMENTS)
    args = parser.parse_args()
    report = audit(args.queue, args.release, args.scene_assignments)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["counts"], sort_keys=True))


if __name__ == "__main__":
    main()
