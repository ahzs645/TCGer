#!/usr/bin/env python3
"""Train the permissive FastViT-T8 CenterNet-style four-corner candidate."""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import platform
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from train_yolo_pose import load_json, sha256_file


MODEL_NAME = "fastvit_t8.apple_in1k"
OUTPUT_STRIDE = 4


def letterbox_geometry(
    width: int, height: int, margins: dict[str, int], resolution: int
) -> dict[str, float | int]:
    padded_width = width + margins["left"] + margins["right"]
    padded_height = height + margins["top"] + margins["bottom"]
    scale = min(resolution / padded_width, resolution / padded_height)
    resized_width = max(1, round(padded_width * scale))
    resized_height = max(1, round(padded_height * scale))
    return {
        "paddedWidth": padded_width,
        "paddedHeight": padded_height,
        "scale": scale,
        "resizedWidth": resized_width,
        "resizedHeight": resized_height,
        "padLeft": (resolution - resized_width) // 2,
        "padTop": (resolution - resized_height) // 2,
    }


def input_point(
    point: dict[str, Any],
    width: int,
    height: int,
    margins: dict[str, int],
    geometry: dict[str, float | int],
    resolution: int,
) -> tuple[float, float]:
    x = (float(point["x"]) * width + margins["left"]) * float(geometry["scale"])
    y = (float(point["y"]) * height + margins["top"]) * float(geometry["scale"])
    x += int(geometry["padLeft"])
    y += int(geometry["padTop"])
    return x / resolution, y / resolution


def gaussian_radius(width: float, height: float, minimum_overlap: float = 0.7) -> int:
    a = 1.0
    b = height + width
    c = width * height * (1.0 - minimum_overlap) / (1.0 + minimum_overlap)
    radius = (b - math.sqrt(max(0.0, b * b - 4 * a * c))) / 2
    return max(1, int(radius))


def draw_gaussian(heatmap: np.ndarray, center: tuple[int, int], radius: int) -> None:
    diameter = 2 * radius + 1
    coordinates = np.arange(diameter, dtype=np.float32) - radius
    kernel = np.exp(-(coordinates[:, None] ** 2 + coordinates[None, :] ** 2) / (2 * (diameter / 6) ** 2))
    x, y = center
    left, right = min(x, radius), min(heatmap.shape[1] - x - 1, radius)
    top, bottom = min(y, radius), min(heatmap.shape[0] - y - 1, radius)
    if min(left, right, top, bottom) < 0:
        return
    target = heatmap[y - top : y + bottom + 1, x - left : x + right + 1]
    source = kernel[radius - top : radius + bottom + 1, radius - left : radius + right + 1]
    np.maximum(target, source, out=target)


def build_targets(
    instances: list[dict[str, Any]],
    *,
    width: int,
    height: int,
    margins: dict[str, int],
    resolution: int,
) -> dict[str, np.ndarray]:
    output_size = resolution // OUTPUT_STRIDE
    heatmap = np.zeros((1, output_size, output_size), dtype=np.float32)
    corners = np.zeros((8, output_size, output_size), dtype=np.float32)
    mask = np.zeros((1, output_size, output_size), dtype=np.float32)
    geometry = letterbox_geometry(width, height, margins, resolution)
    for instance in instances:
        values = instance.get("corners") or []
        if len(values) != 4 or any(not corner.get("coordinateKnown") for corner in values):
            continue
        points = [
            input_point(corner["point"], width, height, margins, geometry, resolution)
            for corner in values
        ]
        if any(not (0 <= x <= 1 and 0 <= y <= 1) for x, y in points):
            raise ValueError(f"context margin does not contain {instance.get('instanceId', 'instance')}")
        center_x = sum(point[0] for point in points) / 4
        center_y = sum(point[1] for point in points) / 4
        cell_x = min(output_size - 1, max(0, int(center_x * output_size)))
        cell_y = min(output_size - 1, max(0, int(center_y * output_size)))
        if mask[0, cell_y, cell_x]:
            continue
        card_width = (max(point[0] for point in points) - min(point[0] for point in points)) * output_size
        card_height = (max(point[1] for point in points) - min(point[1] for point in points)) * output_size
        draw_gaussian(heatmap[0], (cell_x, cell_y), gaussian_radius(card_width, card_height))
        corners[:, cell_y, cell_x] = np.asarray(points, dtype=np.float32).reshape(-1)
        mask[0, cell_y, cell_x] = 1
    return {"heatmap": heatmap, "corners": corners, "mask": mask}


def _release_entries(release: Path, split: str) -> list[dict[str, Any]]:
    manifest = load_json(release / "manifest.json")
    return [entry for entry in manifest["records"] if entry["split"] == split]


def make_dataset(release: Path, split: str, resolution: int, seed: int):
    import torch
    from torch.utils.data import Dataset

    class GeometryDataset(Dataset):
        def __init__(self) -> None:
            self.entries = _release_entries(release, split)

        def __len__(self) -> int:
            return len(self.entries)

        def __getitem__(self, index: int):
            entry = self.entries[index]
            record = load_json(release / entry["path"])
            if record["source"]["kind"] != "synthetic":
                raise ValueError(f"{split} must be synthetic: {entry['recordId']}")
            margins = {
                name: int(record["synthetic"]["contextMarginPixels"][name])
                for name in ("left", "top", "right", "bottom")
            }
            source = release / record["source"]["path"]
            with Image.open(source) as opened:
                image = opened.convert("RGB")
            width, height = image.size
            geometry = letterbox_geometry(width, height, margins, resolution)
            padded = Image.new(
                "RGB",
                (int(geometry["paddedWidth"]), int(geometry["paddedHeight"])),
                (0, 0, 0),
            )
            padded.paste(image, (margins["left"], margins["top"]))
            encoded = io.BytesIO()
            padded.save(
                encoded,
                format="JPEG",
                quality=95,
                optimize=False,
                progressive=False,
            )
            encoded.seek(0)
            with Image.open(encoded) as reopened:
                padded = reopened.convert("RGB")
            resized = padded.resize(
                (int(geometry["resizedWidth"]), int(geometry["resizedHeight"])),
                Image.Resampling.BILINEAR,
            )
            canvas = Image.new("RGB", (resolution, resolution), (114, 114, 114))
            canvas.paste(resized, (int(geometry["padLeft"]), int(geometry["padTop"])))
            target = build_targets(
                record["instances"],
                width=width,
                height=height,
                margins=margins,
                resolution=resolution,
            )
            pixels = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1) / 255.0
            mean = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)[:, None, None]
            std = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)[:, None, None]
            pixels = (pixels - mean) / std
            return (
                torch.from_numpy(pixels.copy()),
                {name: torch.from_numpy(value) for name, value in target.items()},
            )

    return GeometryDataset()


def build_model(base_checkpoint: Path | None):
    import timm
    import torch.nn as nn
    from timm.models import load_checkpoint

    class FourCornerModel(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.backbone = timm.create_model(MODEL_NAME, pretrained=False, features_only=True)
            if base_checkpoint is not None:
                load_checkpoint(self.backbone, str(base_checkpoint), strict=False)
            channels = self.backbone.feature_info.channels()[-1]
            self.decoder = nn.Sequential(
                nn.Conv2d(channels, 256, 3, padding=1),
                nn.ReLU(inplace=True),
                nn.ConvTranspose2d(256, 128, 4, stride=2, padding=1),
                nn.ReLU(inplace=True),
                nn.ConvTranspose2d(128, 64, 4, stride=2, padding=1),
                nn.ReLU(inplace=True),
                nn.ConvTranspose2d(64, 64, 4, stride=2, padding=1),
                nn.ReLU(inplace=True),
            )
            self.heatmap = nn.Conv2d(64, 1, 1)
            self.corners = nn.Conv2d(64, 8, 1)
            nn.init.constant_(self.heatmap.bias, -2.19)

        def forward(self, images):
            features = self.backbone(images)[-1]
            decoded = self.decoder(features)
            return self.heatmap(decoded), self.corners(decoded)

    return FourCornerModel()


def focal_loss(logits, targets):
    import torch

    predictions = logits.sigmoid().clamp(1e-4, 1 - 1e-4)
    positive = targets.eq(1).float()
    negative = targets.lt(1).float()
    negative_weight = (1 - targets).pow(4)
    positive_loss = -torch.log(predictions) * (1 - predictions).pow(2) * positive
    negative_loss = -torch.log(1 - predictions) * predictions.pow(2) * negative_weight * negative
    count = positive.sum().clamp(min=1)
    return (positive_loss.sum() + negative_loss.sum()) / count


def run_epoch(model, loader, optimizer, device: str) -> float:
    import torch
    import torch.nn.functional as functional

    training = optimizer is not None
    model.train(training)
    total = 0.0
    batches = 0
    for images, target in loader:
        images = images.to(device, non_blocking=True)
        target = {name: value.to(device, non_blocking=True) for name, value in target.items()}
        with torch.set_grad_enabled(training):
            heatmap, corners = model(images)
            heatmap_loss = focal_loss(heatmap, target["heatmap"])
            mask = target["mask"].expand_as(corners)
            corner_loss = functional.smooth_l1_loss(
                corners.sigmoid() * mask, target["corners"] * mask, reduction="sum"
            ) / mask.sum().clamp(min=1)
            loss = heatmap_loss + 10.0 * corner_loss
            if training:
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                optimizer.step()
        total += float(loss.detach().cpu())
        batches += 1
    return total / max(1, batches)


def train(args: argparse.Namespace) -> dict[str, Any]:
    import torch
    from huggingface_hub import hf_hub_download
    from torch.utils.data import DataLoader

    release = Path(os.environ["TCGER_GEOMETRY_RELEASE_ROOT"])
    output = Path(os.environ["TCGER_GEOMETRY_OUTPUT_DIR"])
    output.mkdir(parents=True, exist_ok=True)
    if os.environ["TCGER_GEOMETRY_BUDGET_KIND"] != "epochs":
        raise ValueError("FastViT four-corner v1 supports only an epoch budget")
    epochs = int(os.environ["TCGER_GEOMETRY_BUDGET_VALUE"])
    resolution = int(os.environ["TCGER_GEOMETRY_INPUT_RESOLUTION"])
    seed = int(os.environ["TCGER_GEOMETRY_BASE_SEED"])
    if int(os.environ["TCGER_GEOMETRY_REPEAT_COUNT"]) != 1:
        raise ValueError("one Job invocation trains exactly one resolved repeat")
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.use_deterministic_algorithms(True, warn_only=True)
    base = Path(
        hf_hub_download(
            repo_id=args.base_repo,
            filename=args.base_filename,
            revision=args.base_revision,
        )
    )
    if sha256_file(base) != args.base_sha256:
        raise ValueError("FastViT base checkpoint SHA-256 mismatch")
    train_dataset = make_dataset(release, "train", resolution, seed)
    validation_dataset = make_dataset(release, "validation", resolution, seed)
    generator = torch.Generator().manual_seed(seed)
    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch,
        shuffle=True,
        num_workers=args.workers,
        pin_memory=True,
        generator=generator,
    )
    validation_loader = DataLoader(
        validation_dataset,
        batch_size=args.batch,
        shuffle=False,
        num_workers=args.workers,
        pin_memory=True,
    )
    model = build_model(base).cuda()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.05)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    training_dir = output / "training" / "repeat-0"
    training_dir.mkdir(parents=True)
    best_loss = math.inf
    history = []
    for epoch in range(epochs):
        train_loss = run_epoch(model, train_loader, optimizer, "cuda")
        validation_loss = run_epoch(model, validation_loader, None, "cuda")
        scheduler.step()
        state = {
            "model": model.state_dict(),
            "epoch": epoch + 1,
            "architecture": "fastvit-t8-centernet-four-corner-v1",
            "inputResolution": resolution,
            "outputStride": OUTPUT_STRIDE,
        }
        torch.save(state, training_dir / "last.pt")
        if validation_loss < best_loss:
            best_loss = validation_loss
            torch.save(state, training_dir / "best.pt")
        history.append({"epoch": epoch + 1, "trainLoss": train_loss, "validationLoss": validation_loss})
    (training_dir / "history.json").write_text(
        json.dumps(history, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    summary = {
        "schema": "https://tcger.app/reports/fastvit-four-corner-training/v1",
        "candidate": "fastvit-t8-four-corner",
        "experimentHash": os.environ["TCGER_GEOMETRY_EXPERIMENT_HASH"],
        "baseCheckpoint": {
            "repo": args.base_repo,
            "revision": args.base_revision,
            "filename": args.base_filename,
            "sha256": args.base_sha256,
        },
        "training": {
            "epochs": epochs,
            "inputResolution": resolution,
            "batch": args.batch,
            "seed": seed,
            "learningRate": args.learning_rate,
            "augmentationProfile": os.environ["TCGER_GEOMETRY_AUGMENTATION_PROFILE"],
            "runtimeAugmentation": "disabled; variation is baked into the canonical corpus",
            "materialization": "black context pad, JPEG quality 95, then 114 letterbox",
            "pythonVersion": platform.python_version(),
            "torchVersion": torch.__version__,
        },
        "counts": {"trainRecords": len(train_dataset), "validationRecords": len(validation_dataset)},
        "bestValidationLoss": best_loss,
        "artifacts": {
            name: {"path": str(path.relative_to(output)), "sha256": sha256_file(path)}
            for name, path in (
                ("best", training_dir / "best.pt"),
                ("last", training_dir / "last.pt"),
                ("history", training_dir / "history.json"),
            )
        },
    }
    (output / "trainer-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-repo", default="timm/fastvit_t8.apple_in1k")
    parser.add_argument("--base-revision", required=True)
    parser.add_argument("--base-filename", default="model.safetensors")
    parser.add_argument("--base-sha256", required=True)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=0.0003)
    args = parser.parse_args()
    print(json.dumps(train(args), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
