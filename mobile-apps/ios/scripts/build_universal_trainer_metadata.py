#!/usr/bin/env python3
"""Build normalized ArcFace trainer catalogs for Pokémon, MTG, and Yu-Gi-Oh.

Inputs are the catalog snapshots mirrored in the TCG Google Drive. The output
schema is the compact ``CardsIndexMetadata.json`` contract consumed by
``train_arcface_encoder.py``. MTG double-faced printings and Yu-Gi-Oh artwork
variants intentionally get one vector row per visible face/artwork; rows may
share ``cardId`` because they resolve to the same catalog identity.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator


GAMES = ("pokemon", "magic", "yugioh")


def json_records(path: Path) -> Iterator[dict]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as source:
        first = source.read(1)
        source.seek(0)
        if first == "[":
            yield from json.load(source)
            return
        for line in source:
            line = line.strip()
            if line:
                yield json.loads(line)


def normalize_entry(entry: dict, game: str) -> dict:
    return {
        "annIndex": 0,
        "cardId": str(entry["cardId"]),
        "name": str(entry["name"]),
        "game": game,
        "format": entry.get("format"),
        "setCode": entry.get("setCode"),
        "setName": entry.get("setName"),
        "rarity": entry.get("rarity"),
        "imageURL": entry.get("imageURL"),
        "price": entry.get("price"),
    }


def pokemon_entries(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as source:
        rows = json.load(source)
    return [normalize_entry(row, "pokemon") for row in rows if row.get("imageURL")]


def mtg_entries(path: Path) -> list[dict]:
    output = []
    for card in json_records(path):
        if card.get("object") != "card" or card.get("digital"):
            continue
        if "paper" not in (card.get("games") or []):
            continue
        image_sets: list[dict] = []
        if card.get("image_uris"):
            image_sets.append(card["image_uris"])
        else:
            image_sets.extend(
                face["image_uris"]
                for face in card.get("card_faces") or []
                if face.get("image_uris")
            )
        for images in image_sets:
            image_url = images.get("normal") or images.get("large")
            if not image_url:
                continue
            output.append(normalize_entry({
                "cardId": card["id"],
                "name": card["name"],
                "format": "paper",
                "setCode": card.get("set"),
                "setName": card.get("set_name"),
                "rarity": card.get("rarity"),
                "imageURL": image_url,
                "price": None,
            }, "magic"))
    return output


def yugioh_entries(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as source:
        payload = json.load(source)
    cards = payload if isinstance(payload, list) else payload.get("data", [])
    output = []
    for card in cards:
        sets = card.get("card_sets") or []
        set_codes = {row.get("set_code") for row in sets if row.get("set_code")}
        set_names = {row.get("set_name") for row in sets if row.get("set_name")}
        rarities = {row.get("set_rarity") for row in sets if row.get("set_rarity")}
        # A visual card/artwork is not a specific reprint. Only attach printing
        # metadata when the source catalog has exactly one possible value.
        set_code = next(iter(set_codes)) if len(set_codes) == 1 else None
        set_name = next(iter(set_names)) if len(set_names) == 1 else None
        rarity = next(iter(rarities)) if len(rarities) == 1 else None
        for artwork in card.get("card_images") or []:
            image_url = artwork.get("image_url")
            if not image_url:
                continue
            output.append(normalize_entry({
                "cardId": artwork.get("id", card["id"]),
                "name": card["name"],
                "format": "paper",
                "setCode": set_code,
                "setName": set_name,
                "rarity": rarity,
                "imageURL": image_url,
                "price": None,
            }, "yugioh"))
    return output


def assign_indices(entries: Iterable[dict]) -> list[dict]:
    rows = list(entries)
    for index, row in enumerate(rows):
        row["annIndex"] = index
    return rows


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as output:
        json.dump(value, output, separators=(",", ":"), ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pokemon", type=Path)
    parser.add_argument("--mtg", type=Path)
    parser.add_argument("--yugioh", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    builders = {
        "pokemon": (args.pokemon, pokemon_entries),
        "magic": (args.mtg, mtg_entries),
        "yugioh": (args.yugioh, yugioh_entries),
    }
    catalogs: dict[str, list[dict]] = {}
    sources = {}
    for game in GAMES:
        path, builder = builders[game]
        if path is None:
            continue
        rows = assign_indices(builder(path))
        if not rows:
            raise ValueError(f"{game} produced no trainer rows")
        catalogs[game] = rows
        sources[game] = {
            "file": path.name,
            "sha256": sha256(path),
            "rows": len(rows),
            "uniqueCardIds": len({row["cardId"] for row in rows}),
            "uniqueImageURLs": len({row["imageURL"] for row in rows}),
        }
        write_json(args.output / game / "CardsIndexMetadata.json", rows)

    combined = assign_indices(row.copy() for game in GAMES for row in catalogs.get(game, []))
    write_json(args.output / "CardsIndexMetadata-universal.json", combined)
    provenance = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "schema": "tcger-cards-index-metadata-v1",
        "sources": sources,
        "combinedRows": len(combined),
        "gameOrder": [game for game in GAMES if game in catalogs],
    }
    write_json(args.output / "provenance.json", provenance)
    print(json.dumps(provenance, indent=2))


if __name__ == "__main__":
    main()
