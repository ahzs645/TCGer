# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "huggingface-hub>=1.0",
#   "numpy>=1.26,<3",
#   "onnx>=1.17",
#   "onnxruntime>=1.20",
#   "timm>=1.0",
#   "torch>=2.5",
# ]
# ///
"""Export a trained TCGer ArcFace checkpoint for Android ONNX Runtime.

The graph accepts RGB float32 NCHW pixels in ``[0, 1]`` under the input name
``pixel_values``. ImageNet normalization is baked into the graph, and the
``embedding`` output is already L2-normalized. The script validates the ONNX
model with deterministic PyTorch/ONNX Runtime parity probes before uploading
it beside the source checkpoint.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


IMNET_MEAN = [0.485, 0.456, 0.406]
IMNET_STD = [0.229, 0.224, 0.225]
IMAGE_SIZE = 224
DEFAULT_DIMENSION = 384


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hub-repo", default="ahzs645/tcger-universal-arcface")
    parser.add_argument(
        "--checkpoint",
        default="exports/yugioh/full/arcface-checkpoint.pt",
    )
    parser.add_argument("--output-prefix", default="exports/yugioh/full")
    parser.add_argument(
        "--game",
        default="yugioh",
        help="Canonical game key used in the Hub commit messages.",
    )
    parser.add_argument("--output", type=Path, default=Path("/tmp/tcger-android-onnx"))
    parser.add_argument("--opset", type=int, default=18)
    parser.add_argument("--no-upload", action="store_true")
    args = parser.parse_args()
    game = args.game.strip().casefold()
    if game not in {"pokemon", "magic", "yugioh"}:
        raise SystemExit("--game must be pokemon, magic, or yugioh")

    import numpy as np
    import onnx
    import onnxruntime as ort
    import timm
    import torch
    import torch.nn as nn
    import torch.nn.functional as functional
    from huggingface_hub import HfApi, hf_hub_download

    args.output.mkdir(parents=True, exist_ok=True)
    checkpoint_path = Path(hf_hub_download(
        repo_id=args.hub_repo,
        repo_type="model",
        filename=args.checkpoint,
    ))
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    config = checkpoint.get("config") or {}
    backbone_name = config.get("backbone", "fastvit_t8.apple_in1k")
    dimension = int(config.get("dim", DEFAULT_DIMENSION))

    class Encoder(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.backbone = timm.create_model(backbone_name, pretrained=False, num_classes=0)
            self.proj = nn.Linear(self.backbone.num_features, dimension)

        def forward(self, inputs):
            return functional.normalize(self.proj(self.backbone(inputs)), dim=-1)

    class AndroidDeploy(nn.Module):
        def __init__(self, encoder: nn.Module) -> None:
            super().__init__()
            self.encoder = encoder
            self.register_buffer("mean", torch.tensor(IMNET_MEAN).view(1, 3, 1, 1))
            self.register_buffer("std", torch.tensor(IMNET_STD).view(1, 3, 1, 1))

        def forward(self, pixel_values):
            return self.encoder((pixel_values - self.mean) / self.std)

    model = Encoder()
    model.load_state_dict(checkpoint["model"], strict=True)
    deploy = AndroidDeploy(model.float()).eval()
    onnx_path = args.output / "card-embeddings-arcface-fp32.onnx"

    generator = torch.Generator().manual_seed(22)
    example = torch.rand(1, 3, IMAGE_SIZE, IMAGE_SIZE, generator=generator)
    with torch.no_grad():
        torch.onnx.export(
            deploy,
            example,
            onnx_path,
            input_names=["pixel_values"],
            output_names=["embedding"],
            opset_version=args.opset,
            do_constant_folding=True,
            dynamic_axes=None,
            dynamo=False,
        )

    onnx_model = onnx.load(str(onnx_path))
    onnx.checker.check_model(onnx_model)
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    probes = {
        "seed22Random": example.numpy(),
        "allHalf": np.full((1, 3, IMAGE_SIZE, IMAGE_SIZE), 0.5, dtype=np.float32),
    }
    parity = {}
    for name, inputs in probes.items():
        with torch.no_grad():
            expected = deploy(torch.from_numpy(inputs)).numpy()
        actual = session.run(["embedding"], {"pixel_values": inputs})[0]
        max_abs = float(np.max(np.abs(expected - actual)))
        cosine = float(np.sum(expected * actual) / (
            np.linalg.norm(expected) * np.linalg.norm(actual)
        ))
        if max_abs > 1e-4 or cosine < 0.99999:
            raise RuntimeError(
                f"ONNX parity failed for {name}: max_abs={max_abs}, cosine={cosine}"
            )
        parity[name] = {
            "maxAbsDifference": max_abs,
            "cosineSimilarity": cosine,
            "first12": [float(value) for value in actual[0, :12]],
        }

    report = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "hubRepo": args.hub_repo,
            "checkpoint": args.checkpoint,
            "sha256": sha256(checkpoint_path),
            "epoch": checkpoint.get("epoch"),
            "catalogFingerprint": checkpoint.get("catalogFingerprint"),
        },
        "onnx": {
            "filename": onnx_path.name,
            "sha256": sha256(onnx_path),
            "bytes": onnx_path.stat().st_size,
            "opset": args.opset,
            "input": {
                "name": "pixel_values",
                "dtype": "float32",
                "shape": [1, 3, IMAGE_SIZE, IMAGE_SIZE],
                "range": "[0,1] RGB; ImageNet normalization baked into graph",
            },
            "output": {
                "name": "embedding",
                "dtype": "float32",
                "shape": [1, dimension],
                "normalization": "L2",
            },
        },
        "model": {"backbone": backbone_name, "dimension": dimension},
        "parity": parity,
        "providers": session.get_providers(),
    }
    report_path = args.output / "android-onnx-eval.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if not args.no_upload:
        api = HfApi()
        api.upload_file(
            path_or_fileobj=str(onnx_path),
            path_in_repo=f"{args.output_prefix}/{onnx_path.name}",
            repo_id=args.hub_repo,
            repo_type="model",
            commit_message=f"Export {game} Android/web ArcFace ONNX",
        )
        api.upload_file(
            path_or_fileobj=str(report_path),
            path_in_repo=f"{args.output_prefix}/{report_path.name}",
            repo_id=args.hub_repo,
            repo_type="model",
            commit_message=f"Add {game} Android/web ONNX parity report",
        )

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
