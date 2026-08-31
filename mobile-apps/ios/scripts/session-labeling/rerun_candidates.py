#!/usr/bin/env python3
"""Re-run card recognition on an arbitrary crop, Mac-side.

Runs the SAME game-specific artifacts the iOS app installs — each game's
CardEmbeddings-arcface.mlpackage via coremltools plus its matching
CardsIndexVectors-arcface.bin — so candidates here match what the phone would
produce for the same pixels. Used by the labeling panel to answer "with the
fixed boundary, what would the scanner have said?" without touching any
recorded device data.

Preprocessing mirrors CardEmbeddingEncoder.swift / export_arcface_onnx.py:
contract_resize (shortest edge >= 256, bicubic ceil, center-crop 224); the
mlpackage's ImageType handles /255 + ImageNet mean/std internally.

CLI:  rerun_candidates.py <crop.jpg> [-k 5] [--game pokemon|magic]
"""

import argparse
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[3]
PROJECT_ROOT = REPO.parent
SCAN_INDEX = REPO / "ios/TCGer/TCGer/Resources/ScanIndex"
MAGIC_RELEASE = (
    PROJECT_ROOT
    / ".artifacts/scanner-release/magic-visual-style-v2-5c27e506-r2"
)
MAGIC_EXPORT = (
    MAGIC_RELEASE / "exports/magic/full/visual-style-v2-5c27e506-r2"
)
GAME_ARTIFACTS = {
    "pokemon": {
        "model": SCAN_INDEX / "CardEmbeddings-arcface.mlpackage",
        "index": SCAN_INDEX / "CardsIndexVectors-arcface.bin",
        "metadata": SCAN_INDEX / "CardsIndexMetadata.json",
    },
    "magic": {
        "model": MAGIC_RELEASE / "runtime/CardEmbeddings-arcface.mlpackage",
        "index": MAGIC_EXPORT / "CardsIndexVectors-arcface.bin",
        "metadata": MAGIC_EXPORT / "CardsIndexMetadata.json",
    },
}
IMG_SIZE = 224

_MODELS = {}
_INDEXES = {}  # game -> (vectors int8 [N,384], norms [N], cards by annIndex)


def normalized_game(game):
    value = str(game or "pokemon").strip().lower()
    return {"mtg": "magic", "pokémon": "pokemon"}.get(value, value)


def _artifacts(game):
    game = normalized_game(game)
    if game not in GAME_ARTIFACTS:
        raise ValueError(f"re-run is not configured for game '{game}'")
    artifacts = GAME_ARTIFACTS[game]
    missing = [str(path) for path in artifacts.values() if not path.exists()]
    if missing:
        raise FileNotFoundError(
            f"{game} re-run artifacts are missing: {', '.join(missing)}"
        )
    return game, artifacts


def _model(game="pokemon"):
    game, artifacts = _artifacts(game)
    if game not in _MODELS:
        import coremltools as ct

        _MODELS[game] = ct.models.MLModel(
            str(artifacts["model"]), compute_units=ct.ComputeUnit.CPU_ONLY
        )
    return _MODELS[game]


def _index(game="pokemon"):
    game, artifacts = _artifacts(game)
    if game not in _INDEXES:
        with open(artifacts["index"], "rb") as f:
            count, dim = struct.unpack("<ii", f.read(8))
            vecs = np.frombuffer(f.read(), dtype=np.int8).reshape(count, dim)
        norms = np.linalg.norm(vecs.astype(np.float32), axis=1)
        norms = np.where(norms == 0, 1.0, norms)
        cards = [None] * count
        with open(artifacts["metadata"], encoding="utf-8") as source:
            metadata = json.load(source)
        for c in metadata:
            if 0 <= c["annIndex"] < count:
                cards[c["annIndex"]] = c
        _INDEXES[game] = (vecs.astype(np.float32), norms, cards)
    return _INDEXES[game]


def contract_resize(img):
    w, h = img.size
    s = max(256 / min(w, h), IMG_SIZE / w, IMG_SIZE / h)
    rw, rh = math.ceil(w * s), math.ceil(h * s)
    img = img.resize((rw, rh), Image.BICUBIC)
    left, top = (rw - IMG_SIZE) // 2, (rh - IMG_SIZE) // 2
    return img.crop((left, top, left + IMG_SIZE, top + IMG_SIZE))


def embed(image, game="pokemon"):
    """L2-normalized 384-dim embedding of a PIL image (any size)."""
    out = _model(game).predict({"image": contract_resize(image.convert("RGB"))})
    vec = np.asarray(out["embedding"], np.float32).reshape(-1)
    return vec / max(np.linalg.norm(vec), 1e-8)


def top_k(image, k=5, game="pokemon"):
    """Top-k index candidates for a PIL image crop.

    Returns [{cardID, name, similarity}], same shape as the recorded
    evidence's topCandidates."""
    vecs, norms, cards = _index(game)
    q = embed(image, game)
    sims = (vecs @ q) / norms
    order = np.argsort(-sims)[:k]
    return [
        {
            "cardID": cards[i]["cardId"] if cards[i] else f"annIndex:{i}",
            "name": (cards[i] or {}).get("name"),
            "setName": (cards[i] or {}).get("setName"),
            "collectorNumber": (cards[i] or {}).get("collectorNumber"),
            "similarity": float(sims[i]),
        }
        for i in order
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("crop")
    ap.add_argument("-k", type=int, default=5)
    ap.add_argument("--game", default="pokemon", choices=sorted(GAME_ARTIFACTS))
    args = ap.parse_args()
    results = top_k(Image.open(args.crop), args.k, game=args.game)
    print(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
