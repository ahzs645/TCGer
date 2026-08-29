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
import os
import re
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from pathlib import PurePosixPath
from typing import Iterable, Iterator


GAMES = ("pokemon", "magic", "yugioh")
RECOGNITION_CONTRACT = "tcger-two-stage-recognition-v2"
METADATA_SCHEMA = "tcger-cards-index-metadata-v2"
PHYSICAL_SCANNER_PROFILE = "physical"

# TCGdex currently advertises image URLs for these physical Double Crisis
# cards, but its CDN returns permanent 404 responses. PokemonTCG.io has the
# corresponding stable high-resolution scans. Keep the exception explicit so
# future catalog builds remain complete without silently changing providers
# for the other 19,501 physical cards.
POKEMON_IMAGE_OVERRIDES = {
    card_id: f"https://images.pokemontcg.io/dc1/{number}_hires.png"
    for card_id, number in (
        ("dc1-1", "1"),
        ("dc1-10", "10"),
        ("dc1-11", "11"),
        ("dc1-12", "12"),
        ("dc1-13", "13"),
        ("dc1-14", "14"),
    )
}


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


def normalize_release_date(value: object) -> str | None:
    text = str(value or "").strip().replace("/", "-")
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date().isoformat()
    except ValueError as error:
        raise ValueError(f"invalid Pokemon set release date {value!r}") from error


def normalize_created_at(value: str | None) -> str:
    """Return a stable UTC timestamp when a release build supplies one."""
    if value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError(f"invalid --created-at timestamp {value!r}") from error
        if parsed.tzinfo is None:
            raise ValueError("--created-at must include an explicit timezone")
        return parsed.astimezone(timezone.utc).isoformat()
    source_date_epoch = os.environ.get("SOURCE_DATE_EPOCH")
    if source_date_epoch:
        try:
            return datetime.fromtimestamp(int(source_date_epoch), timezone.utc).isoformat()
        except (ValueError, OverflowError) as error:
            raise ValueError("SOURCE_DATE_EPOCH must be an integer Unix timestamp") from error
    return datetime.now(timezone.utc).isoformat()


def pokemon_set_release_dates(path: Path) -> dict[str, str]:
    """Load a compact set-id -> ISO release-date join from provider data."""
    if tarfile.is_tarfile(path):
        dates: dict[str, str] = {}
        with tarfile.open(path, "r:*") as archive:
            for member in archive.getmembers():
                parts = PurePosixPath(member.name).parts
                try:
                    data_index = parts.index("data")
                except ValueError:
                    continue
                # The official TCGdex source tree stores sets at
                # data/<series>/<set>.ts and individual cards one level deeper.
                relative_parts = parts[data_index:]
                if (
                    len(relative_parts) != 3
                    or not relative_parts[-1].endswith(".ts")
                    or not member.isfile()
                ):
                    continue
                extracted = archive.extractfile(member)
                if extracted is None:
                    continue
                source = extracted.read().decode("utf-8")
                set_match = re.search(r'\bid\s*:\s*["\']([^"\']+)["\']', source)
                date_match = re.search(
                    r'\breleaseDate\s*:\s*["\'](\d{4}[-/]\d{2}[-/]\d{2})["\']',
                    source,
                )
                if not set_match or not date_match:
                    continue
                set_id = set_match.group(1).strip()
                release_date = normalize_release_date(date_match.group(1))
                previous = dates.get(set_id)
                if previous and previous != release_date:
                    raise ValueError(
                        f"Pokemon set {set_id!r} has conflicting release dates: "
                        f"{previous!r} and {release_date!r}"
                    )
                if release_date:
                    dates[set_id] = release_date
        if not dates:
            raise ValueError("TCGdex set archive produced no release dates")
        return dates

    with open(path, encoding="utf-8") as source:
        payload = json.load(source)
    if isinstance(payload, list):
        rows = payload
    else:
        rows = payload.get("sets") or payload.get("data") or []
    dates: dict[str, str] = {}
    for row in rows:
        set_id = str(row.get("id") or row.get("setId") or row.get("code") or "").strip()
        release_date = normalize_release_date(
            row.get("releaseDate") or row.get("releasedAt") or row.get("release_date")
        )
        if not set_id or not release_date:
            continue
        previous = dates.get(set_id)
        if previous and previous != release_date:
            raise ValueError(
                f"Pokemon set {set_id!r} has conflicting release dates: "
                f"{previous!r} and {release_date!r}"
            )
        dates[set_id] = release_date
    if not dates:
        raise ValueError("Pokemon set catalog produced no release dates")
    return dates


def pokemon_family_overlay(path: Path) -> tuple[dict[str, str], set[str]]:
    """Load a reviewed exact-printing -> visual-family assignment overlay.

    The overlay is deliberately separate from the provider catalog because
    neither TCGdex nor PokemonTCG exposes a reusable illustration identifier.
    Only reviewed families may collapse multiple printings.
    """
    with open(path, encoding="utf-8") as source:
        payload = json.load(source)
    families = payload.get("families") if isinstance(payload, dict) else None
    if not isinstance(families, list):
        raise ValueError("Pokemon family overlay must contain a families array")
    assignments: dict[str, str] = {}
    cross_name_families: set[str] = set()
    for family in families:
        family_id = str(family.get("recognitionFamilyId") or "").strip()
        printing_ids = family.get("exactPrintingIds") or family.get("cardIds") or []
        if not family_id or not family_id.startswith("pokemon:"):
            raise ValueError("Pokemon family IDs must be non-empty and start with 'pokemon:'")
        if not isinstance(printing_ids, list) or len(printing_ids) < 2:
            raise ValueError(f"Pokemon family {family_id!r} must contain at least two printings")
        if family.get("allowCrossName") is True:
            cross_name_families.add(family_id)
        for value in printing_ids:
            printing_id = str(value).strip()
            if not printing_id:
                raise ValueError(f"Pokemon family {family_id!r} contains an empty printing ID")
            previous = assignments.get(printing_id)
            if previous and previous != family_id:
                raise ValueError(
                    f"Pokemon printing {printing_id!r} belongs to both {previous!r} and {family_id!r}"
                )
            assignments[printing_id] = family_id
    return assignments, cross_name_families


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
        "frameEffects",
        "textless",
        "watermark",
        "promo",
        "finishes",
        "sourceProvider",
        "sourceImageFallbackReason",
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


def magic_recognition_family_id(entry: dict) -> str:
    """Return the visual-family key used by MTG retrieval.

    A family deliberately ignores exact-print evidence such as set code,
    collector number, release date, finish, and security stamp. Those details
    are too small or unreliable for the embedding model and are resolved after
    retrieval. Conversely, a different frame, border, language, face, or
    treatment is visibly different enough to retain its own vector.
    """
    oracle_id = str(entry.get("oracleId") or "").strip()
    illustration_id = str(entry.get("illustrationId") or "").strip()
    if not oracle_id or not illustration_id:
        return str(entry["visualIdentityId"])
    frame_effects = entry.get("frameEffects") or []
    if isinstance(frame_effects, str):
        frame_effects = [frame_effects]
    style = {
        "oracleId": oracle_id,
        "illustrationId": illustration_id,
        "layout": entry.get("layout"),
        "frame": entry.get("frame"),
        "borderColor": entry.get("borderColor"),
        "fullArt": bool(entry.get("fullArt")),
        "faceSide": entry.get("faceSide"),
        "language": entry.get("language"),
        "frameEffects": sorted(str(value) for value in frame_effects),
        "textless": bool(entry.get("textless")),
        "watermark": entry.get("watermark"),
    }
    encoded = json.dumps(style, sort_keys=True, separators=(",", ":")).encode()
    return f"magic:visual:{oracle_id}:{illustration_id}:{hashlib.sha256(encoded).hexdigest()[:16]}"


def pokemon_entries(
    path: Path,
    profile: str = PHYSICAL_SCANNER_PROFILE,
    set_release_dates: dict[str, str] | None = None,
    family_by_printing: dict[str, str] | None = None,
    cross_name_families: set[str] | None = None,
) -> list[dict]:
    with open(path, encoding="utf-8") as source:
        rows = json.load(source)
    output = []
    for source_row in rows:
        if not source_row.get("imageURL"):
            continue
        if profile == PHYSICAL_SCANNER_PROFILE and is_pokemon_pocket(source_row):
            continue
        row = dict(source_row)
        set_code = str(row.get("setCode") or "").strip()
        card_id = str(row.get("cardId") or "").strip()
        if profile == PHYSICAL_SCANNER_PROFILE:
            row["format"] = "paper"
        if set_release_dates and not row.get("releaseDate"):
            row["releaseDate"] = set_release_dates.get(set_code)
        if not row.get("collectorNumber") and set_code and card_id.startswith(f"{set_code}-"):
            row["collectorNumber"] = card_id[len(set_code) + 1:]
        if family_by_printing and card_id in family_by_printing:
            row["recognitionFamilyId"] = family_by_printing[card_id]
        override = POKEMON_IMAGE_OVERRIDES.get(str(row.get("cardId")))
        if override:
            row["imageURL"] = override
            row["sourceProvider"] = "pokemontcg.io"
            row["sourceImageFallbackReason"] = "tcgdex-cdn-404"
        elif "assets.tcgdex.net" in str(row.get("imageURL")):
            row.setdefault("sourceProvider", "tcgdex")
        output.append(normalize_entry(row, "pokemon"))
    if profile == PHYSICAL_SCANNER_PROFILE:
        assert_physical_pokemon_catalog(output)
    if family_by_printing:
        present = {row["exactPrintingId"] for row in output}
        unused = sorted(set(family_by_printing) - present)
        if unused:
            raise ValueError(
                "Pokemon family overlay references missing/non-physical printings: "
                + ", ".join(unused[:5])
            )
        names_by_family: dict[str, set[str]] = {}
        for row in output:
            names_by_family.setdefault(row["recognitionFamilyId"], set()).add(
                row["name"].casefold()
            )
        allowed = cross_name_families or set()
        invalid = [
            family_id for family_id, names in names_by_family.items()
            if len(names) > 1 and family_id not in allowed
        ]
        if invalid:
            raise ValueError(
                "Pokemon overlay merges different names without allowCrossName: "
                + ", ".join(sorted(invalid)[:5])
            )
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
            normalized_source = {
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
                "frameEffects": face.get("frame_effects") or card.get("frame_effects"),
                "textless": face.get("textless", card.get("textless")),
                "watermark": face.get("watermark") or card.get("watermark"),
                "promo": card.get("promo"),
                "finishes": card.get("finishes"),
            }
            normalized_source["recognitionFamilyId"] = magic_recognition_family_id(
                normalized_source
            )
            output.append(normalize_entry(normalized_source, "magic"))
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


def validate_metadata_rows(
    entries: list[dict],
    game: str,
    require_pokemon_runtime_fields: bool = False,
) -> None:
    """Fail before export when a scanner shard is not self-describing.

    Packed vectors only carry an integer row label. These fields are the
    durable contract that maps that label back to a visual family and, when
    printed evidence permits it, an exact collection item.
    """
    required = (
        "cardId",
        "exactPrintingId",
        "recognitionFamilyId",
        "name",
        "game",
        "imageURL",
    )
    magic_required = (
        "visualIdentityId",
        "setCode",
        "collectorNumber",
        "releaseDate",
        "faceSide",
    )
    visible_identities: set[str] = set()
    for index, row in enumerate(entries):
        if row.get("annIndex") != index:
            raise ValueError(
                f"{game} metadata annIndex mismatch at row {index}: "
                f"{row.get('annIndex')!r}"
            )
        if row.get("game") != game:
            raise ValueError(
                f"{game} metadata row {index} has game={row.get('game')!r}"
            )
        missing = [
            key for key in required
            if not isinstance(row.get(key), str) or not row[key].strip()
        ]
        if game == "magic":
            missing.extend(
                key for key in magic_required
                if not isinstance(row.get(key), str) or not row[key].strip()
            )
        if game == "pokemon" and require_pokemon_runtime_fields:
            missing.extend(
                key for key in ("format", "setCode", "collectorNumber", "releaseDate")
                if not isinstance(row.get(key), str) or not row[key].strip()
            )
        if missing:
            raise ValueError(
                f"{game} metadata row {index} is missing required fields: "
                + ", ".join(sorted(set(missing)))
            )
        if game == "magic":
            visible_identity = row["visualIdentityId"]
            if visible_identity in visible_identities:
                raise ValueError(
                    f"magic metadata repeats visible identity {visible_identity!r}"
                )
            visible_identities.add(visible_identity)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as output:
        json.dump(
            value,
            output,
            separators=(",", ":"),
            ensure_ascii=False,
            sort_keys=True,
        )


def validate_pokemon_source_lock(
    path: Path,
    *,
    pokemon_path: Path,
    pokemon_sets_path: Path,
    pokemon_family_overlay_path: Path | None,
    profile: str,
) -> dict:
    """Validate immutable inputs before a release metadata build."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != "tcger-pokemon-metadata-source-lock-v1":
        raise ValueError("unsupported Pokemon metadata source-lock schema")
    if payload.get("profile") != profile:
        raise ValueError(
            f"Pokemon source lock profile {payload.get('profile')!r} does not match {profile!r}"
        )
    builder = payload.get("builder") or {}
    current_builder_sha = sha256(Path(__file__))
    if builder.get("sha256") != current_builder_sha:
        raise ValueError(
            "Pokemon source lock was created by a different metadata builder; "
            "refresh the lock after reviewing the builder change"
        )
    inputs = payload.get("inputs") or {}
    checks = (
        ("pokemonCatalog", pokemon_path),
        ("pokemonSetRegistry", pokemon_sets_path),
    )
    for key, actual_path in checks:
        expected = (inputs.get(key) or {}).get("sha256")
        actual = sha256(actual_path)
        if expected != actual:
            raise ValueError(
                f"Pokemon source lock {key} SHA-256 mismatch: expected {expected}, got {actual}"
            )
    overlay = inputs.get("pokemonFamilyOverlay")
    if overlay is None and pokemon_family_overlay_path is not None:
        raise ValueError("Pokemon family overlay was supplied but is absent from the source lock")
    if overlay is not None:
        if pokemon_family_overlay_path is None:
            raise ValueError("Pokemon source lock requires --pokemon-family-overlay")
        expected = overlay.get("sha256")
        actual = sha256(pokemon_family_overlay_path)
        if expected != actual:
            raise ValueError(
                "Pokemon source lock family-overlay SHA-256 mismatch: "
                f"expected {expected}, got {actual}"
            )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pokemon", type=Path)
    parser.add_argument(
        "--pokemon-sets",
        type=Path,
        help="Pokemon set registry containing release dates (required for physical scanner builds)",
    )
    parser.add_argument(
        "--pokemon-family-overlay",
        type=Path,
        help="Optional reviewed artwork-family overlay; unlisted printings remain singleton families",
    )
    parser.add_argument(
        "--pokemon-source-lock",
        type=Path,
        help="Validate the Pokemon catalog, set registry, builder, and profile against this lock",
    )
    parser.add_argument(
        "--created-at",
        help=(
            "UTC provenance timestamp. Locked builds inherit this from the source lock; "
            "otherwise SOURCE_DATE_EPOCH is honored before the wall clock."
        ),
    )
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

    if args.pokemon and args.pokemon_profile == PHYSICAL_SCANNER_PROFILE and not args.pokemon_sets:
        parser.error("--pokemon-sets is required for a physical Pokemon scanner build")
    if args.pokemon_source_lock and (not args.pokemon or not args.pokemon_sets):
        parser.error("--pokemon-source-lock requires --pokemon and --pokemon-sets")
    pokemon_source_lock = None
    if args.pokemon_source_lock:
        pokemon_source_lock = validate_pokemon_source_lock(
            args.pokemon_source_lock,
            pokemon_path=args.pokemon,
            pokemon_sets_path=args.pokemon_sets,
            pokemon_family_overlay_path=args.pokemon_family_overlay,
            profile=args.pokemon_profile,
        )
    created_at = normalize_created_at(
        args.created_at or (
            str(pokemon_source_lock.get("createdAt"))
            if pokemon_source_lock else None
        )
    )
    pokemon_dates = pokemon_set_release_dates(args.pokemon_sets) if args.pokemon_sets else None
    pokemon_families: dict[str, str] = {}
    pokemon_cross_name_families: set[str] = set()
    if args.pokemon_family_overlay:
        pokemon_families, pokemon_cross_name_families = pokemon_family_overlay(
            args.pokemon_family_overlay
        )

    builders = {
        "pokemon": (
            args.pokemon,
            lambda path: pokemon_entries(
                path,
                profile=args.pokemon_profile,
                set_release_dates=pokemon_dates,
                family_by_printing=pokemon_families,
                cross_name_families=pokemon_cross_name_families,
            ),
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
        validate_metadata_rows(
            rows,
            game,
            require_pokemon_runtime_fields=(
                game == "pokemon" and args.pokemon_profile == PHYSICAL_SCANNER_PROFILE
            ),
        )
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
        "createdAt": created_at,
        "schema": METADATA_SCHEMA,
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
                "familyPreferred": "reviewed-overlay",
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
        "pokemonSetCatalog": (
            {"file": args.pokemon_sets.name, "sha256": sha256(args.pokemon_sets)}
            if args.pokemon_sets else None
        ),
        "pokemonFamilyOverlay": (
            {
                "file": args.pokemon_family_overlay.name,
                "sha256": sha256(args.pokemon_family_overlay),
                "assignedPrintings": len(pokemon_families),
                "multiPrintingFamilies": len(set(pokemon_families.values())),
            }
            if args.pokemon_family_overlay else None
        ),
        "pokemonSourceLock": (
            {
                key: pokemon_source_lock[key]
                for key in ("schema", "profile", "createdAt", "builder", "inputs")
            }
            if pokemon_source_lock else None
        ),
        "combinedRows": len(combined),
        "gameOrder": [game for game in GAMES if game in catalogs],
    }
    write_json(args.output / "provenance.json", provenance)
    print(json.dumps(provenance, indent=2))


if __name__ == "__main__":
    main()
