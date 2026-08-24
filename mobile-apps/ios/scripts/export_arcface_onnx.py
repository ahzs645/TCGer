#!/usr/bin/env python3
"""Export the ArcFace encoder checkpoint to ONNX for the web scanner.

Sibling of train_arcface_encoder.py's Core ML export: identical Deploy
wrapper (input = RGB float [0,1], 1x3x224x224; ImageNet mean/std baked into
the graph), so the browser side only resizes/crops and divides by 255 —
the same division of labor the Core ML ImageType (scale=1/255) gives iOS.

Validation is end-to-end against the shipped index, not just torch-vs-onnx:
it fetches a few catalog images, applies the trainer's contract_resize, and
checks each embeds to ITS OWN row of CardsIndexVectors-arcface.bin as top-1.
That simultaneously proves (a) the export is faithful and (b) the bin's row
order matches the web artifact's entries order (both are annIndex order).

Usage:
  python export_arcface_onnx.py \
    --checkpoint tmp/arcface-web/arcface-checkpoint-epoch5.pt \
    --index-bin tmp/arcface-web/CardsIndexVectors-arcface.bin \
    --web-artifact frontend/public/scan-index/pokemon-embeddings.json \
    --out tmp/arcface-web/card-embeddings-arcface.onnx
"""
import argparse
import io
import json
import math
import struct
import urllib.request
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import timm
from PIL import Image

IMNET_MEAN = [0.485, 0.456, 0.406]
IMNET_STD = [0.229, 0.224, 0.225]
IMG_SIZE = 224
EMBED_DIM = 384


class Encoder(nn.Module):
    def __init__(self, backbone="fastvit_t8.apple_in1k"):
        super().__init__()
        self.backbone = timm.create_model(backbone, pretrained=False, num_classes=0)
        self.proj = nn.Linear(self.backbone.num_features, EMBED_DIM)

    def forward(self, x):
        return F.normalize(self.proj(self.backbone(x)), dim=-1)


class Deploy(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m
        self.register_buffer("mean", torch.tensor(IMNET_MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(IMNET_STD).view(1, 3, 1, 1))

    def forward(self, x):
        return self.m((x - self.mean) / self.std)


def contract_resize(img):
    # Mirrors CardEmbeddingEncoder.swift / the trainer: shortest edge >= 256
    # (both sides cover 224), bicubic with ceil, center-crop 224.
    w, h = img.size
    s = max(256 / min(w, h), IMG_SIZE / w, IMG_SIZE / h)
    rw, rh = math.ceil(w * s), math.ceil(h * s)
    img = img.resize((rw, rh), Image.BICUBIC)
    left, top = (rw - IMG_SIZE) // 2, (rh - IMG_SIZE) // 2
    return img.crop((left, top, left + IMG_SIZE, top + IMG_SIZE))


def to_input(img):
    x = np.asarray(contract_resize(img), dtype=np.float32) / 255.0
    return np.expand_dims(x.transpose(2, 0, 1), 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--index-bin", required=True)
    ap.add_argument("--web-artifact", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--spot-checks", type=int, default=6)
    args = ap.parse_args()

    ck = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model = Encoder()
    model.load_state_dict(ck["model"])
    deploy = Deploy(model.float()).eval()

    example = torch.rand(1, 3, IMG_SIZE, IMG_SIZE)
    torch.onnx.export(
        deploy, example, args.out,
        input_names=["pixel_values"], output_names=["embedding"],
        opset_version=17, do_constant_folding=True,
    )
    size_mb = Path(args.out).stat().st_size / 1e6
    print(f"exported {args.out} ({size_mb:.1f} MB)")

    import onnxruntime as ort
    sess = ort.InferenceSession(args.out, providers=["CPUExecutionProvider"])

    # 1) Numerical parity torch vs onnx on random inputs.
    with torch.no_grad():
        for _ in range(3):
            x = torch.rand(1, 3, IMG_SIZE, IMG_SIZE)
            t = deploy(x).numpy()[0]
            o = sess.run(None, {"pixel_values": x.numpy()})[0][0]
            cos = float(np.dot(t, o) / (np.linalg.norm(t) * np.linalg.norm(o)))
            assert cos > 0.9999, f"torch/onnx divergence: cos={cos}"
    print("parity: torch vs onnx cos > 0.9999 on random inputs")

    # 2) End-to-end vs the shipped index on real catalog images.
    with open(args.index_bin, "rb") as f:
        count, dim = struct.unpack("<ii", f.read(8))
        vecs = np.frombuffer(f.read(), dtype=np.int8).reshape(count, dim)
    norms = np.linalg.norm(vecs.astype(np.float32), axis=1)
    zero_rows = int((norms == 0).sum())
    print(f"index: {count} x {dim}, {zero_rows} zero rows")

    artifact = json.load(open(args.web_artifact))
    entries = artifact["entries"]
    assert len(entries) == count, f"entry count {len(entries)} != bin rows {count}"

    rng = np.random.default_rng(22)
    picks, ok = [], 0
    while len(picks) < args.spot_checks:
        i = int(rng.integers(0, count))
        if norms[i] > 0 and entries[i].get("imageUrl"):
            picks.append(i)
    safe = np.where(norms == 0, 1.0, norms)
    for i in picks:
        url = entries[i]["imageUrl"]
        if not url.endswith(".webp"):
            url = url.rstrip("/") + "/high.webp"
        req = urllib.request.Request(url, headers={"User-Agent": "TCGer-export"})
        img = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert("RGB")
        emb = sess.run(None, {"pixel_values": to_input(img)})[0][0]
        sims = (vecs.astype(np.float32) @ emb) / safe
        top1 = int(np.argmax(sims))
        mark = "OK " if top1 == i else "MISS"
        print(f"  {mark} row {i} ({entries[i]['externalId']}): top1=row {top1} "
              f"({entries[top1]['externalId']}) sim={sims[top1]:.4f} self={sims[i]:.4f}")
        ok += top1 == i
    print(f"self-retrieval spot check: {ok}/{len(picks)}")
    if ok < len(picks):
        raise SystemExit("spot check failed — do NOT ship this export")


if __name__ == "__main__":
    main()
