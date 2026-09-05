#!/usr/bin/env python3
"""Exclude pinned evaluation identities, then split verified card asset bytes."""

from __future__ import annotations

import argparse
import copy
from collections import Counter, defaultdict
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from corpus_release import (
    canonical_json,
    corpus_hash,
    load_json,
    sha256_bytes,
    sha256_file,
    write_json,
)  # noqa: E402
from combine_geometry_releases import link_or_copy  # noqa: E402


def prepare(
    source: Path, evaluations: list[Path], output: Path, seed: int = 20260904
) -> dict:
    if output.exists():
        raise FileExistsError(output)
    document = load_json(source)
    excluded_ids = set()
    pins = []
    for root in evaluations:
        manifest = load_json(root / "manifest.json")
        if corpus_hash(manifest) != manifest["corpusHash"]:
            raise ValueError("evaluation corpus hash mismatch")
        pins.append(
            {"releaseId": manifest["releaseId"], "corpusHash": manifest["corpusHash"]}
        )
        for entry in manifest["records"]:
            excluded_ids.update(entry["leakageKeys"].get("sourceAssetIds", []))
            excluded_ids.update(entry["leakageKeys"].get("physicalCardIds", []))
    excluded_hashes = {
        row["sha256"] for row in document["assets"] if row["assetId"] in excluded_ids
    }
    groups = defaultdict(list)
    excluded = []
    for row in document["assets"]:
        path = (source.parent / row["path"]).resolve()
        if (
            not path.is_relative_to(source.parent.resolve())
            or sha256_file(path) != row["sha256"]
        ):
            raise ValueError(f"asset bytes disagree: {row['assetId']}")
        if row["assetId"] in excluded_ids or row["sha256"] in excluded_hashes:
            excluded.append(row["assetId"])
        else:
            groups[row["sha256"]].append(row)
    by_game = defaultdict(list)
    splits = {}
    for digest, rows in groups.items():
        categories = {(row["game"], row["side"]) for row in rows}
        if len(categories) != 1:
            raise ValueError("identical asset bytes carry conflicting game/side")
        game, side = next(iter(categories))
        if side == "faceDown":
            splits[digest] = "train"
        else:
            by_game[game].append(digest)
    for game, digests in by_game.items():
        if len(digests) < 10:
            raise ValueError(f"insufficient face assets: {game}")
        ordered = sorted(
            digests, key=lambda digest: sha256_bytes(f"{seed}:{game}:{digest}".encode())
        )
        validation_count = max(1, len(ordered) // 10)
        splits.update(
            {
                digest: "validation" if i < validation_count else "train"
                for i, digest in enumerate(ordered)
            }
        )
    output.mkdir(parents=True)
    rows = []
    for digest, originals in sorted(groups.items()):
        for original in originals:
            row = copy.deepcopy(original)
            row["split"] = splits[digest]
            path = output / row["path"]
            path.parent.mkdir(parents=True, exist_ok=True)
            link_or_copy(source.parent / row["path"], path)
            rows.append(row)
    result = {**document, "assets": sorted(rows, key=lambda r: r["assetId"])}
    evidence = {
        "sourceManifestSha256": sha256_file(source),
        "evaluationReleases": pins,
        "assignment": "per-game sha256-ranked 90/10 byte groups; backs train only",
        "seed": seed,
        "excludedAssetIds": sorted(excluded),
        "excludedImageSha256": sorted(excluded_hashes),
        "counts": dict(Counter(f"{r['game']}:{r['side']}:{r['split']}" for r in rows)),
        "assignmentSha256": sha256_bytes(canonical_json(splits)),
    }
    result["assemblyEvidence"] = evidence
    write_json(output / "assets.json", result)
    evidence["outputManifestSha256"] = sha256_file(output / "assets.json")
    write_json(output / "assembly-evidence.json", evidence)
    return evidence


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--evaluation", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source, args.evaluation, args.output)
