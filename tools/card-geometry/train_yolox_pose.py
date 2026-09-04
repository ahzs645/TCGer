#!/usr/bin/env python3
"""Train the Apache-2.0 MMYOLO YOLOX-Pose four-corner candidate.

The adapter converts the canonical release to bottom-up COCO keypoints with
the same explicit context margin used by the Ultralytics candidate.  MMYOLO is
provided as a separately pinned source checkout so the training config, code
revision, and checkpoint remain independently auditable.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

from PIL import Image

from train_yolo_pose import load_json, padded_point, sha256_file


VISIBILITY = {"visible": 2, "occluded": 1, "outsideFrame": 1}
CARD_METAINFO = {
    "dataset_name": "tcger-card-corners",
    "paper_info": {},
    "keypoint_info": {
        0: {"name": "top_left", "id": 0, "color": [0, 255, 0], "type": "", "swap": "top_right"},
        1: {"name": "top_right", "id": 1, "color": [0, 255, 0], "type": "", "swap": "top_left"},
        2: {"name": "bottom_right", "id": 2, "color": [0, 255, 0], "type": "", "swap": "bottom_left"},
        3: {"name": "bottom_left", "id": 3, "color": [0, 255, 0], "type": "", "swap": "bottom_right"},
    },
    "skeleton_info": {
        0: {"link": ("top_left", "top_right"), "id": 0, "color": [0, 255, 0]},
        1: {"link": ("top_right", "bottom_right"), "id": 1, "color": [0, 255, 0]},
        2: {"link": ("bottom_right", "bottom_left"), "id": 2, "color": [0, 255, 0]},
        3: {"link": ("bottom_left", "top_left"), "id": 3, "color": [0, 255, 0]},
    },
    "joint_weights": [1.0, 1.0, 1.0, 1.0],
    "sigmas": [0.025, 0.025, 0.025, 0.025],
}


def coco_annotation(
    instance: dict[str, Any],
    *,
    annotation_id: int,
    image_id: int,
    width: int,
    height: int,
    margins: dict[str, int],
) -> dict[str, Any] | None:
    corners = instance.get("corners") or []
    if len(corners) != 4 or any(not corner.get("coordinateKnown") for corner in corners):
        return None
    padded_width = width + margins["left"] + margins["right"]
    padded_height = height + margins["top"] + margins["bottom"]
    keypoints: list[float | int] = []
    points = []
    for corner in corners:
        x, y = padded_point(corner["point"], width, height, margins)
        if not (0 <= x <= 1 and 0 <= y <= 1):
            raise ValueError(
                f"context margin does not contain {instance.get('instanceId', 'instance')}"
            )
        visibility = corner.get("visibility")
        if visibility not in VISIBILITY:
            raise ValueError(f"unsupported known-corner visibility: {visibility!r}")
        px, py = x * padded_width, y * padded_height
        points.append((px, py))
        keypoints.extend((round(px, 6), round(py, 6), VISIBILITY[visibility]))
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    left, top = min(xs), min(ys)
    box_width, box_height = max(xs) - left, max(ys) - top
    if box_width <= 0 or box_height <= 0:
        raise ValueError(f"degenerate instance: {instance.get('instanceId', 'instance')}")
    return {
        "id": annotation_id,
        "image_id": image_id,
        "category_id": 1,
        "bbox": [round(left, 6), round(top, 6), round(box_width, 6), round(box_height, 6)],
        "area": round(box_width * box_height, 6),
        "iscrowd": 0,
        "num_keypoints": 4,
        "keypoints": keypoints,
    }


def materialize_coco(release: Path, destination: Path) -> dict[str, Any]:
    manifest = load_json(release / "manifest.json")
    destination.mkdir(parents=True, exist_ok=False)
    annotations: dict[str, list[dict[str, Any]]] = {"train": [], "validation": []}
    images: dict[str, list[dict[str, Any]]] = {"train": [], "validation": []}
    counts: Counter[str] = Counter()
    next_image_id = 1
    next_annotation_id = 1
    for split in annotations:
        (destination / "images" / split).mkdir(parents=True)
    (destination / "annotations").mkdir()
    for entry in manifest["records"]:
        split = entry["split"]
        if split not in annotations:
            continue
        record = load_json(release / entry["path"])
        if record["source"]["kind"] != "synthetic":
            raise ValueError(f"{split} must be synthetic in v1: {entry['recordId']}")
        margins = {
            name: int(record["synthetic"]["contextMarginPixels"][name])
            for name in ("left", "top", "right", "bottom")
        }
        source = release / record["source"]["path"]
        with Image.open(source) as opened:
            image = opened.convert("RGB")
        width, height = image.size
        padded_width = width + margins["left"] + margins["right"]
        padded_height = height + margins["top"] + margins["bottom"]
        rows = []
        for instance in record["instances"]:
            row = coco_annotation(
                instance,
                annotation_id=next_annotation_id,
                image_id=next_image_id,
                width=width,
                height=height,
                margins=margins,
            )
            if row is not None:
                rows.append(row)
                next_annotation_id += 1
        if not rows:
            counts[f"recordsSkippedNoKnownCorners:{split}"] += 1
            continue
        padded = Image.new("RGB", (padded_width, padded_height), (0, 0, 0))
        padded.paste(image, (margins["left"], margins["top"]))
        filename = f"{entry['recordId']}.jpg"
        padded.save(
            destination / "images" / split / filename,
            format="JPEG",
            quality=95,
            optimize=False,
            progressive=False,
        )
        images[split].append(
            {"id": next_image_id, "file_name": filename, "width": padded_width, "height": padded_height}
        )
        annotations[split].extend(rows)
        counts[f"records:{split}"] += 1
        counts[f"instances:{split}"] += len(rows)
        next_image_id += 1
    category = {
        "id": 1,
        "name": "card",
        "supercategory": "card",
        "keypoints": ["top_left", "top_right", "bottom_right", "bottom_left"],
        "skeleton": [[1, 2], [2, 3], [3, 4], [4, 1]],
    }
    for split in annotations:
        document = {
            "info": {"description": "TCGer canonical card geometry"},
            "licenses": [],
            "images": images[split],
            "annotations": annotations[split],
            "categories": [category],
        }
        (destination / "annotations" / f"{split}.json").write_text(
            json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    if not counts["records:train"] or not counts["records:validation"]:
        raise ValueError(f"materialized dataset is incomplete: {dict(counts)}")
    return {
        "corpusHash": manifest["corpusHash"],
        "counts": dict(sorted(counts.items())),
        "contextPadding": {
            "order": "source -> black context padding -> MMYOLO letterbox",
            "fillRgb": [0, 0, 0],
            "cornerMapping": "(x*sourceWidth+left)/(sourceWidth+left+right)",
        },
    }


def write_config(
    *, mmyolo_root: Path, dataset: Path, output: Path, epochs: int, batch: int, workers: int, seed: int
) -> Path:
    base = mmyolo_root / "configs/yolox/pose/yolox-pose_s_8xb32-300e-rtmdet-hyp_coco.py"
    if not base.is_file():
        raise ValueError(f"pinned MMYOLO checkout lacks YOLOX-Pose config: {base}")
    config = output / "yolox-pose-card.py"
    metainfo = repr(CARD_METAINFO)
    shared_pipeline = """[
    dict(type='LoadImageFromFile'),
    dict(type='LoadAnnotations', with_keypoints=True),
    dict(type='Resize', scale=(640, 640), keep_ratio=True),
    dict(type='mmdet.Pad', pad_to_square=True,
         pad_val=dict(img=(114.0, 114.0, 114.0))),
    dict(type='FilterAnnotations', by_keypoints=True, keep_empty=False),
    dict(type='PackDetInputs',
         meta_keys=('id', 'img_id', 'img_path', 'ori_shape', 'img_shape',
                    'scale_factor', 'flip_indices')),
]"""
    config.write_text(
        "\n".join(
            [
                f"_base_ = {str(base)!r}",
                f"data_root = {str(dataset.resolve()) + '/'!r}",
                f"metainfo = {metainfo}",
                "num_keypoints = 4",
                "img_scale = (640, 640)",
                f"shared_pipeline = {shared_pipeline}",
                "model = dict(bbox_head=dict(head_module=dict(num_keypoints=4), "
                "loss_pose=dict(_delete_=True, type='OksLoss', metainfo=metainfo, "
                "loss_weight=30.0)), train_cfg=dict(assigner=dict("
                "oks_calculator=dict(_delete_=True, type='OksLoss', "
                "metainfo=metainfo))))",
                f"train_dataloader = dict(batch_size={batch}, num_workers={workers}, "
                "dataset=dict(_delete_=True, type='PoseCocoDataset', data_mode='bottomup', "
                "data_root=data_root, ann_file='annotations/train.json', "
                "data_prefix=dict(img='images/train/'), metainfo=metainfo, "
                "pipeline=shared_pipeline))",
                f"val_dataloader = dict(batch_size={batch}, num_workers={workers}, "
                "dataset=dict(_delete_=True, type='PoseCocoDataset', data_mode='bottomup', "
                "data_root=data_root, ann_file='annotations/validation.json', "
                "data_prefix=dict(img='images/validation/'), metainfo=metainfo, "
                "pipeline=shared_pipeline))",
                "test_dataloader = val_dataloader",
                "val_evaluator = dict(_delete_=True, type='mmpose.CocoMetric', "
                "ann_file=data_root + 'annotations/validation.json', score_mode='bbox')",
                "test_evaluator = val_evaluator",
                f"train_cfg = dict(max_epochs={epochs}, val_interval=1, dynamic_intervals=None)",
                "param_scheduler = [dict(type='CosineAnnealingLR', eta_min=0.00001, "
                f"begin=0, end={epochs}, T_max={epochs}, by_epoch=True)]",
                "custom_hooks = [dict(type='EMAHook', ema_type='ExpMomentumEMA', "
                "momentum=0.0002, update_buffers=True, strict_load=False, priority=49)]",
                f"randomness = dict(seed={seed}, deterministic=True)",
                "default_hooks = dict(checkpoint=dict(interval=1, save_best='coco/AP', rule='greater'))",
                "visualizer = dict(type='mmpose.PoseLocalVisualizer')",
                "work_dir = None",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return config


def train(args: argparse.Namespace) -> dict[str, Any]:
    release = Path(os.environ["TCGER_GEOMETRY_RELEASE_ROOT"])
    output = Path(os.environ["TCGER_GEOMETRY_OUTPUT_DIR"])
    output.mkdir(parents=True, exist_ok=True)
    if os.environ["TCGER_GEOMETRY_BUDGET_KIND"] != "epochs":
        raise ValueError("YOLOX-Pose v1 supports only an epoch budget")
    epochs = int(os.environ["TCGER_GEOMETRY_BUDGET_VALUE"])
    seed = int(os.environ["TCGER_GEOMETRY_BASE_SEED"])
    if int(os.environ["TCGER_GEOMETRY_REPEAT_COUNT"]) != 1:
        raise ValueError("one Job invocation trains exactly one resolved repeat")
    dataset = output / "coco-dataset"
    materialization = materialize_coco(release, dataset)
    config = write_config(
        mmyolo_root=args.mmyolo_root,
        dataset=dataset,
        output=output,
        epochs=epochs,
        batch=args.batch,
        workers=args.workers,
        seed=seed,
    )
    work_dir = output / "training" / "repeat-0"
    subprocess.run(
        [
            os.environ.get("PYTHON", "python"),
            str(args.mmyolo_root / "tools/train.py"),
            str(config),
            "--work-dir",
            str(work_dir),
            "--amp",
        ],
        check=True,
    )
    checkpoints = sorted(work_dir.glob("*.pth"))
    if not checkpoints:
        raise RuntimeError("MMYOLO training produced no checkpoint")
    summary = {
        "schema": "https://tcger.app/reports/yolox-pose-training/v1",
        "candidate": "yolox-pose",
        "experimentHash": os.environ["TCGER_GEOMETRY_EXPERIMENT_HASH"],
        "materialization": materialization,
        "mmyolo": {"root": str(args.mmyolo_root), "revision": args.mmyolo_revision},
        "training": {
            "epochs": epochs,
            "inputResolution": int(os.environ["TCGER_GEOMETRY_INPUT_RESOLUTION"]),
            "batch": args.batch,
            "seed": seed,
            "augmentationProfile": os.environ["TCGER_GEOMETRY_AUGMENTATION_PROFILE"],
            "runtimeAugmentation": "disabled; variation is baked into the canonical corpus",
            "pythonVersion": platform.python_version(),
        },
        "artifacts": {
            path.name: {"path": str(path.relative_to(output)), "sha256": sha256_file(path)}
            for path in checkpoints
        },
    }
    (output / "trainer-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    shutil.rmtree(dataset)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mmyolo-root", type=Path, required=True)
    parser.add_argument("--mmyolo-revision", required=True)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--materialize-only", action="store_true")
    parser.add_argument("--release-root", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.materialize_only:
        if args.release_root is None or args.output is None:
            parser.error("--materialize-only requires --release-root and --output")
        print(json.dumps(materialize_coco(args.release_root, args.output), sort_keys=True))
        return 0
    print(json.dumps(train(args), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
