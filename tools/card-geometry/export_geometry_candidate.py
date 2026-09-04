#!/usr/bin/env python3
"""Export a private geometry candidate without bundled NMS."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any

from train_yolo_pose import sha256_file


def tree_sha256(path: Path) -> str:
    if path.is_file():
        return sha256_file(path)
    digest = hashlib.sha256()
    for child in sorted(item for item in path.rglob("*") if item.is_file()):
        digest.update(child.relative_to(path).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(child.read_bytes())
    return digest.hexdigest()


def artifact(path: Path, output: Path) -> dict[str, Any]:
    size = sum(child.stat().st_size for child in path.rglob("*") if child.is_file()) if path.is_dir() else path.stat().st_size
    return {
        "path": str(path.relative_to(output)),
        "sha256": tree_sha256(path),
        "bytes": size,
    }


def find_one(root: Path, patterns: tuple[str, ...]) -> Path:
    matches = []
    for pattern in patterns:
        matches.extend(root.glob(pattern))
    unique = sorted(set(matches))
    if not unique:
        raise RuntimeError(f"no checkpoint matches {patterns} under {root}")
    preferred = [path for path in unique if path.name.startswith("best")]
    return preferred[0] if preferred else unique[-1]


def export_yolo(checkpoint: Path, format_name: str, output: Path, resolution: int) -> Path:
    from ultralytics import YOLO

    model = YOLO(str(checkpoint))
    result = Path(
        model.export(
            format=format_name,
            imgsz=resolution,
            nms=False,
            dynamic=False,
            simplify=False,
            opset=17 if format_name == "onnx" else None,
            batch=1,
        )
    )
    suffix = ".onnx" if format_name == "onnx" else ".mlpackage"
    destination = output / f"card-geometry{suffix}"
    if result.is_dir():
        shutil.copytree(result, destination)
    else:
        shutil.copy2(result, destination)
    return destination


def load_fastvit(checkpoint: Path):
    import torch

    from train_fastvit_four_corner import build_model

    model = build_model(None)
    state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict(state["model"])
    model.eval()
    return model


def load_yolox(checkpoint_root: Path, checkpoint: Path):
    from mmdet.apis import init_detector

    config = find_one(
        checkpoint_root,
        ("training-output/yolox-pose-card.py", "**/yolox-pose-card.py"),
    )
    return init_detector(str(config), str(checkpoint), device="cpu").eval()


def tensor_model(candidate: str, checkpoint_root: Path, checkpoint: Path):
    if candidate == "fastvit-t8-four-corner":
        return load_fastvit(checkpoint)
    if candidate == "yolox-pose":
        import torch.nn as nn

        detector = load_yolox(checkpoint_root, checkpoint)

        class TensorForward(nn.Module):
            def __init__(self, model) -> None:
                super().__init__()
                self.model = model

            def forward(self, images):
                return self.model(images, None, mode="tensor")

        return TensorForward(detector).eval()
    raise ValueError(f"no tensor exporter for {candidate}")


def export_tensor_model(
    candidate: str,
    checkpoint_root: Path,
    checkpoint: Path,
    format_name: str,
    output: Path,
    resolution: int,
) -> Path:
    import torch

    model = tensor_model(candidate, checkpoint_root, checkpoint)
    example = torch.zeros(1, 3, resolution, resolution)
    if format_name == "onnx":
        destination = output / "card-geometry.onnx"
        torch.onnx.export(
            model,
            example,
            destination,
            input_names=["images"],
            opset_version=17,
            do_constant_folding=True,
        )
        return destination
    import coremltools as ct

    traced = torch.jit.trace(model, example, strict=False)
    converted = ct.convert(
        traced,
        inputs=[ct.TensorType(name="images", shape=example.shape)],
        convert_to="mlprogram",
        minimum_deployment_target=ct.target.iOS17,
    )
    destination = output / "card-geometry.mlpackage"
    converted.save(destination)
    return destination


def run(candidate: str, format_name: str) -> dict[str, Any]:
    checkpoint_root = Path(os.environ["TCGER_GEOMETRY_CHECKPOINT_ROOT"])
    output = Path(os.environ["TCGER_GEOMETRY_OUTPUT_DIR"])
    output.mkdir(parents=True, exist_ok=True)
    if candidate.startswith("yolo11"):
        checkpoint = find_one(
            checkpoint_root,
            ("training-output/training/repeat-0/weights/best.pt", "**/weights/best.pt"),
        )
        exported = export_yolo(
            checkpoint,
            format_name,
            output,
            int(os.environ["TCGER_GEOMETRY_INPUT_RESOLUTION"]),
        )
    else:
        suffix = "*.pth" if candidate == "yolox-pose" else "best.pt"
        checkpoint = find_one(checkpoint_root, (f"training-output/**/{suffix}", f"**/{suffix}"))
        exported = export_tensor_model(
            candidate,
            checkpoint_root,
            checkpoint,
            format_name,
            output,
            int(os.environ["TCGER_GEOMETRY_INPUT_RESOLUTION"]),
        )
    report = {
        "schema": "https://tcger.app/reports/card-geometry-private-export/v1",
        "candidate": candidate,
        "format": format_name,
        "bundledNms": False,
        "checkpointSha256": sha256_file(checkpoint),
        "artifact": artifact(exported, output),
    }
    (output / "export-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--candidate",
        required=True,
        choices=("yolo11n-pose", "yolo11s-pose", "yolox-pose", "fastvit-t8-four-corner"),
    )
    parser.add_argument("--format", required=True, choices=("onnx", "coreml"))
    args = parser.parse_args()
    expected = os.environ.get("TCGER_GEOMETRY_CANDIDATE")
    if expected and expected != args.candidate:
        raise SystemExit(f"candidate mismatch: config={expected}, argument={args.candidate}")
    print(json.dumps(run(args.candidate, args.format), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
