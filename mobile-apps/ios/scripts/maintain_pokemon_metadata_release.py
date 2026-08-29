#!/usr/bin/env python3
"""Refresh, build, and verify the locked physical Pokemon metadata release.

``refresh`` is the only networked operation. It turns one immutable TCGdex
commit into a small semantic set registry, binds that registry, the tracked
Pokemon catalog, the optional reviewed family overlay, and this builder by
SHA-256, then records the expected release hashes.

``build`` and ``verify`` are network-free. They fail if any input or the
builder differs from the reviewed lock, and they require byte-identical output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import build_universal_trainer_metadata as metadata_builder


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = Path(__file__).resolve()
BUILDER_PATH = SCRIPT_PATH.with_name("build_universal_trainer_metadata.py")
LOCK_DIR = SCRIPT_PATH.with_name("metadata-locks")
DEFAULT_LOCK = LOCK_DIR / "pokemon-physical-v2.lock.json"
DEFAULT_REGISTRY = LOCK_DIR / "pokemon-set-release-dates.json"
DEFAULT_CATALOG = (
    REPO_ROOT
    / "mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/CardsIndexMetadata.json"
)
DEFAULT_OUTPUT = REPO_ROOT / ".artifacts/pokemon-metadata-locked/catalogs"
SOURCE_LOCK_SCHEMA = "tcger-pokemon-metadata-source-lock-v1"
SET_REGISTRY_SCHEMA = "tcger-pokemon-set-release-registry-v1"
TCGDEX_REPOSITORY = "tcgdex/cards-database"
REQUEST_HEADERS = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "TCGer/1.0 (https://github.com/ahzs645/TCGer)",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checked_repo_path(path: Path) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(REPO_ROOT)
    except ValueError as error:
        raise ValueError(f"locked source must live under the repository: {resolved}") from error
    return resolved


def repo_relative(path: Path) -> str:
    return str(checked_repo_path(path).relative_to(REPO_ROOT))


def path_from_lock(value: str) -> Path:
    return checked_repo_path(REPO_ROOT / value)


def write_json_atomic(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def download_tcgdex_archive(revision: str, destination: Path) -> str:
    if not re.fullmatch(r"[0-9a-fA-F]{40}", revision):
        raise ValueError("TCGdex revision must be a full 40-character commit SHA")
    url = f"https://api.github.com/repos/{TCGDEX_REPOSITORY}/tarball/{revision.lower()}"
    request = urllib.request.Request(url, headers=REQUEST_HEADERS)
    with urllib.request.urlopen(request, timeout=120) as response:
        with destination.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    return url


def load_lock(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != SOURCE_LOCK_SCHEMA:
        raise ValueError(f"unsupported Pokemon metadata lock: {payload.get('schema')!r}")
    if payload.get("profile") != "physical":
        raise ValueError("release lock must use the physical Pokemon profile")
    return payload


def run_builder(lock_path: Path, output: Path, lock: dict) -> None:
    inputs = lock["inputs"]
    command = [
        sys.executable,
        str(BUILDER_PATH),
        "--pokemon",
        str(path_from_lock(inputs["pokemonCatalog"]["path"])),
        "--pokemon-sets",
        str(path_from_lock(inputs["pokemonSetRegistry"]["path"])),
        "--pokemon-source-lock",
        str(lock_path),
        "--pokemon-profile",
        "physical",
        "--output",
        str(output),
    ]
    overlay = inputs.get("pokemonFamilyOverlay")
    if overlay:
        command.extend(
            ["--pokemon-family-overlay", str(path_from_lock(overlay["path"]))]
        )
    try:
        subprocess.run(command, check=True, text=True, capture_output=True)
    except subprocess.CalledProcessError as error:
        if error.stdout:
            print(error.stdout, file=sys.stderr, end="")
        if error.stderr:
            print(error.stderr, file=sys.stderr, end="")
        raise


def release_outputs(output: Path) -> dict:
    paths = {
        "pokemonCatalog": output / "pokemon/CardsIndexMetadata.json",
        "universalCatalog": output / "CardsIndexMetadata-universal.json",
        "provenance": output / "provenance.json",
    }
    for name, path in paths.items():
        if not path.is_file():
            raise FileNotFoundError(f"metadata builder did not create {name}: {path}")
    rows = json.loads(paths["pokemonCatalog"].read_text(encoding="utf-8"))
    return {
        name: {
            "path": str(path.relative_to(output)),
            "sha256": sha256(path),
            **({"rows": len(rows)} if name == "pokemonCatalog" else {}),
        }
        for name, path in paths.items()
    }


def verify_outputs(output: Path, expected: dict) -> dict:
    actual = release_outputs(output)
    if actual != expected:
        raise ValueError(
            "Pokemon metadata output does not match the source lock\n"
            f"expected={json.dumps(expected, sort_keys=True)}\n"
            f"actual={json.dumps(actual, sort_keys=True)}"
        )
    return actual


def refresh(args: argparse.Namespace) -> None:
    catalog = checked_repo_path(args.pokemon_catalog)
    registry_path = checked_repo_path(args.registry)
    lock_path = checked_repo_path(args.lock)
    overlay_path = checked_repo_path(args.pokemon_family_overlay) if args.pokemon_family_overlay else None
    created_at = metadata_builder.normalize_created_at(args.created_at)

    with tempfile.TemporaryDirectory(prefix="tcger-pokemon-metadata-refresh-") as temporary:
        temporary_root = Path(temporary)
        archive_path = temporary_root / "tcgdex-cards-database.tar.gz"
        archive_url = download_tcgdex_archive(args.tcgdex_revision, archive_path)
        release_dates = metadata_builder.pokemon_set_release_dates(archive_path)
        registry = {
            "schema": SET_REGISTRY_SCHEMA,
            "source": {
                "archiveURL": archive_url,
                "repository": TCGDEX_REPOSITORY,
                "revision": args.tcgdex_revision.lower(),
            },
            "sets": [
                {"id": set_id, "releaseDate": release_dates[set_id]}
                for set_id in sorted(release_dates)
            ],
        }
        write_json_atomic(registry_path, registry)

        inputs = {
            "pokemonCatalog": {
                "path": repo_relative(catalog),
                "sha256": sha256(catalog),
            },
            "pokemonSetRegistry": {
                "path": repo_relative(registry_path),
                "sha256": sha256(registry_path),
                "repository": TCGDEX_REPOSITORY,
                "revision": args.tcgdex_revision.lower(),
                "sets": len(release_dates),
            },
            "pokemonFamilyOverlay": (
                {
                    "path": repo_relative(overlay_path),
                    "sha256": sha256(overlay_path),
                }
                if overlay_path else None
            ),
        }
        lock = {
            "schema": SOURCE_LOCK_SCHEMA,
            "profile": "physical",
            "createdAt": created_at,
            "builder": {
                "path": repo_relative(BUILDER_PATH),
                "sha256": sha256(BUILDER_PATH),
            },
            "inputs": inputs,
        }
        provisional_lock = temporary_root / "pokemon-source-lock.json"
        write_json_atomic(provisional_lock, lock)
        run_builder(provisional_lock, args.output, lock)
        lock["outputs"] = release_outputs(args.output)
        write_json_atomic(lock_path, lock)
        verify_outputs(args.output, lock["outputs"])

    print(
        json.dumps(
            {
                "status": "refreshed",
                "lock": str(lock_path),
                "registry": str(registry_path),
                "output": str(args.output.resolve()),
                "rows": lock["outputs"]["pokemonCatalog"]["rows"],
                "catalogSHA256": lock["outputs"]["pokemonCatalog"]["sha256"],
            },
            indent=2,
        )
    )


def build(lock_path: Path, output: Path) -> dict:
    lock_path = checked_repo_path(lock_path)
    lock = load_lock(lock_path)
    run_builder(lock_path, output, lock)
    actual = verify_outputs(output, lock["outputs"])
    return {
        "status": "verified",
        "lock": str(lock_path),
        "output": str(output.resolve()),
        "rows": actual["pokemonCatalog"]["rows"],
        "catalogSHA256": actual["pokemonCatalog"]["sha256"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    refresh_parser = subparsers.add_parser(
        "refresh",
        help="networked maintainer operation: refresh the semantic registry and source lock",
    )
    refresh_parser.add_argument("--tcgdex-revision", required=True)
    refresh_parser.add_argument("--created-at", help="reviewed release timestamp with timezone")
    refresh_parser.add_argument("--pokemon-catalog", type=Path, default=DEFAULT_CATALOG)
    refresh_parser.add_argument("--pokemon-family-overlay", type=Path)
    refresh_parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    refresh_parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    refresh_parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)

    build_parser = subparsers.add_parser(
        "build",
        help="offline locked build into an explicit output directory",
    )
    build_parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    build_parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)

    verify_parser = subparsers.add_parser(
        "verify",
        help="offline clean-room rebuild and exact output-hash comparison",
    )
    verify_parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)

    args = parser.parse_args()
    if args.command == "refresh":
        refresh(args)
    elif args.command == "build":
        print(json.dumps(build(args.lock, args.output), indent=2))
    else:
        with tempfile.TemporaryDirectory(prefix="tcger-pokemon-metadata-verify-") as temporary:
            print(json.dumps(build(args.lock, Path(temporary) / "catalogs"), indent=2))


if __name__ == "__main__":
    main()
