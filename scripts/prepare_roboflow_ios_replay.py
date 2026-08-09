#!/usr/bin/env python3
"""Safely expand Roboflow COCO archives for the iOS scanner diagnostic test."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import stat
import zipfile
from collections import defaultdict
from pathlib import Path, PurePosixPath


ARCHIVE_DATASET_NAMES = {
    "annotations.v7i.coco-segmentation.zip": "tcgx-annotations-v7",
    "labelyolo.v4i.coco.zip": "labelyolo-v4",
    "pk-detect.v3i.coco.zip": "pk-detect-v3",
    "pokefolio.v1i.coco.zip": "pokefolio-v1",
    "pokemon_card_detector.v1-versie-1.coco.zip": "pokemon-card-detector-v1",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Expand Roboflow COCO ZIPs and create an iOS replay manifest."
    )
    parser.add_argument("archives", type=Path, help="Directory containing the raw Roboflow ZIP files")
    parser.add_argument("--output", required=True, type=Path, help="Derived replay directory")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_extract(archive: Path, destination: Path, digest: str) -> None:
    marker = destination / ".archive-sha256"
    if marker.exists() and marker.read_text().strip() == digest:
        return
    if destination.exists() and any(destination.iterdir()):
        raise RuntimeError(
            f"Refusing to overwrite non-empty derived directory with a different archive: {destination}"
        )

    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        if len(members) > 20_000:
            raise RuntimeError(f"Archive has an unexpected number of entries: {archive}")
        if sum(member.file_size for member in members) > 1_000_000_000:
            raise RuntimeError(f"Archive expands beyond the 1 GB safety limit: {archive}")

        for member in members:
            member_path = PurePosixPath(member.filename)
            if member_path.is_absolute() or ".." in member_path.parts:
                raise RuntimeError(f"Unsafe archive path in {archive}: {member.filename}")
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise RuntimeError(f"Symlinks are not accepted in dataset archives: {member.filename}")

            target = (destination / Path(*member_path.parts)).resolve()
            if target != destination_root and destination_root not in target.parents:
                raise RuntimeError(f"Archive path escapes destination: {member.filename}")
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue

            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)

    marker.write_text(digest + "\n")


def records_for_dataset(dataset_name: str, root: Path, output_root: Path) -> list[dict]:
    records: list[dict] = []
    annotation_files = sorted(root.rglob("_annotations.coco.json"))
    if not annotation_files:
        raise RuntimeError(f"No COCO annotations found in {root}")

    for annotation_file in annotation_files:
        payload = json.loads(annotation_file.read_text())
        category_names = {
            int(category["id"]): str(category["name"])
            for category in payload.get("categories", [])
        }
        annotations_by_image: dict[int, list[dict]] = defaultdict(list)
        for annotation in payload.get("annotations", []):
            bbox = annotation.get("bbox")
            if not isinstance(bbox, list) or len(bbox) != 4:
                continue
            annotations_by_image[int(annotation["image_id"])].append(
                {
                    "category": category_names.get(int(annotation["category_id"]), "unknown"),
                    "bbox": [float(value) for value in bbox],
                    "area": float(annotation.get("area", bbox[2] * bbox[3])),
                }
            )

        split = annotation_file.parent.name
        for image in payload.get("images", []):
            image_path = (annotation_file.parent / image["file_name"]).resolve()
            if not image_path.is_file():
                raise RuntimeError(f"Missing image referenced by COCO JSON: {image_path}")
            records.append(
                {
                    "dataset": dataset_name,
                    "split": split,
                    "imagePath": str(image_path.relative_to(output_root)),
                    "width": int(image["width"]),
                    "height": int(image["height"]),
                    "annotations": annotations_by_image.get(int(image["id"]), []),
                }
            )

    records.sort(key=lambda record: (record["split"], record["imagePath"]))
    return records


def main() -> None:
    args = parse_args()
    archives = args.archives.expanduser().resolve()
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)

    archive_paths = sorted(archives.glob("*.zip"))
    if not archive_paths:
        raise SystemExit(f"No ZIP archives found in {archives}")

    all_records: list[dict] = []
    datasets: list[dict] = []
    for archive in archive_paths:
        dataset_name = ARCHIVE_DATASET_NAMES.get(archive.name)
        if dataset_name is None:
            raise RuntimeError(f"Add an explicit dataset name for unexpected archive: {archive.name}")
        digest = sha256(archive)
        dataset_root = output / "datasets" / dataset_name
        safe_extract(archive, dataset_root, digest)
        records = records_for_dataset(dataset_name, dataset_root, output)
        all_records.extend(records)
        datasets.append(
            {
                "name": dataset_name,
                "archive": archive.name,
                "sha256": digest,
                "images": len(records),
                "annotations": sum(len(record["annotations"]) for record in records),
                "categories": sorted(
                    {
                        annotation["category"]
                        for record in records
                        for annotation in record["annotations"]
                    }
                ),
            }
        )

    manifest = {
        "schemaVersion": 1,
        "datasets": datasets,
        "records": all_records,
        "totals": {
            "images": len(all_records),
            "annotations": sum(len(record["annotations"]) for record in all_records),
        },
    }
    manifest_path = output / "roboflow-ios-replay.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"manifest": str(manifest_path), **manifest["totals"]}, indent=2))


if __name__ == "__main__":
    main()
