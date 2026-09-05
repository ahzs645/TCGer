#!/usr/bin/env python3
"""Emit review candidates for near-duplicate images across release boundaries.

Perceptual similarity is a review signal, not proof of shared source identity.
Exact SHA-256 and canonical archive gates remain independent and mandatory.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from corpus_release import corpus_hash, canonical_json, sha256_bytes
from train_yolo_pose import load_json, sha256_file

POPCOUNT = np.array([i.bit_count() for i in range(256)], dtype=np.uint8)


def perceptual_hashes(path: Path) -> np.ndarray:
    with Image.open(path) as source:
        image = (
            ImageOps.exif_transpose(source)
            .convert("L")
            .resize((32, 32), Image.Resampling.LANCZOS)
        )
    pixels = np.asarray(image, dtype=np.float32)
    values = []
    for reflected in (pixels, np.fliplr(pixels)):
        for rotation in range(4):
            dct = cv2.dct(np.ascontiguousarray(np.rot90(reflected, rotation)))[
                :8, :8
            ].ravel()
            bits = dct > np.median(dct[1:])
            bits[0] = False
            values.append(np.packbits(bits))
    return np.stack(values)


def inventory(root: Path) -> tuple[dict, list[dict], np.ndarray]:
    manifest = load_json(root / "manifest.json")
    if corpus_hash(manifest) != manifest["corpusHash"]:
        raise ValueError(f"corpus hash mismatch: {root}")
    rows, hashes = [], []
    for entry in manifest["records"]:
        archive = entry["leakageKeys"]["sourceArchiveId"]
        aliases = manifest["sourceArchiveAliases"]
        if archive not in aliases:
            raise ValueError(f"unmapped archive: {archive}")
        for image in entry["images"]:
            path = (root / image["path"]).resolve()
            if (
                not path.is_relative_to(root.resolve())
                or sha256_file(path) != image["sha256"]
            ):
                raise ValueError(f"image bytes disagree: {entry['recordId']}")
            rows.append(
                {
                    "releaseId": manifest["releaseId"],
                    "corpusHash": manifest["corpusHash"],
                    "recordId": entry["recordId"],
                    "split": entry["split"],
                    "canonicalArchiveId": aliases[archive],
                    "imageSha256": image["sha256"],
                    "imagePath": image["path"],
                }
            )
            hashes.append(perceptual_hashes(path))
    return (
        manifest,
        rows,
        np.stack(hashes) if hashes else np.empty((0, 8, 8), dtype=np.uint8),
    )


def audit(
    training: Path, evaluations: list[Path], output: Path, maximum_distance: int = 4
) -> dict:
    if not 0 <= maximum_distance <= 63:
        raise ValueError("maximum distance must be between 0 and 63")
    output.mkdir(parents=True, exist_ok=False)
    roots = [training, *evaluations]
    data = [inventory(root) for root in roots]
    counts = Counter()
    with (output / "review-pairs.jsonl").open("w") as handle:
        for target_index, (_, targets, target_hashes) in enumerate(data):
            for source_index, source in enumerate(data[0][1]):
                # Rotation/reflection invariance: compare the canonical source
                # hash with every transformed target hash.
                distances = (
                    POPCOUNT[np.bitwise_xor(target_hashes, data[0][2][source_index, 0])]
                    .sum(axis=2)
                    .min(axis=1)
                )
                for index in np.flatnonzero(distances <= maximum_distance):
                    target = targets[index]
                    if target_index == 0 and (
                        index <= source_index or target["split"] == source["split"]
                    ):
                        continue
                    row = {
                        "left": source,
                        "right": target,
                        "hammingDistance": int(distances[index]),
                        "exactBytes": source["imageSha256"] == target["imageSha256"],
                        "reviewStatus": "pending",
                    }
                    handle.write(json.dumps(row, sort_keys=True) + "\n")
                    counts[
                        "withinTrainingCrossSplit"
                        if target_index == 0
                        else "trainingVsEvaluation"
                    ] += 1
    report = {
        "schema": "https://tcger.app/reports/card-geometry-near-duplicate-audit/v1",
        "diagnosticOnly": True,
        "algorithm": "32x32 grayscale Lanczos, OpenCV DCT, median AC 8x8, DC cleared; 8 rotations/reflections",
        "maximumHammingDistance": maximum_distance,
        "counts": dict(counts),
        "releases": [
            {
                "releaseId": m["releaseId"],
                "corpusHash": m["corpusHash"],
                "images": len(rows),
            }
            for m, rows, _ in data
        ],
        "reviewPairsSha256": sha256_file(output / "review-pairs.jsonl"),
        "inputInventoryHash": sha256_bytes(
            canonical_json([rows for _, rows, _ in data])
        ),
    }
    (output / "audit.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n"
    )
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--training", type=Path, required=True)
    parser.add_argument("--evaluation", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--maximum-distance", type=int, default=4)
    args = parser.parse_args()
    print(
        json.dumps(
            audit(args.training, args.evaluation, args.output, args.maximum_distance),
            sort_keys=True,
        )
    )
