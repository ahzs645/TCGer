#!/usr/bin/env python3
"""Create an immutable split-only smoke release from a compositor release."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from combine_geometry_releases import link_or_copy
from compositor.compositor import _smoke_policy
from corpus_release import (
    MANIFEST_SCHEMA_ID,
    corpus_hash,
    load_json,
    pretty_json,
    sha256_bytes,
)


def slice_release(*, source: Path, output: Path, split: str, release_id: str) -> dict[str, Any]:
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"refusing to replace non-empty output: {output}")
    source_manifest = load_json(source / "manifest.json")
    selected = [entry for entry in source_manifest["records"] if entry["split"] == split]
    if not selected:
        raise ValueError(f"source release has no {split!r} records")
    output.mkdir(parents=True, exist_ok=True)
    scene_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for entry in selected:
        scene_counts[split][entry["sceneSlice"]] += 1
        for relative in [entry["path"], *(image["path"] for image in entry["images"])]:
            destination = output / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            link_or_copy(source / relative, destination)
    policy = _smoke_policy(scene_counts)
    policy_text = pretty_json(policy)
    (output / "policy.json").write_text(policy_text, encoding="utf-8")
    if (source / "compositor-config.resolved.json").is_file():
        link_or_copy(
            source / "compositor-config.resolved.json",
            output / "compositor-config.resolved.json",
        )
    if (source / "provenance").is_dir():
        for item in sorted(path for path in (source / "provenance").rglob("*") if path.is_file()):
            destination = output / item.relative_to(source)
            destination.parent.mkdir(parents=True, exist_ok=True)
            link_or_copy(item, destination)
    if (source / "build-summary.json").is_file():
        destination = output / "provenance/source-build-summary.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        link_or_copy(source / "build-summary.json", destination)
    manifest = {
        "schema": MANIFEST_SCHEMA_ID,
        "releaseId": release_id,
        "releasePurpose": "smoke",
        "readiness": {
            "readinessPolicyPath": "policy.json",
            "readinessPolicyId": policy["policyId"],
            "readinessPolicySha256": sha256_bytes(policy_text.encode("utf-8")),
        },
        "splitAssignment": {
            "method": f"filtered-{split}-source-split-v1",
            "seed": int(source_manifest["splitAssignment"]["seed"]),
        },
        "evaluationSessionDenylist": list(source_manifest["evaluationSessionDenylist"]),
        "sourceArchiveAliases": source_manifest["sourceArchiveAliases"],
        "records": selected,
    }
    manifest["corpusHash"] = corpus_hash(manifest)
    (output / "manifest.json").write_text(pretty_json(manifest), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--split", choices=("train", "validation"), required=True)
    parser.add_argument("--release-id", required=True)
    args = parser.parse_args()
    manifest = slice_release(
        source=args.source, output=args.output, split=args.split, release_id=args.release_id
    )
    print(
        json.dumps(
            {
                "releaseId": manifest["releaseId"],
                "corpusHash": manifest["corpusHash"],
                "records": len(manifest["records"]),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
