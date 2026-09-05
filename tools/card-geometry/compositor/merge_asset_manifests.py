#!/usr/bin/env python3
"""Merge same-role compositor asset manifests without weakening split leakage."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

PARENT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PARENT))

from corpus_release import pretty_json, sha256_file  # noqa: E402

from compositor.compositor import ASSET_MANIFEST_SCHEMA, CompositorError, load_assets  # noqa: E402


def load_manifest(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schema") != ASSET_MANIFEST_SCHEMA:
        raise CompositorError(f"unsupported asset manifest: {path}")
    return value


def merge_manifests(inputs: list[Path], output: Path) -> dict[str, Any]:
    if not inputs:
        raise CompositorError("at least one input manifest is required")
    if output.exists() and any(output.iterdir()):
        raise CompositorError(f"refusing to replace non-empty output: {output}")
    loaded = [(path, load_manifest(path)) for path in inputs]
    roles = {document.get("role") for _, document in loaded}
    if len(roles) != 1:
        raise CompositorError(f"input roles disagree: {sorted(str(role) for role in roles)}")
    exclusions = None
    if roles == {"background"}:
        for path, document in loaded:
            load_assets(path, "background")
            if "sessionExclusions" in document:
                if exclusions is not None and exclusions != document["sessionExclusions"]:
                    raise CompositorError("background session exclusion inventories disagree")
                exclusions = document["sessionExclusions"]
    output.mkdir(parents=True, exist_ok=True)
    assets_dir = output / "assets"
    assets_dir.mkdir()
    assets: list[dict[str, Any]] = []
    ids: set[str] = set()
    byte_splits: dict[str, set[str]] = defaultdict(set)
    for manifest_path, document in loaded:
        for source_row in document["assets"]:
            row = dict(source_row)
            asset_id = row["assetId"]
            if asset_id in ids:
                raise CompositorError(f"duplicate asset id: {asset_id}")
            ids.add(asset_id)
            source = manifest_path.parent / row["path"]
            if not source.is_file() or sha256_file(source) != row["sha256"]:
                raise CompositorError(f"asset bytes do not match manifest: {source}")
            byte_splits[row["sha256"]].add(row["split"])
            destination = assets_dir / source.name
            if destination.exists():
                raise CompositorError(f"duplicate asset filename: {destination.name}")
            shutil.copyfile(source, destination)
            row["path"] = destination.relative_to(output).as_posix()
            assets.append(row)
    crossing = sorted(digest for digest, splits in byte_splits.items() if len(splits) > 1)
    if crossing:
        raise CompositorError(f"identical asset bytes cross splits: {crossing[:5]}")
    document = {
        "schema": ASSET_MANIFEST_SCHEMA,
        "role": roles.pop(),
        "assets": sorted(assets, key=lambda row: row["assetId"]),
    }
    if exclusions is not None:
        document["sessionExclusions"] = exclusions
        document["reviewEvidenceInputs"] = [
            {"manifestSha256": sha256_file(path), "evidence": value.get("reviewEvidence")}
            for path, value in loaded
        ]
    (output / "assets.json").write_text(pretty_json(document), encoding="utf-8")
    return document


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        document = merge_manifests(args.input, args.output)
    except (CompositorError, OSError, ValueError) as error:
        print(f"asset merge failed: {error}", file=sys.stderr)
        return 2
    print(
        pretty_json(
            {
                "assets": len(document["assets"]),
                "output": str(args.output / "assets.json"),
                "role": document["role"],
            }
        ),
        end="",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
