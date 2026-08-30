# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "huggingface-hub>=1.3.0",
# ]
# ///
"""Run one ArcFace game from a pinned TrainingSetPlan and validated shards.

The job downloads only pinned Hub artifacts. It converts the metadata-only
TrainingSetPlan into a small virtual prepared-pack contract whose shard
directory points at the existing validated release, then delegates to the
normal full-run wrapper. No upstream card-image URL is ever fetched.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path


PLAN_SCHEMA = "tcger-training-set-plan-v1"


class PlanRunError(RuntimeError):
    pass


def clean_download_workdir(work: Path) -> list[Path]:
    """Remove only the two ephemeral Hub snapshots used by a plan job."""
    work = work.expanduser().resolve()
    filesystem_root = Path(work.anchor)
    script_parents = Path(__file__).resolve().parents
    script_root = script_parents[3] if len(script_parents) > 3 else filesystem_root
    forbidden = {filesystem_root, Path.home().resolve()}
    if script_root != filesystem_root:
        forbidden.add(script_root)
    if work in forbidden or len(work.parts) < 3:
        raise PlanRunError(f"refusing to clean unsafe workdir: {work}")
    removed = []
    for name in ("plan", "source-library"):
        target = work / name
        if target.is_symlink() or target.is_file():
            target.unlink()
            removed.append(target)
        elif target.is_dir():
            shutil.rmtree(target)
            removed.append(target)
    return removed


def decode_hub_path(value: str) -> str:
    """Decode a Hub-only path without exposing it as a local CLI dependency."""
    if value.startswith("hub64:"):
        encoded = value[len("hub64:"):]
        try:
            decoded = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as error:
            raise PlanRunError(f"invalid encoded Hub path: {value}") from error
    elif value.startswith("hub:"):
        decoded = value[len("hub:"):]
    else:
        return value
    if not decoded or decoded.startswith("/") or ".." in Path(decoded).parts:
        raise PlanRunError(f"invalid encoded Hub path: {value}")
    return decoded


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise PlanRunError(f"expected an object at {path}:{line_number}")
        rows.append(row)
    return rows


def write_json(path: Path, value: object) -> None:
    path.write_text(canonical_json(value) + "\n", encoding="utf-8")


def build_virtual_pack(
    *,
    plan_root: Path,
    source_root: Path,
    output: Path,
    game: str,
    plan_repo: str,
    plan_revision: str,
    plan_path: str,
) -> dict:
    source_and_output_are_same = output.resolve() == source_root.resolve()
    if output.exists() and not source_and_output_are_same:
        raise PlanRunError(f"virtual pack output already exists: {output}")
    plan_bytes = (plan_root / "training-set-plan.json").read_bytes()
    plan = json.loads(plan_bytes)
    if plan.get("schema") != PLAN_SCHEMA:
        raise PlanRunError("unsupported TrainingSetPlan schema")
    descriptor = plan.get("files", {}).get("samples", {})
    samples_path = plan_root / str(descriptor.get("path") or "samples.jsonl")
    samples_bytes = samples_path.read_bytes()
    if sha256_bytes(samples_bytes) != descriptor.get("sha256"):
        raise PlanRunError("TrainingSetPlan samples SHA-256 mismatch")
    game_contract = plan.get("games", {}).get(game)
    if not game_contract:
        raise PlanRunError(f"TrainingSetPlan has no {game} game")
    if game_contract.get("trainingReady") is not True:
        raise PlanRunError(f"TrainingSetPlan says {game} is not training-ready")

    source_contract_path = source_root / "library.json"
    source_manifest_path = source_root / "manifest.jsonl"
    source_contract = json.loads(source_contract_path.read_text(encoding="utf-8"))
    source_manifest_bytes = source_manifest_path.read_bytes()
    if sha256_bytes(source_manifest_bytes) != source_contract.get("manifestSHA256"):
        raise PlanRunError("validated source manifest SHA-256 mismatch")
    source_by_id = {
        str(row.get("sampleId")): row
        for row in load_jsonl(source_manifest_path)
        if row.get("sampleId")
    }

    selected = [row for row in load_jsonl(samples_path) if row.get("game") == game]
    if len(selected) != int(game_contract.get("selectedSamples") or 0):
        raise PlanRunError("TrainingSetPlan selected-sample count mismatch")
    output_rows = []
    for planned in selected:
        sample_id = str(planned.get("sampleId") or "")
        source = source_by_id.get(sample_id)
        materialization = planned.get("materialization") or {}
        if source is None or source.get("status") != "valid":
            raise PlanRunError(f"validated source lacks selected sample {sample_id}")
        if materialization.get("status") != "validated":
            raise PlanRunError(f"selected sample is not validated: {sample_id}")
        for plan_key, source_key in (
            ("blobSha256", "blobSha256"),
            ("bytes", "bytes"),
            ("shard", "shard"),
            ("member", "member"),
        ):
            if materialization.get(plan_key) != source.get(source_key):
                raise PlanRunError(f"materialization contract mismatch for {sample_id}:{plan_key}")
        partition = str(planned.get("partition") or "")
        usage = str(planned.get("usage") or "")
        if partition not in {"train", "validation", "test"}:
            raise PlanRunError(f"invalid plan partition for {sample_id}")
        if usage not in {"training", "evaluation"}:
            raise PlanRunError(f"invalid plan usage for {sample_id}")
        row = dict(source)
        row.update({
            "partition": partition,
            "selectedForPack": True,
            "selectionReason": planned.get("selectionReason"),
            "trainingEligible": usage == "training" and partition == "train",
            "evaluationEligible": usage == "evaluation" and partition in {"validation", "test"},
            "trainingSetPlanSampleId": sample_id,
        })
        output_rows.append(row)

    output_rows.sort(key=lambda row: (
        str(row.get("recognitionFamilyId")),
        str(row.get("visualIdentityId")),
        str(row.get("sampleId")),
    ))
    manifest_bytes = "".join(canonical_json(row) + "\n" for row in output_rows).encode()
    output.mkdir(parents=True, exist_ok=source_and_output_are_same)
    (output / "manifest.jsonl").write_bytes(manifest_bytes)
    if not source_and_output_are_same:
        os.symlink(source_root / "shards", output / "shards", target_is_directory=True)

    training_count = sum(row["trainingEligible"] for row in output_rows)
    evaluation_count = sum(row["evaluationEligible"] for row in output_rows)
    coverage = {
        "schemaVersion": 1,
        "status": "ready",
        "failClosed": True,
        "counts": {
            "catalogRows": int(game_contract.get("catalogRows") or 0),
            "selected": len(output_rows),
            "skipped": int(game_contract.get("catalogRows") or 0) - len(output_rows),
            "input": len(output_rows),
            "valid": len(output_rows),
            "invalid": 0,
            "uniqueBlobs": len({row.get("blobSha256") for row in output_rows}),
            "trainingEligible": training_count,
            "evaluationEligible": evaluation_count,
            "quarantined": 0,
        },
        "coverage": 1.0,
        "invalidSamples": [],
    }
    contract = {
        "schemaVersion": 1,
        "manifest": "manifest.jsonl",
        "manifestSHA256": sha256_bytes(manifest_bytes),
        "coverage": "coverage.json",
        "shardPrefixLength": source_contract.get("shardPrefixLength"),
        "selectionPolicy": {
            "mode": "recognition-family-cap-v1",
            "trainingSamplesPerFamily": 1,
            "evaluationSamplesPerFamily": int(
                plan.get("selectionPolicy", {}).get("evaluationSamplesPerFamily") or 2
            ),
            "selectedRows": len(output_rows),
            "catalogRows": int(game_contract.get("catalogRows") or 0),
        },
        "trainingSetPlan": {
            "repo": plan_repo,
            "revision": plan_revision,
            "path": plan_path,
            "contractSHA256": sha256_bytes(plan_bytes),
            "samplesSHA256": sha256_bytes(samples_bytes),
            "game": game,
        },
        "validatedSourceLibrary": {
            "manifestSHA256": source_contract.get("manifestSHA256"),
            "sourceRevisions": source_contract.get("sourceRevisions"),
        },
    }
    write_json(output / "coverage.json", coverage)
    write_json(output / "library.json", contract)
    return {
        "selectedRows": len(output_rows),
        "trainingRows": training_count,
        "evaluationRows": evaluation_count,
        "catalogRows": int(game_contract.get("catalogRows") or 0),
        "manifestSHA256": contract["manifestSHA256"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=("pokemon", "magic", "yugioh"), required=True)
    parser.add_argument("--plan-repo", default="ahzs645/tcger-scanner-images")
    parser.add_argument("--plan-revision", required=True)
    parser.add_argument("--plan-path", required=True)
    parser.add_argument("--source-library-repo", default="ahzs645/tcger-scanner-images")
    parser.add_argument("--source-library-revision", required=True)
    parser.add_argument("--source-library-path", required=True)
    parser.add_argument("--model-repo", default="ahzs645/tcger-universal-arcface")
    parser.add_argument("--model-revision", required=True)
    parser.add_argument("--runner-path", required=True)
    parser.add_argument("--trainer-path", required=True)
    parser.add_argument("--artifact-variant", required=True)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--workdir", type=Path, default=Path("/tmp/tcger-plan-training"))
    args = parser.parse_args()
    for label, revision in (
        ("plan", args.plan_revision),
        ("source library", args.source_library_revision),
        ("model", args.model_revision),
    ):
        if not re.fullmatch(r"[0-9a-fA-F]{40}", revision):
            parser.error(f"--{label.replace(' ', '-')}-revision must be an immutable commit SHA")
    if args.epochs < 1 or args.batch < 1:
        parser.error("--epochs and --batch must be positive")
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise PlanRunError("HF_TOKEN is required")

    from huggingface_hub import hf_hub_download, snapshot_download

    work = args.workdir.expanduser().resolve()
    removed_work = clean_download_workdir(work)
    if removed_work:
        print(
            "cleaned previous generated Hub snapshots: "
            + ", ".join(path.name for path in removed_work),
            flush=True,
        )
    work.mkdir(parents=True, exist_ok=True)
    plan_snapshot = Path(snapshot_download(
        repo_id=args.plan_repo,
        repo_type="dataset",
        revision=args.plan_revision,
        allow_patterns=f"{args.plan_path.strip('/')}/**",
        local_dir=work / "plan",
        token=token,
    ))
    plan_root = plan_snapshot / args.plan_path.strip("/")
    # Download the existing immutable shards, not upstream image URLs. The
    # source release is larger than the selected plan but is streamed by Xet
    # and remains ephemeral inside this job.
    source_snapshot = Path(snapshot_download(
        repo_id=args.source_library_repo,
        repo_type="dataset",
        revision=args.source_library_revision,
        allow_patterns=f"{args.source_library_path.strip('/')}/**",
        local_dir=work / "source-library",
        token=token,
    ))
    source_root = source_snapshot / args.source_library_path.strip("/")
    # Rewrite only the ephemeral local snapshot's metadata in place so the
    # selected manifest and its shards share one security boundary. A symlink
    # to shards elsewhere is intentionally rejected by DurableImageLibrary.
    virtual_root = source_root
    descriptor = build_virtual_pack(
        plan_root=plan_root,
        source_root=source_root,
        output=virtual_root,
        game=args.game,
        plan_repo=args.plan_repo,
        plan_revision=args.plan_revision,
        plan_path=args.plan_path,
    )
    print(json.dumps({"phase": "virtual-pack-ready", **descriptor}, sort_keys=True), flush=True)

    runner_path = decode_hub_path(args.runner_path)
    trainer_path = decode_hub_path(args.trainer_path)
    runner = hf_hub_download(
        repo_id=args.model_repo,
        repo_type="model",
        revision=args.model_revision,
        filename=runner_path,
        token=token,
    )
    command = [
        "uv", "run", runner,
        "--hub-repo", args.model_repo,
        "--mode", "full",
        "--games", args.game,
        "--artifact-variant", args.artifact_variant,
        "--catalog-revision", args.model_revision,
        "--trainer-hub-path-in-repo", trainer_path,
        "--prepared-image-library-root", str(virtual_root),
        "--max-prepared-images", str(descriptor["selectedRows"]),
        "--epochs", str(args.epochs),
        "--batch", str(args.batch),
        "--skip-pokemon-baseline",
    ]
    subprocess.run(command, check=True)


if __name__ == "__main__":
    main()
