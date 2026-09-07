#!/usr/bin/env python3
"""List real archive train targets that still lack corner supervision for human labeling.

The multi-card archives (binder-like grids, scattered tabletop layouts) carry
only boxes, so no fit adapter can recover their corners. This tool enumerates
those targets from a category-aware release so a person can label them in
priority order, and emits a queue with everything the archive corner-label
sidecar (`card-geometry-archive-corner-labels` v1) needs to bind a label back:
canonical record id, image hash, annotation index and the seed box. It writes
no labels and never touches evaluation or Dev Mode records.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from corpus_release import load_json, sha256_file

SCHEMA = "https://tcger.app/manifests/card-geometry-archive-corner-label-queue/v1"
DEFAULT_SLICES = ("multi_card_grid_archive", "multi_card_scatter_archive", "multi_card_other_archive")


def build_queue(release: Path, *, splits: tuple[str, ...], slices: tuple[str, ...],
                canonical_corpus_sha256: str | None = None) -> dict[str, Any]:
    manifest = load_json(release / "manifest.json")
    if "targetSemantics" not in manifest:
        raise ValueError("queue requires a category-aware release with targetSemantics")
    summary_path = release / "build-summary.json"
    if canonical_corpus_sha256 is None and summary_path.exists():
        canonical_corpus_sha256 = load_json(summary_path).get("canonicalCorpusSha256")
    frames = []
    counts: Counter = Counter()
    for entry in sorted(manifest["records"], key=lambda item: item["recordId"]):
        if entry["split"] not in splits or entry["sceneSlice"] not in slices:
            continue
        keys = entry["leakageKeys"]
        if keys["sourceKind"] != "real" or keys.get("sessionId"):
            continue
        record = load_json(release / entry["path"])
        pending = [
            instance for instance in record["instances"]
            if not all(corner.get("coordinateKnown") for corner in instance["corners"])
        ]
        if not pending:
            continue
        frames.append({
            "recordId": entry["recordId"],
            "canonicalRecordId": entry["recordId"].removeprefix("coco-"),
            "split": entry["split"],
            "sceneSlice": entry["sceneSlice"],
            "sourceArchiveId": keys["sourceArchiveId"],
            "imagePath": record["source"]["path"],
            "imageSha256": record["source"]["sha256"],
            "width": record["source"]["width"],
            "height": record["source"]["height"],
            "instances": [
                {
                    "instanceId": instance["instanceId"],
                    "sourceAnnotationIndex": instance["sourceAnnotationIndex"],
                    "seedBox": instance["box"],
                    "container": instance.get("container", "unknown"),
                }
                for instance in pending
            ],
        })
        counts[f"records:{entry['split']}/{entry['sceneSlice']}"] += 1
        counts[f"targets:{entry['split']}/{entry['sceneSlice']}"] += len(pending)
        counts[f"targets:{keys['sourceArchiveId']}"] += len(pending)
    return {
        "schema": SCHEMA,
        "releaseId": manifest["releaseId"],
        "corpusHash": manifest["corpusHash"],
        "manifestSha256": sha256_file(release / "manifest.json"),
        "canonicalCorpusSha256": canonical_corpus_sha256,
        "selection": {"splits": list(splits), "sceneSlices": list(slices),
                      "rule": "real archive records without a capture session whose targets lack four known corners"},
        "labelSidecarSchema": "https://tcger.app/schemas/card-geometry-archive-corner-labels/v1",
        "counts": dict(sorted(counts.items())),
        "frames": frames,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--split", action="append", default=None, choices=("train", "validation"))
    parser.add_argument("--scene-slice", action="append", default=None)
    parser.add_argument("--canonical-corpus", type=Path, help="canonical corpus.jsonl; its hash binds the label sidecar")
    args = parser.parse_args()
    queue = build_queue(
        args.release,
        splits=tuple(args.split or ("train",)),
        slices=tuple(args.scene_slice or DEFAULT_SLICES),
        canonical_corpus_sha256=sha256_file(args.canonical_corpus) if args.canonical_corpus else None,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(queue, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(queue["counts"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
