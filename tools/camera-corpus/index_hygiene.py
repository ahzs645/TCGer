#!/usr/bin/env python3
"""Audit a packed scanner index for attractor rows and emit exclusion/negative specs.

A degenerate query (inverted crop, blank card, blur) lands on rows whose
reference vectors sit in a tight cluster despite being different cards: back
faces, Collectors' Edition / World Championship gold-border reprints, 30th
Anniversary, playtest `unk` rows. This script measures that with the runtime's
own vectors and writes:

  index-hygiene.json      every row with a >THRESHOLD neighbour of a different
                          name, its cluster, and a suggested action
  orientation-negatives.json
                          training-recipe spec: rotate-180 / back-face / gold
                          border negatives the trainer should add per family

Usage:
  python3 tools/camera-corpus/index_hygiene.py --runtime <dir> --out <dir> [--threshold 0.9]
"""
from __future__ import annotations

import argparse
import collections
import json
import struct
from pathlib import Path

import numpy as np

NON_GALLERY_SETS = {
    # Non-tournament reprints whose renders collapse onto retro-frame lands.
    "cei", "ced", "wc97", "wc98", "wc99", "wc00", "wc01", "wc02", "wc03", "wc04",
    "30a", "fbb", "4bb", "ptc", "unk", "itp", "sum",
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--threshold", type=float, default=0.9)
    parser.add_argument("--chunk", type=int, default=2048)
    args = parser.parse_args()

    rows = json.loads((args.runtime / "CardsIndexMetadata.json").read_text())
    raw = (args.runtime / "CardsIndexVectors-arcface.bin").read_bytes()
    count, dim = struct.unpack("<II", raw[:8])
    vectors = np.frombuffer(raw[8:], dtype=np.int8).reshape(count, dim).astype(np.float32)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    names = np.array([r["name"] for r in rows])

    # Exact all-pairs nearest different-name neighbour, chunked.
    flagged: dict[int, tuple[int, float]] = {}
    nn_same = np.zeros(count, dtype=np.float32)
    for start in range(0, count, args.chunk):
        block = vectors[start:start + args.chunk] @ vectors.T
        for local in range(block.shape[0]):
            i = start + local
            scores = block[local]
            scores[i] = -1
            order = np.argsort(-scores)[:12]
            best_other = next((j for j in order if names[j] != names[i]), None)
            nn_same[i] = scores[order[0]]
            if best_other is not None and scores[best_other] >= args.threshold:
                flagged[i] = (int(best_other), float(scores[best_other]))

    # Union-find clusters among flagged rows.
    parent = {i: i for i in flagged}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, (j, _) in flagged.items():
        if j in parent:
            parent[find(i)] = find(j)
    clusters = collections.defaultdict(list)
    for i in flagged:
        clusters[find(i)].append(i)

    def action(row):
        if row.get("faceSide") == "back":
            return "exclude:back-face"
        if (row.get("setCode") or "").lower() in NON_GALLERY_SETS:
            return "exclude:non-gallery-set"
        return "review:attractor-member"

    entries = []
    for i, (j, score) in sorted(flagged.items(), key=lambda kv: -kv[1][1]):
        row = rows[i]
        entries.append({
            "annIndex": i, "cardId": row["cardId"], "name": row["name"], "setCode": row.get("setCode"),
            "collectorNumber": row.get("collectorNumber"), "faceSide": row.get("faceSide"),
            "recognitionFamilyId": row.get("recognitionFamilyId"),
            "nearestDifferentName": {"annIndex": j, "cardId": rows[j]["cardId"], "name": rows[j]["name"], "similarity": score},
            "cluster": find(i), "action": action(row),
        })
    cluster_summary = sorted(
        ({"cluster": root, "size": len(members),
          "sets": collections.Counter((rows[m].get("setCode") or "?") for m in members).most_common(6),
          "backFaces": sum(1 for m in members if rows[m].get("faceSide") == "back")}
         for root, members in clusters.items()),
        key=lambda c: -c["size"],
    )
    summary = {
        "schema": "tcger-index-hygiene-v1",
        "rows": count,
        "threshold": args.threshold,
        "flagged": len(flagged),
        "actions": dict(collections.Counter(e["action"] for e in entries)),
        "mean_nearest_neighbour_cosine": float(nn_same.mean()),
        "clusters": cluster_summary[:25],
        "entries": entries,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "index-hygiene.json").write_text(json.dumps(summary, indent=1))

    negatives = {
        "schema": "tcger-orientation-negatives-v1",
        "description": (
            "Trainer recipe additions. For every training family add (a) its representative "
            "render rotated 180 degrees and (b) any back-face render of the same card as "
            "samples of a shared reject class (not a new identity), so inverted or reversed "
            "crops learn to score low against every family instead of collapsing onto the "
            "attractor rows listed in index-hygiene.json. Gold-border / Collectors' Edition "
            "reprints in `nonGallerySets` are excluded from the gallery and used only as "
            "extra positives for their same-art family."
        ),
        "rejectClass": "__inverted_or_reverse__",
        "rotate180PerFamily": True,
        "backFacesAsReject": True,
        "nonGallerySets": sorted(NON_GALLERY_SETS),
        "excludeAnnIndices": [e["annIndex"] for e in entries if e["action"].startswith("exclude:")],
        "reviewAnnIndices": [e["annIndex"] for e in entries if e["action"].startswith("review:")],
    }
    (args.out / "orientation-negatives.json").write_text(json.dumps(negatives, indent=1))
    print(json.dumps({k: v for k, v in summary.items() if k not in ("entries", "clusters")}, indent=1))
    for cluster in cluster_summary[:6]:
        print(cluster)


if __name__ == "__main__":
    main()
