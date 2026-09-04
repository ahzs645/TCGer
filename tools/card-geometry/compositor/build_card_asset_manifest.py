#!/usr/bin/env python3
"""Extract split-assigned card renders from a pinned local image-library snapshot."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tarfile
from collections import defaultdict
from pathlib import Path
from typing import Any

PARENT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PARENT))

from corpus_release import pretty_json, sha256_bytes, sha256_file  # noqa: E402

from compositor.compositor import ASSET_MANIFEST_SCHEMA, CompositorError  # noqa: E402


def _rows(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise CompositorError(f"{path}:{line_number}: {error}") from error
            rows.append(row)
    return rows


def build_manifest(
    *,
    library_root: Path,
    library_repo: str,
    library_revision: str,
    game: str,
    train_count: int,
    validation_count: int,
    output: Path,
    card_back: Path | None = None,
) -> dict[str, Any]:
    if output.exists() and any(output.iterdir()):
        raise CompositorError(f"refusing to replace non-empty output: {output}")
    manifest_path = library_root / "manifest.jsonl"
    library_path = library_root / "library.json"
    if not manifest_path.is_file() or not library_path.is_file():
        raise CompositorError("library root needs manifest.jsonl and library.json")
    if len(library_revision) != 40:
        raise CompositorError("library revision must be an immutable 40-hex commit")
    selected = []
    requested = {"train": train_count, "validation": validation_count}
    candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    rows = _rows(manifest_path)
    blob_splits: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        split = row.get("partition")
        digest = row.get("blobSha256")
        if split in requested and isinstance(digest, str):
            blob_splits[digest].add(split)
    seen_blobs: set[str] = set()
    for row in rows:
        split = row.get("partition")
        shard = row.get("shard")
        digest = row.get("blobSha256")
        if (
            row.get("game") == game
            and row.get("status") == "valid"
            and split in requested
            and isinstance(shard, str)
            and isinstance(digest, str)
            and (library_root / shard).is_file()
            and len(blob_splits[digest]) == 1
            and digest not in seen_blobs
        ):
            candidates[split].append(row)
            seen_blobs.add(digest)
    for split, count in requested.items():
        choices = sorted(
            candidates[split],
            key=lambda row: (row["blobSha256"], row["sampleId"]),
        )
        if len(choices) < count:
            raise CompositorError(
                f"need {count} {split} assets but only {len(choices)} exist in local shards"
            )
        selected.extend((split, row) for row in choices[:count])

    output.mkdir(parents=True, exist_ok=True)
    assets_dir = output / "assets"
    assets_dir.mkdir()
    rows_by_shard: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for split, row in selected:
        rows_by_shard[row["shard"]].append((split, row))
    assets = []
    for shard, rows in sorted(rows_by_shard.items()):
        with tarfile.open(library_root / shard, "r") as archive:
            for split, row in sorted(rows, key=lambda item: item[1]["blobSha256"]):
                member = archive.getmember(row["member"])
                extracted = archive.extractfile(member)
                if extracted is None:
                    raise CompositorError(f"missing tar member {row['member']}")
                data = extracted.read()
                if sha256_bytes(data) != row["blobSha256"]:
                    raise CompositorError(f"blob hash mismatch for {row['sampleId']}")
                suffix = "." + str(row.get("extension") or "img").lower()
                asset_id = f"lib-{game}-{row['blobSha256'][:32]}"
                destination = assets_dir / f"{asset_id}{suffix}"
                destination.write_bytes(data)
                assets.append(
                    {
                        "assetId": asset_id,
                        "path": destination.relative_to(output).as_posix(),
                        "sha256": row["blobSha256"],
                        "split": split,
                        "licenseId": "private-training-only",
                        "game": game,
                        "side": "faceUp",
                        "provenance": {
                            "libraryRepo": library_repo,
                            "libraryRevision": library_revision,
                            "libraryManifestSha256": sha256_file(manifest_path),
                            "libraryMember": row["member"],
                            "sampleId": row["sampleId"],
                            "sourceCatalogRevision": row.get("provenance", {}).get("sourceCatalogRevision"),
                            "redistributionStatus": "private-training-only",
                        },
                    }
                )
    if card_back is not None:
        digest = sha256_file(card_back)
        asset_id = f"local-{game}-back-{digest[:24]}"
        destination = assets_dir / f"{asset_id}{card_back.suffix.lower()}"
        shutil.copyfile(card_back, destination)
        assets.append(
            {
                "assetId": asset_id,
                "path": destination.relative_to(output).as_posix(),
                "sha256": digest,
                "split": "train",
                "licenseId": "private-training-only",
                "game": game,
                "side": "faceDown",
                "provenance": {
                    "sourcePath": card_back.as_posix(),
                    "redistributionStatus": "private-training-only",
                },
            }
        )
    document = {
        "schema": ASSET_MANIFEST_SCHEMA,
        "role": "card",
        "assets": sorted(assets, key=lambda row: row["assetId"]),
    }
    (output / "card-assets.json").write_text(pretty_json(document), encoding="utf-8")
    return document


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library-root", type=Path, required=True)
    parser.add_argument("--library-repo", required=True)
    parser.add_argument("--library-revision", required=True)
    parser.add_argument("--game", required=True)
    parser.add_argument("--train-count", type=int, required=True)
    parser.add_argument("--validation-count", type=int, required=True)
    parser.add_argument("--card-back", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        document = build_manifest(
            library_root=args.library_root,
            library_repo=args.library_repo,
            library_revision=args.library_revision,
            game=args.game,
            train_count=args.train_count,
            validation_count=args.validation_count,
            output=args.output,
            card_back=args.card_back,
        )
    except (CompositorError, OSError, tarfile.TarError) as error:
        print(f"asset extraction failed: {error}", file=sys.stderr)
        return 2
    print(pretty_json({"assets": len(document["assets"]), "output": str(args.output)}), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
