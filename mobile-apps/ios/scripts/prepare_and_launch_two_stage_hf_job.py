# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "huggingface-hub>=1.3.0",
#   "pillow>=10.0",
# ]
# ///
"""Materialize a pinned image library, then launch one isolated GPU trainer.

This CPU preparation job is intentionally the only component allowed to start
the paid child job. The child is submitted only after the catalog images have
100% validated coverage, the deterministic release audits successfully, and
the uploaded dataset returns an immutable commit SHA.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download


def run(command: list[str]) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=("pokemon", "magic", "yugioh"), required=True)
    parser.add_argument("--model-repo", default="ahzs645/tcger-universal-arcface")
    parser.add_argument("--image-repo", default="ahzs645/tcger-scanner-images")
    parser.add_argument("--bundle-revision", required=True)
    parser.add_argument("--code-prefix", required=True)
    parser.add_argument("--release-path", required=True)
    parser.add_argument("--artifact-variant", required=True)
    parser.add_argument("--workers", type=int, default=32)
    parser.add_argument("--training-flavor", default="l4x1")
    parser.add_argument("--training-timeout", default="24h")
    parser.add_argument("--workdir", type=Path, default=Path("/tmp/tcger-two-stage-prep"))
    args = parser.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is required")
    api = HfApi(token=token)
    work = args.workdir
    release = work / "release"
    cache = work / "blob-cache"
    work.mkdir(parents=True, exist_ok=True)

    def model_file(relative: str) -> Path:
        return Path(hf_hub_download(
            repo_id=args.model_repo,
            repo_type="model",
            revision=args.bundle_revision,
            filename=relative,
            token=token,
        ))

    catalog = model_file(f"catalogs/{args.game}/CardsIndexMetadata.json")
    sync_script = model_file(
        f"{args.code_prefix}/sync_training_image_library.py"
    )
    wrapper_script = model_file(
        f"{args.code_prefix}/run_universal_arcface_hf_job.py"
    )
    trainer_repo_path = f"{args.code_prefix}/train_arcface_encoder.py"
    trainer_script = model_file(trainer_repo_path)

    run([
        sys.executable,
        str(sync_script),
        "sync",
        "--catalog", str(catalog),
        "--source-revision", f"{args.game}={args.bundle_revision}",
        "--blob-cache", str(cache),
        "--output", str(release),
        "--workers", str(args.workers),
    ])
    run([sys.executable, str(sync_script), "audit", "--root", str(release)])

    api.create_repo(
        repo_id=args.image_repo,
        repo_type="dataset",
        private=True,
        exist_ok=True,
    )
    image_commit = api.upload_folder(
        folder_path=str(release),
        path_in_repo=args.release_path.strip("/"),
        repo_id=args.image_repo,
        repo_type="dataset",
        commit_message=f"Add {args.game} two-stage scanner image release",
    )
    image_revision = image_commit.oid
    if not image_revision:
        image_revision = api.repo_info(
            repo_id=args.image_repo, repo_type="dataset"
        ).sha
    if not image_revision or len(image_revision) != 40:
        raise RuntimeError("image upload did not return an immutable commit SHA")

    child_args = [
        "--hub-repo", args.model_repo,
        "--mode", "full",
        "--games", args.game,
        "--artifact-variant", args.artifact_variant,
        "--catalog-revision", args.bundle_revision,
        # Pass the downloaded pinned trainer as a real local attachment. The
        # Jobs client treats any .py-valued script argument as a file to bundle;
        # passing the Hub-relative name here made it reject the child before
        # submission because that relative path did not exist in this process.
        "--trainer-script", str(trainer_script),
        "--image-library-repo", args.image_repo,
        "--image-library-revision", image_revision,
        "--image-library-path-in-repo", args.release_path.strip("/"),
    ]
    if args.game != "pokemon":
        child_args.append("--skip-pokemon-baseline")
    child = api.run_uv_job(
        str(wrapper_script),
        script_args=child_args,
        flavor=args.training_flavor,
        timeout=args.training_timeout,
        name=f"tcger-{args.game}-{args.artifact_variant}",
        labels={
            "pipeline": "tcger-two-stage-recognition-v1",
            "game": args.game,
            "stage": "train",
        },
        secrets={"HF_TOKEN": token},
    )

    state = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "status": "training-submitted",
        "recognitionContract": "tcger-two-stage-recognition-v1",
        "game": args.game,
        "bundleRevision": args.bundle_revision,
        "catalogPath": f"catalogs/{args.game}/CardsIndexMetadata.json",
        "imageLibrary": {
            "repo": args.image_repo,
            "revision": image_revision,
            "path": args.release_path.strip("/"),
        },
        "training": {
            "jobId": child.id,
            "flavor": args.training_flavor,
            "timeout": args.training_timeout,
            "artifactVariant": args.artifact_variant,
        },
    }
    state_path = work / "pipeline-state.json"
    state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    api.upload_file(
        path_or_fileobj=str(state_path),
        path_in_repo=f"runs/{args.game}/full/{args.artifact_variant}/pipeline-state.json",
        repo_id=args.model_repo,
        repo_type="model",
        commit_message=f"Record {args.game} two-stage training submission",
    )
    print(json.dumps(state, indent=2), flush=True)


if __name__ == "__main__":
    main()
