#!/usr/bin/env python3
"""Compile heterogeneous Roboflow archives into one canonical card corpus.

The compiler reads COCO JSON and image bytes directly from immutable ZIP files.
It does not modify or extract the raw archives unless ``--materialize-images``
is requested. The default output is an archive-backed JSONL manifest plus COCO
files whose image names use ``zip://ARCHIVE#MEMBER`` references.

Important policy boundaries:

* only source classes explicitly mapped by source-config.json are admitted;
* whole-card masks are category ``card``; regions and slabs stay distinct;
* object-detection boxes become rectangular masks marked ``bbox-derived``;
* only source instance-segmentation polygons are evaluation eligible;
* Roboflow augmentation siblings are grouped before deterministic splitting;
* exact duplicate bytes across archives are merged, preferring polygon masks;
* raw source split names are provenance only; canonical splits are rebuilt to
  prevent augmentation and fork leakage.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import shutil
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


SPLIT_ALIASES = {
    "train": "train",
    "training": "train",
    "valid": "validation",
    "validation": "validation",
    "val": "validation",
    "test": "test",
    "testing": "test",
}
DEFAULT_SPLITS = {"train": 0.8, "validation": 0.1, "test": 0.1}
ROBOFLOW_HASH = re.compile(r"\.rf\.[0-9a-f]+(?=\.[^.]+$)", re.IGNORECASE)


@dataclass
class Candidate:
    source: str
    task: str
    license: str
    archive: str
    annotation_member: str
    image_member: str
    source_split: str
    source_image_id: int
    source_file_name: str
    width: int
    height: int
    digest: str
    family_key: str
    leakage_key: str
    annotations: list[dict[str, Any]] = field(default_factory=list)
    is_unannotated: bool = False


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(text)
    temporary.replace(path)


def normalized_source_name(file_name: str) -> str:
    name = PurePosixPath(file_name).name.lower()
    return ROBOFLOW_HASH.sub("", name)


def source_split(member: str) -> str:
    for part in PurePosixPath(member).parts:
        mapped = SPLIT_ALIASES.get(part.lower())
        if mapped:
            return mapped
    return "unspecified"


def member_for_image(names: set[str], annotation_member: str, file_name: str) -> str | None:
    candidate = str(PurePosixPath(annotation_member).parent / file_name)
    if candidate in names:
        return candidate
    normalized = file_name.lstrip("./")
    suffix_matches = [name for name in names if name.endswith("/" + normalized) or name == normalized]
    if len(suffix_matches) == 1:
        return suffix_matches[0]
    basename_matches = [name for name in names if PurePosixPath(name).name == PurePosixPath(file_name).name]
    if len(basename_matches) == 1:
        return basename_matches[0]
    return None


def clamp(value: float, low: float, high: float) -> float:
    return min(max(float(value), low), high)


def normalized_bbox(raw: Iterable[float], width: int, height: int) -> list[float]:
    x, y, w, h = (float(value) for value in raw)
    x1 = clamp(x, 0, width)
    y1 = clamp(y, 0, height)
    x2 = clamp(x + max(w, 0), 0, width)
    y2 = clamp(y + max(h, 0), 0, height)
    return [x1, y1, max(0.0, x2 - x1), max(0.0, y2 - y1)]


def rectangle_polygon(bbox: list[float]) -> list[list[float]]:
    x, y, w, h = bbox
    return [[x, y, x + w, y, x + w, y + h, x, y + h]]


def normalized_polygons(raw: Any, width: int, height: int) -> list[list[float]]:
    if not isinstance(raw, list):
        return []
    polygons: list[list[float]] = []
    for polygon in raw:
        if not isinstance(polygon, list) or len(polygon) < 6 or len(polygon) % 2:
            continue
        cleaned: list[float] = []
        for index, value in enumerate(polygon):
            cleaned.append(clamp(value, 0, width if index % 2 == 0 else height))
        polygons.append(cleaned)
    return polygons


def polygon_point_count(segmentation: Any) -> int:
    if not isinstance(segmentation, list):
        return 0
    return sum(len(polygon) // 2 for polygon in segmentation if isinstance(polygon, list))


def bbox_iou(left: list[float], right: list[float]) -> float:
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    x1, y1 = max(lx, rx), max(ly, ry)
    x2, y2 = min(lx + lw, rx + rw), min(ly + lh, ry + rh)
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = lw * lh + rw * rh - intersection
    return intersection / union if union > 0 else 0.0


def annotation_score(annotation: dict[str, Any]) -> tuple[int, int, float]:
    quality = {"source-polygon": 3, "source-rle": 2, "bbox-derived": 1}.get(
        annotation["geometryQuality"], 0
    )
    return quality, polygon_point_count(annotation.get("segmentation")), float(annotation.get("area", 0))


def add_annotation(target: list[dict[str, Any]], incoming: dict[str, Any]) -> None:
    for index, existing in enumerate(target):
        if existing["category"] != incoming["category"]:
            continue
        if bbox_iou(existing["bbox"], incoming["bbox"]) < 0.95:
            continue
        combined = sorted(set(existing["provenance"] + incoming["provenance"]))
        preferred = incoming if annotation_score(incoming) > annotation_score(existing) else existing
        preferred = dict(preferred)
        preferred["provenance"] = combined
        target[index] = preferred
        return
    target.append(incoming)


def canonical_annotation(
    raw: dict[str, Any],
    canonical_name: str,
    category_id: int,
    source: str,
    source_category: str,
    task: str,
    width: int,
    height: int,
) -> dict[str, Any] | None:
    bbox = normalized_bbox(raw.get("bbox") or [0, 0, 0, 0], width, height)
    if bbox[2] <= 0 or bbox[3] <= 0:
        return None
    segmentation: Any
    if task == "instance-segmentation":
        polygons = normalized_polygons(raw.get("segmentation"), width, height)
        if polygons:
            segmentation = polygons
            geometry_quality = "source-polygon"
        elif isinstance(raw.get("segmentation"), dict):
            segmentation = raw["segmentation"]
            geometry_quality = "source-rle"
        else:
            segmentation = rectangle_polygon(bbox)
            geometry_quality = "bbox-derived"
    else:
        segmentation = rectangle_polygon(bbox)
        geometry_quality = "bbox-derived"
    return {
        "category": canonical_name,
        "categoryId": category_id,
        "bbox": bbox,
        "segmentation": segmentation,
        "area": float(raw.get("area") or bbox[2] * bbox[3]),
        "iscrowd": int(raw.get("iscrowd") or 0),
        "geometryQuality": geometry_quality,
        "evaluationEligible": bool(
            canonical_name == "card" and geometry_quality in {"source-polygon", "source-rle"}
        ),
        "provenance": [f"{source}:{source_category}:{raw.get('id', 'unknown')}"]
    }


def validate_config(config: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    if config.get("schemaVersion") != 1:
        raise ValueError("source config schemaVersion must be 1")
    categories = config.get("canonicalCategories") or []
    category_by_name = {item["name"]: item for item in categories}
    if len(category_by_name) != len(categories):
        raise ValueError("canonical category names must be unique")
    ids = [int(item["id"]) for item in categories]
    if len(set(ids)) != len(ids):
        raise ValueError("canonical category ids must be unique")
    sources = config.get("sources") or []
    source_by_name = {item["name"]: item for item in sources}
    if len(source_by_name) != len(sources):
        raise ValueError("source names must be unique")
    for source in sources:
        for mapped in source.get("categories", {}).values():
            if mapped is not None and mapped not in category_by_name:
                raise ValueError(f"{source['name']} maps to unknown canonical category {mapped}")
    return category_by_name, {name: int(item["id"]) for name, item in category_by_name.items()}


def load_candidates(
    raw_dir: Path,
    config: dict[str, Any],
    strict: bool = True,
    archive_hashes: dict[str, str] | None = None,
) -> tuple[list[Candidate], dict[str, Any]]:
    _, canonical_ids = validate_config(config)
    candidates: list[Candidate] = []
    audit: dict[str, Any] = {"sources": {}, "warnings": []}
    for source in config["sources"]:
        source_name = source["name"]
        archive_path = raw_dir / source["archive"]
        source_audit: dict[str, Any] = collections.Counter()
        source_audit["archive"] = source["archive"]
        source_audit["task"] = source["task"]
        audit["sources"][source_name] = source_audit
        if not archive_path.exists():
            raise FileNotFoundError(f"missing source archive: {archive_path}")
        if archive_hashes is not None:
            if source["archive"] not in archive_hashes:
                raise ValueError(f"archive is absent from verification manifest: {source['archive']}")
            digest = file_sha256(archive_path)
            if digest != archive_hashes[source["archive"]]:
                raise ValueError(f"archive hash mismatch: {source['archive']}")
            source_audit["archiveHashVerified"] = True
        with zipfile.ZipFile(archive_path) as archive:
            names = set(archive.namelist())
            annotation_members = sorted(name for name in names if name.endswith("_annotations.coco.json"))
            if not annotation_members:
                raise ValueError(f"no COCO annotations in {source['archive']}")
            for annotation_member in annotation_members:
                data = json.loads(archive.read(annotation_member))
                category_names = {int(item["id"]): item["name"] for item in data.get("categories", [])}
                annotations_by_image: dict[int, list[dict[str, Any]]] = collections.defaultdict(list)
                annotated_category_ids: set[int] = set()
                for annotation in data.get("annotations", []):
                    image_id = int(annotation["image_id"])
                    annotations_by_image[image_id].append(annotation)
                    annotated_category_ids.add(int(annotation["category_id"]))
                unknown = sorted(
                    {
                        category_names[category_id]
                        for category_id in annotated_category_ids
                        if category_names.get(category_id) not in source.get("categories", {})
                    }
                )
                if unknown:
                    message = f"{source_name} has annotated unmapped categories: {', '.join(unknown)}"
                    if strict:
                        raise ValueError(message)
                    audit["warnings"].append(message)
                for image in data.get("images", []):
                    source_audit["declaredImages"] += 1
                    image_member = member_for_image(names, annotation_member, image["file_name"])
                    if image_member is None:
                        source_audit["missingImages"] += 1
                        continue
                    image_bytes = archive.read(image_member)
                    digest = hashlib.sha256(image_bytes).hexdigest()
                    width, height = int(image["width"]), int(image["height"])
                    canonical_annotations: list[dict[str, Any]] = []
                    for raw_annotation in annotations_by_image.get(int(image["id"]), []):
                        source_category = category_names.get(int(raw_annotation["category_id"]), "")
                        if source_category not in source.get("categories", {}):
                            continue
                        canonical_name = source["categories"][source_category]
                        if canonical_name is None:
                            source_audit["ignoredAnnotations"] += 1
                            continue
                        annotation = canonical_annotation(
                            raw_annotation,
                            canonical_name,
                            canonical_ids[canonical_name],
                            source_name,
                            source_category,
                            source["task"],
                            width,
                            height,
                        )
                        if annotation is not None:
                            add_annotation(canonical_annotations, annotation)
                            source_audit[f"canonicalAnnotations:{canonical_name}"] += 1
                    is_unannotated = not annotations_by_image.get(int(image["id"]))
                    if not canonical_annotations and not is_unannotated:
                        source_audit["imagesWithoutCanonicalAnnotations"] += 1
                        continue
                    if is_unannotated and not source.get("includeUnannotatedImages", True):
                        source_audit["excludedUnannotatedImages"] += 1
                        continue
                    normalized_origin = normalized_source_name(image["file_name"])
                    family = f"{source_name}:{normalized_origin}"
                    leakage_namespace = source.get("originNamespace") or source_name
                    leakage = f"{leakage_namespace}:{normalized_origin}"
                    candidates.append(
                        Candidate(
                            source=source_name,
                            task=source["task"],
                            license=source["license"],
                            archive=source["archive"],
                            annotation_member=annotation_member,
                            image_member=image_member,
                            source_split=source_split(annotation_member),
                            source_image_id=int(image["id"]),
                            source_file_name=image["file_name"],
                            width=width,
                            height=height,
                            digest=digest,
                            family_key=family,
                            leakage_key=leakage,
                            annotations=canonical_annotations,
                            is_unannotated=is_unannotated,
                        )
                    )
                    source_audit["admittedCandidates"] += 1
        audit["sources"][source_name] = dict(source_audit)
    return candidates, audit


def candidate_score(candidate: Candidate) -> tuple[int, int, int]:
    polygon_cards = sum(
        annotation["category"] == "card" and annotation["geometryQuality"] == "source-polygon"
        for annotation in candidate.annotations
    )
    original = int(ROBOFLOW_HASH.search(PurePosixPath(candidate.source_file_name).name) is None)
    return polygon_cards, original, candidate.width * candidate.height


def preferred_candidate(group: Iterable[Candidate]) -> Candidate:
    # Stable path order breaks equal-quality ties; max() keeps the first item.
    return max(sorted(group, key=lambda item: item.image_member), key=candidate_score)


def record_score(record: dict[str, Any]) -> tuple[int, int, int]:
    polygon_cards = sum(
        annotation["category"] == "card" and annotation["geometryQuality"] == "source-polygon"
        for annotation in record["annotations"]
    )
    original = int(
        any(
            ROBOFLOW_HASH.search(PurePosixPath(item["sourceFileName"]).name) is None
            for item in record["provenance"]
        )
    )
    return polygon_cards, original, int(record["width"]) * int(record["height"])


def apply_augmentation_policy(
    records: list[dict[str, Any]], policy: str
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    if policy == "all":
        return records, {
            "input": len(records),
            "kept": len(records),
            "dropped": 0,
            "originFamilies": len({alias for record in records for alias in record["familyAliases"]}),
        }
    if policy != "representative":
        raise ValueError(f"unknown augmentation policy: {policy}")
    disjoint = DisjointSet(len(records))
    owner_by_alias: dict[str, int] = {}
    for index, record in enumerate(records):
        for alias in record["familyAliases"]:
            if alias in owner_by_alias:
                disjoint.union(index, owner_by_alias[alias])
            else:
                owner_by_alias[alias] = index
    components: dict[int, list[dict[str, Any]]] = collections.defaultdict(list)
    for index, record in enumerate(records):
        components[disjoint.find(index)].append(record)
    kept = [
        max(sorted(group, key=lambda item: item["sha256"]), key=record_score)
        for group in components.values()
    ]
    kept.sort(key=lambda record: record["sha256"])
    return kept, {
        "input": len(records),
        "kept": len(kept),
        "dropped": len(records) - len(kept),
        "originFamilies": len(components),
    }


def merge_exact_duplicates(candidates: list[Candidate]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    by_digest: dict[str, list[Candidate]] = collections.defaultdict(list)
    for candidate in candidates:
        by_digest[candidate.digest].append(candidate)
    records: list[dict[str, Any]] = []
    merged_groups = 0
    merged_candidates = 0
    for digest, group in sorted(by_digest.items()):
        if len(group) > 1:
            merged_groups += 1
            merged_candidates += len(group) - 1
        preferred = preferred_candidate(group)
        annotations: list[dict[str, Any]] = []
        for candidate in group:
            for annotation in candidate.annotations:
                add_annotation(annotations, dict(annotation))
        provenances = [
            {
                "source": item.source,
                "task": item.task,
                "license": item.license,
                "archive": item.archive,
                "annotationMember": item.annotation_member,
                "imageMember": item.image_member,
                "sourceSplit": item.source_split,
                "sourceImageId": item.source_image_id,
                "sourceFileName": item.source_file_name,
                "familyKey": item.family_key,
                "leakageKey": item.leakage_key,
            }
            for item in sorted(group, key=lambda item: (item.source, item.image_member))
        ]
        records.append(
            {
                "id": digest,
                "sha256": digest,
                "width": preferred.width,
                "height": preferred.height,
                "extension": PurePosixPath(preferred.image_member).suffix.lower() or ".jpg",
                "archive": preferred.archive,
                "imageMember": preferred.image_member,
                "annotations": sorted(
                    annotations,
                    key=lambda annotation: (annotation["categoryId"], annotation["bbox"]),
                ),
                "provenance": provenances,
                "familyAliases": sorted({item.family_key for item in group}),
                "leakageAliases": sorted({item.leakage_key for item in group}),
                "isUnannotated": all(item.is_unannotated for item in group),
            }
        )
    return records, {
        "exactDuplicateGroups": merged_groups,
        "exactDuplicateCandidatesMerged": merged_candidates,
    }


class DisjointSet:
    def __init__(self, size: int):
        self.parent = list(range(size))

    def find(self, value: int) -> int:
        while self.parent[value] != value:
            self.parent[value] = self.parent[self.parent[value]]
            value = self.parent[value]
        return value

    def union(self, left: int, right: int) -> None:
        left_root, right_root = self.find(left), self.find(right)
        if left_root != right_root:
            self.parent[right_root] = left_root


def assign_splits(
    records: list[dict[str, Any]], split_weights: dict[str, float], seed: str
) -> None:
    total = sum(split_weights.values())
    if total <= 0:
        raise ValueError("split weights must total more than zero")
    normalized = {name: weight / total for name, weight in split_weights.items()}
    order = [name for name in ("train", "validation", "test") if name in normalized]
    if set(order) != set(normalized):
        raise ValueError("supported split names are train, validation, and test")
    disjoint = DisjointSet(len(records))
    owner_by_alias: dict[str, int] = {}
    for index, record in enumerate(records):
        for alias in record["leakageAliases"]:
            if alias in owner_by_alias:
                disjoint.union(index, owner_by_alias[alias])
            else:
                owner_by_alias[alias] = index
    components: dict[int, list[int]] = collections.defaultdict(list)
    for index in range(len(records)):
        components[disjoint.find(index)].append(index)
    for indices in components.values():
        aliases = sorted({alias for index in indices for alias in records[index]["leakageAliases"]})
        group_id = hashlib.sha256("\n".join(aliases).encode()).hexdigest()
        fraction = int(hashlib.sha256(f"{seed}:{group_id}".encode()).hexdigest()[:16], 16) / 2**64
        cumulative = 0.0
        selected = order[-1]
        for name in order:
            cumulative += normalized[name]
            if fraction < cumulative:
                selected = name
                break
        for index in indices:
            records[index]["groupId"] = group_id
            records[index]["split"] = selected


def archive_hashes_from_manifest(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    data = json.loads(path.read_text())
    return {
        PurePosixPath(item["archive"]).name: item["sha256"]
        for item in data.get("datasets", [])
        if item.get("archive") and item.get("sha256")
    }


def materialize_image(raw_dir: Path, out: Path, record: dict[str, Any]) -> str:
    relative = Path("images") / record["split"] / f"{record['sha256']}{record['extension']}"
    destination = out / relative
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(raw_dir / record["archive"]) as archive, archive.open(record["imageMember"]) as source:
            temporary = destination.with_name(f".{destination.name}.tmp")
            with temporary.open("wb") as target:
                shutil.copyfileobj(source, target)
            if file_sha256(temporary) != record["sha256"]:
                temporary.unlink(missing_ok=True)
                raise ValueError(f"materialized image hash mismatch: {record['id']}")
            temporary.replace(destination)
    return relative.as_posix()


def coco_split(
    split: str,
    records: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    materialize: bool,
    description: str,
    annotation_filter,
    include_all_images: bool = False,
) -> dict[str, Any]:
    images = []
    annotations = []
    annotation_id = 1
    for record in records:
        selected_annotations = [
            annotation for annotation in record["annotations"] if annotation_filter(annotation)
        ]
        if not include_all_images and not selected_annotations and not record["isUnannotated"]:
            continue
        image_id = len(images) + 1
        file_name = (
            f"{record['sha256']}{record['extension']}"
            if materialize
            else f"zip://{record['archive']}#{record['imageMember']}"
        )
        images.append(
            {
                "id": image_id,
                "file_name": file_name,
                "width": record["width"],
                "height": record["height"],
                "sha256": record["sha256"],
                "group_id": record["groupId"],
            }
        )
        for annotation in selected_annotations:
            annotations.append(
                {
                    "id": annotation_id,
                    "image_id": image_id,
                    "category_id": annotation["categoryId"],
                    "bbox": annotation["bbox"],
                    "segmentation": annotation["segmentation"],
                    "area": annotation["area"],
                    "iscrowd": annotation["iscrowd"],
                    "geometry_quality": annotation["geometryQuality"],
                    "evaluation_eligible": annotation["evaluationEligible"],
                    "provenance": annotation["provenance"],
                }
            )
            annotation_id += 1
    return {
        "info": {
            "description": description,
            "schema_version": 1,
            "split": split,
            "archive_backed": not materialize,
        },
        "licenses": [],
        "categories": categories,
        "images": images,
        "annotations": annotations,
    }


def build_outputs(
    records: list[dict[str, Any]],
    config: dict[str, Any],
    raw_dir: Path,
    out: Path,
    materialize: bool,
    report: dict[str, Any],
) -> None:
    out.mkdir(parents=True, exist_ok=True)
    categories = [
        {"id": int(item["id"]), "name": item["name"], "supercategory": item["role"]}
        for item in config["canonicalCategories"]
    ]
    manifest_lines = []
    for record in sorted(records, key=lambda item: (item["split"], item["sha256"])):
        row = dict(record)
        row["imageUri"] = (
            materialize_image(raw_dir, out, record)
            if materialize
            else f"zip://{record['archive']}#{record['imageMember']}"
        )
        manifest_lines.append(stable_json(row))
    atomic_write_text(out / "corpus.jsonl", "\n".join(manifest_lines) + ("\n" if manifest_lines else ""))

    licenses = [
        {"id": index + 1, "name": name}
        for index, name in enumerate(sorted({source["license"] for source in config["sources"]}))
    ]
    card_category = [category for category in categories if category["name"] == "card"]
    for split in ("train", "validation", "test"):
        split_records = sorted(
            (record for record in records if record["split"] == split), key=lambda item: item["sha256"]
        )
        variants = [
            (
                "coco",
                categories,
                "TCGer canonical multi-source card corpus with primary, auxiliary, and context labels",
                lambda annotation: True,
                True,
            ),
            (
                "coco-card-detection",
                card_category,
                "TCGer canonical whole-card detector corpus including polygon and bbox-derived geometry",
                lambda annotation: annotation["category"] == "card",
                False,
            ),
            (
                "coco-card-segmentation",
                card_category,
                "TCGer canonical whole-card segmentation corpus with source masks only",
                lambda annotation: annotation["category"] == "card" and annotation["evaluationEligible"],
                False,
            ),
        ]
        for directory, variant_categories, description, annotation_filter, include_all in variants:
            coco = coco_split(
                split,
                split_records,
                variant_categories,
                materialize,
                description,
                annotation_filter,
                include_all_images=include_all,
            )
            coco["licenses"] = licenses
            atomic_write_text(
                out / directory / f"{split}.json",
                json.dumps(coco, indent=2, sort_keys=True) + "\n",
            )
    atomic_write_text(out / "report.json", json.dumps(report, indent=2, sort_keys=True) + "\n")


def compile_corpus(
    raw_dir: Path,
    config_path: Path,
    out: Path,
    augmentation_policy: str = "representative",
    split_weights: dict[str, float] | None = None,
    seed: str = "tcger-card-segmentation-v1",
    strict: bool = True,
    materialize: bool = False,
    archive_manifest: Path | None = None,
) -> dict[str, Any]:
    config = json.loads(config_path.read_text())
    archive_hashes = archive_hashes_from_manifest(archive_manifest) if archive_manifest else None
    candidates, audit = load_candidates(raw_dir, config, strict=strict, archive_hashes=archive_hashes)
    exact_records, duplicate_report = merge_exact_duplicates(candidates)
    records, augmentation = apply_augmentation_policy(exact_records, augmentation_policy)
    assign_splits(records, split_weights or DEFAULT_SPLITS, seed)
    counts_by_split = collections.Counter(record["split"] for record in records)
    annotations_by_category = collections.Counter(
        annotation["category"] for record in records for annotation in record["annotations"]
    )
    annotations_by_quality = collections.Counter(
        annotation["geometryQuality"] for record in records for annotation in record["annotations"]
    )
    images_by_source: dict[str, set[str]] = collections.defaultdict(set)
    sources_by_group: dict[str, set[str]] = collections.defaultdict(set)
    for record in records:
        for provenance in record["provenance"]:
            images_by_source[provenance["source"]].add(record["id"])
            sources_by_group[record["groupId"]].add(provenance["source"])
    report = {
        "schemaVersion": 1,
        "rawArchives": len(config["sources"]),
        "augmentationPolicy": augmentation_policy,
        "splitSeed": seed,
        "splitWeights": split_weights or DEFAULT_SPLITS,
        "candidateImages": len(candidates),
        "canonicalImages": len(records),
        "canonicalAnnotations": sum(len(record["annotations"]) for record in records),
        "evaluationEligibleCardMasks": sum(
            annotation["evaluationEligible"]
            for record in records
            for annotation in record["annotations"]
        ),
        "unannotatedImages": sum(record["isUnannotated"] for record in records),
        "imagesBySplit": dict(sorted(counts_by_split.items())),
        "annotationsByCategory": dict(sorted(annotations_by_category.items())),
        "annotationsByGeometryQuality": dict(sorted(annotations_by_quality.items())),
        "canonicalImagesBySource": {
            source: len(image_ids) for source, image_ids in sorted(images_by_source.items())
        },
        "crossSourceLeakageGroups": sum(len(sources) > 1 for sources in sources_by_group.values()),
        "augmentationDeduplication": augmentation,
        "exactDeduplication": duplicate_report,
        "sourceAudit": audit,
        "materializedImages": materialize,
        "trainingPolicy": {
            "primaryCategory": "card",
            "segmentationEvaluationGeometry": ["source-polygon", "source-rle"],
            "bboxDerivedUse": "detector pretraining or localization evaluation only",
            "auxiliaryCategories": ["inner_border", "title_region", "info_region", "collection_region"],
            "contextCategories": ["slab"],
        },
    }
    build_outputs(records, config, raw_dir, out, materialize, report)
    return report


def parse_split_weights(value: str) -> dict[str, float]:
    weights: dict[str, float] = {}
    for component in value.split(","):
        name, raw_weight = component.split("=", 1)
        weights[name.strip()] = float(raw_weight)
    return weights


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw-dir", required=True, type=Path, help="directory containing immutable source ZIP files")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).with_name("source-config.json"),
        help="source category mappings",
    )
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--archive-manifest", type=Path, help="optional inventory whose SHA-256 values must match")
    parser.add_argument("--augmentation-policy", choices=("representative", "all"), default="representative")
    parser.add_argument("--splits", default="train=0.8,validation=0.1,test=0.1")
    parser.add_argument("--seed", default="tcger-card-segmentation-v1")
    parser.add_argument("--allow-unmapped", action="store_true", help="warn instead of failing on annotated source classes without a mapping")
    parser.add_argument("--materialize-images", action="store_true", help="extract canonical image bytes under OUT/images")
    args = parser.parse_args()
    report = compile_corpus(
        raw_dir=args.raw_dir,
        config_path=args.config,
        out=args.out,
        augmentation_policy=args.augmentation_policy,
        split_weights=parse_split_weights(args.splits),
        seed=args.seed,
        strict=not args.allow_unmapped,
        materialize=args.materialize_images,
        archive_manifest=args.archive_manifest,
    )
    print(json.dumps({key: report[key] for key in ("canonicalImages", "canonicalAnnotations", "evaluationEligibleCardMasks", "imagesBySplit")}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2)
