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
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_RAW = (
    "https://raw.githubusercontent.com/ahzs645/TCGer/"
    "main"
)
POKEMON_METADATA = (
    f"{REPO_RAW}/mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/"
    "CardsIndexMetadata.json"
)
TCGDEX_CARDS_DATABASE_REVISION = "d86b5107d09484994f7fa15c45b0af8ffd72e1b0"
POKEMON_SETS = (
    "https://api.github.com/repos/tcgdex/cards-database/tarball/"
    f"{TCGDEX_CARDS_DATABASE_REVISION}"
)
CONVERTER = f"{REPO_RAW}/mobile-apps/ios/scripts/build_universal_trainer_metadata.py"
TRAINER = f"{REPO_RAW}/mobile-apps/ios/scripts/train_arcface_encoder.py"
SCRYFALL_BULK = "https://api.scryfall.com/bulk-data/default-cards"
YGOPRODECK_CARDS = "https://db.ygoprodeck.com/api/v7/cardinfo.php"
ALL_GAMES = ("pokemon", "magic", "yugioh")
DEFAULT_CATALOG_REVISION = "4ae187396e03383a7a9f33816acd1531a7f390dc"
REQUEST_HEADERS = {
    "User-Agent": "TCGer/1.0 (https://github.com/ahzs645/TCGer)",
    "Accept": "application/json;q=0.9,*/*;q=0.8",
}

GENERATED_WORKDIR_NAMES = (
    "source",
    "normalized",
    "outputs",
    "image-library-hub",
    "scripts",
    "hub",
    "CardEmbeddings-arcface.mlpackage",
)


def clean_generated_workdir(work: Path, protected_paths=()) -> list[Path]:
    """Reset exact job-owned children while preserving caches and mounted inputs."""
    work = work.expanduser().resolve()
    filesystem_root = Path(work.anchor)
    script_parents = Path(__file__).resolve().parents
    script_root = script_parents[3] if len(script_parents) > 3 else filesystem_root
    forbidden = {filesystem_root, Path.home().resolve()}
    if script_root != filesystem_root:
        forbidden.add(script_root)
    if work in forbidden or len(work.parts) < 3:
        raise ValueError(f"refusing to clean unsafe workdir: {work}")
    protected = [Path(path).expanduser().resolve() for path in protected_paths if path]
    removed = []
    for name in GENERATED_WORKDIR_NAMES:
        target = work / name
        if any(target == path or target in path.parents for path in protected):
            raise ValueError(
                f"generated workdir target contains a protected input: {target}"
            )
        if target.is_symlink() or target.is_file():
            target.unlink()
            removed.append(target)
        elif target.is_dir():
            shutil.rmtree(target)
            removed.append(target)
    return removed


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


def validate_prepared_runtime_catalog(path: Path, game: str) -> int:
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"prepared {game} catalog is empty")
    if any(row.get("annIndex") != index for index, row in enumerate(rows)):
        raise ValueError(f"prepared {game} catalog has non-contiguous annIndex values")
    if game == "pokemon":
        required = ("format", "setCode", "collectorNumber", "releaseDate", "recognitionFamilyId")
        for index, row in enumerate(rows):
            missing = [
                field for field in required
                if not isinstance(row.get(field), str) or not row[field].strip()
            ]
            image_url = str(row.get("imageURL") or "").casefold()
            if missing:
                raise ValueError(
                    f"prepared Pokemon catalog row {index} lacks runtime metadata: "
                    + ", ".join(missing)
                )
            if row["format"].casefold() != "paper" or "/tcgp/" in image_url:
                raise ValueError(f"prepared Pokemon catalog row {index} is not physical")
    return len(rows)


def validate_prepared_image_pack(root: Path, max_images: int) -> dict:
    """Fail before GPU work unless a mounted pack is bounded and immutable."""
    root = root.resolve()
    contract_path = root / "library.json"
    coverage_path = root / "coverage.json"
    if not contract_path.is_file() or not coverage_path.is_file():
        raise RuntimeError(f"prepared image pack is incomplete: {root}")
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
    policy = contract.get("selectionPolicy") or {}
    if policy.get("mode") != "recognition-family-cap-v1":
        raise RuntimeError(
            "full runs require a recognition-family-capped prepared image pack"
        )
    if policy.get("trainingSamplesPerFamily") != 1:
        raise RuntimeError("production packs must select exactly one training image per family")
    selected = int(policy.get("selectedRows") or 0)
    if selected < 1 or selected > max_images:
        raise RuntimeError(
            f"prepared image pack selects {selected} images; allowed range is 1..{max_images}"
        )
    if coverage.get("status") != "ready" or coverage.get("counts", {}).get("valid") != selected:
        raise RuntimeError("prepared image pack does not have complete selected-image coverage")
    manifest_path = root / str(contract.get("manifest") or "manifest.jsonl")
    manifest_sha = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    if manifest_sha != contract.get("manifestSHA256"):
        raise RuntimeError("prepared image pack manifest SHA-256 mismatch")
    return {
        "source": "mounted-prepared-pack",
        "root": str(root),
        "manifestSHA256": manifest_sha,
        "selectedRows": selected,
        "catalogRows": int(policy.get("catalogRows") or selected),
        "selectionPolicy": policy,
    }


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
    parser.add_argument(
        "--training-views-per-card",
        type=int,
        help=(
            "Training augmentations per identity per epoch. Evaluation remains "
            "at the trainer's default three queries per identity."
        ),
    )
    parser.add_argument(
        "--artifact-variant",
        help=(
            "Optional lowercase path suffix for an isolated experiment. A "
            "training-view override gets a deterministic suffix automatically."
        ),
    )
    parser.add_argument("--workdir", type=Path, default=Path("/tmp/tcger-universal"))
    parser.add_argument(
        "--trainer-script",
        type=Path,
        help="Optional local trainer script; useful for immutable/pinned job bundles",
    )
    parser.add_argument(
        "--trainer-hub-path-in-repo",
        help=(
            "Trainer script stored in --hub-repo at --catalog-revision. This "
            "is the production path for an immutable code/catalog bundle."
        ),
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
        default=DEFAULT_CATALOG_REVISION,
        help="Revision containing catalogs prepared by prepare_universal_arcface_hub.py",
    )
    parser.add_argument(
        "--refresh-catalogs",
        action="store_true",
        help="Ignore prepared Hub catalogs and rebuild them from upstream sources",
    )
    parser.add_argument(
        "--image-library-repo",
        help="Legacy Hub dataset source; disabled unless --allow-job-image-download is set",
    )
    parser.add_argument(
        "--image-library-revision",
        help="Legacy immutable dataset commit; requires --allow-job-image-download",
    )
    parser.add_argument(
        "--image-library-path-in-repo",
        default="release",
        help="Release directory inside --image-library-repo",
    )
    parser.add_argument(
        "--prepared-image-library-root",
        type=Path,
        help=(
            "Read-only family-capped image pack mounted into the job. Full runs "
            "require this path and never fetch upstream image URLs."
        ),
    )
    parser.add_argument(
        "--max-prepared-images",
        type=int,
        default=75_000,
        help="fail closed when a prepared pack exceeds this selected-image count",
    )
    parser.add_argument(
        "--allow-job-image-download",
        action="store_true",
        help="legacy diagnostic escape hatch allowing a Hub image snapshot download",
    )
    parser.add_argument(
        "--allow-unpinned-image-sources",
        action="store_true",
        help=(
            "Quick-mode diagnostic escape hatch for mutable upstream URLs. "
            "Full production runs always reject it."
        ),
    )
    args = parser.parse_args()

    selected_games = tuple(game for game in ALL_GAMES if game in args.games)
    if len(selected_games) != len(args.games):
        parser.error("--games must not contain duplicates")
    if args.training_views_per_card is not None and args.training_views_per_card < 1:
        parser.error("--training-views-per-card must be positive")
    if args.image_library_revision and not re.fullmatch(
        r"[0-9a-fA-F]{40}", args.image_library_revision
    ):
        parser.error("--image-library-revision must be a 40-character commit SHA")
    if (
        args.mode == "full"
        and not re.fullmatch(r"[0-9a-fA-F]{40}", args.catalog_revision)
        and not args.allow_unpinned_image_sources
    ):
        parser.error("full runs require an immutable --catalog-revision commit SHA")
    if args.max_prepared_images < 1:
        parser.error("--max-prepared-images must be positive")
    if args.mode == "full" and not args.prepared_image_library_root:
        parser.error(
            "full runs require --prepared-image-library-root; image acquisition "
            "must finish before the GPU job is submitted"
        )
    if args.mode == "full" and args.allow_unpinned_image_sources:
        parser.error("full runs cannot download mutable upstream image URLs")
    if args.image_library_revision and not args.allow_job_image_download:
        parser.error(
            "Hub image-library downloads are disabled; mount a prepared pack with "
            "--prepared-image-library-root"
        )
    artifact_variant = args.artifact_variant
    if artifact_variant is None and args.training_views_per_card is not None:
        artifact_variant = f"train-views-{args.training_views_per_card}"
    if artifact_variant and not re.fullmatch(r"[a-z0-9][a-z0-9-]*", artifact_variant):
        parser.error("--artifact-variant must contain lowercase letters, digits, or dashes")
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
    run_prefix = f"runs/{artifact_scope}/{args.mode}"
    if artifact_variant:
        training_prefix = f"{training_prefix}/{artifact_variant}"
        export_prefix = f"{export_prefix}/{artifact_variant}"
        run_prefix = f"{run_prefix}/{artifact_variant}"

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

    work = args.workdir.expanduser().resolve()
    removed_work = clean_generated_workdir(
        work,
        protected_paths=[args.prepared_image_library_root, args.trainer_script],
    )
    if removed_work:
        print(
            "cleaned previous generated job artifacts: "
            + ", ".join(path.name for path in removed_work),
            flush=True,
        )
    source_dir = work / "source"
    normalized_dir = work / "normalized"
    output_dir = work / "outputs"
    cache_dir = work / "card-images"
    image_library_hub_dir = work / "image-library-hub"
    scripts_dir = work / "scripts"
    for directory in (source_dir, normalized_dir, output_dir, cache_dir, scripts_dir):
        directory.mkdir(parents=True, exist_ok=True)

    image_library_root = None
    image_library_descriptor = None
    image_library_id = None
    if args.prepared_image_library_root:
        image_library_root = args.prepared_image_library_root.resolve()
        image_library_descriptor = validate_prepared_image_pack(
            image_library_root, args.max_prepared_images
        )
        image_library_id = image_library_descriptor["manifestSHA256"]
        print(
            f"using mounted prepared pack {image_library_root} "
            f"({image_library_descriptor['selectedRows']} selected images)",
            flush=True,
        )
    elif args.image_library_revision:
        if not args.image_library_repo:
            parser.error("--image-library-repo is required with --image-library-revision")
        library_path = args.image_library_path_in_repo.strip("/")
        if not library_path or ".." in Path(library_path).parts:
            parser.error("--image-library-path-in-repo must be a safe relative path")
        downloaded_library = Path(snapshot_download(
            repo_id=args.image_library_repo,
            repo_type="dataset",
            revision=args.image_library_revision,
            allow_patterns=f"{library_path}/**",
            local_dir=image_library_hub_dir,
            token=token,
        ))
        image_library_root = downloaded_library / library_path
        if not (image_library_root / "library.json").is_file():
            raise FileNotFoundError(
                f"pinned image library is incomplete: {image_library_root}"
            )
        print(
            f"using image library {args.image_library_repo}@"
            f"{args.image_library_revision}:{library_path}",
            flush=True,
        )
        image_library_descriptor = {
            "source": "legacy-hub-snapshot-download",
            "repo": args.image_library_repo,
            "revision": args.image_library_revision,
            "path": library_path,
        }
        image_library_id = args.image_library_revision

    converter_path = scripts_dir / "build_universal_trainer_metadata.py"
    trainer_path = scripts_dir / "train_arcface_encoder.py"

    if args.trainer_script and args.trainer_hub_path_in_repo:
        parser.error("choose either --trainer-script or --trainer-hub-path-in-repo")
    if args.trainer_script:
        if not args.trainer_script.is_file():
            raise FileNotFoundError(f"trainer script not found: {args.trainer_script}")
        shutil.copy2(args.trainer_script, trainer_path)
    elif args.trainer_hub_path_in_repo:
        pinned_trainer = hf_hub_download(
            repo_id=args.hub_repo,
            repo_type="model",
            revision=args.catalog_revision,
            filename=args.trainer_hub_path_in_repo,
            token=token,
        )
        shutil.copy2(pinned_trainer, trainer_path)
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
            for game, path in zip(selected_games, required):
                validate_prepared_runtime_catalog(path, game)
            if "pokemon" in selected_games:
                provenance_path = hub_dir / "provenance.json"
                if not provenance_path.is_file():
                    raise FileNotFoundError("prepared Pokemon catalog has no provenance.json")
                provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
                lock = provenance.get("pokemonSourceLock")
                if not isinstance(lock, dict) or lock.get("schema") != "tcger-pokemon-metadata-source-lock-v1":
                    raise ValueError("prepared Pokemon catalog is not source-lock reproducible")
            shutil.copytree(hub_dir, normalized_dir, dirs_exist_ok=True)
            prepared_catalogs = True
            print(
                f"using prepared catalogs from {args.hub_repo}@{args.catalog_revision}",
                flush=True,
            )
        except Exception as error:
            if args.mode == "full":
                raise RuntimeError(
                    "full runs require a valid source-locked catalog at the pinned "
                    "--catalog-revision; run the CPU metadata preflight and pin its "
                    "result before allocating a GPU"
                ) from error
            print(f"prepared catalogs unavailable; rebuilding: {error}", flush=True)

    bulk_metadata = None
    if not prepared_catalogs:
        source_paths = {
            "pokemon": source_dir / "pokemon.json",
            "pokemon_sets": source_dir / "tcgdex-cards-database.tar.gz",
            "magic": source_dir / "magic-default-cards.json",
            "yugioh": source_dir / "yugioh.json",
        }
        if "pokemon" in selected_games:
            download(POKEMON_METADATA, source_paths["pokemon"])
            download(POKEMON_SETS, source_paths["pokemon_sets"])
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
        if "pokemon" in selected_games:
            converter_command.extend(["--pokemon-sets", str(source_paths["pokemon_sets"])])
        converter_command.extend(["--output", str(normalized_dir)])
        run(converter_command)

    run_config = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "games": list(selected_games),
        "artifactScope": artifact_scope,
        "artifactVariant": artifact_variant,
        "trainingPrefix": training_prefix,
        "exportPrefix": export_prefix,
        "epochs": epochs,
        "limitPerGame": limit,
        "batch": args.batch,
        "trainingViewsPerCard": args.training_views_per_card or 3,
        "evaluationViewsPerCard": 3,
        "preparedCatalogs": prepared_catalogs,
        "catalogRevision": args.catalog_revision,
        "trainerHubPathInRepo": args.trainer_hub_path_in_repo,
        "imageLibrary": image_library_descriptor,
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
        path_in_repo=f"{run_prefix}/run-config.json",
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
    if args.training_views_per_card is not None:
        trainer_command.extend([
            "--training-views-per-card",
            str(args.training_views_per_card),
        ])
    if pokemon_baseline_path:
        trainer_command.extend([
            "--pokemon-baseline-onnx", str(pokemon_baseline_path),
        ])
    if image_library_root:
        trainer_command.extend([
            "--image-library-root", str(image_library_root),
            "--image-library-revision", image_library_id,
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
        # Replace only this run's scoped export prefix, in the upload commit,
        # so removed shards/files from an older export cannot survive remotely.
        delete_patterns="*",
    )
    print(f"results: https://huggingface.co/{args.hub_repo}", flush=True)


if __name__ == "__main__":
    main()
