#!/usr/bin/env python3
"""Combine pinned shippable corpus parts under one fixed training policy."""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus_release import (  # noqa: E402
    MANIFEST_SCHEMA_ID,
    POLICY_SCHEMA_FILE,
    corpus_hash,
    load_json,
    leakage_keys_from_record,
    load_schema,
    make_validator,
    pretty_json,
    sha256_bytes,
    validation_errors,
)

APPROVED_POLICY_ID = "training-minimums-v2"
APPROVED_POLICY_SHA256 = "b86ce9823667212afdb0158113539a81c79e3a7cfe1509acea88f5afb186816d"
ROUND_TWO_POLICY_SHA256 = "679dd02c8e6280f2043978e007ea16d9608eba9a0c74ea2766477b885c4e56da"


def link_or_copy(source: Path, destination: Path) -> str:
    """Preserve immutable release bytes without duplicating them when possible."""
    try:
        os.link(source, destination)
        return "hardlink"
    except OSError:
        shutil.copyfile(source, destination)
        return "copy"


def combine(
    *, inputs: list[Path], output: Path, release_id: str, policy_path: Path,
    evaluation_releases: dict[str, Path] | None = None,
) -> dict[str, Any]:
    if not inputs:
        raise ValueError("at least one input release is required")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"refusing to replace non-empty output: {output}")
    policy_bytes = policy_path.read_bytes()
    policy = json.loads(policy_bytes)
    errors = validation_errors(make_validator(load_schema(POLICY_SCHEMA_FILE)), policy)
    if errors:
        raise ValueError("invalid readiness policy:\n- " + "\n- ".join(errors))
    expected = {APPROVED_POLICY_ID: APPROVED_POLICY_SHA256,
                "training-minimums-v3": ROUND_TWO_POLICY_SHA256}.get(policy.get("policyId"))
    if expected is None or sha256_bytes(policy_bytes) != expected:
        raise ValueError("training policy bytes do not match the frozen v2 or v3 hash")
    round_two = policy["policyId"] == "training-minimums-v3"
    if round_two and set(evaluation_releases or {}) != {"frozenReal", "syntheticMultigame"}:
        raise ValueError("v3 requires separately pinned frozenReal and syntheticMultigame evaluations")
    if round_two:
        from preflight import run_preflight
        for name, root in {**evaluation_releases, **{f"input-{i}": root for i, root in enumerate(inputs)}}.items():
            if run_preflight(root)["failedChecks"]:
                raise ValueError(f"evaluation preflight failed: {name}")
    if policy.get("allowedSourceTiers") != ["shippable"]:
        raise ValueError("combined training release requires shippable-only policy")

    output.mkdir(parents=True, exist_ok=True)
    (output / "policy.json").write_bytes(policy_bytes)
    entries: list[dict[str, Any]] = []
    denylist: set[str] = set()
    seen_records: set[str] = set()
    seen_paths: set[str] = {"policy.json", "manifest.json"}
    aliases: dict[str, str] = {}
    for root in inputs:
        for archive_id, canonical_id in load_json(root / "manifest.json")["sourceArchiveAliases"].items():
            if archive_id in aliases and aliases[archive_id] != canonical_id:
                raise ValueError(f"conflicting archive alias: {archive_id}")
            aliases[archive_id] = canonical_id
    for root in sorted((path.resolve() for path in inputs), key=str):
        manifest = load_json(root / "manifest.json")
        denylist.update(manifest["evaluationSessionDenylist"])
        for original in manifest["records"]:
            entry = copy.deepcopy(original)
            if round_two and entry["split"] == "test":
                raise ValueError("v3 training corpus must not embed test records")
            entry["leakageKeys"] = leakage_keys_from_record(
                load_json(root / entry["path"]), aliases
            )
            if entry.get("sourceTier") != "shippable":
                raise ValueError(
                    f"{entry['recordId']} is not shippable: {entry.get('sourceTier')!r}"
                )
            if (
                entry["split"] == "test"
                and entry["leakageKeys"]["sourceKind"] == "synthetic"
            ):
                raise ValueError(f"synthetic test record forbidden: {entry['recordId']}")
            if entry["recordId"] in seen_records:
                raise ValueError(f"duplicate recordId: {entry['recordId']}")
            seen_records.add(entry["recordId"])
            for relative in [entry["path"], *(image["path"] for image in entry["images"])]:
                if relative in seen_paths:
                    raise ValueError(f"duplicate release path: {relative}")
                seen_paths.add(relative)
                destination = output / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                link_or_copy(root / relative, destination)
            entries.append(entry)

    manifest = {
        "schema": MANIFEST_SCHEMA_ID,
        "releaseId": release_id,
        "releasePurpose": "training",
        "readiness": {
            "readinessPolicyPath": "policy.json",
            "readinessPolicyId": policy["policyId"],
            "readinessPolicySha256": sha256_bytes(policy_bytes),
        },
        "splitAssignment": {"method": "combined-pinned-releases-v1", "seed": 0},
        "evaluationSessionDenylist": sorted(denylist),
        "sourceArchiveAliases": aliases,
        "records": sorted(entries, key=lambda entry: entry["recordId"]),
    }
    manifest["corpusHash"] = corpus_hash(manifest)
    if round_two:
        from corpus_release import canonical_json
        provenance_files = {}
        for root in inputs:
            part_id = load_json(root / "manifest.json")["releaseId"]
            for source in sorted(root.rglob("*")):
                if not source.is_file() or source.relative_to(root).parts[0] in {"records", "images"}:
                    continue
                relative = Path("provenance") / part_id / source.relative_to(root)
                target = output / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                link_or_copy(source, target)
                provenance_files[relative.as_posix()] = sha256_bytes(source.read_bytes())
                if source.name == "background-assets.json":
                    denylist.update(load_json(source).get("sessionExclusions", []))
        for root in evaluation_releases.values():
            evaluation = load_json(root / "manifest.json")
            denylist.update(evaluation["evaluationSessionDenylist"])
            denylist.update(entry["leakageKeys"]["sessionId"] for entry in evaluation["records"]
                            if entry["leakageKeys"].get("sessionId"))
        manifest["evaluationSessionDenylist"] = sorted(denylist)
        assignment = {}
        for entry in entries:
            key = entry["leakageKeys"]["sourceArchiveId"]
            if key in assignment and assignment[key] != entry["split"]:
                raise ValueError(f"canonical archive crosses splits: {key}")
            assignment[key] = entry["split"]
        inputs_hashes = {load_json(root / "manifest.json")["releaseId"]:
                        load_json(root / "manifest.json")["corpusHash"]
                        for root in [*inputs, *evaluation_releases.values()]}
        inventory = {"corpusHashes": inputs_hashes, "provenanceFiles": provenance_files}
        (output / "assembly-provenance.json").write_text(pretty_json(inventory))
        manifest["splitAssignment"] = {
            "method": "combined-pinned-releases-v3", "seed": 20260905,
            "archiveSplits": assignment,
            "inputInventorySha256": sha256_bytes(canonical_json(inventory)),
        }
        manifest["corpusHash"] = corpus_hash(manifest)
    (output / "manifest.json").write_text(pretty_json(manifest), encoding="utf-8")
    if round_two:
        from run_card_geometry_hf_job import check_cross_release_leakage
        report = check_cross_release_leakage(output, evaluation_releases)
        (output / "cross-release-leakage.json").write_text(pretty_json(report))
        if report["failedChecks"]:
            raise ValueError(f"cross-release leakage: {report['leaks']}")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-release", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--evaluation-release", action="append", default=[],
                        help="NAME=PATH; v3 requires frozenReal and syntheticMultigame")
    args = parser.parse_args()
    evaluations = {}
    for value in args.evaluation_release:
        name, separator, path = value.partition("=")
        if not separator or not name or not path or name in evaluations:
            parser.error("evaluation releases require unique NAME=PATH values")
        evaluations[name] = Path(path)
    manifest = combine(
        inputs=args.input_release,
        output=args.output,
        release_id=args.release_id,
        policy_path=args.policy,
        evaluation_releases=evaluations,
    )
    print(
        json.dumps(
            {
                "releaseId": manifest["releaseId"],
                "corpusHash": manifest["corpusHash"],
                "records": len(manifest["records"]),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
