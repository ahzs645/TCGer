"""Build a smoke-purpose geometry release from real, already-curated sources.

The adapter intentionally has a narrow trust boundary:

* only canonical annotations whose category has the `primary` role in the
  category contract (`tools/card-segmentation-data/source-config.json`) become
  whole-card geometry targets. `auxiliary` regions (inner borders, title,
  information and collection regions) and `context` objects (slabs) are counted
  in `source.annotationCategories` and never become instances; a slab that
  encloses a card only sets that card's `container`. Unknown or missing
  categories fail the build instead of being guessed. Every emitted instance
  records its `sourceCategory` and `sourceAnnotationIndex`, and the manifest
  declares the `targetSemantics` contract so preflight can verify the boundary;
* standardized COCO `source-polygon` and `source-rle` annotations contribute
  visible masks; `bbox-derived` annotations retain boxes with unknown corners;
* a polygon contributes `maskFit` corners only when an explicit conservative
  four-point fit passes residual, convexity, aspect, and occlusion checks;
* Dev Mode contributes persisted `fixedQuad` corners with their durable
  provenance: `manual` is human ground truth, named detector sources remain
  metric-excluded detector evidence, and unknown provenance is skipped;
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

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from scanner_recording_images import default_input_cache, materialize_input
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from card_layer_order import ordered_indices, validate_relations  # noqa: E402
from polygon_quad_fit import (  # noqa: E402
    ADAPTER_ID as POLYGON_FIT_V2,
    CONSERVATIVE_ADAPTER_ID,
    fit_polygon_quad,
)
from corpus_release import (  # noqa: E402
    MANIFEST_SCHEMA_ID,
    POLICY_SCHEMA_ID,
    RECORD_SCHEMA_ID,
    corpus_hash,
    leakage_keys_from_record,
    load_json,
    load_schema,
    make_validator,
    pretty_json,
    sha256_bytes,
    sha256_file,
    validation_errors,
)

DEFAULT_TCGX_ARCHIVE = "annotations.v7i.coco-segmentation.zip"
SHIPPABLE_LICENSES = frozenset({"CC BY 4.0", "MIT", "self-captured"})
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
MULTI_INSTANCE_SCHEMA = (
    Path(__file__).resolve().parents[2]
    / "docs/scanner-system/schemas/card-geometry-manual-multi-instance-labels.v1.schema.json"
)
ARCHIVE_CORNER_LABELS_SCHEMA = (
    Path(__file__).resolve().parents[2]
    / "docs/scanner-system/schemas/card-geometry-archive-corner-labels.v1.schema.json"
)
# A human quad must cover the canonical annotation box it refines; anything
# looser is a mismatched annotation index, not a corner refinement.
ARCHIVE_LABEL_MIN_BOX_IOU = 0.5
CATEGORY_CONTRACT_PATH = (
    Path(__file__).resolve().parents[1] / "card-segmentation-data" / "source-config.json"
)
CATEGORY_ROLES = ("primary", "auxiliary", "context")
TARGET_SEMANTICS_CONTRACT = "canonical-primary-card-targets-v1"
# A slab annotation encloses a card when the card box lies inside the slab box
# within this normalized tolerance on every side.
SLAB_CONTAINMENT_TOLERANCE = 0.02
POLYGON_FIT_ADAPTERS = (CONSERVATIVE_ADAPTER_ID, POLYGON_FIT_V2)
# Provisional multi-card scene assignments from classify_canonical_scenes.py map
# to archive-specific slices. The names describe the measured layout, not a
# verified binder or duel scene, and never collide with synthetic or Dev Mode
# slices so per-slice minimums stay separately enforceable.
SCENE_ASSIGNMENT_SLICES = {
    "binder_page": "multi_card_grid_archive",
    "duel_field": "multi_card_scatter_archive",
    "other": "multi_card_other_archive",
}
SINGLE_CARD_SLICE = "single_card_archive"


def load_scene_assignments(path: Path, canonical_corpus: Path) -> dict[str, Any]:
    """Read classifier assignments and bind them to the canonical corpus bytes."""
    document = load_json(path)
    declared = document.get("input", {}).get("sha256")
    actual = sha256_file(canonical_corpus)
    if declared != actual:
        raise ValueError(
            f"scene assignments were computed for canonical corpus {declared!r}, not {actual!r}"
        )
    by_record = {}
    for item in document.get("assignments", []):
        assignment = item.get("assignment")
        if assignment not in SCENE_ASSIGNMENT_SLICES:
            raise ValueError(f"unknown scene assignment {assignment!r} for {item.get('recordId')}")
        by_record[item["recordId"]] = SCENE_ASSIGNMENT_SLICES[assignment]
    return {
        "path": path,
        "sha256": sha256_file(path),
        "heuristic": document.get("heuristic", {}).get("id"),
        "byRecord": by_record,
    }


def load_archive_corner_labels(path: Path, canonical_corpus: Path) -> dict[str, Any]:
    """Read archive corner labels and their provenance, bound to corpus bytes."""
    document = load_json(path)
    errors = validation_errors(make_validator(load_schema(ARCHIVE_CORNER_LABELS_SCHEMA)), document)
    if errors:
        raise ValueError("invalid archive corner labels:\n- " + "\n- ".join(errors))
    actual = sha256_file(canonical_corpus)
    if document["canonicalCorpusSha256"] != actual:
        raise ValueError(
            f"archive corner labels were drawn on canonical corpus {document['canonicalCorpusSha256']!r}, not {actual!r}"
        )
    frames: dict[str, dict[str, Any]] = {}
    for frame in document["frames"]:
        if frame["canonicalRecordId"] in frames:
            raise ValueError(f"duplicate archive corner label frame {frame['canonicalRecordId']}")
        indices = [item["sourceAnnotationIndex"] for item in frame["instances"]]
        if len(indices) != len(set(indices)):
            raise ValueError(f"duplicate sourceAnnotationIndex in {frame['canonicalRecordId']}")
        validate_relations(frame.get("occlusionRelations", []), indices)
        frames[frame["canonicalRecordId"]] = frame
    return {"path": path, "sha256": sha256_file(path), "frames": frames}


def _box_iou(first: dict[str, float], second: dict[str, float]) -> float:
    width = max(0.0, min(first["right"], second["right"]) - max(first["left"], second["left"]))
    height = max(0.0, min(first["bottom"], second["bottom"]) - max(first["top"], second["top"]))
    inter = width * height
    area = lambda box: max(0.0, box["right"] - box["left"]) * max(0.0, box["bottom"] - box["top"])  # noqa: E731
    union = area(first) + area(second) - inter
    return inter / union if union > 0 else 0.0


def _validate_archive_quad_order(quad: list[list[float]]) -> None:
    """Require image-space clockwise TL,TR,BR,BL ordering.

    Image coordinates have y increasing downward, so the canonical card order
    has positive shoelace/cross products.  Cyclic rotations retain that order;
    reversing the winding would make the perspective crop mirrored.
    """
    crosses = []
    for i, a in enumerate(quad):
        b = quad[(i + 1) % 4]
        c = quad[(i + 2) % 4]
        crosses.append(
            (b[0] - a[0]) * (c[1] - b[1])
            - (b[1] - a[1]) * (c[0] - b[0])
        )
    if not all(cross > 1e-8 for cross in crosses):
        raise ValueError(
            "archive corner labels must use clockwise TL,TR,BR,BL order"
        )


def _apply_archive_corner_labels(
    row: dict[str, Any],
    instances: list[dict[str, Any]],
    frame: dict[str, Any],
    stats: Counter,
) -> None:
    """Replace box-only or fitted corners, retaining human or model provenance."""
    if frame["imageSha256"] != row["sha256"]:
        raise ValueError(f"archive corner labels for {row['id']} were drawn on different image bytes")
    by_index = {instance["sourceAnnotationIndex"]: instance for instance in instances}
    sources = set()
    for label in frame["instances"]:
        source = label.get("cornerSource", "human")
        if source not in ("human", "detector"):
            raise ValueError("archive cornerSource must be human or detector")
        sources.add(source)
        instance = by_index.get(label["sourceAnnotationIndex"])
        if instance is None:
            raise ValueError(
                f"archive corner label {row['id']}:{label['sourceAnnotationIndex']} does not name a whole-card target"
            )
        _validate_archive_quad_order(label["corners"])
        xs = [point[0] for point in label["corners"]]
        ys = [point[1] for point in label["corners"]]
        quad_box = {
            "left": max(0.0, min(xs)), "top": max(0.0, min(ys)),
            "right": min(1.0, max(xs)), "bottom": min(1.0, max(ys)),
        }
        if _box_iou(quad_box, instance["box"]) < ARCHIVE_LABEL_MIN_BOX_IOU:
            raise ValueError(
                f"archive corner label {row['id']}:{label['sourceAnnotationIndex']} does not cover its annotation box"
            )
        instance["corners"] = [
            {
                "point": {"x": float(x), "y": float(y)},
                "visibility": visibility,
                "coordinateKnown": True,
                "cornerSource": source,
            }
            for (x, y), visibility in zip(label["corners"], label["cornerVisibility"], strict=True)
        ]
        instance["orientationKnown"] = bool(label["orientationKnown"])
        instance.pop("cornerFit", None)
        stats["archiveHumanCornerInstances" if source == "human" else "archiveBotCornerInstances"] += 1
    for source in sources:
        stats["archiveHumanCornerRecords" if source == "human" else "archiveBotCornerRecords"] += 1
    if frame.get("occlusionRelations"):
        relations = validate_relations(frame["occlusionRelations"], [i["sourceAnnotationIndex"] for i in frame["instances"]])
        # Legacy total order needs a deterministic tie-break for unrelated cards.
        # cardsAbove retains only the explicitly reviewed partial relationships.
        for rank, index in enumerate(ordered_indices(by_index, relations)):
            by_index[index]["occlusionOrder"] = rank
        for relation in relations:
            below = by_index[relation["below"]]
            below.setdefault("cardsAbove", []).append(by_index[relation["above"]]["instanceId"])
        stats["archiveHumanLayerRelations"] += len(relations)


def load_category_contract(path: Path = CATEGORY_CONTRACT_PATH) -> dict[str, Any]:
    """Read the canonical category roles that decide what becomes a card target.

    The canonicalizer already resolved every raw source label into one of these
    canonical categories. This adapter must not re-interpret them: `primary`
    categories are whole cards, `auxiliary` categories are card subregions and
    `context` categories are objects that hold cards.
    """
    data = path.read_bytes()
    document = json.loads(data)
    roles: dict[str, str] = {}
    for item in document.get("canonicalCategories", []):
        name = item.get("name") if isinstance(item, dict) else None
        role = item.get("role") if isinstance(item, dict) else None
        if not isinstance(name, str) or role not in CATEGORY_ROLES:
            raise ValueError(f"invalid canonical category entry in {path}: {item!r}")
        if name in roles:
            raise ValueError(f"duplicate canonical category {name!r} in {path}")
        roles[name] = role
    if "card" not in roles or roles["card"] != "primary":
        raise ValueError(f"category contract {path} does not declare `card` as primary")
    return {"path": path, "sha256": sha256_bytes(data), "roles": roles}


def target_semantics(contract: dict[str, Any]) -> dict[str, Any]:
    """Manifest declaration preflight verifies against every archive record."""
    roles = contract["roles"]
    return {
        "contract": TARGET_SEMANTICS_CONTRACT,
        "primaryCategories": sorted(n for n, r in roles.items() if r == "primary"),
        "auxiliaryCategories": sorted(n for n, r in roles.items() if r == "auxiliary"),
        "contextCategories": sorted(n for n, r in roles.items() if r == "context"),
        "categoryContractSha256": contract["sha256"],
    }


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
    points: list[tuple[float, float]],
) -> tuple[list[tuple[float, float]] | None, str]:
    """Accept only a lossless four-vertex mask fit with explicit quality gates.

    A four-point source polygon has zero boundary residual and a polygon/quad
    area ratio of one. More complex masks are retained as masks but deliberately
    left without corners; approximation belongs in a separately versioned fit
    adapter with measured thresholds.
    """
    # Requiring the source mask itself to have exactly four unique vertices is
    # the residual gate: an accepted fit reproduces the boundary with zero
    # residual by construction. Approximation belongs in a separately
    # versioned adapter with measured thresholds.
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


def _annotation_box(
    annotation: dict[str, Any],
    polygon: list[tuple[float, float]],
    width: int,
    height: int,
) -> dict[str, float] | None:
    """Normalized extent of an annotation from its bbox, else its polygon."""
    box = None
    raw_box = annotation.get("bbox")
    if isinstance(raw_box, list) and len(raw_box) == 4:
        x, y, w, h = map(float, raw_box)
        if all(math.isfinite(value) for value in (x, y, w, h)) and w > 0 and h > 0:
            box = {"left": max(0.0, x / width), "top": max(0.0, y / height),
                   "right": min(1.0, (x + w) / width), "bottom": min(1.0, (y + h) / height)}
    if box is None and polygon:
        box = {"left": max(0.0, min(p[0] for p in polygon) / width),
               "top": max(0.0, min(p[1] for p in polygon) / height),
               "right": min(1.0, max(p[0] for p in polygon) / width),
               "bottom": min(1.0, max(p[1] for p in polygon) / height)}
    if box is None or box["right"] <= box["left"] or box["bottom"] <= box["top"]:
        return None
    return box


def _box_inside(inner: dict[str, float], outer: dict[str, float]) -> bool:
    tolerance = SLAB_CONTAINMENT_TOLERANCE
    return (
        inner["left"] >= outer["left"] - tolerance
        and inner["top"] >= outer["top"] - tolerance
        and inner["right"] <= outer["right"] + tolerance
        and inner["bottom"] <= outer["bottom"] + tolerance
    )


def _mask_instance(
    annotation: dict[str, Any],
    index: int,
    width: int,
    height: int,
    stats: Counter,
    polygon_fit: str = CONSERVATIVE_ADAPTER_ID,
) -> dict[str, Any] | None:
    if polygon_fit not in POLYGON_FIT_ADAPTERS:
        raise ValueError(f"unknown polygon fit adapter {polygon_fit!r}")
    quality = annotation.get("geometryQuality")
    visible_mask, polygon = _annotation_mask(annotation, width, height)
    box = _annotation_box(annotation, polygon, width, height)
    if box is None:
        stats["instancesMissingBox"] += 1
        return None
    corners = _unknown_corners()
    adapter_used = None
    fit, outcome = (conservative_mask_quad(polygon) if polygon else (None, "rle")) if quality in {
        "source-polygon", "source-rle"} else (None, "box-only")
    if fit:
        adapter_used = CONSERVATIVE_ADAPTER_ID
    elif polygon and polygon_fit == POLYGON_FIT_V2 and outcome in {"residual", "aspect"}:
        # Only outlines the lossless adapter rejected for shape reasons reach
        # the gated line fit; convexity/occlusion rejections stay rejected.
        fit, v2_outcome, _metrics = fit_polygon_quad(polygon)
        stats[f"polygonFitV2:{v2_outcome}"] += 1
        if fit:
            adapter_used = POLYGON_FIT_V2
            outcome = f"accepted:{POLYGON_FIT_V2}"
    if quality not in {"source-polygon", "source-rle"}:
        # The rectangle encodes only extent, never a visible mask or a quad.
        visible_mask = None
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
        "box": box,
        "occlusionOrder": index,
    }
    if visible_mask is not None:
        instance["visibleMask"] = visible_mask
    if adapter_used is not None:
        instance["cornerFit"] = adapter_used
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
    source_tier: str = "shippable",
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
        "sourceTier": source_tier,
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


def _shippable_source_license(row: dict[str, Any]) -> str:
    license_id = _source_license(row)
    if license_id not in SHIPPABLE_LICENSES:
        raise ValueError(
            f"canonical source {row.get('id')} has no single shippable license: {license_id!r}"
        )
    return license_id


def _card_instances(
    row: dict[str, Any],
    roles: dict[str, str],
    stats: Counter,
    polygon_fit: str = CONSERVATIVE_ADAPTER_ID,
) -> tuple[list[dict[str, Any]], Counter] | None:
    """Whole-card targets of one canonical record, or None to exclude the image.

    Every annotation is classified through the category contract before any
    geometry is read. Auxiliary and context annotations are counted but never
    become instances, and a missing box on them cannot exclude the image; a
    primary annotation without a usable box still excludes the whole image so a
    visible card never becomes an unlabeled negative.
    """
    width, height = int(row["width"]), int(row["height"])
    annotations = row.get("annotations", [])
    categories: Counter = Counter()
    for index, annotation in enumerate(annotations):
        category = annotation.get("category") if isinstance(annotation, dict) else None
        if not isinstance(category, str) or category not in roles:
            raise ValueError(
                f"canonical record {row.get('id')} annotation {index} has unknown "
                f"category {category!r}; extend the category contract instead of guessing"
            )
        categories[category] += 1
    slab_boxes = []
    for annotation in annotations:
        if roles[annotation["category"]] != "context":
            continue
        _, polygon = _annotation_mask(annotation, width, height)
        slab_box = _annotation_box(annotation, polygon, width, height)
        if slab_box is None:
            stats["contextAnnotationsWithoutBox"] += 1
        elif annotation["category"] == "slab":
            slab_boxes.append(slab_box)
    instances: list[dict[str, Any]] = []
    for index, annotation in enumerate(annotations):
        category = annotation["category"]
        role = roles[category]
        if role != "primary":
            stats[f"annotationsNotTargets:{role}:{category}"] += 1
            continue
        instance = _mask_instance(
            annotation, len(instances), width, height, stats, polygon_fit
        )
        if instance is None:
            return None
        instance["sourceCategory"] = category
        instance["sourceAnnotationIndex"] = index
        provenance = annotation.get("provenance")
        if isinstance(provenance, list) and provenance:
            instance["sourceProvenance"] = sorted(
                {str(value) for value in provenance if isinstance(value, str) and value}
            )
        if any(_box_inside(instance["box"], slab) for slab in slab_boxes):
            instance["container"] = "slab"
            stats["cardsInsideSlab"] += 1
        instances.append(instance)
    return instances, categories


def add_canonical_archive(
    *,
    root: Path,
    rows: list[dict[str, Any]],
    archive_path: Path,
    split: str,
    stats: Counter,
    max_records: int | None = None,
    contract: dict[str, Any] | None = None,
    polygon_fit: str = CONSERVATIVE_ADAPTER_ID,
    scene_assignments: dict[str, Any] | None = None,
    corner_labels: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    roles = (contract or load_category_contract())["roles"]
    scene_by_record = (scene_assignments or {}).get("byRecord", {})
    label_frames = (corner_labels or {}).get("frames", {})
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
            if not row.get("annotations"):
                stats["recordsExcludedNoGeometry"] += 1
                continue
            selected = _card_instances(row, roles, stats, polygon_fit)
            if selected is None:
                stats["recordsExcludedMissingBox"] += 1
                continue
            instances, categories = selected
            if not instances:
                stats["recordsExcludedNoCardAnnotations"] += 1
                continue
            if row["id"] in label_frames:
                _apply_archive_corner_labels(row, instances, label_frames[row["id"]], stats)
            stats["canonicalInstancesRetained"] += len(instances)
            stats["canonicalCardAnnotationsRetained"] += len(instances)
            if len(instances) > 1:
                stats["recordsWithMultipleCards"] += 1
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
                    "annotationCategories": dict(sorted(categories.items())),
                },
                "grouping": {
                    "sourceArchiveId": source_archive_id,
                    "sourceAssetIds": sorted({
                        "coco-source:" + sha256_bytes(value.encode("utf-8"))
                        for value in row.get("leakageAliases", [])
                    }),
                },
                "instances": instances,
            }
            license_id = _shippable_source_license(row)
            record["source"]["licenseId"] = license_id
            stats[f"sourceLicense:{license_id}"] += 1
            suffix = Path(row["imageMember"]).suffix or ".jpg"
            scene_slice = SINGLE_CARD_SLICE
            if len(instances) > 1 and scene_assignments is not None:
                if row["id"] not in scene_by_record:
                    raise ValueError(
                        f"multi-card canonical record {row['id']} has no scene assignment"
                    )
                scene_slice = scene_by_record[row["id"]]
            stats[f"sceneSlice:{scene_slice}"] += 1
            entries.append(
                _write_record(root, record, image_bytes, suffix, split, scene_slice)
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
    if any(not (math.isfinite(x) and math.isfinite(y)) for x, y in points):
        return None
    return points


def _devmode_entry(
    *,
    root: Path,
    session_id: str,
    record_suffix: str,
    image_path: Path,
    quad: list[tuple[float, float]],
    fixed_quad_source: Any,
    capture_mode: str | None,
    stats: Counter,
) -> dict[str, Any] | None:
    if not isinstance(fixed_quad_source, str) or not fixed_quad_source.strip():
        # Older writebacks can contain a quad without durable provenance. Do
        # not promote unknown or detector precision to human ground truth.
        stats["devmodeFixedQuadSkippedUnknownSource"] += 1
        return None
    corner_source = "human" if fixed_quad_source.strip() == "manual" else "detector"
    if not image_path.is_file():
        stats["devmodeMissingImage"] += 1
        return None
    image_bytes = image_path.read_bytes()
    width, height = _image_dimensions(image_bytes)
    corners = [
        {
            "point": {"x": x, "y": y},
            "visibility": (
                "visible" if 0 <= x <= 1 and 0 <= y <= 1 else "outsideFrame"
            ),
            "coordinateKnown": True,
            "cornerSource": corner_source,
        }
        for x, y in quad
    ]
    record = {
        "schema": RECORD_SCHEMA_ID,
        "recordId": _safe_id(f"devmode-{session_id}-{record_suffix}"),
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
                # Manual quads preserve the labeler's card-relative click
                # order (TL, TR, BR, BL). Named detector sources are only
                # geometrically ordered and therefore do not establish card
                # orientation.
                "orientationKnown": corner_source == "human",
                "side": "unknown",
                "container": "unknown",
                "occlusionOrder": 0,
            }
        ],
    }
    scene_slice = (
        "binder_page"
        if capture_mode in {"binder", "binder_page"}
        else "single_handheld"
    )
    stats["devmodeQuadRecords"] += 1
    stats[f"devmodeCornerSource:{corner_source}"] += 1
    stats["devmodeOutsideFrameCorners"] += sum(
        corner["visibility"] == "outsideFrame" for corner in corners
    )
    return _write_record(
        root,
        record,
        image_bytes,
        image_path.suffix or ".jpg",
        "test",
        scene_slice,
    )


def add_devmode_session(
    root: Path, session: Path, stats: Counter
) -> tuple[list[dict[str, Any]], str | None]:
    document = json.loads((session / "results.json").read_text(encoding="utf-8"))
    entries = []
    session_id = _safe_id(session.name)
    for index, frame in enumerate(document.get("frames", [])):
        quad = _quad_points(frame.get("fixedQuad"))
        if quad is None:
            continue
        entry = _devmode_entry(
            root=root,
            session_id=session_id,
            record_suffix=f"{index:05d}",
            image_path=materialize_input(session, frame, default_input_cache()),
            quad=quad,
            fixed_quad_source=frame.get("fixedQuadSource"),
            capture_mode=frame.get("captureMode"),
            stats=stats,
        )
        if entry:
            entries.append(entry)
    return entries, session_id if entries else None


def add_manual_devmode_backup(
    root: Path, backup_path: Path, sessions_root: Path, stats: Counter
) -> tuple[list[dict[str, Any]], list[str]]:
    """Ingest manual quads from a read-only FiftyOne label backup.

    This avoids rewriting canonical session `results.json` merely to build a
    release. The backup contains the stable `session/image` key and quad; image
    bytes still come from the canonical session library.
    """
    records = json.loads(backup_path.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        raise ValueError(f"Dev Mode label backup is not a JSON array: {backup_path}")
    entries = []
    session_ids = set()
    for item in sorted(records, key=lambda value: str(value.get("key", ""))):
        raw_multi = item.get("manual_instances_json")
        if isinstance(raw_multi, str) and raw_multi.strip():
            try:
                frame = json.loads(raw_multi)
            except json.JSONDecodeError:
                stats["devmodeBackupInvalidMultiInstance"] += 1
            else:
                if frame.get("noLabelableCard") is True:
                    if frame.get("instances") != []:
                        raise ValueError(
                            "noLabelableCard frame must contain an empty instances list"
                        )
                    key = frame.get("key")
                    if not isinstance(key, str) or "/" not in key:
                        raise ValueError("noLabelableCard frame must contain a session/image key")
                    stats["devmodeBackupNoLabelableCardRecords"] += 1
                    continue
                entry, session_id = _manual_multi_frame_entry(
                    root, frame, sessions_root, stats
                )
                entries.append(entry)
                session_ids.add(session_id)
                stats["devmodeBackupMultiInstanceRecords"] += 1
                continue
        if item.get("fixed_quad_source") != "manual":
            continue
        raw_quad = item.get("fixed_quad_json")
        if isinstance(raw_quad, str):
            try:
                raw_quad = json.loads(raw_quad)
            except json.JSONDecodeError:
                stats["devmodeBackupInvalidQuad"] += 1
                continue
        quad = _quad_points(raw_quad)
        key = item.get("key")
        if quad is None or not isinstance(key, str) or "/" not in key:
            stats["devmodeBackupInvalidQuad"] += 1
            continue
        raw_session_id, image_file = key.split("/", 1)
        session_id = _safe_id(raw_session_id)
        entry = _devmode_entry(
            root=root,
            session_id=session_id,
            record_suffix=sha256_bytes(key.encode("utf-8"))[:16],
            image_path=sessions_root / raw_session_id / image_file,
            quad=quad,
            fixed_quad_source="manual",
            capture_mode=None,
            stats=stats,
        )
        if entry:
            entries.append(entry)
            session_ids.add(session_id)
            stats["devmodeBackupManualRecords"] += 1
    return entries, sorted(session_ids)


def _manual_multi_frame_entry(
    root: Path,
    frame: dict[str, Any],
    sessions_root: Path,
    stats: Counter,
) -> tuple[dict[str, Any], str]:
    errors = validation_errors(
        make_validator(load_schema(MULTI_INSTANCE_SCHEMA)),
        {
            "schema": "https://tcger.app/schemas/card-geometry-manual-multi-instance-labels/v1",
            "frames": [frame],
        },
    )
    if errors:
        raise ValueError("invalid multi-instance frame:\n- " + "\n- ".join(errors))
    orders = [item["occlusionOrder"] for item in frame["instances"]]
    if len(orders) != len(set(orders)):
        raise ValueError(f"duplicate occlusionOrder in {frame['key']}")
    raw_session, image_file = frame["key"].split("/", 1)
    session_id = _safe_id(raw_session)
    image_path = sessions_root / raw_session / image_file
    if not image_path.is_file():
        raise FileNotFoundError(image_path)
    image_bytes = image_path.read_bytes()
    width, height = _image_dimensions(image_bytes)
    instances = []
    for annotation in frame["instances"]:
        quad = _quad_points(annotation["corners"])
        if quad is None:
            raise ValueError(f"invalid quad in {frame['key']}:{annotation['instanceId']}")
        instances.append(
            {
                "instanceId": _safe_id(annotation["instanceId"]),
                "detectionClass": "card",
                "corners": [
                    {
                        "point": {"x": x, "y": y},
                        "visibility": visibility,
                        "coordinateKnown": True,
                        "cornerSource": "human",
                    }
                    for (x, y), visibility in zip(
                        quad, annotation["cornerVisibility"], strict=True
                    )
                ],
                "orientationKnown": annotation["orientationKnown"],
                "side": annotation["side"],
                "container": annotation.get("container", "unknown"),
                "occlusionOrder": annotation["occlusionOrder"],
                "physicalCardId": _safe_id(annotation["physicalCardId"]),
            }
        )
    record = {
        "schema": RECORD_SCHEMA_ID,
        "recordId": _safe_id(
            f"devmode-multi-{session_id}-{sha256_bytes(frame['key'].encode())[:16]}"
        ),
        "source": {"kind": "real", "width": width, "height": height},
        "grouping": {
            "sourceArchiveId": _safe_id(f"devmode:{session_id}"),
            "sessionId": session_id,
        },
        "instances": instances,
    }
    entry = _write_record(
        root,
        record,
        image_bytes,
        image_path.suffix or ".jpg",
        "test",
        frame["sceneSlice"],
    )
    stats["devmodeMultiInstanceFrames"] += 1
    stats["devmodeMultiInstanceCards"] += len(instances)
    stats["devmodeMultiInstanceFaceDown"] += sum(
        instance["side"] == "faceDown" for instance in instances
    )
    stats["devmodeMultiInstanceOccludedCorners"] += sum(
        corner["visibility"] == "occluded"
        for instance in instances
        for corner in instance["corners"]
    )
    return entry, session_id


def add_manual_multi_instance_labels(
    root: Path, labels_path: Path, sessions_root: Path, stats: Counter
) -> tuple[list[dict[str, Any]], list[str]]:
    """Ingest human-ordered quads for every card in a labeled frame."""
    document = json.loads(labels_path.read_text(encoding="utf-8"))
    errors = validation_errors(
        make_validator(load_schema(MULTI_INSTANCE_SCHEMA)), document
    )
    if errors:
        raise ValueError("invalid multi-instance labels:\n- " + "\n- ".join(errors))
    entries = []
    sessions = set()
    for frame in sorted(document["frames"], key=lambda item: item["key"]):
        entry, session_id = _manual_multi_frame_entry(
            root, frame, sessions_root, stats
        )
        entries.append(entry)
        sessions.add(session_id)
    return entries, sorted(sessions)


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
        "minimumMetricEligibleInstances": {split: 0 for split in ordered},
        "allowedSourceTiers": ["shippable"],
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
    devmode_label_backups: list[Path] | None = None,
    devmode_sessions_root: Path | None = None,
    multi_instance_label_files: list[Path] | None = None,
    release_id: str = "real-geometry-ingestion-smoke-v1",
    source_archive_aliases: dict[str, str] | None = None,
    category_contract: Path = CATEGORY_CONTRACT_PATH,
    polygon_fit: str = CONSERVATIVE_ADAPTER_ID,
    scene_assignments_path: Path | None = None,
    archive_corner_labels_path: Path | None = None,
) -> dict[str, Any]:
    _validate_archive_splits(archive_splits)
    corner_labels = (
        load_archive_corner_labels(archive_corner_labels_path, canonical_corpus)
        if archive_corner_labels_path is not None
        else None
    )
    contract = load_category_contract(category_contract)
    if polygon_fit not in POLYGON_FIT_ADAPTERS:
        raise ValueError(f"unknown polygon fit adapter {polygon_fit!r}")
    scene_assignments = (
        load_scene_assignments(scene_assignments_path, canonical_corpus)
        if scene_assignments_path is not None
        else None
    )
    # Known archive identities are explicit. Additional archives/re-exports
    # require a reviewed table; do not silently declare unknown sources unique.
    canonical_fork = "coco:card-seg-j74w1.v3i.coco-segmentation"
    aliases = dict(source_archive_aliases) if source_archive_aliases is not None else {
        "coco:annotations.v7i.coco-segmentation": "coco:annotations.v7i.coco-segmentation",
        canonical_fork: canonical_fork,
        "coco:card-seg-j74w1-q8yst.v1i.coco-segmentation": canonical_fork,
    }
    for archive_name in archive_splits:
        leakage_keys_from_record(
            {"grouping": {"sourceArchiveId": _safe_id(f"coco:{Path(archive_name).stem}")}},
            aliases,
        )
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
                contract=contract,
                polygon_fit=polygon_fit,
                scene_assignments=scene_assignments,
                corner_labels=corner_labels,
            )
        )
    denylist: set[str] = set()
    for session in sorted(devmode_sessions):
        session_entries, session_id = add_devmode_session(output, session, stats)
        entries.extend(session_entries)
        if session_id:
            denylist.add(session_id)
    backup_paths = sorted(devmode_label_backups or [])
    if backup_paths and devmode_sessions_root is None:
        raise ValueError("devmode_sessions_root is required with label backups")
    for backup_path in backup_paths:
        assert devmode_sessions_root is not None
        backup_entries, session_ids = add_manual_devmode_backup(
            output, backup_path, devmode_sessions_root, stats
        )
        entries.extend(backup_entries)
        denylist.update(session_ids)
    multi_paths = sorted(multi_instance_label_files or [])
    if multi_paths and devmode_sessions_root is None:
        raise ValueError("devmode_sessions_root is required with multi-instance labels")
    for labels_path in multi_paths:
        assert devmode_sessions_root is not None
        multi_entries, session_ids = add_manual_multi_instance_labels(
            output, labels_path, devmode_sessions_root, stats
        )
        entries.extend(multi_entries)
        denylist.update(session_ids)
    if not entries:
        raise ValueError("no geometry records were produced")
    for entry in entries:
        record = load_json(output / entry["path"])
        archive_id = record["grouping"]["sourceArchiveId"]
        if archive_id.startswith("devmode:"):
            aliases.setdefault(archive_id, archive_id)
        entry["leakageKeys"] = leakage_keys_from_record(record, aliases)
    splits = {entry["split"] for entry in entries}
    policy = _smoke_policy(splits, bool(denylist))
    policy_text = pretty_json(policy)
    (output / "policy.json").write_text(policy_text, encoding="utf-8")
    manifest: dict[str, Any] = {
        "schema": MANIFEST_SCHEMA_ID,
        "releaseId": _safe_id(release_id),
        "releasePurpose": "smoke",
        "readiness": {
            "readinessPolicyPath": "policy.json",
            "readinessPolicyId": policy["policyId"],
            "readinessPolicySha256": sha256_bytes(policy_text.encode("utf-8")),
        },
        "splitAssignment": {"method": "whole-source-archive-explicit-v1", "seed": 0},
        "evaluationSessionDenylist": sorted(denylist),
        "sourceArchiveAliases": aliases,
        "targetSemantics": target_semantics(contract),
        "records": sorted(entries, key=lambda entry: entry["recordId"]),
    }
    manifest["corpusHash"] = corpus_hash(manifest)
    (output / "manifest.json").write_text(pretty_json(manifest), encoding="utf-8")
    summary = {
        "release": str(output),
        "corpusHash": manifest["corpusHash"],
        "policySha256": manifest["readiness"]["readinessPolicySha256"],
        "canonicalCorpusSha256": sha256_file(canonical_corpus),
        "categoryContract": {
            "path": str(contract["path"]),
            "sha256": contract["sha256"],
            "roles": dict(sorted(contract["roles"].items())),
        },
        "polygonFitAdapter": polygon_fit,
        "archiveCornerLabels": (
            {"path": str(corner_labels["path"]), "sha256": corner_labels["sha256"],
             "frames": len(corner_labels["frames"])}
            if corner_labels is not None
            else None
        ),
        "sceneAssignments": (
            {
                "path": str(scene_assignments["path"]),
                "sha256": scene_assignments["sha256"],
                "heuristic": scene_assignments["heuristic"],
                "sliceMapping": SCENE_ASSIGNMENT_SLICES,
            }
            if scene_assignments is not None
            else None
        ),
        "records": len(entries),
        "instances": stats["canonicalInstancesRetained"]
        + stats["devmodeQuadRecords"]
        + stats["devmodeMultiInstanceCards"],
        "archiveSplits": dict(sorted(archive_splits.items())),
        "maxRecordsPerArchive": max_records_per_archive,
        "devmodeLabelBackups": [
            {"path": str(path), "sha256": sha256_file(path)} for path in backup_paths
        ],
        "multiInstanceLabelFiles": [
            {"path": str(path), "sha256": sha256_file(path)} for path in multi_paths
        ],
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
        "--devmode-label-backup",
        type=Path,
        action="append",
        default=[],
        help="FiftyOne labels-*.json backup; only manual fixed quads are ingested",
    )
    parser.add_argument(
        "--devmode-sessions-root",
        type=Path,
        help="Canonical sessions directory used to resolve backup session/image keys",
    )
    parser.add_argument(
        "--multi-instance-labels",
        type=Path,
        action="append",
        default=[],
        help="manual multi-card label sidecar matching the checked-in schema",
    )
    parser.add_argument(
        "--max-records-per-archive",
        type=int,
        help="Deterministic smoke sample after sorting by record id; omit for a complete archive",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release-id", default="real-geometry-ingestion-smoke-v1")
    parser.add_argument(
        "--source-archive-aliases", type=Path,
        help="JSON object mapping record sourceArchiveId values to canonical IDs; required for archives beyond the built-in TCGX and card-seg fork mapping",
    )
    parser.add_argument(
        "--category-contract", type=Path, default=CATEGORY_CONTRACT_PATH,
        help="canonical category contract whose `primary` categories become card targets",
    )
    parser.add_argument(
        "--polygon-fit", choices=POLYGON_FIT_ADAPTERS, default=CONSERVATIVE_ADAPTER_ID,
        help="corner fit adapter; v2 additionally recovers gated line fits from many-vertex or square-stretched outlines",
    )
    parser.add_argument(
        "--scene-assignments", type=Path,
        help="classify_canonical_scenes.py report bound to this canonical corpus; multi-card records take archive scene slices",
    )
    parser.add_argument(
        "--archive-corner-labels", type=Path,
        help="human four-corner labels for canonical archive targets (card-geometry-archive-corner-labels v1)",
    )
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
        devmode_label_backups=args.devmode_label_backup,
        devmode_sessions_root=args.devmode_sessions_root,
        multi_instance_label_files=args.multi_instance_labels,
        release_id=args.release_id,
        source_archive_aliases=load_json(args.source_archive_aliases) if args.source_archive_aliases else None,
        category_contract=args.category_contract,
        polygon_fit=args.polygon_fit,
        scene_assignments_path=args.scene_assignments,
        archive_corner_labels_path=args.archive_corner_labels,
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
