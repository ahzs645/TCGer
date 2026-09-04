#!/usr/bin/env python3
"""Launch private exports against immutable completed-training identities."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from launch_geometry_bakeoff import bootstrap_command, checked_git_revision
from run_card_geometry_hf_job import descriptor, load_json, resolve_config, sha256_file


SCHEMA_ID = "https://tcger.app/reports/card-geometry-export-launch/v1"
REPOSITORY = Path(__file__).resolve().parents[2]


def validate_training_identity(
    launch: dict[str, Any], candidate: str, raw_config: dict[str, Any]
) -> dict[str, Any]:
    experiments = launch.get("experiments") or {}
    if candidate not in experiments:
        raise ValueError(f"training launch has no candidate {candidate!r}")
    resolved = resolve_config(raw_config)
    actual = descriptor(resolved)
    expected = experiments[candidate]
    for field in ("candidate", "experimentHash", "checkpointPrefix", "corpusHash"):
        if actual.get(field) != expected.get(field):
            raise ValueError(
                f"training identity mismatch for {candidate} {field}: "
                f"{actual.get(field)!r} != {expected.get(field)!r}"
            )
    return actual


def launch_exports(args: argparse.Namespace) -> dict[str, Any]:
    from huggingface_hub import CommitOperationAdd, HfApi, get_token, hf_hub_download

    training = load_json(args.training_launch_report)
    if training.get("schema") != "https://tcger.app/reports/card-geometry-bakeoff-launch/v1":
        raise ValueError("not a card-geometry training launch report")
    training_input_commit = str(training["inputCommit"])
    training_tooling_revision = str(training["toolingRevision"])
    corpus_hash = str(training["corpusHash"])
    export_tooling_revision = checked_git_revision()
    candidates = args.candidate or sorted(training["experiments"])
    token = get_token()
    if not token:
        raise RuntimeError("a local Hugging Face token is required")
    api = HfApi(token=token)
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        tooling = root / "card-geometry-tooling.tar.gz"
        subprocess.run(
            [
                "git",
                "archive",
                "--format=tar.gz",
                f"--output={tooling}",
                export_tooling_revision,
                "tools/card-geometry",
                "docs/scanner-system",
            ],
            cwd=REPOSITORY,
            check=True,
        )
        tooling_sha = sha256_file(tooling)
        tooling_path = (
            f"geometry/tooling/{export_tooling_revision}/card-geometry-tooling.tar.gz"
        )
        commit = api.create_commit(
            repo_id=args.checkpoint_repo,
            repo_type="model",
            operations=[
                CommitOperationAdd(path_in_repo=tooling_path, path_or_fileobj=tooling)
            ],
            commit_message=f"geometry export tooling {export_tooling_revision[:12]}",
        )
        export_input_commit = str(commit.oid)
    jobs = []
    inputs = {}
    for candidate in candidates:
        config_path = (
            f"geometry/bakeoffs/{training_tooling_revision}/{corpus_hash}/{candidate}.json"
        )
        config_file = Path(
            hf_hub_download(
                repo_id=args.checkpoint_repo,
                repo_type="model",
                filename=config_path,
                revision=training_input_commit,
                token=token,
            )
        )
        config_sha = sha256_file(config_file)
        raw_config = load_json(config_file)
        identity = validate_training_identity(training, candidate, raw_config)
        preflight = raw_config["corpus"]["preflightReport"]
        command = bootstrap_command(
            candidate=candidate,
            checkpoint_repo=args.checkpoint_repo,
            hub_revision=export_input_commit,
            tooling_path=tooling_path,
            tooling_sha=tooling_sha,
            config_path=config_path,
            config_sha=config_sha,
            pipeline_smoke=False,
            preflight_path=preflight["path"],
            preflight_sha=preflight["sha256"],
            action="export",
            export_format=args.export_format,
            training_input_revision=training_input_commit,
        )
        job = api.run_job(
            image=raw_config["execution"]["containerImage"],
            command=command,
            secrets={"HF_TOKEN": token},
            flavor="l4x1",
            timeout="6h",
            name=f"geometry-{candidate}-export-{args.export_format}-pinned",
        )
        inputs[candidate] = {
            "configPath": config_path,
            "configSha256": config_sha,
            "experimentHash": identity["experimentHash"],
            "checkpointPrefix": identity["checkpointPrefix"],
        }
        jobs.append(
            {
                "candidate": candidate,
                "format": args.export_format,
                "id": job.id,
                "url": job.url,
            }
        )
    return {
        "schema": SCHEMA_ID,
        "format": args.export_format,
        "checkpointRepo": args.checkpoint_repo,
        "corpusHash": corpus_hash,
        "trainingInputCommit": training_input_commit,
        "trainingToolingRevision": training_tooling_revision,
        "exportInputCommit": export_input_commit,
        "exportToolingRevision": export_tooling_revision,
        "exportToolingSha256": tooling_sha,
        "inputs": inputs,
        "jobs": jobs,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--training-launch-report", type=Path, required=True)
    parser.add_argument("--export-format", choices=("onnx", "coreml"), required=True)
    parser.add_argument("--candidate", action="append", default=[])
    parser.add_argument("--checkpoint-repo", default="ahzs645/tcger-universal-arcface")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report = launch_exports(args)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
