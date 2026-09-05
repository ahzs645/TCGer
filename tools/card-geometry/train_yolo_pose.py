#!/usr/bin/env python3
"""Train the Ultralytics four-corner pose smoke from a canonical release.

The release remains the source of truth. This adapter materializes only its
train and validation splits into YOLO pose labels, applies the compositor's
declared context margin before Ultralytics letterboxing, and records every
resolved input beside the resulting private checkpoints.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

from PIL import Image

from training_geometry import (
    MissingInstanceBox, context_margins, context_policy_from_environment,
    has_corner_supervision, instance_box, validate_instance_boxes,
)


VISIBILITY = {"visible": 2, "occluded": 1, "outsideFrame": 1}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def padded_point(
    point: dict[str, Any], width: int, height: int, margins: dict[str, int]
) -> tuple[float, float]:
    padded_width = width + margins["left"] + margins["right"]
    padded_height = height + margins["top"] + margins["bottom"]
    x = (float(point["x"]) * width + margins["left"]) / padded_width
    y = (float(point["y"]) * height + margins["top"]) / padded_height
    return x, y


def yolo_line(
    instance: dict[str, Any], width: int, height: int, margins: dict[str, int]
) -> str | None:
    corners = instance.get("corners") or []
    known = has_corner_supervision(instance)
    if known:
        keypoints = [padded_point(corner["point"], width, height, margins) for corner in corners]
    else:
        left, top, right, bottom = instance_box(instance)
        keypoints = [padded_point({"x": x, "y": y}, width, height, margins)
                     for x, y in ((left, top), (right, bottom))]
    if any(not (0 <= x <= 1 and 0 <= y <= 1) for x, y in keypoints):
        raise ValueError(
            f"context margin does not contain {instance.get('instanceId', 'instance')}"
        )
    xs = [point[0] for point in keypoints]
    ys = [point[1] for point in keypoints]
    left, right = min(xs), max(xs)
    top, bottom = min(ys), max(ys)
    if right <= left or bottom <= top:
        raise ValueError(f"degenerate instance: {instance.get('instanceId', 'instance')}")
    values: list[float | int] = [
        0,
        (left + right) / 2,
        (top + bottom) / 2,
        right - left,
        bottom - top,
    ]
    if not known:
        values.extend([0, 0, 0] * 4)
    for corner, (x, y) in zip(corners if known else [], keypoints):
        visibility = corner.get("visibility")
        if visibility not in VISIBILITY:
            raise ValueError(f"unsupported known-corner visibility: {visibility!r}")
        values.extend((x, y, VISIBILITY[visibility]))
    return " ".join(
        str(value) if isinstance(value, int) else f"{value:.10f}" for value in values
    )


def materialize_yolo(
    release: Path, destination: Path, real_context_policy: dict[str, Any] | None = None
) -> dict[str, Any]:
    manifest = load_json(release / "manifest.json")
    counts: Counter[str] = Counter()
    destination.mkdir(parents=True, exist_ok=False)
    for split in ("train", "validation"):
        (destination / "images" / split).mkdir(parents=True)
        (destination / "labels" / split).mkdir(parents=True)
    for entry in manifest["records"]:
        split = entry["split"]
        if split not in {"train", "validation"}:
            continue
        record = load_json(release / entry["path"])
        margins = context_margins(record, real_context_policy)
        try:
            validate_instance_boxes(record["instances"])
        except MissingInstanceBox:
            counts[f"recordsSkippedMissingBox:{split}"] += 1
            continue
        source = release / record["source"]["path"]
        with Image.open(source) as opened:
            image = opened.convert("RGB")
        width, height = image.size
        if (width, height) != (
            int(record["source"]["width"]),
            int(record["source"]["height"]),
        ):
            raise ValueError(f"image dimensions disagree with record: {entry['recordId']}")
        padded = Image.new(
            "RGB",
            (width + margins["left"] + margins["right"], height + margins["top"] + margins["bottom"]),
            (0, 0, 0),
        )
        padded.paste(image, (margins["left"], margins["top"]))
        image_target = destination / "images" / split / f"{entry['recordId']}.jpg"
        padded.save(image_target, format="JPEG", quality=95, optimize=False, progressive=False)
        lines = []
        for instance in record["instances"]:
            line = yolo_line(instance, width, height, margins)
            if line is not None:
                lines.append(line)
                counts[f"instances:{split}"] += 1
        (destination / "labels" / split / f"{entry['recordId']}.txt").write_text(
            "\n".join(lines) + "\n", encoding="utf-8"
        )
        counts[f"records:{split}"] += 1
    yaml = (
        f"path: {destination.resolve()}\n"
        "train: images/train\n"
        "val: images/validation\n"
        "names:\n  0: card\n"
        "kpt_shape: [4, 3]\n"
        "flip_idx: [1, 0, 3, 2]\n"
    )
    (destination / "dataset.yaml").write_text(yaml, encoding="utf-8")
    if not counts["records:train"] or not counts["records:validation"]:
        raise ValueError(f"materialized dataset is incomplete: {dict(counts)}")
    return {
        "corpusHash": manifest["corpusHash"],
        "realContextMarginPolicy": real_context_policy,
        "counts": dict(sorted(counts.items())),
        "contextPadding": {
            "order": "source -> black context padding -> Ultralytics letterbox",
            "fillRgb": [0, 0, 0],
            "cornerMapping": "(x*sourceWidth+left)/(sourceWidth+left+right)",
        },
    }


def download_verified(url: str, expected_sha256: str, destination: Path) -> None:
    urllib.request.urlretrieve(url, destination)
    actual = sha256_file(destination)
    if actual != expected_sha256:
        destination.unlink(missing_ok=True)
        raise ValueError(
            f"base checkpoint SHA-256 mismatch: expected {expected_sha256}, got {actual}"
        )


SUPPORTED_CANDIDATES = {"yolo11n-pose", "yolo11s-pose"}


def train(args: argparse.Namespace) -> dict[str, Any]:
    release = Path(os.environ["TCGER_GEOMETRY_RELEASE_ROOT"])
    output = Path(os.environ["TCGER_GEOMETRY_OUTPUT_DIR"])
    output.mkdir(parents=True, exist_ok=True)
    budget_kind = os.environ["TCGER_GEOMETRY_BUDGET_KIND"]
    if budget_kind != "epochs":
        raise ValueError("YOLO pose v1 supports only an epoch budget")
    epochs = int(os.environ["TCGER_GEOMETRY_BUDGET_VALUE"])
    resolution = int(os.environ["TCGER_GEOMETRY_INPUT_RESOLUTION"])
    seed = int(os.environ["TCGER_GEOMETRY_BASE_SEED"])
    repeats = int(os.environ["TCGER_GEOMETRY_REPEAT_COUNT"])
    if repeats != 1:
        raise ValueError("one Job invocation trains exactly one resolved repeat")

    dataset = output / "yolo-dataset"
    materialization = materialize_yolo(release, dataset, context_policy_from_environment())
    base = output / f"base-{args.candidate}.pt"
    download_verified(args.base_url, args.base_sha256, base)

    from ultralytics import YOLO, __version__ as ultralytics_version

    project = output / "training"
    model = YOLO(str(base))
    model.train(
        data=str(dataset / "dataset.yaml"),
        epochs=epochs,
        imgsz=resolution,
        batch=args.batch,
        device=0,
        workers=args.workers,
        seed=seed,
        deterministic=True,
        project=str(project),
        name="repeat-0",
        exist_ok=False,
        save=True,
        save_period=1,
        plots=False,
        verbose=True,
        # The canonical synthetic corpus already carries the shared geometry
        # and photometric augmentation.  Disable framework-local randomness so
        # every bake-off candidate sees the same pixels.
        hsv_h=0.0,
        hsv_s=0.0,
        hsv_v=0.0,
        degrees=0.0,
        translate=0.0,
        scale=0.0,
        shear=0.0,
        perspective=0.0,
        flipud=0.0,
        fliplr=0.0,
        bgr=0.0,
        mosaic=0.0,
        mixup=0.0,
        cutmix=0.0,
        copy_paste=0.0,
        close_mosaic=0,
    )
    weights = project / "repeat-0" / "weights"
    artifacts = {
        name: {"path": str(path.relative_to(output)), "sha256": sha256_file(path)}
        for name, path in (("best", weights / "best.pt"), ("last", weights / "last.pt"))
        if path.is_file()
    }
    if not artifacts:
        raise RuntimeError("training produced no checkpoint")
    summary = {
        "schema": "https://tcger.app/reports/yolo-pose-training-smoke/v1",
        "candidate": args.candidate,
        "experimentHash": os.environ["TCGER_GEOMETRY_EXPERIMENT_HASH"],
        "materialization": materialization,
        "baseCheckpoint": {
            "url": args.base_url,
            "sha256": args.base_sha256,
        },
        "training": {
            "epochs": epochs,
            "inputResolution": resolution,
            "batch": args.batch,
            "seed": seed,
            "augmentationProfile": os.environ["TCGER_GEOMETRY_AUGMENTATION_PROFILE"],
            "runtimeAugmentation": "disabled; variation is baked into the canonical corpus",
            "materialization": "black context pad, JPEG quality 95, then 114 letterbox",
            "ultralyticsVersion": ultralytics_version,
            "pythonVersion": platform.python_version(),
        },
        "artifacts": artifacts,
    }
    (output / "trainer-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    shutil.rmtree(dataset)
    base.unlink()
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--base-sha256", required=True)
    parser.add_argument("--candidate", choices=sorted(SUPPORTED_CANDIDATES), required=True)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--materialize-only", action="store_true")
    parser.add_argument("--release-root", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.materialize_only:
        if args.release_root is None or args.output is None:
            parser.error("--materialize-only requires --release-root and --output")
        print(json.dumps(materialize_yolo(args.release_root, args.output), sort_keys=True))
        return 0
    print(json.dumps(train(args), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
