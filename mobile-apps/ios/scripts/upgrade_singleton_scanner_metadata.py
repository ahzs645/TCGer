#!/usr/bin/env python3
"""Upgrade a printing-level scanner index to the visual-family metadata contract.

This migration is intentionally narrow: every input row must already represent a
unique recognition family. It preserves row order and ``annIndex`` so the output
continues to align byte-for-byte with the existing packed vector file. A catalog
that contains repeated family ids needs a real family-level vector rebuild and is
rejected instead of being silently collapsed here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


POCKET_MARKERS = ("/tcgp/", "series=tcgp", "format=pocket")
PRINTING_FIELDS = (
    "cardId",
    "exactPrintingId",
    "format",
    "setCode",
    "collectorNumber",
    "setName",
    "rarity",
    "imageURL",
    "price",
    "releaseDate",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_pocket(entry: dict[str, Any]) -> bool:
    if str(entry.get("format") or "").strip().casefold() == "pocket":
        return True
    if str(entry.get("series") or "").strip().casefold() == "tcgp":
        return True
    searchable = " ".join(
        str(entry.get(field) or "").casefold()
        for field in ("imageURL", "sourceURL", "sourcePath")
    )
    return any(marker in searchable for marker in POCKET_MARKERS)


def require_text(entry: dict[str, Any], field: str, row_index: int) -> str:
    value = entry.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"row {row_index} is missing non-empty {field}")
    return value


def upgrade_rows(rows: list[dict[str, Any]], expected_game: str) -> list[dict[str, Any]]:
    if not rows:
        raise ValueError("scanner metadata must be a non-empty JSON array")
    game = expected_game.strip().casefold()
    if not game:
        raise ValueError("expected game must be non-empty")

    family_ids: set[str] = set()
    exact_printing_ids: set[str] = set()
    upgraded: list[dict[str, Any]] = []
    for index, source in enumerate(rows):
        if not isinstance(source, dict):
            raise ValueError(f"row {index} is not a JSON object")
        if source.get("annIndex") != index:
            raise ValueError(
                f"row {index} has annIndex {source.get('annIndex')!r}; "
                "the migration cannot realign vectors"
            )
        if str(source.get("game") or "").casefold() != game:
            raise ValueError(f"row {index} is not for game {game}")
        if is_pocket(source):
            raise ValueError(f"row {index} contains a Pokémon TCG Pocket asset")
        if source.get("printings") not in (None, []):
            raise ValueError(f"row {index} already contains exact printings")

        card_id = require_text(source, "cardId", index)
        exact_printing_id = require_text(source, "exactPrintingId", index)
        family_id = require_text(source, "recognitionFamilyId", index)
        require_text(source, "name", index)
        require_text(source, "imageURL", index)
        if family_id in family_ids:
            raise ValueError(
                f"recognition family {family_id!r} occurs more than once; "
                "rebuild family-level vectors instead of using this migration"
            )
        if exact_printing_id in exact_printing_ids:
            raise ValueError(f"duplicate exact printing id {exact_printing_id!r}")
        family_ids.add(family_id)
        exact_printing_ids.add(exact_printing_id)

        row = dict(source)
        if not row.get("format"):
            row["format"] = "paper"
        printing = {
            field: row.get(field)
            for field in PRINTING_FIELDS
            if row.get(field) is not None
        }
        printing["cardId"] = card_id
        printing["exactPrintingId"] = exact_printing_id
        row["indexIdentity"] = "recognition_family"
        row["printingCount"] = 1
        row["printings"] = [printing]
        upgraded.append(row)

    return upgraded


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--game", required=True)
    parser.add_argument("--source-provenance", type=Path)
    parser.add_argument("--provenance-output", type=Path)
    args = parser.parse_args()

    source = json.loads(args.input.read_text(encoding="utf-8"))
    if not isinstance(source, list):
        raise SystemExit("scanner metadata must be a JSON array")
    upgraded = upgrade_rows(source, args.game)
    write_json(args.output, upgraded)

    if bool(args.source_provenance) != bool(args.provenance_output):
        raise SystemExit("--source-provenance and --provenance-output must be used together")
    if args.source_provenance and args.provenance_output:
        original_provenance = json.loads(args.source_provenance.read_text(encoding="utf-8"))
        provenance = {
            "schema": "tcger-scanner-release-provenance-v1",
            "game": args.game.strip().casefold(),
            "metadataSchema": "tcger-cards-index-metadata-v3",
            "recognitionContract": "tcger-two-stage-recognition-v2",
            "transformation": {
                "name": "upgrade-singleton-scanner-metadata",
                "preservesVectorRowOrder": True,
                "sourceMetadataSha256": sha256(args.input),
                "outputMetadataSha256": sha256(args.output),
                "rowCount": len(upgraded),
                "printingCount": len(upgraded),
            },
            "sourceProvenance": original_provenance,
        }
        write_json(args.provenance_output, provenance)

    print(json.dumps({
        "game": args.game.strip().casefold(),
        "rows": len(upgraded),
        "printings": len(upgraded),
        "output": str(args.output),
        "sha256": sha256(args.output),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
