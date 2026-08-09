#!/usr/bin/env python3
"""Merge downloaded Roboflow COCO archives into Create ML detector data.

The original train/valid/test split is preserved. Dataset-specific category
names are deliberately collapsed to one `card` label. Images are symlinked,
not copied, so rebuilding the training view is fast and space-efficient.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def clipped_box(box: list[float], width: float, height: float) -> dict[str, float] | None:
    x, y, box_width, box_height = box
    left = max(0.0, x)
    top = max(0.0, y)
    right = min(width, x + box_width)
    bottom = min(height, y + box_height)
    box_width = right - left
    box_height = bottom - top
    if box_width < 4 or box_height < 4:
        return None
    return {
        "x": left + box_width / 2,
        "y": top + box_height / 2,
        "width": box_width,
        "height": box_height,
    }


def prepare_split(source: Path, output: Path, split: str) -> tuple[int, int]:
    destination = output / split
    images_directory = destination / "images"
    if destination.exists():
        shutil.rmtree(destination)
    images_directory.mkdir(parents=True)

    records: list[dict[str, object]] = []
    annotation_count = 0
    for dataset in sorted(path for path in source.iterdir() if path.is_dir()):
        split_directory = dataset / split
        coco_path = split_directory / "_annotations.coco.json"
        if not coco_path.exists():
            continue
        coco = json.loads(coco_path.read_text())
        annotations_by_image: dict[int, list[dict[str, object]]] = {}
        images = {image["id"]: image for image in coco.get("images", [])}
        for annotation in coco.get("annotations", []):
            image = images.get(annotation.get("image_id"))
            if not image:
                continue
            coordinates = clipped_box(
                annotation["bbox"], float(image["width"]), float(image["height"])
            )
            if coordinates is None:
                continue
            annotations_by_image.setdefault(image["id"], []).append(
                {"label": "card", "coordinates": coordinates}
            )

        for image_id, image in sorted(images.items()):
            annotations = annotations_by_image.get(image_id, [])
            if not annotations:
                continue
            source_image = split_directory / image["file_name"]
            if not source_image.exists():
                continue
            safe_name = f"{dataset.name}__{image_id}__{Path(image['file_name']).name}"
            target_image = images_directory / safe_name
            # Create ML's object-detector loader silently drops symlinks and
            # reports an empty table. A hard link is seen as a regular image
            # while still sharing the source file's storage blocks.
            try:
                target_image.hardlink_to(source_image.resolve())
            except OSError:
                shutil.copy2(source_image, target_image)
            records.append({"image": safe_name, "annotations": annotations})
            annotation_count += len(annotations)

    (destination / "annotations.json").write_text(
        json.dumps(records, separators=(",", ":"))
    )
    return len(records), annotation_count


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    totals = {}
    for split in ("train", "valid", "test"):
        images, annotations = prepare_split(args.source, args.output, split)
        totals[split] = {"images": images, "annotations": annotations}
        print(f"{split}: {images} images, {annotations} card boxes")
    (args.output / "summary.json").write_text(json.dumps(totals, indent=2) + "\n")


if __name__ == "__main__":
    main()
