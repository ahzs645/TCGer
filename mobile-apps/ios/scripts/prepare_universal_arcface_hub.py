# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "huggingface-hub>=1.0",
# ]
# ///
"""Prepare the TCGer universal scanner catalogs without using a GPU.

This is the free/preflight half of the Hugging Face workflow. It downloads the
authoritative Pokemon, Scryfall, and YGOPRODeck catalog snapshots, converts
them to the ArcFace trainer contract, validates the result, and optionally
uploads the catalogs to a private model repository. It never starts a Job or
allocates paid hardware.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from huggingface_hub import HfApi, get_token


REPO_RAW = (
    "https://raw.githubusercontent.com/ahzs645/TCGer/"
    "codex/universal-scanner-shards"
)
POKEMON_METADATA = (
    f"{REPO_RAW}/mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/"
    "CardsIndexMetadata.json"
)
SCRYFALL_BULK = "https://api.scryfall.com/bulk-data/default-cards"
YGOPRODECK_CARDS = "https://db.ygoprodeck.com/api/v7/cardinfo.php"
REQUEST_HEADERS = {
    "User-Agent": "TCGer/1.0 (https://github.com/ahzs645/TCGer)",
    "Accept": "application/json;q=0.9,*/*;q=0.8",
}


def download(url: str, destination: Path) -> None:
    if destination.is_file() and destination.stat().st_size > 0:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(
        url,
        headers=REQUEST_HEADERS,
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        with open(temporary, "wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    os.replace(temporary, destination)


def load_json(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers=REQUEST_HEADERS,
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def validate_catalogs(output: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    combined_count = 0
    for game in ("pokemon", "magic", "yugioh"):
        path = output / game / "CardsIndexMetadata.json"
        with open(path, encoding="utf-8") as source:
            rows = json.load(source)
        if not rows:
            raise ValueError(f"{game} catalog is empty")
        if any(row.get("annIndex") != index for index, row in enumerate(rows)):
            raise ValueError(f"{game} annIndex values are not contiguous")
        if any(row.get("game") != game for row in rows):
            raise ValueError(f"{game} catalog contains a mismatched game value")
        if any(not row.get("imageURL") for row in rows):
            raise ValueError(f"{game} catalog contains a row without imageURL")
        counts[game] = len(rows)
        combined_count += len(rows)

    with open(output / "CardsIndexMetadata-universal.json", encoding="utf-8") as source:
        universal = json.load(source)
    if len(universal) != combined_count:
        raise ValueError("universal catalog count does not match its game catalogs")
    if any(row.get("annIndex") != index for index, row in enumerate(universal)):
        raise ValueError("universal annIndex values are not contiguous")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hub-repo", default="ahzs645/tcger-universal-arcface")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(".artifacts/huggingface/universal-arcface/catalogs"),
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="Build and validate locally without requiring Hugging Face login",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    converter = script_dir / "build_universal_trainer_metadata.py"
    if not converter.is_file():
        raise FileNotFoundError(f"metadata converter not found: {converter}")

    source_dir = args.output.parent / "source"
    pokemon_path = source_dir / "pokemon.json"
    magic_path = source_dir / "magic-default-cards.json"
    yugioh_path = source_dir / "yugioh.json"

    download(POKEMON_METADATA, pokemon_path)
    bulk_metadata = load_json(SCRYFALL_BULK)
    magic_download_uri = (
        bulk_metadata.get("download_uri")
        or bulk_metadata.get("jsonl_download_uri")
    )
    if not magic_download_uri:
        raise ValueError("Scryfall bulk-data response has no download URI")
    download(magic_download_uri, magic_path)
    download(YGOPRODECK_CARDS, yugioh_path)

    subprocess.run([
        sys.executable,
        str(converter),
        "--pokemon", str(pokemon_path),
        "--mtg", str(magic_path),
        "--yugioh", str(yugioh_path),
        "--output", str(args.output),
    ], check=True)

    counts = validate_catalogs(args.output)
    preflight = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "status": "ready-for-gpu",
        "hubRepo": args.hub_repo,
        "games": counts,
        "combinedRows": sum(counts.values()),
        "sources": {
            "pokemon": POKEMON_METADATA,
            "magic": {
                "endpoint": SCRYFALL_BULK,
                "updatedAt": bulk_metadata.get("updated_at"),
                "downloadURI": magic_download_uri,
            },
            "yugioh": YGOPRODECK_CARDS,
        },
    }
    with open(args.output / "preflight.json", "w", encoding="utf-8") as destination:
        json.dump(preflight, destination, indent=2)

    if not args.no_upload:
        token = get_token()
        if not token:
            raise RuntimeError(
                "Hugging Face login is required for upload. Run `hf auth login`, "
                "or rerun with --no-upload."
            )
        api = HfApi(token=token)
        api.create_repo(
            repo_id=args.hub_repo,
            repo_type="model",
            private=True,
            exist_ok=True,
        )
        api.upload_folder(
            folder_path=str(args.output),
            path_in_repo="catalogs",
            repo_id=args.hub_repo,
            repo_type="model",
            commit_message="Prepare universal scanner catalogs",
        )
        preflight["url"] = f"https://huggingface.co/{args.hub_repo}/tree/main/catalogs"

    print(json.dumps(preflight, indent=2))


if __name__ == "__main__":
    main()
