"""Run one pinned card-geometry candidate experiment on Hugging Face Jobs.

The wrapper is intentionally backend-neutral. A resolved JSON config supplies
the candidate-specific train and export commands, while this file owns the
shared invariants: corpus preflight, experiment hashing, private checkpoint
scope, fairness metadata, and the Ultralytics publication gate.

Typical invocation inside an L4 Job:

    python tools/card-geometry/run_card_geometry_hf_job.py \
      --config experiment.json --action train

Use ``--dry-run`` to validate and print the descriptor without downloading a
dataset, accessing the Hub, or executing a backend command.
"""

from __future__ import annotations

import argparse
import copy
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus_release import (
    REPOSITORY,
    SCHEMAS_DIR,
    canonical_json,
    load_json,
    make_validator,
    pretty_json,
    sha256_bytes,
    sha256_file,
    validation_errors,
)
from preflight import Expectations, run_preflight

CONFIG_SCHEMA_ID = "https://tcger.app/schemas/card-geometry-experiment-config/v1"
CONFIG_SCHEMA_FILE = "card-geometry-experiment-config.v1.schema.json"
REPORT_SCHEMA_ID = "https://tcger.app/reports/card-geometry-candidate-run/v1"

CANDIDATES: dict[str, dict[str, str]] = {
    "yolo11n-pose": {"framework": "ultralytics", "licenseFamily": "ultralytics"},
    "yolo11s-pose": {"framework": "ultralytics", "licenseFamily": "ultralytics"},
    "yolox-pose": {"framework": "mmyolo", "licenseFamily": "permissive"},
    "fastvit-t8-four-corner": {
        "framework": "tcger-pytorch",
        "licenseFamily": "permissive",
    },
}

DEFAULTS: dict[str, Any] = {
    "bakeoffId": "shared-card-geometry-licensing-v1",
    "fairness": {
        "inputResolution": 640,
        "augmentationProfile": "shared-card-geometry-v1",
        "seedPolicy": {
            "baseSeed": 20260902,
            "repeatCount": 1,
            "derivation": "base-plus-repeat-index",
        },
    },
    "measurements": {
        "geometryRealV3": True,
        "geometrySyntheticDuelField": True,
        "recognitionReplay": True,
        "exportedBytesPlatforms": ["ios", "android", "web"],
        "physicalLatencyPlatforms": ["ios", "android"],
        "coremlOnnxParity": True,
        "decoderCodeSize": True,
        "l4GpuHours": True,
    },
    "deviations": [],
}


class ConfigurationError(ValueError):
    """The run configuration is invalid or violates a bake-off invariant."""


class PublicationBlocked(RuntimeError):
    """The selected license route does not authorize asset-store publication."""


def _merge_defaults(defaults: Any, supplied: Any) -> Any:
    if not isinstance(defaults, dict) or not isinstance(supplied, dict):
        return copy.deepcopy(supplied)
    merged = copy.deepcopy(defaults)
    for key, value in supplied.items():
        merged[key] = _merge_defaults(merged[key], value) if key in merged else copy.deepcopy(value)
    return merged


def resolve_config(raw: dict[str, Any]) -> dict[str, Any]:
    """Apply defaults, validate Draft 2020-12 schema, and enforce semantics."""
    resolved = _merge_defaults(DEFAULTS, raw)
    validator = make_validator(load_json(SCHEMAS_DIR / CONFIG_SCHEMA_FILE))
    errors = validation_errors(validator, resolved, limit=50)
    if errors:
        raise ConfigurationError("invalid experiment config:\n- " + "\n- ".join(errors))

    candidate = CANDIDATES[resolved["candidate"]]
    if resolved["framework"] != candidate["framework"]:
        raise ConfigurationError(
            f"{resolved['candidate']} requires framework {candidate['framework']!r}"
        )

    route = resolved["licenseRoute"]
    if candidate["licenseFamily"] == "ultralytics":
        if route not in {"evaluation-only", "enterprise", "agpl"}:
            raise ConfigurationError(
                "Ultralytics candidates require evaluation-only, enterprise, or agpl"
            )
    elif route != "permissive":
        raise ConfigurationError(
            f"{resolved['candidate']} uses the permissive publication route"
        )

    return resolved


def experiment_hash(resolved: dict[str, Any]) -> str:
    """Hash the complete resolved config after all defaults are applied."""
    return sha256_bytes(canonical_json(resolved))


def fairness_hash(resolved: dict[str, Any]) -> str:
    """Identify the shared corpus, budget, seed, augmentation, and evaluation rules."""
    shared = {
        "bakeoffId": resolved["bakeoffId"],
        "corpus": resolved["corpus"],
        "fairness": resolved["fairness"],
        "evaluations": resolved["evaluations"],
        "measurements": resolved["measurements"],
    }
    return sha256_bytes(canonical_json(shared))


def checkpoint_prefix(resolved: dict[str, Any], digest: str | None = None) -> str:
    digest = digest or experiment_hash(resolved)
    return (
        f"geometry/{resolved['candidate']}/"
        f"{resolved['corpus']['corpusHash']}/{digest}"
    )


def descriptor(resolved: dict[str, Any]) -> dict[str, Any]:
    digest = experiment_hash(resolved)
    return {
        "schema": REPORT_SCHEMA_ID,
        "bakeoffId": resolved["bakeoffId"],
        "candidate": resolved["candidate"],
        "framework": resolved["framework"],
        "licenseRoute": resolved["licenseRoute"],
        "corpusHash": resolved["corpus"]["corpusHash"],
        "policyId": resolved["corpus"]["policyId"],
        "policySha256": resolved["corpus"]["policySha256"],
        "experimentHash": digest,
        "fairnessHash": fairness_hash(resolved),
        "checkpointPrefix": checkpoint_prefix(resolved, digest),
        "resolvedConfigSha256": digest,
    }


def assert_export_allowed(resolved: dict[str, Any], destination: str) -> None:
    """Refuse an unauthorized asset-store step before an exporter can run."""
    if destination != "asset-store":
        return
    if resolved["licenseRoute"] == "evaluation-only":
        raise PublicationBlocked(
            "asset-store publication is blocked for licenseRoute=evaluation-only"
        )
    if CANDIDATES[resolved["candidate"]]["licenseFamily"] == "ultralytics" and resolved[
        "licenseRoute"
    ] not in {"enterprise", "agpl"}:
        raise PublicationBlocked(
            "Ultralytics asset-store publication requires enterprise or agpl"
        )


def _safe_workdir(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    if resolved in {Path(resolved.anchor), Path.home().resolve()} or len(resolved.parts) < 3:
        raise ConfigurationError(f"unsafe workdir: {resolved}")
    return resolved


def _verify_local_artifacts(resolved: dict[str, Any]) -> None:
    artifacts = {
        "evaluationScript": resolved["fairness"]["evaluationScript"],
        "recognitionReplay": resolved["evaluations"]["recognitionReplay"],
        "goldenFixtures": resolved["evaluations"]["goldenFixtures"],
    }
    for label, artifact in artifacts.items():
        path = REPOSITORY / artifact["path"]
        if not path.is_file():
            raise RuntimeError(f"{label} is missing from the Job bundle: {path}")
        actual = sha256_file(path)
        if actual != artifact["sha256"]:
            raise RuntimeError(
                f"{label} SHA-256 mismatch: expected {artifact['sha256']}, got {actual}"
            )


def _run(command: list[str], *, env: dict[str, str]) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, check=True, env=env)


def _hub_token() -> str:
    from huggingface_hub import get_token

    token = os.environ.get("HF_TOKEN") or get_token()
    if not token:
        raise RuntimeError("HF_TOKEN is required for private corpus and checkpoint access")
    return token


def _require_private_model_repo(api: Any, repo_id: str) -> None:
    info = api.repo_info(repo_id=repo_id, repo_type="model")
    if not bool(getattr(info, "private", False)):
        raise RuntimeError(f"checkpoint repo must already be private: {repo_id}")


def _download_and_preflight(resolved: dict[str, Any], token: str, work: Path) -> tuple[Path, dict[str, Any]]:
    from huggingface_hub import snapshot_download

    corpus = resolved["corpus"]
    snapshot = Path(
        snapshot_download(
            repo_id=corpus["datasetRepo"],
            repo_type="dataset",
            revision=corpus["datasetRevision"],
            allow_patterns=[corpus["releasePath"], f"{corpus['releasePath']}/**"],
            token=token,
        )
    )
    source = snapshot / corpus["releasePath"]
    if not (source / "manifest.json").is_file():
        raise RuntimeError(f"pinned training release not found: {source}")
    release = work / "release"
    shutil.copytree(source, release, symlinks=False)
    report = run_preflight(
        release,
        expectations=Expectations(
            corpus_hash=corpus["corpusHash"],
            policy_sha256=corpus["policySha256"],
            policy_id=corpus["policyId"],
            purpose="training",
        ),
        tooling_revision=resolved["toolingRevision"],
    )
    if report["failedChecks"] or report["readyFor"] != "training":
        raise RuntimeError(
            "training release preflight failed: "
            f"readyFor={report['readyFor']} failedChecks={report['failedChecks']}"
        )
    return release, report


def _upload_json(api: Any, repo_id: str, path: str, value: Any, message: str) -> str:
    commit = api.upload_file(
        path_or_fileobj=(pretty_json(value)).encode("utf-8"),
        path_in_repo=path,
        repo_id=repo_id,
        repo_type="model",
        commit_message=message,
    )
    oid = getattr(commit, "oid", None)
    if not oid:
        raise RuntimeError(f"upload returned no commit oid: {commit!r}")
    return str(oid)


def execute(
    resolved: dict[str, Any],
    *,
    action: str,
    export_format: str | None,
    export_destination: str,
    workdir: Path,
) -> dict[str, Any]:
    """Execute training or export after all local guards have passed."""
    if action == "export" and not export_format:
        raise ConfigurationError("--export-format is required for --action export")
    if action == "train" and export_format:
        raise ConfigurationError("--export-format is valid only for --action export")
    if action == "export":
        assert_export_allowed(resolved, export_destination)
    elif export_destination != "private-model-repo":
        raise ConfigurationError(
            "--export-destination is valid only for --action export"
        )

    _verify_local_artifacts(resolved)

    from huggingface_hub import HfApi, snapshot_download

    work = _safe_workdir(workdir)
    if work.exists():
        raise RuntimeError(f"workdir already exists: {work}")
    work.mkdir(parents=True)
    token = _hub_token()
    api = HfApi(token=token)
    checkpoint_repo = resolved["execution"]["checkpointRepo"]
    _require_private_model_repo(api, checkpoint_repo)

    run_descriptor = descriptor(resolved)
    prefix = run_descriptor["checkpointPrefix"]
    config_oid = _upload_json(
        api,
        checkpoint_repo,
        f"{prefix}/resolved-config.json",
        resolved,
        f"geometry config {run_descriptor['experimentHash'][:12]}",
    )
    run_descriptor["resolvedConfigCommit"] = config_oid

    output = work / "output"
    output.mkdir()
    env = os.environ.copy()
    env.update(
        {
            "TCGER_GEOMETRY_OUTPUT_DIR": str(output),
            "TCGER_GEOMETRY_CHECKPOINT_REPO": checkpoint_repo,
            "TCGER_GEOMETRY_CHECKPOINT_PREFIX": prefix,
            "TCGER_GEOMETRY_EXPERIMENT_HASH": run_descriptor["experimentHash"],
            "TCGER_GEOMETRY_INPUT_RESOLUTION": str(
                resolved["fairness"]["inputResolution"]
            ),
            "TCGER_GEOMETRY_BUDGET_KIND": resolved["fairness"]["budget"]["kind"],
            "TCGER_GEOMETRY_BUDGET_VALUE": str(
                resolved["fairness"]["budget"]["value"]
            ),
            "TCGER_GEOMETRY_AUGMENTATION_PROFILE": resolved["fairness"][
                "augmentationProfile"
            ],
            "TCGER_GEOMETRY_BASE_SEED": str(
                resolved["fairness"]["seedPolicy"]["baseSeed"]
            ),
            "TCGER_GEOMETRY_REPEAT_COUNT": str(
                resolved["fairness"]["seedPolicy"]["repeatCount"]
            ),
        }
    )

    started = time.monotonic()
    if action == "train":
        release, preflight = _download_and_preflight(resolved, token, work)
        env["TCGER_GEOMETRY_RELEASE_ROOT"] = str(release)
        preflight_oid = _upload_json(
            api,
            checkpoint_repo,
            f"{prefix}/preflight-report.json",
            preflight,
            f"geometry preflight {run_descriptor['experimentHash'][:12]}",
        )
        run_descriptor["preflightCommit"] = preflight_oid
        command = resolved["execution"]["trainCommand"]
    else:
        snapshot = Path(
            snapshot_download(
                repo_id=checkpoint_repo,
                repo_type="model",
                revision=config_oid,
                allow_patterns=f"{prefix}/**",
                token=token,
            )
        )
        env["TCGER_GEOMETRY_CHECKPOINT_ROOT"] = str(snapshot / prefix)
        command = resolved["execution"]["privateExportCommands"][export_format]

    _run(command, env=env)
    elapsed = time.monotonic() - started
    run_descriptor.update(
        {
            "action": action,
            "exportFormat": export_format,
            "exportDestination": export_destination,
            "elapsedSeconds": round(elapsed, 6),
            "wrapperElapsedHours": round(elapsed / 3600.0, 9),
        }
    )
    if any(output.iterdir()):
        api.upload_folder(
            folder_path=str(output),
            path_in_repo=(
                f"{prefix}/training-output"
                if action == "train"
                else f"{prefix}/exports/{export_format}"
            ),
            repo_id=checkpoint_repo,
            repo_type="model",
        )

    if action == "export" and export_destination == "asset-store":
        publish = resolved["execution"].get("assetStorePublishCommand")
        if not publish:
            raise ConfigurationError(
                "asset-store export requires execution.assetStorePublishCommand"
            )
        _run(publish, env=env)

    report_oid = _upload_json(
        api,
        checkpoint_repo,
        f"{prefix}/run-{action}.json",
        run_descriptor,
        f"geometry {action} {run_descriptor['experimentHash'][:12]}",
    )
    run_descriptor["runReportCommit"] = report_oid
    return run_descriptor


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--action", choices=("describe", "train", "export"), default="describe")
    parser.add_argument("--export-format", choices=("coreml", "onnx"))
    parser.add_argument(
        "--export-destination",
        choices=("private-model-repo", "asset-store"),
        default="private-model-repo",
    )
    parser.add_argument("--workdir", type=Path, default=Path("/tmp/tcger-card-geometry"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    raw = load_json(args.config)
    if not isinstance(raw, dict):
        raise SystemExit("experiment config must be a JSON object")
    try:
        resolved = resolve_config(raw)
        if args.action == "export" and not args.export_format:
            raise ConfigurationError("--export-format is required for --action export")
        if args.action == "train" and args.export_format:
            raise ConfigurationError("--export-format is valid only for --action export")
        if args.action == "export":
            assert_export_allowed(resolved, args.export_destination)
        elif args.export_destination != "private-model-repo":
            raise ConfigurationError(
                "--export-destination is valid only for --action export"
            )
    except (ConfigurationError, PublicationBlocked) as error:
        raise SystemExit(str(error)) from error

    run_descriptor = descriptor(resolved)
    if args.action == "describe" or args.dry_run:
        print(pretty_json({"descriptor": run_descriptor, "resolvedConfig": resolved}), end="")
        return 0
    try:
        result = execute(
            resolved,
            action=args.action,
            export_format=args.export_format,
            export_destination=args.export_destination,
            workdir=args.workdir,
        )
    except (ConfigurationError, PublicationBlocked, RuntimeError) as error:
        raise SystemExit(str(error)) from error
    print(pretty_json(result), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
