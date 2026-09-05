#!/usr/bin/env python3
"""Compute whole-archive assignments and build an auditable real-data candidate.

This emits smoke-purpose data for review, never a training authorization.
Canonical identities are supplied explicitly; source-family links and exact
image matches join assignment components without asserting a new fork identity.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from pathlib import Path

from build_real_smoke_release import _safe_id, build_release
from corpus_release import (
    canonical_json,
    corpus_hash,
    load_json,
    sha256_bytes,
    write_json,
)


def archive_id(name: str) -> str:
    return _safe_id(f"coco:{Path(name).stem}")


def compute_plan(
    rows: list[dict],
    aliases: dict[str, str],
    evaluations: list[dict],
    seed: int = 20260904,
    reviewed_links: list[dict] | None = None,
) -> dict:
    archives = {archive_id(row["archive"]) for row in rows}
    for key in archives:
        if key not in aliases or aliases.get(aliases[key]) != aliases[key]:
            raise ValueError(f"unmapped or chained archive id: {key}")
    parent = {aliases[key]: aliases[key] for key in archives}

    def find(key):
        while parent[key] != key:
            key = parent[key]
        return key

    def union(left, right):
        a, b = sorted((find(left), find(right)))
        parent[b] = a

    for link in reviewed_links or []:
        if (
            link.get("decision") != "keep-same-split"
            or not link.get("reviewer")
            or not link.get("evidenceSha256")
        ):
            raise ValueError("archive link requires recorded review and evidence hash")
        left, right = link["canonicalArchiveIds"]
        if left not in parent or right not in parent:
            raise ValueError("reviewed link references an unknown canonical archive")
        union(left, right)

    owners = {}
    for row in rows:
        key = aliases[archive_id(row["archive"])]
        for identity in [
            ("imageSha256", row["sha256"]),
            *[("sourceFamily", value) for value in row.get("leakageAliases", [])],
        ]:
            if identity in owners:
                union(key, owners[identity])
            owners[identity] = key
    excluded_archives, excluded_images, excluded_assets = set(), set(), set()
    for manifest in evaluations:
        for key, value in manifest["sourceArchiveAliases"].items():
            if key in aliases and aliases[key] != value:
                raise ValueError(f"conflicting evaluation alias: {key}")
        for entry in manifest["records"]:
            excluded_archives.add(entry["leakageKeys"]["sourceArchiveId"])
            excluded_images.update(image["sha256"] for image in entry["images"])
            excluded_assets.update(entry["leakageKeys"].get("sourceAssetIds", []))
    excluded_components = set()
    reasons = defaultdict(set)
    for row in rows:
        key = aliases[archive_id(row["archive"])]
        component = find(key)
        if key in excluded_archives:
            reasons[component].add("evaluation canonical archive")
        if row["sha256"] in excluded_images:
            reasons[component].add("evaluation image bytes")
        if any(
            "coco-source:" + sha256_bytes(value.encode()) in excluded_assets
            for value in row.get("leakageAliases", [])
        ):
            reasons[component].add("evaluation source family")
        if reasons[component]:
            excluded_components.add(component)
    counts = Counter(find(aliases[archive_id(row["archive"])]) for row in rows)
    eligible = {
        key: count for key, count in counts.items() if key not in excluded_components
    }
    if len(eligible) < 2:
        raise ValueError("need at least two evaluation-disjoint archive components")
    # Largest component first; put the next component in the split with the
    # smallest fraction of its target filled. Hash breaks equal-size ties.
    totals = {"train": 0, "validation": 0}
    weights = {"train": 0.8, "validation": 0.2}
    assigned = {}
    for key in sorted(
        eligible, key=lambda k: (-eligible[k], sha256_bytes(f"{seed}:{k}".encode()))
    ):
        split = min(weights, key=lambda s: (totals[s] / weights[s], -weights[s]))
        assigned[key] = split
        totals[split] += eligible[key]
    archive_splits = {
        name: assigned[find(aliases[archive_id(name)])]
        for name in sorted({r["archive"] for r in rows})
        if find(aliases[archive_id(name)]) in assigned
    }
    inventory = [
        {
            "recordId": r["id"],
            "archive": r["archive"],
            "imageSha256": r["sha256"],
            "sourceFamilies": sorted(r.get("leakageAliases", [])),
        }
        for r in sorted(rows, key=lambda r: r["id"])
    ]
    return {
        "method": "whole-archive-components-largest-first-80-20-v1",
        "seed": seed,
        "inputInventorySha256": sha256_bytes(
            canonical_json(
                {"records": inventory, "reviewedLinks": reviewed_links or []}
            )
        ),
        "reviewedLinks": reviewed_links or [],
        "archiveSplits": {
            key: assigned[find(key)] for key in sorted(parent) if find(key) in assigned
        },
        "sourceArchiveAliases": aliases,
        "archiveFileSplits": archive_splits,
        "targetFractions": weights,
        "inputRecordCounts": totals,
        "excludedComponents": {
            key: sorted(reasons[key]) for key in sorted(excluded_components)
        },
        "componentByCanonicalArchive": {key: find(key) for key in sorted(parent)},
        "evaluationCorpusHashes": [m["corpusHash"] for m in evaluations],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canonical-corpus", type=Path, required=True)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--aliases", type=Path, required=True)
    parser.add_argument("--reviewed-links", type=Path)
    parser.add_argument("--evaluation", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    args = parser.parse_args()
    import json

    rows = [
        json.loads(line)
        for line in args.canonical_corpus.read_text().splitlines()
        if line.strip()
    ]
    manifests = [load_json(root / "manifest.json") for root in args.evaluation]
    for manifest in manifests:
        if corpus_hash(manifest) != manifest["corpusHash"]:
            raise ValueError("evaluation manifest hash mismatch")
    plan = compute_plan(
        rows,
        load_json(args.aliases),
        manifests,
        reviewed_links=load_json(args.reviewed_links) if args.reviewed_links else [],
    )
    build_release(
        canonical_corpus=args.canonical_corpus,
        raw_dir=args.raw_dir,
        archive_splits=plan["archiveFileSplits"],
        devmode_sessions=[],
        output=args.output,
        release_id=args.release_id,
        source_archive_aliases=plan["sourceArchiveAliases"],
    )
    manifest = load_json(args.output / "manifest.json")
    manifest["splitAssignment"] = {
        key: plan[key]
        for key in ("method", "seed", "inputInventorySha256", "archiveSplits")
    }
    manifest["corpusHash"] = corpus_hash(manifest)
    write_json(args.output / "manifest.json", manifest)
    write_json(args.output / "archive-assignment.json", plan)
    summary = load_json(args.output / "build-summary.json")
    summary["corpusHash"] = manifest["corpusHash"]
    write_json(args.output / "build-summary.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
