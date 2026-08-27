#!/usr/bin/env python3
"""Re-run card recognition on an arbitrary crop, Mac-side.

Runs the SAME artifacts the iOS app ships — CardEmbeddings-arcface.mlpackage
via coremltools and CardsIndexVectors-arcface.bin — so candidates here match
what the phone would produce for the same pixels. Used by the labeling panel
to answer "with the fixed boundary, what would the scanner have said?"
without touching any recorded device data.

Preprocessing mirrors CardEmbeddingEncoder.swift / export_arcface_onnx.py:
contract_resize (shortest edge >= 256, bicubic ceil, center-crop 224); the
mlpackage's ImageType handles /255 + ImageNet mean/std internally.

CLI:  rerun_candidates.py <crop.jpg> [-k 5]
"""

import argparse
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SCAN_INDEX = REPO / "ios/TCGer/TCGer/Resources/ScanIndex"
MLPACKAGE = SCAN_INDEX / "CardEmbeddings-arcface.mlpackage"
INDEX_BIN = SCAN_INDEX / "CardsIndexVectors-arcface.bin"
METADATA = SCAN_INDEX / "CardsIndexMetadata.json"
IMG_SIZE = 224

_MODEL = None
_INDEX = None  # (vectors int8 [N,384], norms [N], cards ordered by annIndex)


def _model():
    global _MODEL
    if _MODEL is None:
        import coremltools as ct

        _MODEL = ct.models.MLModel(str(MLPACKAGE), compute_units=ct.ComputeUnit.CPU_ONLY)
    return _MODEL


def _index():
    global _INDEX
    if _INDEX is None:
        with open(INDEX_BIN, "rb") as f:
            count, dim = struct.unpack("<ii", f.read(8))
            vecs = np.frombuffer(f.read(), dtype=np.int8).reshape(count, dim)
        norms = np.linalg.norm(vecs.astype(np.float32), axis=1)
        norms = np.where(norms == 0, 1.0, norms)
        cards = [None] * count
        for c in json.load(open(METADATA)):
            if 0 <= c["annIndex"] < count:
                cards[c["annIndex"]] = c
        _INDEX = (vecs.astype(np.float32), norms, cards)
    return _INDEX


def contract_resize(img):
    w, h = img.size
    s = max(256 / min(w, h), IMG_SIZE / w, IMG_SIZE / h)
    rw, rh = math.ceil(w * s), math.ceil(h * s)
    img = img.resize((rw, rh), Image.BICUBIC)
    left, top = (rw - IMG_SIZE) // 2, (rh - IMG_SIZE) // 2
    return img.crop((left, top, left + IMG_SIZE, top + IMG_SIZE))


def embed(image):
    """L2-normalized 384-dim embedding of a PIL image (any size)."""
    out = _model().predict({"image": contract_resize(image.convert("RGB"))})
    vec = np.asarray(out["embedding"], np.float32).reshape(-1)
    return vec / max(np.linalg.norm(vec), 1e-8)


def top_k(image, k=5):
    """Top-k index candidates for a PIL image crop.

    Returns [{cardID, name, similarity}], same shape as the recorded
    evidence's topCandidates."""
    vecs, norms, cards = _index()
    q = embed(image)
    sims = (vecs @ q) / norms
    order = np.argsort(-sims)[:k]
    return [
        {
            "cardID": cards[i]["cardId"] if cards[i] else f"annIndex:{i}",
            "name": (cards[i] or {}).get("name"),
            "similarity": float(sims[i]),
        }
        for i in order
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("crop")
    ap.add_argument("-k", type=int, default=5)
    args = ap.parse_args()
    results = top_k(Image.open(args.crop), args.k)
    print(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
