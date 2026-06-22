#!/usr/bin/env python3
"""
Convert DINOv2-small to a CoreML image encoder for the iOS scanner.

Produces CardEmbeddings.mlpackage with:
  - input  "image"     : 224x224 RGB image (CVPixelBuffer, 0-255)
  - output "embedding" : 384-d L2-normalised CLS token

ImageNet normalisation is baked into the model (a Normalize front layer +
ct.ImageType scale=1/255), so the iOS side hands it a 224x224 RGB crop.

PARITY NOTE: the browser index is built with the HF DINOv2 image processor
(resize shortest-edge 256 → center-crop 224 → ImageNet norm). Keep
CardEmbeddingEncoder.swift aligned with that resize/crop step before inference.

Usage: python3 convert-dinov2-coreml.py [--model facebook/dinov2-small] [--out <dir>]
"""
import argparse
import os
import types

import torch
import torch.nn as nn
import torch.nn.functional as F
import coremltools as ct
from transformers import Dinov2Model

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]


def freeze_position_encoding(model: nn.Module, size: int = 224) -> None:
    """DINOv2 interpolates its position encodings dynamically (int casts that
    coremltools can't trace). The input is FIXED at `size`, so the interpolated
    encoding is constant — precompute it and replace the dynamic method with a
    constant return."""
    emb = model.embeddings
    with torch.no_grad():
        dummy = torch.zeros(1, 3, size, size)
        patch = emb.patch_embeddings(dummy)
        cls = emb.cls_token.expand(patch.shape[0], -1, -1)
        tokens = torch.cat((cls, patch), dim=1)
        const_pos = emb.interpolate_pos_encoding(tokens, size, size).detach()
    emb.register_buffer("_const_pos", const_pos)

    def constant_interpolate(self, embeddings, height, width):  # noqa: ARG001
        return self._const_pos

    emb.interpolate_pos_encoding = types.MethodType(constant_interpolate, emb)


class Encoder(nn.Module):
    def __init__(self, model: nn.Module):
        super().__init__()
        self.model = model
        self.register_buffer("mean", torch.tensor(IMAGENET_MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(IMAGENET_STD).view(1, 3, 1, 1))

    def forward(self, x):  # x in [0,1], shape [1,3,224,224]
        x = (x - self.mean) / self.std
        out = self.model(x).last_hidden_state[:, 0]  # CLS token [1,384]
        return F.normalize(out, dim=-1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="facebook/dinov2-small")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "TCGer", "TCGer", "Resources", "ScanIndex"))
    args = ap.parse_args()

    print(f"[coreml] loading {args.model} ...")
    base = Dinov2Model.from_pretrained(args.model)
    base.eval()
    freeze_position_encoding(base, size=224)
    enc = Encoder(base).eval()

    example = torch.rand(1, 3, 224, 224)
    with torch.no_grad():
        ref = enc(example)
    print(f"[coreml] traced output shape {tuple(ref.shape)} (expect [1, 384])")

    traced = torch.jit.trace(enc, example, strict=False)

    print("[coreml] converting to CoreML (ML Program) ...")
    mlmodel = ct.convert(
        traced,
        inputs=[
            ct.ImageType(
                name="image",
                shape=(1, 3, 224, 224),
                scale=1.0 / 255.0,
                bias=[0.0, 0.0, 0.0],
                color_layout=ct.colorlayout.RGB,
            )
        ],
        outputs=[ct.TensorType(name="embedding")],
        minimum_deployment_target=ct.target.iOS16,
        compute_units=ct.ComputeUnit.ALL,
        convert_to="mlprogram",
    )
    mlmodel.short_description = "DINOv2-small card embedding encoder (384-d, L2-normalised)"

    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, "CardEmbeddings.mlpackage")
    mlmodel.save(out_path)
    print(f"[coreml] saved {out_path}")


if __name__ == "__main__":
    main()
