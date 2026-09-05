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
import hashlib
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
    leakage_keys_from_record,
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
TRANSPORT_LAYOUT_FILE = "_transport-layout.v1.json"
TRANSPORT_LAYOUT_SCHEMA = "https://tcger.app/datasets/card-geometry-transport-layout/v1"

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


def resolve_config(raw: dict[str, Any], *, pipeline_smoke: bool = False) -> dict[str, Any]:
    """Apply defaults, validate Draft 2020-12 schema, and enforce semantics."""
    resolved = _merge_defaults(DEFAULTS, raw)
    if pipeline_smoke:
        if resolved.get("candidate") != "yolo11n-pose":
            raise ConfigurationError(
                "--pipeline-smoke is restricted to the yolo11n-pose end-to-end proof"
            )
        resolved["fairness"]["budget"] = {"kind": "epochs", "value": 1}
        resolved["fairness"]["seedPolicy"]["repeatCount"] = 1
        resolved["deviations"].append(
            {
                "rule": "budget",
                "candidateValue": {"kind": "epochs", "value": 1},
                "reason": "one-epoch pipeline smoke before the full bake-off batch",
            }
        )
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

    resume_from = resolved["execution"].get("resumeFrom")
    if resume_from is not None:
        if resolved["candidate"] != "yolox-pose":
            raise ConfigurationError("checkpoint resume is restricted to yolox-pose")
        expected_prefix = (
            f"geometry/yolox-pose/{resolved['corpus']['corpusHash']}/"
        )
        if not resume_from["checkpointPrefix"].startswith(expected_prefix):
            raise ConfigurationError(
                "resume checkpoint must belong to the same candidate and corpus"
            )
        if resume_from["epoch"] > resolved["fairness"]["budget"]["value"]:
            raise ConfigurationError("resume epoch exceeds the experiment budget")

    if resolved["execution"].get("evaluationCommand") and not resolved[
        "evaluations"
    ].get("recognitionModels"):
        raise ConfigurationError(
            "execution.evaluationCommand requires evaluations.recognitionModels"
        )
    if resolved["execution"].get("evaluationCommand") and not resolved["corpus"].get(
        "preflightReport"
    ):
        raise ConfigurationError(
            "evaluation runs require a corpus.preflightReport pinned into the experiment"
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


def materialize_downloaded_release(source: Path, destination: Path) -> None:
    """Restore a transport-sharded Hub release to its canonical local layout."""
    layout_path = source / TRANSPORT_LAYOUT_FILE
    if not layout_path.is_file():
        shutil.copytree(source, destination, symlinks=False)
        return
    layout = load_json(layout_path)
    expected_layout = {
        "schema": TRANSPORT_LAYOUT_SCHEMA,
        "algorithm": "sha256-relative-path-prefix",
        "prefixLength": 2,
        "directories": layout.get("directories"),
    }
    if layout != expected_layout:
        raise RuntimeError("unsupported geometry release transport layout")
    directories = layout.get("directories")
    if not isinstance(directories, list) or not directories or not all(
        isinstance(value, str) and value and "/" not in value for value in directories
    ):
        raise RuntimeError("invalid geometry release transport directories")
    sharded = set(directories)
    destination.mkdir(parents=True)
    for item in sorted(path for path in source.rglob("*") if path.is_file()):
        relative = item.relative_to(source)
        if relative.as_posix() == TRANSPORT_LAYOUT_FILE:
            continue
        canonical = relative
        if relative.parts[0] in sharded:
            if len(relative.parts) != 3:
                raise RuntimeError(f"invalid sharded transport path: {relative}")
            canonical = Path(relative.parts[0], relative.parts[2])
            expected = hashlib.sha256(canonical.as_posix().encode("utf-8")).hexdigest()[:2]
            if relative.parts[1] != expected:
                raise RuntimeError(f"transport shard mismatch: {relative}")
        target = destination / canonical
        if target.exists():
            raise RuntimeError(f"duplicate canonical transport path: {canonical}")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)


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
    materialize_downloaded_release(source, release)
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
    pinned_path = os.environ.get("TCGER_GEOMETRY_PREFLIGHT_REPORT")
    if not pinned_path:
        raise RuntimeError("TCGER_GEOMETRY_PREFLIGHT_REPORT is required")
    pinned = load_json(Path(pinned_path))
    if pinned.get("failedChecks") or pinned.get("readyFor") != "training":
        raise RuntimeError("pinned preflight report did not authorize training")
    for field in (
        "recomputedCorpusHash",
        "readinessPolicyId",
        "readinessPolicySha256",
    ):
        if pinned.get(field) != report.get(field):
            raise RuntimeError(f"pinned and recomputed preflight disagree on {field}")
    return release, report


def _download_evaluation_release(
    release: dict[str, Any], token: str, work: Path, name: str
) -> Path:
    from huggingface_hub import snapshot_download

    snapshot = Path(
        snapshot_download(
            repo_id=release["datasetRepo"],
            repo_type="dataset",
            revision=release["datasetRevision"],
            allow_patterns=[release["releasePath"], f"{release['releasePath']}/**"],
            token=token,
        )
    )
    source = snapshot / release["releasePath"]
    if not (source / "manifest.json").is_file():
        raise RuntimeError(f"pinned {name} evaluation release not found: {source}")
    destination = work / "evaluations" / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    materialize_downloaded_release(source, destination)
    report = run_preflight(destination, expectations=Expectations(corpus_hash=release["corpusHash"]))
    if report["failedChecks"]:
        raise RuntimeError(f"pinned {name} evaluation preflight failed: {report['failedChecks']}")
    return destination


def check_cross_release_leakage(
    training: Path, evaluations: dict[str, Path]
) -> dict[str, Any]:
    """Compare all records in preflighted releases, including held-out records.

    Merge alias knowledge before deriving keys, so a fork cannot become an
    independent archive just because it is described in a different release.
    Contradictory alias declarations fail closed. Preflight-verified image
    hashes also catch exact copies whose archive relationship is undeclared.
    """
    roots = {"training": training, **evaluations}
    manifests = {name: load_json(root / "manifest.json") for name, root in roots.items()}
    aliases: dict[str, str] = {}
    conflicts: dict[str, list[str]] = {}
    for manifest in manifests.values():
        for alias, canonical in manifest["sourceArchiveAliases"].items():
            if alias in aliases and aliases[alias] != canonical:
                conflicts[alias] = sorted({aliases[alias], canonical})
            else:
                aliases[alias] = canonical
    keys_by_release: dict[str, set[tuple[str, str]]] = {}
    for name, root in roots.items():
        keys: set[tuple[str, str]] = set()
        for entry in manifests[name]["records"]:
            keys.update(("imageSha256", image["sha256"]) for image in entry["images"])
            derived = leakage_keys_from_record(load_json(root / entry["path"]), aliases)
            keys.add(("sourceArchiveId", derived["sourceArchiveId"]))
            if derived.get("sessionId"):
                keys.add(("sessionId", derived["sessionId"]))
            for kind in ("sourceAssetId", "physicalCardId"):
                keys.update((kind, value) for value in derived[f"{kind}s"])
        keys_by_release[name] = keys
    leaks = {
        name: sorted(f"{kind}:{value}" for kind, value in keys_by_release["training"] & keys_by_release[name])
        for name in evaluations
    }
    return {
        "schema": "https://tcger.app/reports/card-geometry-cross-release-leakage/v1",
        "failedChecks": ["CROSS_RELEASE_LEAKAGE_DISJOINT"] if conflicts or any(leaks.values()) else [],
        "corpusHashes": {name: manifest["corpusHash"] for name, manifest in manifests.items()},
        "archiveAliasConflicts": conflicts,
        "leaks": leaks,
    }


def prepare_training_evaluations(
    resolved: dict[str, Any], training: Path, token: str, work: Path, output: Path
) -> dict[str, Path]:
    """Gate every training command, even when no post-training scorer is set."""
    evaluations = {
        name: _download_evaluation_release(spec, token, work, name)
        for name, spec in resolved["evaluations"].items()
        if isinstance(spec, dict) and "releasePath" in spec
    }
    report = check_cross_release_leakage(training, evaluations)
    (output / "cross-release-leakage.json").write_text(pretty_json(report), encoding="utf-8")
    if report["failedChecks"]:
        raise RuntimeError(f"CROSS_RELEASE_LEAKAGE_DISJOINT failed: {report['leaks']}; aliases={report['archiveAliasConflicts']}")
    return evaluations


def _download_recognition_models(resolved: dict[str, Any], token: str, work: Path) -> Path:
    from huggingface_hub import hf_hub_download

    spec = resolved["evaluations"]["recognitionModels"]
    root = work / "recognition-models"
    for game, assets in spec["games"].items():
        game_root = root / game
        game_root.mkdir(parents=True, exist_ok=True)
        for name in ("onnx", "metadata", "vectors"):
            item = assets[name]
            source = Path(
                hf_hub_download(
                    repo_id=spec["modelRepo"],
                    filename=item["path"],
                    revision=spec["modelRevision"],
                    token=token,
                )
            )
            if sha256_file(source) != item["sha256"]:
                raise RuntimeError(f"{game} {name} recognition artifact hash mismatch")
            shutil.copy2(source, game_root / Path(item["path"]).name)
        (game_root / "policy.json").write_text(
            pretty_json(
                {
                    "strongThreshold": assets["strongThreshold"],
                    "queryNormalization": assets["queryNormalization"],
                }
            ),
            encoding="utf-8",
        )
    return root


def export_checkpoint_patterns(candidate: str, prefix: str) -> list[str]:
    """Download only the release checkpoint needed by a private exporter."""
    root = f"{prefix}/training-output"
    if candidate.startswith("yolo11"):
        return [f"{root}/training/repeat-0/weights/best.pt"]
    if candidate == "fastvit-t8-four-corner":
        return [f"{root}/training/repeat-0/best.pt"]
    if candidate == "yolox-pose":
        return [
            f"{root}/training/repeat-0/*.pth",
            f"{root}/yolox-pose-card.py",
        ]
    raise ConfigurationError(f"unsupported export candidate: {candidate}")


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
            "TCGER_GEOMETRY_CANDIDATE": resolved["candidate"],
            "TCGER_GEOMETRY_TOOLING_REVISION": resolved["toolingRevision"],
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
    resume_from = resolved["execution"].get("resumeFrom")
    if resume_from is not None:
        env.update(
            {
                "TCGER_GEOMETRY_RESUME_PREFIX": resume_from["checkpointPrefix"],
                "TCGER_GEOMETRY_RESUME_SHA256": resume_from["checkpointSha256"],
                "TCGER_GEOMETRY_RESUME_EPOCH": str(resume_from["epoch"]),
                "TCGER_GEOMETRY_RESUME_JOB_ID": resume_from["jobId"],
            }
        )

    started = time.monotonic()
    if action == "train":
        release, preflight = _download_and_preflight(resolved, token, work)
        evaluation_roots = prepare_training_evaluations(resolved, release, token, work, output)
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
                allow_patterns=export_checkpoint_patterns(
                    resolved["candidate"], prefix
                ),
                token=token,
            )
        )
        env["TCGER_GEOMETRY_CHECKPOINT_ROOT"] = str(snapshot / prefix)
        command = resolved["execution"]["privateExportCommands"][export_format]

    _run(command, env=env)
    if action == "train" and resolved["execution"].get("evaluationCommand"):
        real = evaluation_roots["frozenRealV3"]
        synthetic = evaluation_roots["syntheticDuelField"]
        env["TCGER_GEOMETRY_EVAL_REAL_ROOT"] = str(real)
        env["TCGER_GEOMETRY_EVAL_REAL_HASH"] = resolved["evaluations"][
            "frozenRealV3"
        ]["corpusHash"]
        env["TCGER_GEOMETRY_EVAL_SYNTHETIC_ROOT"] = str(synthetic)
        env["TCGER_GEOMETRY_EVAL_SYNTHETIC_HASH"] = resolved["evaluations"][
            "syntheticDuelField"
        ]["corpusHash"]
        env["TCGER_GEOMETRY_RECOGNITION_MODELS_ROOT"] = str(
            _download_recognition_models(resolved, token, work)
        )
        _run(resolved["execution"]["evaluationCommand"], env=env)
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
    parser.add_argument(
        "--pipeline-smoke",
        action="store_true",
        help="force the one-epoch, one-repeat yolo11n-pose pipeline proof and hash that deviation",
    )
    args = parser.parse_args(argv)

    raw = load_json(args.config)
    if not isinstance(raw, dict):
        raise SystemExit("experiment config must be a JSON object")
    try:
        resolved = resolve_config(raw, pipeline_smoke=args.pipeline_smoke)
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
