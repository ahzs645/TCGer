#!/usr/bin/env python3
"""Build a bounded, immutable compositor card pack from a pinned catalog.

This adapter is for a game whose complete private image-library release has
not been materialized yet. It assigns stable identities to train or
validation before downloading, stores the fetched bytes by content hash, and
records the catalog hash, revision, URL, and original identity on every asset.
The resulting manifest has the same contract as an image-library-backed pack.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

from PIL import Image

PARENT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PARENT))

from corpus_release import pretty_json, sha256_bytes, sha256_file  # noqa: E402

from compositor.compositor import ASSET_MANIFEST_SCHEMA, CompositorError  # noqa: E402


def stable_split(game: str, identity: str) -> str:
    """Assign an identity before fetch, with a fixed 90/10 train/validation split."""
    digest = sha256_bytes(f"geometry-card-split-v1:{game}:{identity}".encode())
    return "validation" if int(digest[:8], 16) % 10 == 0 else "train"


def load_catalog(path: Path) -> list[dict[str, Any]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(value, dict):
        for key in ("data", "cards", "items"):
            candidate = value.get(key)
            if isinstance(candidate, list):
                value = candidate
                break
    if not isinstance(value, list) or not all(isinstance(row, dict) for row in value):
        raise CompositorError("catalog must be a JSON array of objects")
    return value


def catalog_candidates(
    rows: list[dict[str, Any]], game: str
) -> dict[str, list[dict[str, str]]]:
    by_split: dict[str, list[dict[str, str]]] = defaultdict(list)
    seen: set[tuple[str, str]] = set()
    for row in rows:
        if str(row.get("game") or "").casefold() != game.casefold():
            continue
        identity = str(row.get("cardId") or row.get("id") or "").strip()
        url = str(row.get("imageURL") or row.get("imageUrl") or "").strip()
        if not identity or not url or (identity, url) in seen:
            continue
        seen.add((identity, url))
        by_split[stable_split(game, identity)].append(
            {"identity": identity, "url": url, "name": str(row.get("name") or identity)}
        )
    for split in by_split:
        by_split[split].sort(
            key=lambda row: sha256_bytes(
                f"geometry-card-order-v1:{game}:{row['identity']}".encode()
            )
        )
    return by_split


def fetch(url: str, destination: Path) -> None:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "TCGer card-geometry asset builder/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
        destination.write_bytes(response.read())
    with Image.open(destination) as image:
        image.verify()


def build_manifest(
    *,
    catalog: Path,
    catalog_revision: str,
    game: str,
    train_count: int,
    validation_count: int,
    output: Path,
    card_back: Path | None = None,
) -> dict[str, Any]:
    if output.exists() and any(output.iterdir()):
        raise CompositorError(f"refusing to replace non-empty output: {output}")
    if len(catalog_revision) != 40:
        raise CompositorError("catalog revision must be an immutable 40-hex revision")
    requested = {"train": train_count, "validation": validation_count}
    choices = catalog_candidates(load_catalog(catalog), game)
    for split, count in requested.items():
        if len(choices[split]) < count:
            raise CompositorError(
                f"need {count} {split} identities but catalog has {len(choices[split])}"
            )

    output.mkdir(parents=True, exist_ok=True)
    assets_dir = output / "assets"
    assets_dir.mkdir()
    catalog_sha = sha256_file(catalog)
    assets: list[dict[str, Any]] = []
    byte_splits: dict[str, set[str]] = defaultdict(set)
    for split, count in requested.items():
        for row in choices[split][:count]:
            temporary = assets_dir / f"download-{split}-{row['identity']}.img"
            fetch(row["url"], temporary)
            digest = sha256_file(temporary)
            byte_splits[digest].add(split)
            with Image.open(temporary) as opened:
                image_format = str(opened.format or "").lower()
            suffix = {"jpeg": ".jpg", "png": ".png", "webp": ".webp"}.get(
                image_format, ".img"
            )
            asset_id = f"catalog-{game}-{digest[:32]}"
            destination = assets_dir / f"{asset_id}{suffix}"
            if destination.exists():
                temporary.unlink()
            else:
                temporary.replace(destination)
            assets.append(
                {
                    "assetId": asset_id,
                    "path": destination.relative_to(output).as_posix(),
                    "sha256": digest,
                    "split": split,
                    "licenseId": "private-training-only",
                    "game": game,
                    "side": "faceUp",
                    "provenance": {
                        "sourceCatalog": catalog.name,
                        "sourceCatalogRevision": catalog_revision,
                        "sourceCatalogSha256": catalog_sha,
                        "sourceIdentity": row["identity"],
                        "sourceUrl": row["url"],
                        "redistributionStatus": "private-training-only",
                    },
                }
            )
    crossing = sorted(digest for digest, splits in byte_splits.items() if len(splits) > 1)
    if crossing:
        raise CompositorError(f"identical card bytes cross splits: {crossing[:5]}")
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
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--catalog-revision", required=True)
    parser.add_argument("--game", required=True)
    parser.add_argument("--train-count", type=int, required=True)
    parser.add_argument("--validation-count", type=int, required=True)
    parser.add_argument("--card-back", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        document = build_manifest(
            catalog=args.catalog,
            catalog_revision=args.catalog_revision,
            game=args.game,
            train_count=args.train_count,
            validation_count=args.validation_count,
            output=args.output,
            card_back=args.card_back,
        )
    except (CompositorError, OSError, ValueError) as error:
        print(f"catalog asset extraction failed: {error}", file=sys.stderr)
        return 2
    print(pretty_json({"assets": len(document["assets"]), "output": str(args.output)}), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
