# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "coremltools>=8.0",
#   "huggingface-hub>=0.34.0",
#   "numpy>=1.26,<3",
#   "pillow>=10.0",
#   "requests>=2.32",
#   "timm>=1.0",
#   "torch>=2.5",
#   "torchvision>=0.20",
# ]
# ///
"""Run the reproducible TCGer universal ArcFace training/export job.

The job obtains the same authoritative catalogs mirrored in the TCG Google
Drive (Scryfall, YGOPRODeck, and the tracked Pokémon catalog), normalizes them,
trains one game-neutral encoder, exports a combined index plus per-game shards,
and persists checkpoints/results to a private Hugging Face model repository.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_RAW = (
    "https://raw.githubusercontent.com/ahzs645/TCGer/"
    "codex/universal-scanner-shards"
)
POKEMON_METADATA = (
    f"{REPO_RAW}/mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/"
    "CardsIndexMetadata.json"
)
CONVERTER = f"{REPO_RAW}/mobile-apps/ios/scripts/build_universal_trainer_metadata.py"
TRAINER = f"{REPO_RAW}/mobile-apps/ios/scripts/train_arcface_encoder.py"
SCRYFALL_BULK = "https://api.scryfall.com/bulk-data/default-cards"
YGOPRODECK_CARDS = "https://db.ygoprodeck.com/api/v7/cardinfo.php"


def download(url: str, destination: Path) -> None:
    import requests

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    with requests.get(
        url,
        headers={"User-Agent": "TCGer-universal-trainer/1.0"},
        timeout=120,
        stream=True,
    ) as response:
        response.raise_for_status()
        with open(temporary, "wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                if chunk:
                    output.write(chunk)
    os.replace(temporary, destination)


def run(command: list[str], env: dict[str, str] | None = None) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, check=True, env=env)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hub-repo", default="ahzs645/tcger-universal-arcface")
    parser.add_argument("--mode", choices=("quick", "full"), default="quick")
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--limit-per-game", type=int)
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--workdir", type=Path, default=Path("/tmp/tcger-universal"))
    args = parser.parse_args()

    import requests
    from huggingface_hub import HfApi

    epochs = args.epochs or (3 if args.mode == "quick" else 12)
    limit = args.limit_per_game
    if limit is None:
        limit = 2000 if args.mode == "quick" else 0

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is required for checkpoint persistence")
    api = HfApi(token=token)
    api.create_repo(
        repo_id=args.hub_repo,
        repo_type="model",
        private=True,
        exist_ok=True,
    )

    work = args.workdir
    source_dir = work / "source"
    normalized_dir = work / "normalized"
    output_dir = work / "outputs"
    cache_dir = work / "card-images"
    scripts_dir = work / "scripts"
    for directory in (source_dir, normalized_dir, output_dir, cache_dir, scripts_dir):
        directory.mkdir(parents=True, exist_ok=True)

    pokemon_path = source_dir / "pokemon.json"
    magic_path = source_dir / "magic-default-cards.json"
    yugioh_path = source_dir / "yugioh.json"
    converter_path = scripts_dir / "build_universal_trainer_metadata.py"
    trainer_path = scripts_dir / "train_arcface_encoder.py"

    download(POKEMON_METADATA, pokemon_path)
    bulk = requests.get(
        SCRYFALL_BULK,
        headers={"User-Agent": "TCGer-universal-trainer/1.0"},
        timeout=60,
    )
    bulk.raise_for_status()
    bulk_metadata = bulk.json()
    download(bulk_metadata["download_uri"], magic_path)
    download(YGOPRODECK_CARDS, yugioh_path)
    download(CONVERTER, converter_path)
    download(TRAINER, trainer_path)

    run([
        sys.executable,
        str(converter_path),
        "--pokemon", str(pokemon_path),
        "--mtg", str(magic_path),
        "--yugioh", str(yugioh_path),
        "--output", str(normalized_dir),
    ])

    run_config = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "epochs": epochs,
        "limitPerGame": limit,
        "batch": args.batch,
        "catalogs": {
            "pokemon": POKEMON_METADATA,
            "magic": {
                "endpoint": SCRYFALL_BULK,
                "updatedAt": bulk_metadata.get("updated_at"),
                "downloadURI": bulk_metadata.get("download_uri"),
            },
            "yugioh": YGOPRODECK_CARDS,
        },
    }
    with open(normalized_dir / "run-config.json", "w", encoding="utf-8") as output:
        json.dump(run_config, output, indent=2)

    # This early upload verifies write permission before any paid GPU training.
    api.upload_folder(
        folder_path=str(normalized_dir),
        path_in_repo="catalogs",
        repo_id=args.hub_repo,
        repo_type="model",
    )

    trainer_command = [
        sys.executable,
        str(trainer_path),
        "--metadata", str(normalized_dir / "pokemon" / "CardsIndexMetadata.json"),
        "--metadata", str(normalized_dir / "magic" / "CardsIndexMetadata.json"),
        "--metadata", str(normalized_dir / "yugioh" / "CardsIndexMetadata.json"),
        "--epochs", str(epochs),
        "--batch", str(args.batch),
        "--hub-repo", args.hub_repo,
        "--hub-path-prefix", f"training/{args.mode}",
    ]
    if limit:
        trainer_command.extend(["--limit-per-game", str(limit)])
    trainer_env = os.environ.copy()
    trainer_env["TCGER_CACHE_DIR"] = str(cache_dir)
    trainer_env["TCGER_OUTPUT_DIR"] = str(output_dir)
    run(trainer_command, env=trainer_env)

    shutil.copy2(normalized_dir / "provenance.json", output_dir / "provenance.json")
    shutil.copy2(normalized_dir / "run-config.json", output_dir / "run-config.json")
    api.upload_folder(
        folder_path=str(output_dir),
        path_in_repo=f"exports/{args.mode}",
        repo_id=args.hub_repo,
        repo_type="model",
    )
    print(f"results: https://huggingface.co/{args.hub_repo}", flush=True)


if __name__ == "__main__":
    main()
