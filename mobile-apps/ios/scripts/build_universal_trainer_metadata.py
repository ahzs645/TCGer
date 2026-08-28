#!/usr/bin/env python3
"""Build normalized two-stage scanner catalogs for supported card games.

Inputs are the catalog snapshots mirrored in the TCG Google Drive. The output
schema is the compact ``CardsIndexMetadata.json`` contract consumed by
``train_arcface_encoder.py``. The visual encoder learns a stable
``recognitionFamilyId`` while ``exactPrintingId`` and verification metadata
remain available to a second-stage title/footer/symbol resolver. MTG
double-faced printings and Yu-Gi-Oh artwork variants intentionally get one
vector row per identifying visible face/artwork; rows may share ``cardId``
because they resolve to the same catalog identity.
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
RECOGNITION_CONTRACT = "tcger-two-stage-recognition-v1"
PHYSICAL_SCANNER_PROFILE = "physical"


def is_pokemon_pocket(entry: dict) -> bool:
    """Detect TCG Pocket rows independently of any one upstream schema."""
    series = entry.get("series")
    if isinstance(series, dict):
        series_values = (series.get("id"), series.get("name"))
    else:
        series_values = (series,)
    fields = (
        entry.get("format"),
        entry.get("gameFormat"),
        entry.get("setSeries"),
        *series_values,
    )
    if any(str(value or "").strip().casefold() in {"pocket", "tcgp"} for value in fields):
        return True
    image_url = str(entry.get("imageURL") or entry.get("image") or "")
    return "/tcgp/" in image_url.casefold()


def assert_physical_pokemon_catalog(entries: Iterable[dict]) -> None:
    contaminated = [row for row in entries if is_pokemon_pocket(row)]
    if contaminated:
        example = contaminated[0].get("cardId") or contaminated[0].get("name")
        raise ValueError(
            "physical Pokemon scanner catalog contains "
            f"{len(contaminated)} TCG Pocket row(s); first={example}"
        )


def json_records(path: Path) -> Iterator[dict]:
    with open(path, "rb") as raw_source:
        is_gzip = raw_source.read(2) == b"\x1f\x8b"
    opener = gzip.open if is_gzip else open
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
    row = {
        "annIndex": 0,
        "cardId": str(entry["cardId"]),
        "exactPrintingId": str(entry.get("exactPrintingId") or entry["cardId"]),
        "name": str(entry["name"]),
        "game": game,
        "format": entry.get("format"),
        "setCode": entry.get("setCode"),
        "setName": entry.get("setName"),
        "rarity": entry.get("rarity"),
        "imageURL": entry.get("imageURL"),
        "price": entry.get("price"),
    }
    optional_fields = (
        "recognitionFamilyId",
        "visualIdentityId",
        "oracleId",
        "illustrationId",
        "artworkId",
        "collectorNumber",
        "releaseDate",
        "layout",
        "setType",
        "faceSide",
        "faceIndex",
        "compoundName",
        "language",
        "frame",
        "borderColor",
        "fullArt",
        "promo",
        "finishes",
    )
    for key in optional_fields:
        value = entry.get(key)
        if value is not None:
            row[key] = value
    row.setdefault(
        "recognitionFamilyId",
        f"{game}:printing:{row['exactPrintingId']}",
    )
    return row


def pokemon_entries(path: Path, profile: str = PHYSICAL_SCANNER_PROFILE) -> list[dict]:
    with open(path, encoding="utf-8") as source:
        rows = json.load(source)
    output = [
        normalize_entry(row, "pokemon")
        for row in rows
        if row.get("imageURL") and (profile != PHYSICAL_SCANNER_PROFILE or not is_pokemon_pocket(row))
    ]
    if profile == PHYSICAL_SCANNER_PROFILE:
        assert_physical_pokemon_catalog(output)
    return output


def mtg_entries(path: Path) -> list[dict]:
    output = []
    for card in json_records(path):
        if card.get("object") != "card" or card.get("digital"):
            continue
        if "paper" not in (card.get("games") or []):
            continue
        visible_faces: list[tuple[dict, int]] = []
        if card.get("image_uris"):
            visible_faces.append((card, 0))
        else:
            visible_faces.extend(
                (face, face_index)
                for face_index, face in enumerate(card.get("card_faces") or [])
                if face.get("image_uris")
            )
        for face, face_index in visible_faces:
            images = face.get("image_uris") or {}
            image_url = images.get("normal") or images.get("large")
            if not image_url:
                continue
            face_side = "back" if "/back/" in image_url else (
                "back" if face_index > 0 else "front"
            )
            # Art Series reverse faces are one generic checklist/back shared by
            # many unrelated fronts. They cannot identify a card and create
            # contradictory ArcFace labels, so retain the catalog printing but
            # do not emit that non-identifying face into the scanner gallery.
            if card.get("layout") == "art_series" and face_side == "back":
                continue
            oracle_id = face.get("oracle_id") or card.get("oracle_id")
            illustration_id = face.get("illustration_id") or card.get("illustration_id")
            visible_face_id = f"magic:printing:{card['id']}:{face_side}"
            recognition_family_id = (
                f"magic:illustration:{illustration_id}"
                if illustration_id
                else visible_face_id
            )
            output.append(normalize_entry({
                "cardId": card["id"],
                "exactPrintingId": card["id"],
                "name": face.get("name") or card["name"],
                "compoundName": card["name"],
                "format": "paper",
                "setCode": card.get("set"),
                "setName": card.get("set_name"),
                "rarity": card.get("rarity"),
                "imageURL": image_url,
                "price": None,
                "visualIdentityId": visible_face_id,
                "recognitionFamilyId": recognition_family_id,
                "oracleId": oracle_id,
                "illustrationId": illustration_id,
                "collectorNumber": card.get("collector_number"),
                "releaseDate": card.get("released_at"),
                "layout": card.get("layout"),
                "setType": card.get("set_type"),
                "faceSide": face_side,
                "faceIndex": face_index,
                "language": card.get("lang"),
                "frame": card.get("frame"),
                "borderColor": card.get("border_color"),
                "fullArt": card.get("full_art"),
                "promo": card.get("promo"),
                "finishes": card.get("finishes"),
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
            artwork_id = str(artwork.get("id", card["id"]))
            output.append(normalize_entry({
                "cardId": artwork_id,
                "exactPrintingId": str(card["id"]),
                "name": card["name"],
                "format": "paper",
                "setCode": set_code,
                "setName": set_name,
                "rarity": rarity,
                "imageURL": image_url,
                "price": None,
                "artworkId": artwork_id,
                "visualIdentityId": f"yugioh:artwork:{artwork_id}",
                "recognitionFamilyId": f"yugioh:artwork:{artwork_id}",
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
    parser.add_argument(
        "--pokemon-profile",
        choices=("physical", "all"),
        default=PHYSICAL_SCANNER_PROFILE,
        help=(
            "Scanner builds default to physical cards and exclude TCG Pocket. "
            "Use 'all' only for a non-scanner collection catalog."
        ),
    )
    args = parser.parse_args()

    builders = {
        "pokemon": (
            args.pokemon,
            lambda path: pokemon_entries(path, profile=args.pokemon_profile),
        ),
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
        if game == "pokemon" and args.pokemon_profile == PHYSICAL_SCANNER_PROFILE:
            assert_physical_pokemon_catalog(rows)
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
        "schema": "tcger-cards-index-metadata-v2",
        "recognitionContract": RECOGNITION_CONTRACT,
        "recognitionPolicies": {
            "default": {
                "visualStage": "recognitionFamilyId",
                "collectionIdentity": "exactPrintingId",
                "abstainWhenExactPrintingIsUnresolved": True,
            },
            "pokemon": {
                "scannerProfile": args.pokemon_profile,
                "excludedFromPhysicalScanner": [
                    "series=tcgp", "format=pocket", "imageURL contains /tcgp/"
                ],
                "familyFallback": "printing",
                "verificationEvidence": ["name", "setCode", "collectorNumber"],
            },
            "magic": {
                "familyPreferred": "illustrationId",
                "familyFallback": "visible-printing-face",
                "excludedFaces": ["layout=art_series,faceSide=back"],
                "verificationEvidence": [
                    "name", "setCode", "collectorNumber", "setSymbol",
                    "frame", "treatment",
                ],
            },
            "yugioh": {
                "familyPreferred": "artworkId",
                "verificationEvidence": ["name", "setCode", "collectorNumber"],
            },
        },
        "sources": sources,
        "combinedRows": len(combined),
        "gameOrder": [game for game in GAMES if game in catalogs],
    }
    write_json(args.output / "provenance.json", provenance)
    print(json.dumps(provenance, indent=2))


if __name__ == "__main__":
    main()
