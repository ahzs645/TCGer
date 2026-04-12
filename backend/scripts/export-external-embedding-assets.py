#!/usr/bin/env python3

import argparse
import json
import re
from pathlib import Path

import torch
import torchvision.models as models


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export Trading-Card-Scanner ResNet18 embedding assets for the TCGer backend."
    )
    parser.add_argument(
        "--repo-root",
        required=True,
        help="Path to the Trading-Card-Scanner-main repository root.",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory where the ONNX model, meta JSON, and float32 index should be written.",
    )
    parser.add_argument(
        "--model-path",
        default=None,
        help="Override the source .pth model path. Defaults to res/detection_weights/resnet18_embeddings.pth under repo root.",
    )
    parser.add_argument(
        "--embeddings-path",
        default=None,
        help="Override the source .pt embeddings path. Defaults to res/classification_embeddings/Resnet18_embeddings.pt under repo root.",
    )
    return parser.parse_args()


def normalize_external_id(source_key: str) -> str:
    normalized = source_key.replace("\\", "/").split("/")[-1]
    normalized = re.sub(r"\.png$", "", normalized, flags=re.IGNORECASE)

    if "-" not in normalized:
        return normalized.lower()

    set_code, collector_number = normalized.split("-", 1)
    set_code = re.sub(r"^([a-z]+)0+(\d)", r"\1\2", set_code, flags=re.IGNORECASE)
    collector_number = re.sub(r"^0+(\d)", r"\1", collector_number)
    return f"{set_code.lower()}-{collector_number.lower()}"


def build_model(model_path: Path) -> torch.nn.Module:
    model = models.resnet18(weights=None)
    model = torch.nn.Sequential(*list(model.children())[:-1])
    state_dict = torch.load(model_path, map_location="cpu")
    model.load_state_dict(state_dict)
    model.eval()
    return model


def export_onnx(model: torch.nn.Module, output_path: Path) -> None:
    sample = torch.randn(1, 3, 224, 224)
    torch.onnx.export(
        model,
        sample,
        output_path,
        input_names=["input"],
        output_names=["embedding"],
        dynamic_axes=None,
        opset_version=17,
        dynamo=False,
    )


def export_index(embeddings_path: Path, output_dir: Path) -> tuple[Path, Path]:
    dataset = torch.load(embeddings_path, map_location="cpu")
    ordered_keys = sorted(dataset.keys())
    vectors = []
    entries = []

    for key in ordered_keys:
        vector = dataset[key].flatten().to(dtype=torch.float32)
        normalized = torch.nn.functional.normalize(vector, dim=0)
        vectors.append(normalized)
        entries.append(
            {
                "externalId": normalize_external_id(key),
                "sourceKey": key,
            }
        )

    stacked = torch.stack(vectors)
    index_path = output_dir / "resnet18-embeddings.f32bin"
    meta_path = output_dir / "resnet18-embeddings.meta.json"

    stacked.numpy().tofile(index_path)
    meta_path.write_text(
        json.dumps(
            {
                "dimension": int(stacked.shape[1]),
                "normalized": True,
                "model": "trading-card-scanner-resnet18",
                "entries": entries,
            },
            indent=2,
        )
    )

    return index_path, meta_path


def main() -> None:
    args = parse_args()
    repo_root = Path(args.repo_root).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    model_path = (
        Path(args.model_path).expanduser().resolve()
        if args.model_path
        else repo_root / "res" / "detection_weights" / "resnet18_embeddings.pth"
    )
    embeddings_path = (
        Path(args.embeddings_path).expanduser().resolve()
        if args.embeddings_path
        else repo_root / "res" / "classification_embeddings" / "Resnet18_embeddings.pt"
    )

    model = build_model(model_path)
    onnx_path = output_dir / "resnet18-embeddings.onnx"
    export_onnx(model, onnx_path)
    index_path, meta_path = export_index(embeddings_path, output_dir)

    print(json.dumps(
        {
            "modelPath": str(onnx_path),
            "indexPath": str(index_path),
            "metaPath": str(meta_path),
        },
        indent=2,
    ))


if __name__ == "__main__":
    main()
