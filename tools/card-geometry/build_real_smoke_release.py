"""Build a smoke-purpose geometry release from real, already-curated sources.

The adapter intentionally has a narrow trust boundary:

* standardized COCO `source-polygon` and `source-rle` annotations contribute
  visible masks; `bbox-derived` annotations are excluded from geometry v1;
* a polygon contributes `maskFit` corners only when an explicit conservative
  four-point fit passes residual, convexity, aspect, and occlusion checks;
* Dev Mode contributes corners only from a persisted `fixedQuad`, which is a
  human-confirmed boundary and is therefore tagged `human`;
* inherited source-dataset splits are ignored. Every source archive is assigned
  wholesale to one release split, and known forks must share that split.

The result is a `smoke` release. Its bundled policy can prove the ingestion and
preflight plumbing, but the release purpose prevents it from authorizing a
training job.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus_release import (  # noqa: E402
    MANIFEST_SCHEMA_ID,
    POLICY_SCHEMA_ID,
    RECORD_SCHEMA_ID,
    corpus_hash,
    leakage_keys_from_record,
    pretty_json,
    sha256_bytes,
)

DEFAULT_TCGX_ARCHIVE = "annotations.v7i.coco-segmentation.zip"
KNOWN_FORK_GROUPS = (
    frozenset(
        {
            "card-seg-j74w1.v3i.coco-segmentation.zip",
            "card-seg-j74w1-q8yst.v1i.coco-segmentation.zip",
        }
    ),
)
UNKNOWN_CORNERS = tuple(
    {"visibility": "unlabeled", "coordinateKnown": False} for _ in range(4)
)


def _json_lines(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"{path}:{number}: {error}") from error


def _safe_id(value: str) -> str:
    cleaned = "".join(
        character if character.isalnum() or character in "._:-" else "-"
        for character in value
    )
    cleaned = cleaned.strip("-.")
    if not cleaned or not cleaned[0].isalnum():
        cleaned = f"source-{cleaned}"
    return cleaned[:160]


def _points(flat: list[float]) -> list[tuple[float, float]]:
    if len(flat) < 6 or len(flat) % 2:
        return []
    result = [
        (float(flat[index]), float(flat[index + 1])) for index in range(0, len(flat), 2)
    ]
    if len(result) > 1 and math.dist(result[0], result[-1]) <= 1e-6:
        result.pop()
    return result


def _signed_area(points: list[tuple[float, float]]) -> float:
    return 0.5 * sum(
        x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1])
    )


def _order_quad(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    center_x = sum(point[0] for point in points) / 4
    center_y = sum(point[1] for point in points) / 4
    circular = sorted(
        points, key=lambda point: math.atan2(point[1] - center_y, point[0] - center_x)
    )
    start = min(range(4), key=lambda index: sum(circular[index]))
    ordered = circular[start:] + circular[:start]
    if _signed_area(ordered) < 0:
        ordered = [ordered[0], ordered[3], ordered[2], ordered[1]]
    return ordered


def _convex(points: list[tuple[float, float]]) -> bool:
    signs = []
    for first, second, third in zip(
        points, points[1:] + points[:1], points[2:] + points[:2]
    ):
        cross = (second[0] - first[0]) * (third[1] - second[1]) - (
            second[1] - first[1]
        ) * (third[0] - second[0])
        if abs(cross) <= 1e-6:
            return False
        signs.append(cross > 0)
    return all(signs) or not any(signs)


def conservative_mask_quad(
    points: list[tuple[float, float]], width: int, height: int
) -> tuple[list[tuple[float, float]] | None, str]:
    """Accept only a lossless four-vertex mask fit with explicit quality gates.

    A four-point source polygon has zero boundary residual and a polygon/quad
    area ratio of one. More complex masks are retained as masks but deliberately
    left without corners; approximation belongs in a separately versioned fit
    adapter with measured thresholds.
    """
    if len(points) != 4 or len(set(points)) != 4:
        return None, "residual"
    ordered = _order_quad(points)
    if not _convex(ordered):
        return None, "convexity"
    lengths = [
        math.dist(first, second)
        for first, second in zip(ordered, ordered[1:] + ordered[:1])
    ]
    if min(lengths) <= 0:
        return None, "convexity"
    opposite_width = (lengths[0] + lengths[2]) / 2
    opposite_height = (lengths[1] + lengths[3]) / 2
    aspect = max(opposite_width, opposite_height) / min(opposite_width, opposite_height)
    if not 1.10 <= aspect <= 2.20:
        return None, "aspect"
    polygon_area = abs(_signed_area(points))
    quad_area = abs(_signed_area(ordered))
    if quad_area <= 0 or polygon_area / quad_area < 0.95:
        return None, "occlusion"
    diagonal = math.hypot(width, height)
    residual = 0.0 / diagonal
    if residual > 0.01:
        return None, "residual"
    return ordered, "accepted"


def _normalized_polygon(
    points: list[tuple[float, float]], width: int, height: int
) -> dict[str, Any]:
    return {
        "kind": "polygon",
        "points": [
            {"x": max(0.0, min(x / width, 1.0)), "y": max(0.0, min(y / height, 1.0))}
            for x, y in points
        ],
    }


def _annotation_mask(
    annotation: dict[str, Any], width: int, height: int
) -> tuple[dict[str, Any] | None, list[tuple[float, float]]]:
    segmentation = annotation.get("segmentation")
    if isinstance(segmentation, dict):
        size = segmentation.get("size") or [height, width]
        counts = segmentation.get("counts")
        if counts is None:
            return None, []
        return {
            "kind": "cocoRle",
            "width": int(size[1]),
            "height": int(size[0]),
            "counts": counts,
        }, []
    if not isinstance(segmentation, list):
        return None, []
    polygons = [
        _points(polygon) for polygon in segmentation if isinstance(polygon, list)
    ]
    polygons = [polygon for polygon in polygons if len(polygon) >= 3]
    if not polygons:
        return None, []
    polygon = max(polygons, key=lambda candidate: abs(_signed_area(candidate)))
    return _normalized_polygon(polygon, width, height), polygon


def _unknown_corners() -> list[dict[str, Any]]:
    return [dict(corner) for corner in UNKNOWN_CORNERS]


def _mask_instance(
    annotation: dict[str, Any], index: int, width: int, height: int, stats: Counter
) -> dict[str, Any] | None:
    quality = annotation.get("geometryQuality")
    if quality == "bbox-derived":
        stats["bboxDerivedExcluded"] += 1
        return None
    if quality not in {"source-polygon", "source-rle"}:
        stats["unsupportedAnnotationExcluded"] += 1
        return None
    visible_mask, polygon = _annotation_mask(annotation, width, height)
    if visible_mask is None:
        stats["maskMissingExcluded"] += 1
        return None
    corners = _unknown_corners()
    fit, outcome = (
        conservative_mask_quad(polygon, width, height) if polygon else (None, "rle")
    )
    stats[f"maskFit:{outcome}"] += 1
    if fit:
        corners = [
            {
                "point": {"x": x / width, "y": y / height},
                "visibility": "visible",
                "coordinateKnown": True,
                "cornerSource": "maskFit",
            }
            for x, y in fit
        ]
    instance: dict[str, Any] = {
        "instanceId": f"card-{index}",
        "detectionClass": "card",
        "corners": corners,
        "orientationKnown": False,
        "side": "unknown",
        "container": "unknown",
        "visibleMask": visible_mask,
        "occlusionOrder": index,
    }
    return instance


def _image_dimensions(data: bytes) -> tuple[int, int]:
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data.startswith(b"\xff\xd8"):
        index = 2
        while index + 9 < len(data):
            if data[index] != 0xFF:
                index += 1
                continue
            marker = data[index + 1]
            index += 2
            if marker in {0xD8, 0xD9}:
                continue
            if index + 2 > len(data):
                break
            length = int.from_bytes(data[index : index + 2], "big")
            if marker in {
                0xC0,
                0xC1,
                0xC2,
                0xC3,
                0xC5,
                0xC6,
                0xC7,
                0xC9,
                0xCA,
                0xCB,
                0xCD,
                0xCE,
                0xCF,
            }:
                return int.from_bytes(
                    data[index + 5 : index + 7], "big"
                ), int.from_bytes(data[index + 3 : index + 5], "big")
            index += length
    raise ValueError("unsupported or unreadable image format")


def _write_record(
    root: Path,
    record: dict[str, Any],
    image_bytes: bytes,
    image_suffix: str,
    split: str,
    scene_slice: str,
) -> dict[str, Any]:
    record_id = record["recordId"]
    image_rel = f"images/{record_id}{image_suffix.lower()}"
    record_rel = f"records/{record_id}.json"
    (root / image_rel).parent.mkdir(parents=True, exist_ok=True)
    (root / image_rel).write_bytes(image_bytes)
    image_hash = sha256_bytes(image_bytes)
    record["source"]["path"] = image_rel
    record["source"]["sha256"] = image_hash
    record_text = pretty_json(record)
    (root / record_rel).parent.mkdir(parents=True, exist_ok=True)
    (root / record_rel).write_text(record_text, encoding="utf-8")
    return {
        "recordId": record_id,
        "path": record_rel,
        "sha256": sha256_bytes(record_text.encode("utf-8")),
        "split": split,
        "sceneSlice": scene_slice,
        "leakageKeys": leakage_keys_from_record(record),
        "images": [{"path": image_rel, "sha256": image_hash}],
    }


def _source_license(row: dict[str, Any]) -> str | None:
    values = {
        str(item.get("license"))
        for item in row.get("provenance", [])
        if item.get("license")
    }
    return next(iter(values)) if len(values) == 1 else None


def add_canonical_archive(
    *,
    root: Path,
    rows: list[dict[str, Any]],
    archive_path: Path,
    split: str,
    stats: Counter,
    max_records: int | None = None,
) -> list[dict[str, Any]]:
    entries = []
    source_archive_id = _safe_id(f"coco:{archive_path.stem}")
    with zipfile.ZipFile(archive_path) as archive:
        selected_rows = sorted(rows, key=lambda item: item["id"])
        if max_records is not None:
            selected_rows = selected_rows[:max_records]
            stats["canonicalRecordsOmittedBySmokeLimit"] += len(rows) - len(
                selected_rows
            )
        for row in selected_rows:
            instances = []
            for index, annotation in enumerate(row.get("annotations", [])):
                instance = _mask_instance(
                    annotation, index, int(row["width"]), int(row["height"]), stats
                )
                if instance:
                    instances.append(instance)
            if not instances:
                stats["recordsExcludedNoGeometry"] += 1
                continue
            image_bytes = archive.read(row["imageMember"])
            image_hash = sha256_bytes(image_bytes)
            if image_hash != row["sha256"]:
                raise ValueError(f"canonical image hash mismatch for {row['id']}")
            dimensions = _image_dimensions(image_bytes)
            if dimensions != (int(row["width"]), int(row["height"])):
                raise ValueError(
                    f"canonical image dimensions mismatch for {row['id']}: {dimensions}"
                )
            record: dict[str, Any] = {
                "schema": RECORD_SCHEMA_ID,
                "recordId": _safe_id(f"coco-{row['id']}"),
                "source": {
                    "kind": "real",
                    "width": dimensions[0],
                    "height": dimensions[1],
                },
                "grouping": {"sourceArchiveId": source_archive_id},
                "instances": instances,
            }
            license_id = _source_license(row)
            if license_id:
                record["source"]["licenseId"] = license_id
            suffix = Path(row["imageMember"]).suffix or ".jpg"
            entries.append(
                _write_record(
                    root, record, image_bytes, suffix, split, "single_card_archive"
                )
            )
            stats["canonicalRecordsIncluded"] += 1
    return entries


def _quad_points(value: Any) -> list[tuple[float, float]] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    points = []
    for item in value:
        if isinstance(item, dict) and {"x", "y"} <= set(item):
            points.append((float(item["x"]), float(item["y"])))
        elif isinstance(item, list) and len(item) == 2:
            points.append((float(item[0]), float(item[1])))
        else:
            return None
    if any(not (0 <= x <= 1 and 0 <= y <= 1) for x, y in points):
        return None
    return points


def add_devmode_session(
    root: Path, session: Path, stats: Counter
) -> tuple[list[dict[str, Any]], str | None]:
    results_path = session / "results.json"
    document = json.loads(results_path.read_text(encoding="utf-8"))
    entries = []
    session_id = _safe_id(session.name)
    for index, frame in enumerate(document.get("frames", [])):
        quad = _quad_points(frame.get("fixedQuad"))
        if quad is None:
            continue
        image_file = frame.get("imageFile")
        image_path = session / str(image_file)
        if not image_path.is_file():
            stats["devmodeMissingImage"] += 1
            continue
        image_bytes = image_path.read_bytes()
        width, height = _image_dimensions(image_bytes)
        corners = [
            {
                "point": {"x": x, "y": y},
                "visibility": "visible",
                "coordinateKnown": True,
                "cornerSource": "human",
            }
            for x, y in quad
        ]
        record = {
            "schema": RECORD_SCHEMA_ID,
            "recordId": _safe_id(f"devmode-{session_id}-{index:05d}"),
            "source": {"kind": "real", "width": width, "height": height},
            "grouping": {
                "sourceArchiveId": _safe_id(f"devmode:{session_id}"),
                "sessionId": session_id,
            },
            "instances": [
                {
                    "instanceId": "card-0",
                    "detectionClass": "card",
                    "corners": corners,
                    "orientationKnown": False,
                    "side": "unknown",
                    "container": "unknown",
                    "occlusionOrder": 0,
                }
            ],
        }
        capture_mode = frame.get("captureMode")
        scene_slice = "binder_page" if capture_mode == "binder" else "single_handheld"
        entries.append(
            _write_record(
                root,
                record,
                image_bytes,
                image_path.suffix or ".jpg",
                "test",
                scene_slice,
            )
        )
        stats["devmodeHumanQuadRecords"] += 1
    return entries, session_id if entries else None


def _validate_archive_splits(archive_splits: dict[str, str]) -> None:
    for group in KNOWN_FORK_GROUPS:
        assigned = {archive_splits[name] for name in group if name in archive_splits}
        if len(assigned) > 1:
            raise ValueError(
                f"known fork archives must share one split: {sorted(group)}"
            )


def _smoke_policy(splits: set[str], has_session: bool) -> dict[str, Any]:
    ordered = [split for split in ("train", "validation", "test") if split in splits]
    return {
        "schema": POLICY_SCHEMA_ID,
        "policyId": "real-ingestion-smoke-v1",
        "description": "Tooling-only minimums for the first real-source ingestion smoke; not production training targets.",
        "requiredSplits": ordered,
        "minimumRecordsPerSplit": {split: 1 for split in ordered},
        "minimumInstancesPerSplit": {split: 1 for split in ordered},
        "minimumRealEvaluationSessions": 1 if has_session else 0,
        "realOnlySplits": ordered,
        "requiredSceneSlices": [],
        # Archive records have no session id, while the separate
        # minimumRealEvaluationSessions field still proves that a requested
        # Dev Mode session made it into the release.
        "requiredLeakageKeys": {"real": [], "synthetic": []},
        "metricEligibleCornerSources": ["human", "synthetic"],
    }


def build_release(
    *,
    canonical_corpus: Path,
    raw_dir: Path,
    archive_splits: dict[str, str],
    devmode_sessions: list[Path],
    output: Path,
    max_records_per_archive: int | None = None,
) -> dict[str, Any]:
    _validate_archive_splits(archive_splits)
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(
            f"refusing to replace non-empty output directory: {output}"
        )
    output.mkdir(parents=True, exist_ok=True)
    by_archive: dict[str, list[dict[str, Any]]] = {name: [] for name in archive_splits}
    for row in _json_lines(canonical_corpus):
        if row.get("archive") in by_archive:
            by_archive[row["archive"]].append(row)
    missing = [name for name, rows in by_archive.items() if not rows]
    if missing:
        raise ValueError(f"archives absent from canonical corpus: {missing}")
    stats: Counter = Counter()
    entries = []
    for archive_name in sorted(by_archive):
        archive_path = raw_dir / archive_name
        if not archive_path.is_file():
            raise FileNotFoundError(archive_path)
        entries.extend(
            add_canonical_archive(
                root=output,
                rows=by_archive[archive_name],
                archive_path=archive_path,
                split=archive_splits[archive_name],
                stats=stats,
                max_records=max_records_per_archive,
            )
        )
    denylist = []
    for session in sorted(devmode_sessions):
        session_entries, session_id = add_devmode_session(output, session, stats)
        entries.extend(session_entries)
        if session_id:
            denylist.append(session_id)
    if not entries:
        raise ValueError("no geometry records were produced")
    splits = {entry["split"] for entry in entries}
    policy = _smoke_policy(splits, bool(denylist))
    policy_text = pretty_json(policy)
    (output / "policy.json").write_text(policy_text, encoding="utf-8")
    manifest: dict[str, Any] = {
        "schema": MANIFEST_SCHEMA_ID,
        "releaseId": "real-geometry-ingestion-smoke-v1",
        "releasePurpose": "smoke",
        "readiness": {
            "readinessPolicyPath": "policy.json",
            "readinessPolicyId": policy["policyId"],
            "readinessPolicySha256": sha256_bytes(policy_text.encode("utf-8")),
        },
        "splitAssignment": {"method": "whole-source-archive-explicit-v1", "seed": 0},
        "evaluationSessionDenylist": sorted(denylist),
        "records": sorted(entries, key=lambda entry: entry["recordId"]),
    }
    manifest["corpusHash"] = corpus_hash(manifest)
    (output / "manifest.json").write_text(pretty_json(manifest), encoding="utf-8")
    summary = {
        "release": str(output),
        "corpusHash": manifest["corpusHash"],
        "policySha256": manifest["readiness"]["readinessPolicySha256"],
        "records": len(entries),
        "instances": sum(stats[key] for key in stats if key.startswith("maskFit:"))
        + stats["devmodeHumanQuadRecords"],
        "archiveSplits": dict(sorted(archive_splits.items())),
        "maxRecordsPerArchive": max_records_per_archive,
        "stats": dict(sorted(stats.items())),
    }
    (output / "build-summary.json").write_text(pretty_json(summary), encoding="utf-8")
    return summary


def _archive_split(value: str) -> tuple[str, str]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("expected ARCHIVE=SPLIT")
    archive, split = value.rsplit("=", 1)
    if split not in {"train", "validation", "test"}:
        raise argparse.ArgumentTypeError("split must be train, validation, or test")
    return archive, split


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--canonical-corpus", type=Path, required=True)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument(
        "--archive-split",
        action="append",
        type=_archive_split,
        default=[],
        metavar="ARCHIVE=SPLIT",
        help=f"whole-archive assignment; defaults to {DEFAULT_TCGX_ARCHIVE}=test",
    )
    parser.add_argument("--devmode-session", type=Path, action="append", default=[])
    parser.add_argument(
        "--max-records-per-archive",
        type=int,
        help="Deterministic smoke sample after sorting by record id; omit for a complete archive",
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    archive_splits = dict(args.archive_split or [(DEFAULT_TCGX_ARCHIVE, "test")])
    if args.max_records_per_archive is not None and args.max_records_per_archive < 1:
        parser.error("--max-records-per-archive must be positive")
    summary = build_release(
        canonical_corpus=args.canonical_corpus,
        raw_dir=args.raw_dir,
        archive_splits=archive_splits,
        devmode_sessions=args.devmode_session,
        output=args.output,
        max_records_per_archive=args.max_records_per_archive,
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
