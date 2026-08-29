# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "huggingface-hub>=1.3.0",
# ]
# ///
"""Audit a locally prepared representative pack, then launch one GPU job.

Image discovery, selection, downloading, and validation must already be complete
on operator-owned storage. The Hugging Face CLI stages the bounded directory as
a read-only mounted volume before allocating the GPU; the training process never
downloads upstream card images or snapshots an image dataset repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from huggingface_hub import HfApi


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SYNC_SCRIPT = REPO_ROOT / "tools/scanner-image-library/sync_training_image_library.py"
DEFAULT_TRAINER = Path(__file__).with_name("train_arcface_encoder.py")
DEFAULT_WRAPPER = Path(__file__).with_name("run_universal_arcface_hf_job.py")


def run(command: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(command), flush=True)
    return subprocess.run(command, check=True, text=True, capture_output=capture)


def read_pack_contract(root: Path, max_images: int) -> dict:
    contract = json.loads((root / "library.json").read_text(encoding="utf-8"))
    coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
    policy = contract.get("selectionPolicy") or {}
    if policy.get("mode") != "recognition-family-cap-v1":
        raise RuntimeError("prepared pack does not use recognition-family-cap-v1")
    if policy.get("trainingSamplesPerFamily") != 1:
        raise RuntimeError("prepared pack must use one training sample per family")
    selected = int(policy.get("selectedRows") or 0)
    if selected < 1 or selected > max_images:
        raise RuntimeError(f"prepared pack selects {selected} images; maximum is {max_images}")
    if coverage.get("status") != "ready" or coverage.get("counts", {}).get("valid") != selected:
        raise RuntimeError("prepared pack coverage is incomplete")
    manifest = root / str(contract.get("manifest") or "manifest.jsonl")
    manifest_sha = hashlib.sha256(manifest.read_bytes()).hexdigest()
    if manifest_sha != contract.get("manifestSHA256"):
        raise RuntimeError("prepared pack manifest SHA-256 mismatch")
    return {
        "manifestSHA256": manifest_sha,
        "catalogRows": int(policy.get("catalogRows") or selected),
        "selectedRows": selected,
        "selectionPolicy": policy,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=("pokemon", "magic", "yugioh"), required=True)
    parser.add_argument("--model-repo", default="ahzs645/tcger-universal-arcface")
    parser.add_argument("--bundle-revision", required=True)
    parser.add_argument("--prepared-image-library-root", type=Path, required=True)
    parser.add_argument("--artifact-variant", required=True)
    parser.add_argument("--training-flavor", default="l4x1")
    parser.add_argument("--training-timeout", default="24h")
    parser.add_argument("--max-prepared-images", type=int, default=75_000)
    parser.add_argument("--sync-script", type=Path, default=DEFAULT_SYNC_SCRIPT)
    parser.add_argument("--trainer-script", type=Path, default=DEFAULT_TRAINER)
    parser.add_argument("--wrapper-script", type=Path, default=DEFAULT_WRAPPER)
    parser.add_argument("--workdir", type=Path, default=Path("/tmp/tcger-two-stage-launch"))
    args = parser.parse_args()

    if not re.fullmatch(r"[0-9a-fA-F]{40}", args.bundle_revision):
        parser.error("--bundle-revision must be an immutable 40-character commit SHA")
    if args.max_prepared_images < 1:
        parser.error("--max-prepared-images must be positive")
    release = args.prepared_image_library_root.resolve()
    for required in (release, args.sync_script, args.trainer_script, args.wrapper_script):
        if not required.exists():
            parser.error(f"required local input does not exist: {required}")

    # This audit reads only local deterministic shards and runs before any GPU
    # allocation or remote job submission.
    run([sys.executable, str(args.sync_script), "audit", "--root", str(release)])
    pack = read_pack_contract(release, args.max_prepared_images)

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is required")
    args.workdir.mkdir(parents=True, exist_ok=True)

    child_args = [
        "--hub-repo", args.model_repo,
        "--mode", "full",
        "--games", args.game,
        "--artifact-variant", args.artifact_variant,
        "--catalog-revision", args.bundle_revision,
        "--trainer-script", "/inputs/code/train_arcface_encoder.py",
        "--prepared-image-library-root", "/inputs/image-library",
        "--max-prepared-images", str(args.max_prepared_images),
    ]
    if args.game != "pokemon":
        child_args.append("--skip-pokemon-baseline")

    # Local-directory volumes are synchronized by the local CLI before job
    # creation and mounted read-only. The GPU process receives files, not a
    # catalog of remote image URLs to download.
    command = [
        "hf", "jobs", "uv", "run",
        "--flavor", args.training_flavor,
        "--timeout", args.training_timeout,
        "--detach",
        "--name", f"tcger-{args.game}-{args.artifact_variant}",
        "--label", "pipeline=tcger-two-stage-recognition-v1",
        "--label", f"game={args.game}",
        "--label", "stage=train",
        "--secrets", "HF_TOKEN",
        "--volume", f"{release}:/inputs/image-library:ro",
        "--volume", f"{args.trainer_script.parent.resolve()}:/inputs/code:ro",
        "--",
        str(args.wrapper_script.resolve()),
        *child_args,
    ]
    completed = run(command, capture=True)
    print(completed.stdout, end="", flush=True)
    match = re.search(r"\b[0-9a-f]{24}\b", completed.stdout)
    if not match:
        raise RuntimeError("Hugging Face CLI did not return a job ID")
    job_id = match.group(0)

    state = {
        "schemaVersion": 2,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "status": "training-submitted",
        "recognitionContract": "tcger-two-stage-recognition-v1",
        "imageAcquisitionBoundary": "local-before-job",
        "game": args.game,
        "bundleRevision": args.bundle_revision,
        "catalogPath": f"catalogs/{args.game}/CardsIndexMetadata.json",
        "preparedImagePack": pack,
        "training": {
            "jobId": job_id,
            "url": f"https://huggingface.co/jobs/{args.model_repo.split('/', 1)[0]}/{job_id}",
            "flavor": args.training_flavor,
            "timeout": args.training_timeout,
            "artifactVariant": args.artifact_variant,
        },
    }
    state_path = args.workdir / "pipeline-state.json"
    state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    HfApi(token=token).upload_file(
        path_or_fileobj=str(state_path),
        path_in_repo=f"runs/{args.game}/full/{args.artifact_variant}/pipeline-state.json",
        repo_id=args.model_repo,
        repo_type="model",
        commit_message=f"Record {args.game} bounded-pack training submission",
    )
    print(json.dumps(state, indent=2), flush=True)


if __name__ == "__main__":
    main()
