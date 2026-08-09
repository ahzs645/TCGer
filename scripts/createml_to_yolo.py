#!/usr/bin/env python3
"""Convert a prepared Create ML detector dataset (images/ + annotations.json
with center-anchored pixel boxes) into ultralytics YOLO layout, for GPU
training off-Mac. Images are hard-linked, not copied.

usage: createml_to_yolo.py CREATEML_ROOT OUTPUT_ROOT
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from PIL import Image

SPLITS = {"train": "train", "valid": "val", "test": "test", "tight-test": "tight_test"}


def convert_split(source: Path, output: Path, split: str, yolo_name: str) -> int:
    records = json.loads((source / split / "annotations.json").read_text())
    images_in = source / split / "images"
    images_out = output / "images" / yolo_name
    labels_out = output / "labels" / yolo_name
    images_out.mkdir(parents=True, exist_ok=True)
    labels_out.mkdir(parents=True, exist_ok=True)

    count = 0
    for record in records:
        source_image = images_in / record["image"]
        if not source_image.exists():
            continue
        with Image.open(source_image) as image:
            width, height = float(image.width), float(image.height)
        lines = []
        for annotation in record["annotations"]:
            c = annotation["coordinates"]
            lines.append(
                f"0 {c['x'] / width:.6f} {c['y'] / height:.6f} "
                f"{c['width'] / width:.6f} {c['height'] / height:.6f}"
            )
        if not lines:
            continue
        target = images_out / record["image"]
        try:
            target.hardlink_to(source_image.resolve())
        except FileExistsError:
            pass
        except OSError:
            shutil.copy2(source_image, target)
        (labels_out / (Path(record["image"]).stem + ".txt")).write_text("\n".join(lines) + "\n")
        count += 1
    return count


def main() -> None:
    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    if output.exists():
        shutil.rmtree(output)
    totals = {}
    for split, yolo_name in SPLITS.items():
        if not (source / split).exists():
            continue
        totals[yolo_name] = convert_split(source, output, split, yolo_name)
        print(f"{yolo_name}: {totals[yolo_name]} images")
    (output / "data.yaml").write_text(
        "path: .\n"
        "train: images/train\n"
        "val: images/val\n"
        "test: images/test\n"
        "names:\n"
        "  0: card\n"
    )


if __name__ == "__main__":
    main()
