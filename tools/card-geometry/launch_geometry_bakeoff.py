#!/usr/bin/env python3
"""Publish pinned bake-off inputs and submit reproducible Hugging Face Jobs."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from corpus_release import REPOSITORY, canonical_json, pretty_json, sha256_bytes, sha256_file
from run_card_geometry_hf_job import resolve_config


PYTORCH_26_IMAGE = (
    "pytorch/pytorch@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee"
)
PYTORCH_21_IMAGE = (
    "pytorch/pytorch@sha256:3387e598cb94fc248d82e712a65b10931a990cea3a2e76362ca30d135f565de4"
)
MMYOLO_REVISION = "8c4d9dc503dc8e327bec8147e8dc97124052f693"
RECOGNITION_MODEL_REVISION = "3e51bbba70c6fbc6d07bdc6d1f4ea4ac7a00f7cb"
RECOGNITION_ASSETS = {
    "pokemon": {
        "onnx": ("card-embeddings-arcface-fp32.onnx", "bd7367284130639345efbe967e5e80b4aadf0ab5d5bc922968d2b06e497eea44"),
        "metadata": ("CardsIndexMetadata.json", "5bcc886d58fca214800d366d080a438515d7820ffe03fcea7395496b5ef08117"),
        "vectors": ("CardsIndexVectors-arcface.bin", "d78e06b0909f39f57deab5c04c1bfb20671bf933f95033f143942e8cc388bdc3"),
        "strongThreshold": 0.65,
        "queryNormalization": "none",
    },
    "magic": {
        "onnx": ("card-embeddings-arcface-fp32.onnx", "ebc725476ec2866cd054cd16ef9bcda257bbfdc5aa05326a79335abc4fdc0d3e"),
        "metadata": ("CardsIndexMetadata.json", "35759a1443c6466847ec584b3ad6581d23e4624c91bc6f943f77f2a595461e54"),
        "vectors": ("CardsIndexVectors-arcface.bin", "4449c186a23ceef512a7786d73f32c8322dc45c7279e90f3dfbc75d7cdc135e8"),
        "strongThreshold": 0.70,
        "queryNormalization": "grey-world-autocontrast",
    },
    "yugioh": {
        "onnx": ("card-embeddings-arcface-fp32.onnx", "b304bde2171d8ca4a824a4e0cab4bc22c3b31e425a8ba5e3ef91aab4ec6f9d58"),
        "metadata": ("CardsIndexMetadata.json", "0ab3fec12511b401244b1f80ac12ac432f10cdb2afdcfc59f7797568d50cca5e"),
        "vectors": ("CardsIndexVectors-arcface.bin", "2de604679f08018e18fe3f3db188414add77fba51c6e8c52c4eb8b87cea8cbdd"),
        "strongThreshold": 0.65,
        "queryNormalization": "none",
    },
}


def recognition_models() -> dict[str, Any]:
    games = {}
    for game, values in RECOGNITION_ASSETS.items():
        games[game] = {}
        for name in ("onnx", "metadata", "vectors"):
            filename, digest = values[name]
            games[game][name] = {
                "path": f"exports/{game}/full/{filename}",
                "sha256": digest,
            }
        games[game]["strongThreshold"] = values["strongThreshold"]
        games[game]["queryNormalization"] = values["queryNormalization"]
    return {
        "modelRepo": "ahzs645/tcger-universal-arcface",
        "modelRevision": RECOGNITION_MODEL_REVISION,
        "games": games,
    }


def checked_git_revision() -> str:
    revision = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPOSITORY, text=True
    ).strip()
    changed = subprocess.check_output(
        [
            "git",
            "status",
            "--porcelain",
            "--",
            "tools/card-geometry",
            "docs/scanner-system",
        ],
        cwd=REPOSITORY,
        text=True,
    ).strip()
    if changed:
        raise RuntimeError("commit card-geometry tooling and docs before launching a pinned Job")
    return revision


def hashed_artifact(relative: str) -> dict[str, str]:
    return {"path": relative, "sha256": sha256_file(REPOSITORY / relative)}


def base_config(
    *,
    candidate: str,
    corpus: dict[str, str],
    tooling_revision: str,
    epochs: int,
    real_evaluation: dict[str, str] | None = None,
) -> dict[str, Any]:
    framework = {
        "yolo11n-pose": "ultralytics",
        "yolo11s-pose": "ultralytics",
        "yolox-pose": "mmyolo",
        "fastvit-t8-four-corner": "tcger-pytorch",
    }[candidate]
    license_route = "evaluation-only" if framework == "ultralytics" else "permissive"
    commands = {
        "yolo11n-pose": [
            "python",
            "tools/card-geometry/train_yolo_pose.py",
            "--candidate",
            "yolo11n-pose",
            "--base-url",
            "https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11n-pose.pt",
            "--base-sha256",
            "869e83fcdffdc7371fa4e34cd8e51c838cc729571d1635e5141e3075e9319dc0",
        ],
        "yolo11s-pose": [
            "python",
            "tools/card-geometry/train_yolo_pose.py",
            "--candidate",
            "yolo11s-pose",
            "--base-url",
            "https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11s-pose.pt",
            "--base-sha256",
            "1060bda4a27012060eca246f9b2adeea22eabb045a1e58f8d229be29b7ebc2ba",
        ],
        "yolox-pose": [
            "python",
            "tools/card-geometry/train_yolox_pose.py",
            "--mmyolo-root",
            "/work/mmyolo",
            "--mmyolo-revision",
            MMYOLO_REVISION,
        ],
        "fastvit-t8-four-corner": [
            "python",
            "tools/card-geometry/train_fastvit_four_corner.py",
            "--base-revision",
            "f0cc1b82f948280d94a8812b1ce83698111054e1",
            "--base-sha256",
            "345af83ed1a7eee2ed322eb327895efd2a2a06c604272dbac92432adc61af889",
        ],
    }
    container = PYTORCH_21_IMAGE if candidate == "yolox-pose" else PYTORCH_26_IMAGE
    real_evaluation = real_evaluation or {
        "datasetRepo": "ahzs645/tcger-scanner-images",
        "datasetRevision": "65017ce8da9137fea491739bd06388ab513831a2",
        "releasePath": "geometry/releases/real-geometry-devmode-orientation-smoke-v3",
        "corpusHash": "97780e7e96cbd98da91173a00b37e6304514f758a9046f5bd98adf30c418820e",
    }
    raw = {
        "schema": "https://tcger.app/schemas/card-geometry-experiment-config/v1",
        "bakeoffId": "shared-card-geometry-licensing-v1",
        "candidate": candidate,
        "framework": framework,
        "licenseRoute": license_route,
        "toolingRevision": tooling_revision,
        "corpus": corpus,
        "execution": {
            "checkpointRepo": "ahzs645/tcger-universal-arcface",
            "checkpointRepoPrivate": True,
            "containerImage": container,
            "gpuFlavor": "l4x1",
            "trainCommand": commands[candidate],
            "evaluationCommand": [
                "python",
                "tools/card-geometry/evaluate_geometry_candidate.py",
                "--candidate",
                candidate,
            ],
            "privateExportCommands": {
                "onnx": [
                    "python",
                    "tools/card-geometry/export_geometry_candidate.py",
                    "--candidate",
                    candidate,
                    "--format",
                    "onnx",
                ],
                "coreml": [
                    "python",
                    "tools/card-geometry/export_geometry_candidate.py",
                    "--candidate",
                    candidate,
                    "--format",
                    "coreml",
                ],
            },
        },
        "fairness": {
            "inputResolution": 640,
            "budget": {"kind": "epochs", "value": epochs},
            "augmentationProfile": "shared-card-geometry-v1",
            "seedPolicy": {
                "baseSeed": 20260903,
                "repeatCount": 1,
                "derivation": "base-plus-repeat-index",
            },
            "evaluationScript": hashed_artifact("tools/card-geometry/benchmark_geometry.py"),
        },
        "evaluations": {
            "frozenRealV3": real_evaluation,
            "syntheticDuelField": {
                "datasetRepo": "ahzs645/tcger-scanner-images",
                "datasetRevision": "b4ef746b06c725cbe196e709d518dc53eea0ad13",
                "releasePath": "geometry/releases/synthetic-geometry-smoke-v1",
                "corpusHash": "544ec80646b61e8b3c5343b93ce9580061d164ad03cd1e25ed28c08d2eec9393",
            },
            "recognitionReplay": hashed_artifact(
                "docs/scanner-system/benchmarks/2026-09-02-shared-card-geometry/reports/device-geometry-outcomes.json"
            ),
            "goldenFixtures": hashed_artifact(
                "tools/card-geometry/fixtures/validation-nms.v1.json"
            ),
            "recognitionModels": recognition_models(),
        },
        "deviations": [],
    }
    return resolve_config(raw)


def bootstrap_command(
    *,
    candidate: str,
    checkpoint_repo: str,
    hub_revision: str,
    tooling_path: str,
    tooling_sha: str,
    config_path: str,
    config_sha: str,
    pipeline_smoke: bool,
) -> list[str]:
    setup = [
        "python -m pip install --no-cache-dir huggingface_hub==1.28.0 jsonschema==4.23.0",
    ]
    if candidate.startswith("yolo11"):
        setup += [
            "python -m pip install --no-cache-dir ultralytics==8.4.138",
            "python -m pip uninstall -y opencv-python",
            "python -m pip install --no-cache-dir opencv-python-headless==4.12.0.88",
        ]
    elif candidate == "yolox-pose":
        setup += [
            "python -m pip install --no-cache-dir openmim==0.3.9",
            "mim install 'mmengine==0.10.7' 'mmcv==2.0.1' 'mmdet==3.3.0' 'mmpose==1.3.2'",
            "git clone --filter=blob:none https://github.com/open-mmlab/mmyolo.git /work/mmyolo",
            f"git -C /work/mmyolo checkout --detach {MMYOLO_REVISION}",
            "python -m pip install --no-cache-dir -e /work/mmyolo",
        ]
    else:
        setup += [
            "python -m pip install --no-cache-dir timm==1.0.22 safetensors==0.6.2",
        ]
    setup += [
        "python -m pip install --no-cache-dir onnxruntime==1.29.0 opencv-python-headless==4.12.0.88"
    ]
    smoke = " --pipeline-smoke" if pipeline_smoke else ""
    program = f"""
import hashlib, os, tarfile
from pathlib import Path
from huggingface_hub import hf_hub_download
repo = {checkpoint_repo!r}
revision = {hub_revision!r}
token = os.environ['HF_TOKEN']
tooling = Path(hf_hub_download(repo_id=repo, filename={tooling_path!r}, revision=revision, token=token))
config = Path(hf_hub_download(repo_id=repo, filename={config_path!r}, revision=revision, token=token))
for path, expected in ((tooling, {tooling_sha!r}), (config, {config_sha!r})):
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f'pinned input hash mismatch for {{path.name}}: {{actual}}')
source = Path('/work/src')
source.mkdir(parents=True, exist_ok=False)
with tarfile.open(tooling, 'r:gz') as archive:
    archive.extractall(source)
Path('/work/experiment.json').write_bytes(config.read_bytes())
""".strip()
    shell = ["set -euo pipefail", *setup, "python - <<'PY'", program, "PY", "cd /work/src"]
    shell.append(
        "python tools/card-geometry/run_card_geometry_hf_job.py "
        f"--config /work/experiment.json --action train{smoke} "
        f"--workdir /work/tcger-card-geometry-{candidate}"
    )
    return ["bash", "-lc", "\n".join(shell)]


def publish_and_launch(args: argparse.Namespace) -> dict[str, Any]:
    from huggingface_hub import CommitOperationAdd, HfApi, get_token

    revision = checked_git_revision()
    corpus = {
        "datasetRepo": args.dataset_repo,
        "datasetRevision": args.dataset_revision,
        "releasePath": args.release_path,
        "corpusHash": args.corpus_hash,
        "policyId": "training-minimums-v2",
        "policySha256": args.policy_sha256,
    }
    candidates = ["yolo11n-pose"] if args.pipeline_smoke else args.candidate
    configs = {
        candidate: base_config(
            candidate=candidate,
            corpus=corpus,
            tooling_revision=revision,
            epochs=args.epochs,
            real_evaluation={
                "datasetRepo": args.dataset_repo,
                "datasetRevision": args.real_evaluation_revision,
                "releasePath": args.real_evaluation_path,
                "corpusHash": args.real_evaluation_hash,
            },
        )
        for candidate in candidates
    }
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
                revision,
                "tools/card-geometry",
                "docs/scanner-system",
            ],
            cwd=REPOSITORY,
            check=True,
        )
        tooling_sha = sha256_file(tooling)
        tooling_path = f"geometry/tooling/{revision}/card-geometry-tooling.tar.gz"
        operations: list[Any] = [CommitOperationAdd(path_in_repo=tooling_path, path_or_fileobj=tooling)]
        config_files = {}
        for candidate, config in configs.items():
            path = root / f"{candidate}.json"
            path.write_text(pretty_json(config), encoding="utf-8")
            config_path = f"geometry/bakeoffs/{revision}/{args.corpus_hash}/{candidate}.json"
            config_files[candidate] = (config_path, sha256_file(path))
            operations.append(CommitOperationAdd(path_in_repo=config_path, path_or_fileobj=path))
        commit = api.create_commit(
            repo_id=args.checkpoint_repo,
            repo_type="model",
            operations=operations,
            commit_message=f"geometry bake-off inputs {args.corpus_hash[:12]}",
        )
        hub_revision = str(commit.oid)
    jobs = []
    if not args.publish_only:
        for candidate in candidates:
            config_path, config_sha = config_files[candidate]
            config = configs[candidate]
            job = api.run_job(
                image=config["execution"]["containerImage"],
                command=bootstrap_command(
                    candidate=candidate,
                    checkpoint_repo=args.checkpoint_repo,
                    hub_revision=hub_revision,
                    tooling_path=tooling_path,
                    tooling_sha=tooling_sha,
                    config_path=config_path,
                    config_sha=config_sha,
                    pipeline_smoke=args.pipeline_smoke,
                ),
                secrets={"HF_TOKEN": token},
                flavor="l4x1",
                timeout="6h",
                name=f"geometry-{candidate}-{'smoke' if args.pipeline_smoke else 'bakeoff'}",
            )
            jobs.append({"candidate": candidate, "id": job.id, "url": job.url})
    return {
        "schema": "https://tcger.app/reports/card-geometry-bakeoff-launch/v1",
        "toolingRevision": revision,
        "toolingSha256": tooling_sha,
        "inputCommit": hub_revision,
        "corpusHash": args.corpus_hash,
        "configHashes": {candidate: sha256_bytes(canonical_json(config)) for candidate, config in configs.items()},
        "jobs": jobs,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-repo", default="ahzs645/tcger-scanner-images")
    parser.add_argument("--dataset-revision", required=True)
    parser.add_argument("--release-path", required=True)
    parser.add_argument("--corpus-hash", required=True)
    parser.add_argument("--real-evaluation-revision", required=True)
    parser.add_argument("--real-evaluation-path", required=True)
    parser.add_argument("--real-evaluation-hash", required=True)
    parser.add_argument(
        "--policy-sha256",
        default="b86ce9823667212afdb0158113539a81c79e3a7cfe1509acea88f5afb186816d",
    )
    parser.add_argument("--checkpoint-repo", default="ahzs645/tcger-universal-arcface")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument(
        "--candidate",
        action="append",
        choices=("yolo11n-pose", "yolo11s-pose", "yolox-pose", "fastvit-t8-four-corner"),
        default=[],
    )
    parser.add_argument("--pipeline-smoke", action="store_true")
    parser.add_argument("--publish-only", action="store_true")
    args = parser.parse_args()
    if not args.pipeline_smoke and not args.candidate:
        args.candidate = [
            "yolo11n-pose",
            "yolo11s-pose",
            "yolox-pose",
            "fastvit-t8-four-corner",
        ]
    result = publish_and_launch(args)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
