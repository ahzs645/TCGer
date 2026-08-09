#!/usr/bin/env python3
"""Merge downloaded Roboflow COCO archives into Create ML detector data.

The original train/valid/test split is preserved. Dataset-specific category
names are deliberately collapsed to one `card` label. Images are hard-linked,
not copied, so rebuilding the training view is fast and space-efficient.

With --tight-crops, train and valid are additionally augmented with synthetic
"the frame is the card" images: each scene donates a crop of its largest card
box with 0-12%% random margins (30%% of them perfectly borderless). Every
Roboflow archive is a card *in a scene*, so without this regime the detector
never learns that a borderless card crop is one card — it fires on interior
panels instead (see SCANNER_TESTING.md, importedPhoto). The scene `test`
split stays untouched for comparability; tight crops from test images go to a
separate `tight-test` split for explicit evaluation of this regime.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
from pathlib import Path

from PIL import Image

TIGHT_MIN_BOX_EDGE = 96.0
TIGHT_MAX_MARGIN = 0.12
TIGHT_BORDERLESS_PROBABILITY = 0.3
TIGHT_NEIGHBOR_VISIBLE_FRACTION = 0.25


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--tight-crops",
        action="store_true",
        help="augment train/valid with tight card crops; emit tight-test from test",
    )
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


def box_bounds(coordinates: dict[str, float]) -> tuple[float, float, float, float]:
    left = coordinates["x"] - coordinates["width"] / 2
    top = coordinates["y"] - coordinates["height"] / 2
    return left, top, left + coordinates["width"], top + coordinates["height"]


def tight_crop_entry(
    source_image: Path,
    safe_name: str,
    annotations: list[dict[str, object]],
    images_directory: Path,
) -> dict[str, object] | None:
    """Crop the largest card box (plus a small random margin) into a new
    training image whose annotation nearly fills the frame. Deterministic per
    image name so dataset rebuilds are reproducible."""
    primary = max(annotations, key=lambda a: a["coordinates"]["width"] * a["coordinates"]["height"])
    coordinates = primary["coordinates"]
    if min(coordinates["width"], coordinates["height"]) < TIGHT_MIN_BOX_EDGE:
        return None

    rng = random.Random(safe_name)
    if rng.random() < TIGHT_BORDERLESS_PROBABILITY:
        margins = (0.0, 0.0, 0.0, 0.0)
    else:
        margins = tuple(rng.uniform(0.0, TIGHT_MAX_MARGIN) for _ in range(4))

    left, top, right, bottom = box_bounds(coordinates)
    crop_left = left - margins[0] * coordinates["width"]
    crop_top = top - margins[1] * coordinates["height"]
    crop_right = right + margins[2] * coordinates["width"]
    crop_bottom = bottom + margins[3] * coordinates["height"]

    try:
        with Image.open(source_image) as image:
            crop_left = max(0.0, crop_left)
            crop_top = max(0.0, crop_top)
            crop_right = min(float(image.width), crop_right)
            crop_bottom = min(float(image.height), crop_bottom)
            if crop_right - crop_left < TIGHT_MIN_BOX_EDGE or crop_bottom - crop_top < TIGHT_MIN_BOX_EDGE:
                return None
            crop = image.convert("RGB").crop(
                (round(crop_left), round(crop_top), round(crop_right), round(crop_bottom))
            )
            crop_name = f"tightcrop__{Path(safe_name).stem}.jpg"
            crop.save(images_directory / crop_name, quality=90)
    except OSError:
        return None

    crop_width = float(crop.width)
    crop_height = float(crop.height)
    crop_annotations: list[dict[str, object]] = []
    for annotation in annotations:
        left, top, right, bottom = box_bounds(annotation["coordinates"])
        shifted = clipped_box(
            [left - round(crop_left), top - round(crop_top), right - left, bottom - top],
            crop_width,
            crop_height,
        )
        if shifted is None:
            continue
        # A sliver of a neighboring card at the crop edge is neither a clean
        # positive nor clean background; label only meaningfully visible cards.
        original_area = (right - left) * (bottom - top)
        if annotation is not primary and shifted["width"] * shifted["height"] < (
            TIGHT_NEIGHBOR_VISIBLE_FRACTION * original_area
        ):
            continue
        crop_annotations.append({"label": "card", "coordinates": shifted})

    if not crop_annotations:
        return None
    return {"image": crop_name, "annotations": crop_annotations}


def prepare_split(
    source: Path,
    output: Path,
    split: str,
    destination_name: str | None = None,
    include_scenes: bool = True,
    include_tight_crops: bool = False,
) -> tuple[int, int, int]:
    destination = output / (destination_name or split)
    images_directory = destination / "images"
    if destination.exists():
        shutil.rmtree(destination)
    images_directory.mkdir(parents=True)

    records: list[dict[str, object]] = []
    annotation_count = 0
    tight_count = 0
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
            if include_scenes:
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
            if include_tight_crops:
                entry = tight_crop_entry(source_image, safe_name, annotations, images_directory)
                if entry is not None:
                    records.append(entry)
                    annotation_count += len(entry["annotations"])
                    tight_count += 1

    (destination / "annotations.json").write_text(
        json.dumps(records, separators=(",", ":"))
    )
    return len(records), annotation_count, tight_count


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    totals = {}
    for split in ("train", "valid", "test"):
        augment = args.tight_crops and split != "test"
        images, annotations, tight = prepare_split(
            args.source, args.output, split, include_tight_crops=augment
        )
        totals[split] = {"images": images, "annotations": annotations, "tightCrops": tight}
        print(f"{split}: {images} images ({tight} tight crops), {annotations} card boxes")
    if args.tight_crops:
        images, annotations, tight = prepare_split(
            args.source,
            args.output,
            "test",
            destination_name="tight-test",
            include_scenes=False,
            include_tight_crops=True,
        )
        totals["tight-test"] = {"images": images, "annotations": annotations, "tightCrops": tight}
        print(f"tight-test: {images} images, {annotations} card boxes")
    (args.output / "summary.json").write_text(json.dumps(totals, indent=2) + "\n")


if __name__ == "__main__":
    main()
