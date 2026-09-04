#!/usr/bin/env python3
"""Publish large geometry releases to one immutable private Hub revision."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any

from corpus_release import load_json, sha256_file


TRANSPORT_LAYOUT_FILE = "_transport-layout.v1.json"
TRANSPORT_LAYOUT_SCHEMA = "https://tcger.app/datasets/card-geometry-transport-layout/v1"
MAX_HUB_DIRECTORY_FILES = 10_000
SHARD_PREFIX_LENGTH = 2


def _transport_path(relative: Path, sharded_directories: set[str]) -> Path:
    if len(relative.parts) == 2 and relative.parts[0] in sharded_directories:
        shard = hashlib.sha256(relative.as_posix().encode("utf-8")).hexdigest()[
            :SHARD_PREFIX_LENGTH
        ]
        return Path(relative.parts[0], shard, relative.parts[1])
    return relative


def _sharded_directories(source: Path) -> set[str]:
    counts: dict[str, int] = {}
    for item in source.iterdir():
        if item.is_dir():
            counts[item.name] = sum(1 for child in item.iterdir() if child.is_file())
    return {
        directory
        for directory, count in counts.items()
        if count > MAX_HUB_DIRECTORY_FILES
    }


def stage_release(source: Path, staging: Path, remote_path: str) -> int:
    if remote_path.startswith("/") or ".." in Path(remote_path).parts:
        raise ValueError(f"unsafe remote release path: {remote_path}")
    if not (source / "manifest.json").is_file():
        raise ValueError(f"release has no manifest: {source}")
    destination = staging / remote_path
    if destination.exists():
        raise FileExistsError(f"staged destination already exists: {destination}")
    sharded_directories = _sharded_directories(source)
    count = 0
    for item in sorted(path for path in source.rglob("*") if path.is_file()):
        relative = item.relative_to(source)
        target = destination / _transport_path(relative, sharded_directories)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(item, target)
        except OSError:
            shutil.copy2(item, target)
        count += 1
    if sharded_directories:
        layout = {
            "schema": TRANSPORT_LAYOUT_SCHEMA,
            "algorithm": "sha256-relative-path-prefix",
            "prefixLength": SHARD_PREFIX_LENGTH,
            "directories": sorted(sharded_directories),
        }
        (destination / TRANSPORT_LAYOUT_FILE).write_text(
            json.dumps(layout, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        count += 1
    return count


def publish(
    *, repo_id: str, releases: list[tuple[Path, str]], staging: Path, workers: int
) -> dict[str, Any]:
    from huggingface_hub import HfApi, get_token, hf_hub_download

    token = get_token()
    if not token:
        raise RuntimeError("a local Hugging Face token is required")
    if staging.exists() and any(staging.iterdir()):
        raise FileExistsError(f"refusing non-empty staging directory: {staging}")
    staging.mkdir(parents=True, exist_ok=True)
    staged = {}
    for source, remote in releases:
        manifest = load_json(source / "manifest.json")
        staged[remote] = {
            "files": stage_release(source, staging, remote),
            "corpusHash": manifest["corpusHash"],
            "manifestSha256": sha256_file(source / "manifest.json"),
        }
    api = HfApi(token=token)
    info = api.repo_info(repo_id=repo_id, repo_type="dataset")
    if not bool(getattr(info, "private", False)):
        raise RuntimeError(f"dataset repo must already be private: {repo_id}")
    api.upload_large_folder(
        repo_id=repo_id,
        repo_type="dataset",
        folder_path=staging,
        num_workers=workers,
        print_report=True,
        print_report_every=60,
    )
    revision = str(api.repo_info(repo_id=repo_id, repo_type="dataset").sha)
    for remote, value in staged.items():
        downloaded = Path(
            hf_hub_download(
                repo_id=repo_id,
                repo_type="dataset",
                revision=revision,
                filename=f"{remote}/manifest.json",
                token=token,
            )
        )
        if sha256_file(downloaded) != value["manifestSha256"]:
            raise RuntimeError(f"published manifest hash mismatch: {remote}")
    return {
        "schema": "https://tcger.app/reports/card-geometry-release-publication/v1",
        "datasetRepo": repo_id,
        "datasetRevision": revision,
        "releases": staged,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-repo", default="ahzs645/tcger-scanner-images")
    parser.add_argument(
        "--release",
        action="append",
        required=True,
        help="LOCAL_PATH=REMOTE_PATH",
    )
    parser.add_argument("--staging", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    releases = []
    for value in args.release:
        local, separator, remote = value.partition("=")
        if not separator or not local or not remote:
            parser.error("--release must be LOCAL_PATH=REMOTE_PATH")
        releases.append((Path(local), remote.strip("/")))
    report = publish(
        repo_id=args.dataset_repo,
        releases=releases,
        staging=args.staging,
        workers=args.workers,
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
