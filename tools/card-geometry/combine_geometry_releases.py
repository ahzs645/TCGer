#!/usr/bin/env python3
"""Combine pinned shippable corpus parts under one fixed training policy."""

from __future__ import annotations

import argparse
import copy
import json
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
    load_schema,
    make_validator,
    pretty_json,
    sha256_bytes,
    validation_errors,
)

APPROVED_POLICY_ID = "training-minimums-v2"
APPROVED_POLICY_SHA256 = "b86ce9823667212afdb0158113539a81c79e3a7cfe1509acea88f5afb186816d"


def combine(
    *, inputs: list[Path], output: Path, release_id: str, policy_path: Path
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
    if policy.get("policyId") != APPROVED_POLICY_ID:
        raise ValueError("combined training release requires training-minimums-v2")
    if sha256_bytes(policy_bytes) != APPROVED_POLICY_SHA256:
        raise ValueError("training-minimums-v2 bytes do not match the approved hash")
    if policy.get("allowedSourceTiers") != ["shippable"]:
        raise ValueError("combined training release requires shippable-only policy")

    output.mkdir(parents=True, exist_ok=True)
    (output / "policy.json").write_bytes(policy_bytes)
    entries: list[dict[str, Any]] = []
    denylist: set[str] = set()
    seen_records: set[str] = set()
    seen_paths: set[str] = {"policy.json", "manifest.json"}
    for root in sorted((path.resolve() for path in inputs), key=str):
        manifest = load_json(root / "manifest.json")
        denylist.update(manifest["evaluationSessionDenylist"])
        for original in manifest["records"]:
            entry = copy.deepcopy(original)
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
                shutil.copyfile(root / relative, destination)
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
        "records": sorted(entries, key=lambda entry: entry["recordId"]),
    }
    manifest["corpusHash"] = corpus_hash(manifest)
    (output / "manifest.json").write_text(pretty_json(manifest), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-release", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--policy", type=Path, required=True)
    args = parser.parse_args()
    manifest = combine(
        inputs=args.input_release,
        output=args.output,
        release_id=args.release_id,
        policy_path=args.policy,
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
