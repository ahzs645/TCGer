#!/usr/bin/env python3
"""Recognition replay on trusted label-derived crops, isolating recognition from geometry.

The model replay in `evaluate_geometry_candidate.py` crops each frame with a
candidate's predicted quad, so a wrong identity can come from geometry or from
the encoder/index. This diagnostic crops the same frames with the frozen human
label quad instead and runs the identical crop contract (720x1000 image-edge,
bilinear, black border, no inset), the identical 0/180 degree orientation rule
and the identical acceptance decision against the pinned per-game encoders.

It never changes a label, a threshold or an encoder. Frames whose label
instance lacks four known human corners are reported as `noTrustedLabel` and
excluded from every outcome count. Runs on CPU with ONNX Runtime.
"""

from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from crop_parity import EncoderRuntime, warp_reference
from evaluate_geometry_candidate import (
    _families_by_card,
    _recognition_decision,
    classify_replay_outcome,
)
from train_yolo_pose import load_json, sha256_file

SCHEMA = "https://tcger.app/reports/card-geometry-label-crop-recognition-replay/v1"
GAMES = ("pokemon", "magic", "yugioh")
CROP_CONTRACT = {
    "quadSource": "frozen human label corners (instance 0)",
    "sourceMapping": "imageEdge",
    "kernel": "bilinear",
    "inset": 0,
    "border": "black",
    "destination": [720, 1000],
    "orientation": "0 and 180 degrees; best encoder top score",
}


def trusted_label_quad(record: dict[str, Any]) -> list[list[float]] | None:
    """Label quad usable as recognition truth, or None when not fully human-known."""
    instances = record.get("instances", [])
    if len(instances) != 1:
        return None
    corners = instances[0].get("corners", [])
    if len(corners) != 4:
        return None
    if not all(
        corner.get("coordinateKnown") and corner.get("cornerSource") == "human"
        for corner in corners
    ):
        return None
    return [[corner["point"]["x"], corner["point"]["y"]] for corner in corners]


def load_runtimes(models_root: Path) -> tuple[dict[str, EncoderRuntime], dict[str, dict], dict[str, Any]]:
    runtimes = {}
    families = {}
    pins = {}
    for game in GAMES:
        root = models_root / game
        policy = load_json(root / "policy.json")
        onnx_path = root / "card-embeddings-arcface-fp32.onnx"
        runtimes[game] = EncoderRuntime.load(
            game,
            onnx_path,
            root,
            float(policy["strongThreshold"]),
            str(policy["queryNormalization"]),
        )
        metadata = json.loads((root / "CardsIndexMetadata.json").read_text(encoding="utf-8"))
        families[game] = _families_by_card(metadata)
        pins[game] = {
            "onnxSha256": sha256_file(onnx_path),
            "metadataSha256": sha256_file(root / "CardsIndexMetadata.json"),
            "vectorsSha256": sha256_file(root / "CardsIndexVectors-arcface.bin"),
            "strongThreshold": float(policy["strongThreshold"]),
            "queryNormalization": str(policy["queryNormalization"]),
        }
    return runtimes, families, pins


def replay(*, release: Path, models_root: Path, crops_dir: Path | None = None) -> dict[str, Any]:
    replay_path = release / "recognition-replay.json"
    manifest = load_json(release / "manifest.json")
    cases = load_json(replay_path)
    entries = {entry["recordId"]: entry for entry in manifest["records"]}
    runtimes, families, pins = load_runtimes(models_root)
    rows = []
    for case in cases["records"]:
        record_id = case["recordId"]
        game = case["game"]
        record = load_json(release / entries[record_id]["path"])
        quad = trusted_label_quad(record)
        row: dict[str, Any] = {
            "recordId": record_id,
            "game": game,
            "expectation": case["expectation"],
            "expectedCardId": case.get("expectedCardId"),
            "forbiddenCardId": case.get("forbiddenCardId"),
            "humanVerdict": case.get("humanVerdict"),
            "archivedBestMatchCardId": case.get("archivedBestMatchCardId"),
        }
        if quad is None:
            row.update({"outcome": "noTrustedLabel", "accepted": False, "acceptedFamily": None,
                        "topScore": None, "rivalMargin": None})
            rows.append(row)
            continue
        with Image.open(release / record["source"]["path"]) as opened:
            image = np.asarray(opened.convert("RGB"))
        crop = Image.fromarray(
            warp_reference(image, quad, mapping="imageEdge", kernel="bilinear", inset=0.0, border="black")
        )
        if crops_dir is not None:
            crops_dir.mkdir(parents=True, exist_ok=True)
            crop.save(crops_dir / f"{record_id}.jpg", quality=95)
        family, accepted, top_score, margin = _recognition_decision(
            runtimes[game], [crop, crop.rotate(180)]
        )
        expected = families[game].get(str(case.get("expectedCardId")), set())
        forbidden = families[game].get(str(case.get("forbiddenCardId")), set())
        outcome = classify_replay_outcome(
            case["expectation"],
            accepted=accepted,
            family=family,
            expected_families=expected,
            forbidden_families=forbidden,
        )
        row.update({
            "outcome": outcome,
            "accepted": accepted,
            "acceptedFamily": family,
            "topScore": top_score,
            "rivalMargin": margin,
            "expectedFamilies": sorted(expected),
        })
        rows.append(row)
    counts = collections.Counter(row["outcome"] for row in rows)
    by_expectation = collections.defaultdict(collections.Counter)
    for row in rows:
        by_expectation[row["expectation"]][row["outcome"]] += 1
    return {
        "schema": SCHEMA,
        "diagnosticOnly": True,
        "releaseId": manifest["releaseId"],
        "corpusHash": manifest["corpusHash"],
        "replayManifestSha256": sha256_file(replay_path),
        "recognitionModels": pins,
        "cropContract": CROP_CONTRACT,
        "counts": {
            "frames": len(rows),
            "correct": counts["correct"],
            "wrong": counts["wrong"],
            "abstain": counts["abstain"],
            "correctReject": counts["correctReject"],
            "unknown": counts["unknown"],
            "noTrustedLabel": counts["noTrustedLabel"],
        },
        "countsByExpectation": {key: dict(value) for key, value in sorted(by_expectation.items())},
        "scopeCaveat": (
            "Crops come from frozen human label quads, not from any geometry model. "
            "Only frames with a verified expected identity can be correct or wrong; "
            "unknown-identity frames report the accepted family without judging it."
        ),
        "frames": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--release", type=Path, required=True, help="real evaluation release root")
    parser.add_argument("--models-root", type=Path, required=True,
                        help="directory with <game>/{onnx,metadata,vectors,policy.json}")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--crops-dir", type=Path, help="optional directory for the label crops")
    args = parser.parse_args()
    report = replay(release=args.release, models_root=args.models_root, crops_dir=args.crops_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"counts": report["counts"], "byExpectation": report["countsByExpectation"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
