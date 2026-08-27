# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "coremltools>=8.0",
#   "huggingface-hub>=0.34.0",
#   "numpy>=1.26,<3",
#   "onnxruntime-gpu>=1.20",
#   "pillow>=10.0",
#   "requests>=2.32",
#   "timm>=1.0",
#   "torch>=2.5",
#   "torchvision>=0.20",
# ]
# ///
"""Run the reproducible TCGer ArcFace training/export job.

The job obtains the same authoritative catalogs mirrored in the TCG Google
Drive (Scryfall, YGOPRODeck, and the tracked Pokémon catalog), normalizes them,
trains one encoder across the selected games, exports the combined index plus
per-game shards, and persists checkpoints/results to a private Hugging Face
model repository.
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
ALL_GAMES = ("pokemon", "magic", "yugioh")
REQUEST_HEADERS = {
    "User-Agent": "TCGer/1.0 (https://github.com/ahzs645/TCGer)",
    "Accept": "application/json;q=0.9,*/*;q=0.8",
}


def download(url: str, destination: Path) -> None:
    import requests

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    with requests.get(
        url,
        headers=REQUEST_HEADERS,
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
    parser.add_argument(
        "--games",
        nargs="+",
        choices=ALL_GAMES,
        default=list(ALL_GAMES),
        help=(
            "Catalogs to train together. The default preserves universal mode; "
            "use '--games pokemon' for an isolated Pokemon encoder."
        ),
    )
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--limit-per-game", type=int)
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--workdir", type=Path, default=Path("/tmp/tcger-universal"))
    parser.add_argument(
        "--trainer-script",
        type=Path,
        help="Optional local trainer script; useful for immutable/pinned job bundles",
    )
    parser.add_argument(
        "--pokemon-baseline-path-in-repo",
        default="baselines/pokemon/card-embeddings-arcface-production-fp16.onnx",
        help="Production Pokemon ONNX used for paired acceptance evaluation",
    )
    parser.add_argument(
        "--skip-pokemon-baseline",
        action="store_true",
        help="Skip the paired production-Pokemon comparison",
    )
    parser.add_argument(
        "--catalog-revision",
        default="main",
        help="Revision containing catalogs prepared by prepare_universal_arcface_hub.py",
    )
    parser.add_argument(
        "--refresh-catalogs",
        action="store_true",
        help="Ignore prepared Hub catalogs and rebuild them from upstream sources",
    )
    args = parser.parse_args()

    selected_games = tuple(game for game in ALL_GAMES if game in args.games)
    if len(selected_games) != len(args.games):
        parser.error("--games must not contain duplicates")
    artifact_scope = (
        "universal" if selected_games == ALL_GAMES else "-".join(selected_games)
    )
    # Preserve the established universal paths while isolating specialized
    # checkpoints and exports so catalogs with different ArcFace heads can
    # never accidentally resume or overwrite one another.
    training_prefix = (
        f"training/{args.mode}"
        if artifact_scope == "universal"
        else f"training/{artifact_scope}/{args.mode}"
    )
    export_prefix = (
        f"exports/{args.mode}"
        if artifact_scope == "universal"
        else f"exports/{artifact_scope}/{args.mode}"
    )

    import requests
    from huggingface_hub import HfApi, hf_hub_download, snapshot_download

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

    converter_path = scripts_dir / "build_universal_trainer_metadata.py"
    trainer_path = scripts_dir / "train_arcface_encoder.py"

    if args.trainer_script:
        if not args.trainer_script.is_file():
            raise FileNotFoundError(f"trainer script not found: {args.trainer_script}")
        shutil.copy2(args.trainer_script, trainer_path)
    else:
        download(TRAINER, trainer_path)

    pokemon_baseline_path = None
    if "pokemon" in selected_games and not args.skip_pokemon_baseline:
        pokemon_baseline_path = Path(hf_hub_download(
            repo_id=args.hub_repo,
            repo_type="model",
            revision=args.catalog_revision,
            filename=args.pokemon_baseline_path_in_repo,
            token=token,
        ))
        print(f"using Pokemon production baseline {pokemon_baseline_path}", flush=True)

    prepared_catalogs = False
    if not args.refresh_catalogs:
        try:
            hub_dir = Path(snapshot_download(
                repo_id=args.hub_repo,
                repo_type="model",
                revision=args.catalog_revision,
                allow_patterns="catalogs/**",
                local_dir=work / "hub",
                token=token,
            )) / "catalogs"
            required = [
                hub_dir / game / "CardsIndexMetadata.json"
                for game in selected_games
            ]
            if not all(path.is_file() for path in required):
                raise FileNotFoundError("prepared Hub catalogs are incomplete")
            shutil.copytree(hub_dir, normalized_dir, dirs_exist_ok=True)
            prepared_catalogs = True
            print(
                f"using prepared catalogs from {args.hub_repo}@{args.catalog_revision}",
                flush=True,
            )
        except Exception as error:
            print(f"prepared catalogs unavailable; rebuilding: {error}", flush=True)

    bulk_metadata = None
    if not prepared_catalogs:
        source_paths = {
            "pokemon": source_dir / "pokemon.json",
            "magic": source_dir / "magic-default-cards.json",
            "yugioh": source_dir / "yugioh.json",
        }
        if "pokemon" in selected_games:
            download(POKEMON_METADATA, source_paths["pokemon"])
        if "magic" in selected_games:
            bulk = requests.get(
                SCRYFALL_BULK,
                headers=REQUEST_HEADERS,
                timeout=60,
            )
            bulk.raise_for_status()
            bulk_metadata = bulk.json()
            magic_download_uri = (
                bulk_metadata.get("download_uri")
                or bulk_metadata.get("jsonl_download_uri")
            )
            if not magic_download_uri:
                raise ValueError("Scryfall bulk-data response has no download URI")
            download(magic_download_uri, source_paths["magic"])
        if "yugioh" in selected_games:
            download(YGOPRODECK_CARDS, source_paths["yugioh"])
        download(CONVERTER, converter_path)
        converter_command = [
            sys.executable,
            str(converter_path),
        ]
        converter_flags = {
            "pokemon": "--pokemon",
            "magic": "--mtg",
            "yugioh": "--yugioh",
        }
        for game in selected_games:
            converter_command.extend([converter_flags[game], str(source_paths[game])])
        converter_command.extend(["--output", str(normalized_dir)])
        run(converter_command)

    run_config = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "games": list(selected_games),
        "artifactScope": artifact_scope,
        "trainingPrefix": training_prefix,
        "exportPrefix": export_prefix,
        "epochs": epochs,
        "limitPerGame": limit,
        "batch": args.batch,
        "preparedCatalogs": prepared_catalogs,
        "catalogRevision": args.catalog_revision,
        "pokemonBaseline": (
            args.pokemon_baseline_path_in_repo if pokemon_baseline_path else None
        ),
        "catalogs": {
            game: value
            for game, value in {
                "pokemon": POKEMON_METADATA,
                "magic": {
                    "endpoint": SCRYFALL_BULK,
                    "updatedAt": (
                        bulk_metadata.get("updated_at") if bulk_metadata else None
                    ),
                    "downloadURI": (
                        bulk_metadata.get("download_uri")
                        or bulk_metadata.get("jsonl_download_uri")
                    ) if bulk_metadata else None,
                },
                "yugioh": YGOPRODECK_CARDS,
            }.items()
            if game in selected_games
        },
    }
    run_config_path = work / "run-config.json"
    with open(run_config_path, "w", encoding="utf-8") as output:
        json.dump(run_config, output, indent=2)

    if not prepared_catalogs:
        api.upload_folder(
            folder_path=str(normalized_dir),
            path_in_repo="catalogs",
            repo_id=args.hub_repo,
            repo_type="model",
        )
    # This scoped early upload verifies write permission without replacing the
    # global catalog manifest with a specialized-run configuration.
    api.upload_file(
        path_or_fileobj=str(run_config_path),
        path_in_repo=f"runs/{artifact_scope}/{args.mode}/run-config.json",
        repo_id=args.hub_repo,
        repo_type="model",
    )

    trainer_command = [
        sys.executable,
        str(trainer_path),
        "--epochs", str(epochs),
        "--batch", str(args.batch),
        "--hub-repo", args.hub_repo,
        "--hub-path-prefix", training_prefix,
    ]
    for game in selected_games:
        trainer_command.extend([
            "--metadata",
            str(normalized_dir / game / "CardsIndexMetadata.json"),
        ])
    if limit:
        trainer_command.extend(["--limit-per-game", str(limit)])
    if pokemon_baseline_path:
        trainer_command.extend([
            "--pokemon-baseline-onnx", str(pokemon_baseline_path),
        ])
    trainer_env = os.environ.copy()
    trainer_env["TCGER_CACHE_DIR"] = str(cache_dir)
    trainer_env["TCGER_OUTPUT_DIR"] = str(output_dir)
    run(trainer_command, env=trainer_env)

    shutil.copy2(normalized_dir / "provenance.json", output_dir / "provenance.json")
    shutil.copy2(run_config_path, output_dir / "run-config.json")
    api.upload_folder(
        folder_path=str(output_dir),
        path_in_repo=export_prefix,
        repo_id=args.hub_repo,
        repo_type="model",
    )
    print(f"results: https://huggingface.co/{args.hub_repo}", flush=True)


if __name__ == "__main__":
    main()
