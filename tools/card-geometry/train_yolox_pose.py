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
import re
import shutil
import subprocess
import threading
from collections import Counter
from pathlib import Path
from typing import Any

from PIL import Image

from train_yolo_pose import download_verified, load_json, padded_point, sha256_file
from training_geometry import (MissingInstanceBox, context_margins, context_policy_from_environment,
    has_corner_supervision, instance_box, validate_instance_boxes)


VISIBILITY = {"visible": 2, "occluded": 1, "outsideFrame": 1}
METAINFO_FILE = "tools/card-geometry/configs/tcger-card-corners.py"
CHECKPOINT_PATTERN = re.compile(r"epoch_(\d+)\.pth$")


def checkpoint_epoch(path: str | Path) -> int | None:
    match = CHECKPOINT_PATTERN.search(str(path))
    return None if match is None else int(match.group(1))


def latest_checkpoint_path(paths: list[str], prefix: str) -> str | None:
    root = f"{prefix}/training-output/training/repeat-0/"
    candidates = [
        (checkpoint_epoch(path), path)
        for path in paths
        if path.startswith(root) and checkpoint_epoch(path) is not None
    ]
    return None if not candidates else max(candidates)[1]


def stable_checkpoints(
    work_dir: Path,
    previous: dict[Path, tuple[int, int]],
    uploaded: set[Path],
) -> tuple[list[Path], dict[Path, tuple[int, int]]]:
    current = {
        path: (path.stat().st_size, path.stat().st_mtime_ns)
        for path in work_dir.glob("epoch_*.pth")
        if path.is_file()
    }
    ready = [
        path
        for path, identity in current.items()
        if previous.get(path) == identity and path not in uploaded
    ]
    return sorted(ready, key=lambda path: checkpoint_epoch(path) or -1), current


class CheckpointPersistence:
    """Persist completed epoch checkpoints while the GPU process is alive."""

    def __init__(self, work_dir: Path) -> None:
        from huggingface_hub import HfApi

        self.work_dir = work_dir
        self.repo = os.environ["TCGER_GEOMETRY_CHECKPOINT_REPO"]
        self.prefix = os.environ["TCGER_GEOMETRY_CHECKPOINT_PREFIX"]
        self.api = HfApi(token=os.environ.get("HF_TOKEN"))
        self.uploaded: set[Path] = set()
        self.commits: dict[str, str] = {}
        self.errors: dict[str, str] = {}
        self.previous: dict[Path, tuple[int, int]] = {}
        self.stop = threading.Event()

    def upload(self, path: Path) -> None:
        epoch = checkpoint_epoch(path)
        if epoch is None:
            return
        target = f"{self.prefix}/training-output/training/repeat-0/{path.name}"
        try:
            commit = self.api.upload_file(
                path_or_fileobj=path,
                path_in_repo=target,
                repo_id=self.repo,
                repo_type="model",
                commit_message=f"geometry YOLOX checkpoint epoch {epoch}",
            )
            self.commits[path.name] = str(commit.oid)
            self.uploaded.add(path)
            self.errors.pop(path.name, None)
        except Exception as error:  # retry on the next polling pass
            self.errors[path.name] = f"{type(error).__name__}: {error}"

    def scan(self, *, force: bool = False) -> None:
        ready, current = stable_checkpoints(
            self.work_dir, self.previous, self.uploaded
        )
        if force:
            ready = sorted(
                (path for path in current if path not in self.uploaded),
                key=lambda path: checkpoint_epoch(path) or -1,
            )
        for path in ready:
            self.upload(path)
        self.previous = current

    def run(self) -> None:
        while not self.stop.wait(15):
            self.scan()


def remote_resume_checkpoint() -> tuple[Path | None, int | None, str | None]:
    from huggingface_hub import HfApi, hf_hub_download

    repo = os.environ["TCGER_GEOMETRY_CHECKPOINT_REPO"]
    prefix = os.environ["TCGER_GEOMETRY_CHECKPOINT_PREFIX"]
    token = os.environ.get("HF_TOKEN")
    api = HfApi(token=token)
    paths = api.list_repo_files(repo_id=repo, repo_type="model")
    source_prefix = prefix
    path = latest_checkpoint_path(paths, source_prefix)
    fallback_prefix = os.environ.get("TCGER_GEOMETRY_RESUME_PREFIX")
    if path is None and fallback_prefix:
        source_prefix = fallback_prefix
        path = latest_checkpoint_path(paths, source_prefix)
    if path is None:
        return None, None, None
    downloaded = Path(
        hf_hub_download(
            repo_id=repo,
            repo_type="model",
            filename=path,
            token=token,
        )
    )
    epoch = checkpoint_epoch(path)
    expected_epoch = os.environ.get("TCGER_GEOMETRY_RESUME_EPOCH")
    if fallback_prefix and expected_epoch is not None and epoch != int(expected_epoch):
        raise ValueError(f"resume epoch mismatch: {epoch} != {expected_epoch}")
    expected_sha256 = os.environ.get("TCGER_GEOMETRY_RESUME_SHA256")
    if expected_sha256 is not None:
        actual_sha256 = sha256_file(downloaded)
        if actual_sha256 != expected_sha256:
            raise ValueError(
                f"resume checkpoint SHA-256 mismatch: {actual_sha256} != {expected_sha256}"
            )
    return downloaded, epoch, source_prefix


def training_command(
    *,
    mmyolo_root: Path,
    config: Path,
    work_dir: Path,
    base_checkpoint: Path,
    resume_checkpoint: Path | None,
) -> list[str]:
    command = [
        os.environ.get("PYTHON", "python"),
        str(mmyolo_root / "tools/train.py"),
        str(config),
        "--work-dir",
        str(work_dir),
        "--amp",
    ]
    if resume_checkpoint is not None:
        command.extend(("--resume", str(resume_checkpoint)))
    else:
        command.extend(("--cfg-options", f"load_from={base_checkpoint}"))
    return command


def stage_resume_checkpoint(checkpoint: Path, epoch: int, work_dir: Path) -> Path:
    work_dir.mkdir(parents=True, exist_ok=True)
    staged = work_dir / f"epoch_{epoch}.pth"
    shutil.copy2(checkpoint, staged)
    return staged


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
    known = has_corner_supervision(instance)
    if not known:
        left, top, right, bottom = instance_box(instance)
        corners = [{"point": {"x": x, "y": y}, "visibility": "visible"}
                   for x, y in ((left, top), (right, top), (right, bottom), (left, bottom))]
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
        "num_keypoints": 4 if known else 0,
        "keypoints": keypoints if known else [0] * 12,
    }


def materialize_coco(release: Path, destination: Path,
                     real_context_policy: dict[str, Any] | None = None) -> dict[str, Any]:
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
        "realContextMarginPolicy": real_context_policy,
        "counts": dict(sorted(counts.items())),
        "contextPadding": {
            "order": "source -> black context padding -> MMYOLO letterbox",
            "fillRgb": [0, 0, 0],
            "cornerMapping": "(x*sourceWidth+left)/(sourceWidth+left+right)",
        },
    }


def scaled_learning_rate(batch: int) -> float:
    if batch <= 0:
        raise ValueError("batch must be positive")
    # This wrapper launches one process on one GPU; disable MMEngine autoscale.
    return 0.004 * batch / 256


def write_config(
    *, mmyolo_root: Path, dataset: Path, output: Path, epochs: int, batch: int, workers: int, seed: int
) -> Path:
    base = mmyolo_root / "configs/yolox/pose/yolox-pose_s_8xb32-300e-rtmdet-hyp_coco.py"
    if not base.is_file():
        raise ValueError(f"pinned MMYOLO checkout lacks YOLOX-Pose config: {base}")
    if not Path(METAINFO_FILE).is_file():
        raise ValueError(f"missing pinned card-corner metainfo: {METAINFO_FILE}")
    config = output / "yolox-pose-card.py"
    shared_pipeline = """[
    dict(type='LoadImageFromFile', to_float32=True),
    dict(type='LoadAnnotations', with_keypoints=True),
    dict(type='Resize', scale=(640, 640), keep_ratio=True),
    dict(type='mmdet.Pad', pad_to_square=True,
         pad_val=dict(img=(114.0, 114.0, 114.0))),
    dict(type='FilterAnnotations', by_box=True, by_keypoints=False, keep_empty=True),
    dict(type='PackDetInputs',
         meta_keys=('id', 'img_id', 'img_path', 'ori_shape', 'img_shape',
                    'scale_factor', 'flip_indices')),
]"""
    inference_pipeline = """[
    dict(type='LoadImageFromFile', to_float32=True),
    dict(type='Resize', scale=(640, 640), keep_ratio=True),
    dict(type='mmdet.Pad', pad_to_square=True,
         pad_val=dict(img=(114.0, 114.0, 114.0))),
    dict(type='PackDetInputs',
         meta_keys=('img_id', 'img_path', 'ori_shape', 'img_shape',
                    'scale_factor')),
]"""
    config.write_text(
        "\n".join(
            [
                f"_base_ = {str(base)!r}",
                f"data_root = {str(dataset.resolve()) + '/'!r}",
                f"metainfo_file = {METAINFO_FILE!r}",
                "metainfo = dict(from_file=metainfo_file)",
                "load_from = None",
                "num_keypoints = 4",
                "img_scale = (640, 640)",
                f"shared_pipeline = {shared_pipeline}",
                f"inference_pipeline = {inference_pipeline}",
                "model = dict(data_preprocessor=dict(batch_augments=None), "
                "bbox_head=dict(head_module=dict(num_keypoints=4), "
                "loss_pose=dict(_delete_=True, type='OksLoss', metainfo=metainfo_file, "
                "loss_weight=30.0)), train_cfg=dict(assigner=dict("
                "oks_calculator=dict(_delete_=True, type='OksLoss', "
                "metainfo=metainfo_file))), test_cfg=dict(yolox_style=True, "
                "multi_label=True, score_thr=0.01, max_per_img=300, "
                "nms=dict(type='nms', iou_threshold=0.65)))",
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
                f"test_dataloader = dict(batch_size={batch}, num_workers={workers}, "
                "dataset=dict(_delete_=True, type='PoseCocoDataset', data_mode='bottomup', "
                "data_root=data_root, ann_file='annotations/validation.json', "
                "data_prefix=dict(img='images/validation/'), metainfo=metainfo, "
                "pipeline=inference_pipeline))",
                "val_evaluator = dict(_delete_=True, type='mmpose.CocoMetric', "
                "ann_file=data_root + 'annotations/validation.json', score_mode='bbox')",
                "test_evaluator = val_evaluator",
                f"train_cfg = dict(max_epochs={epochs}, val_begin=1, "
                "val_interval=1, dynamic_intervals=None)",
                f"optim_wrapper = dict(optimizer=dict(lr={scaled_learning_rate(batch)!r}))",
                "auto_scale_lr = dict(enable=False, base_batch_size=256)",
                "param_scheduler = [dict(type='CosineAnnealingLR', eta_min=0.00001, "
                f"begin=0, end={epochs}, T_max={epochs}, by_epoch=True)]",
                "custom_hooks = [dict(type='EMAHook', ema_type='ExpMomentumEMA', "
                "momentum=0.0002, update_buffers=True, strict_load=False, priority=49)]",
                f"randomness = dict(seed={seed}, deterministic=True)",
                "default_hooks = dict(checkpoint=dict(interval=1, save_best=None))",
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
    from yolox_validation_fix import repair_source

    source_repair = repair_source(args.mmyolo_root)
    (output / "mmyolo-source-repair.json").write_text(json.dumps(source_repair, indent=2) + "\n")
    resume_checkpoint, resume_epoch, resume_prefix = remote_resume_checkpoint()
    base_checkpoint = output / "base-yolox-pose.pth"
    if resume_checkpoint is None:
        download_verified(args.base_url, args.base_sha256, base_checkpoint)
    dataset = output / "coco-dataset"
    materialization = materialize_coco(release, dataset, context_policy_from_environment())
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
    if resume_checkpoint is not None:
        assert resume_epoch is not None
        resume_checkpoint = stage_resume_checkpoint(
            resume_checkpoint, resume_epoch, work_dir
        )
    command = training_command(
        mmyolo_root=args.mmyolo_root,
        config=config,
        work_dir=work_dir,
        base_checkpoint=base_checkpoint,
        resume_checkpoint=resume_checkpoint,
    )
    persistence = CheckpointPersistence(work_dir)
    persistence_thread = threading.Thread(target=persistence.run, daemon=True)
    persistence_thread.start()
    process = subprocess.Popen(command)
    returncode = process.wait()
    persistence.stop.set()
    persistence_thread.join()
    persistence.scan(force=True)
    if returncode:
        raise subprocess.CalledProcessError(returncode, command)
    checkpoints = sorted(work_dir.glob("*.pth"))
    if not checkpoints:
        raise RuntimeError("MMYOLO training produced no checkpoint")
    summary = {
        "schema": "https://tcger.app/reports/yolox-pose-training/v1",
        "candidate": "yolox-pose",
        "experimentHash": os.environ["TCGER_GEOMETRY_EXPERIMENT_HASH"],
        "materialization": materialization,
        "mmyolo": {"root": str(args.mmyolo_root), "revision": args.mmyolo_revision, "sourceRepair": source_repair},
        "baseCheckpoint": {"url": args.base_url, "sha256": args.base_sha256},
        "resume": (
            None
            if resume_checkpoint is None
            else {
                "checkpoint": str(resume_checkpoint),
                "epoch": resume_epoch,
                "sourcePrefix": resume_prefix,
                "sourceJobId": os.environ.get("TCGER_GEOMETRY_RESUME_JOB_ID"),
            }
        ),
        "checkpointPersistence": {
            "pathPrefix": os.environ["TCGER_GEOMETRY_CHECKPOINT_PREFIX"],
            "uploaded": dict(sorted(persistence.commits.items())),
            "errors": dict(sorted(persistence.errors.items())),
        },
        "training": {
            "epochs": epochs,
            "inputResolution": int(os.environ["TCGER_GEOMETRY_INPUT_RESOLUTION"]),
            "batch": args.batch,
            "learningRate": scaled_learning_rate(args.batch),
            "learningRateScaling": {"referenceLearningRate": 0.004, "referenceBatch": 256, "worldSize": 1},
            "seed": seed,
            "augmentationProfile": os.environ["TCGER_GEOMETRY_AUGMENTATION_PROFILE"],
            "runtimeAugmentation": "disabled; variation is baked into the canonical corpus",
            "materialization": "black context pad, JPEG quality 95, then 114 letterbox",
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
    base_checkpoint.unlink(missing_ok=True)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mmyolo-root", type=Path, required=True)
    parser.add_argument("--mmyolo-revision", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--base-sha256", required=True)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--materialize-only", action="store_true")
    parser.add_argument("--release-root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--real-context-policy", type=Path, help="declared policy JSON for materialize-only")
    args = parser.parse_args()
    if args.materialize_only:
        if args.release_root is None or args.output is None:
            parser.error("--materialize-only requires --release-root and --output")
        print(json.dumps(materialize_coco(args.release_root, args.output,
            load_json(args.real_context_policy) if args.real_context_policy else context_policy_from_environment()), sort_keys=True))
        return 0
    print(json.dumps(train(args), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
