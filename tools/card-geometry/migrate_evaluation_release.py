#!/usr/bin/env python3
"""Create and verify a metadata-only v2 successor of a frozen evaluation release."""

from __future__ import annotations

import argparse
import copy
import shutil
from pathlib import Path
from typing import Any

from corpus_release import (
    MANIFEST_SCHEMA_ID,
    canonical_json,
    corpus_hash,
    load_json,
    sha256_bytes,
    sha256_file,
    write_json,
)
from preflight import Expectations, run_preflight


MIGRATION_FIELDS = frozenset({
    "schema", "releaseId", "supersedes", "sourceArchiveAliases", "corpusHash",
})


def _file(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError(f"missing or unsafe release file: {relative}")
    return path


def _verify_payload(root: Path, manifest: dict[str, Any]) -> None:
    """Check actual bytes, not just matching declarations in two manifests."""
    for entry in manifest["records"]:
        for item in [entry, *entry["images"]]:
            if sha256_file(_file(root, item["path"])) != item["sha256"]:
                raise ValueError(f"payload hash mismatch: {item['path']}")
    readiness = manifest["readiness"]
    if sha256_file(_file(root, readiness["readinessPolicyPath"])) != readiness["readinessPolicySha256"]:
        raise ValueError("readiness policy hash mismatch")


def verify_successor(
    predecessor: Path, successor: Path, *, expected_predecessor_hash: str
) -> dict[str, Any]:
    old = load_json(predecessor / "manifest.json")
    new = load_json(successor / "manifest.json")
    if old["corpusHash"] != expected_predecessor_hash or corpus_hash(old) != expected_predecessor_hash:
        raise ValueError("predecessor corpus hash mismatch")
    if corpus_hash(new) != new["corpusHash"]:
        raise ValueError("successor corpus hash mismatch")
    if new.get("schema") != MANIFEST_SCHEMA_ID:
        raise ValueError("successor must use the v2 manifest schema")
    if new.get("releaseId") == old["releaseId"]:
        raise ValueError("successor needs a distinct releaseId")
    if new.get("supersedes") != {"releaseId": old["releaseId"], "corpusHash": old["corpusHash"]}:
        raise ValueError("supersedes does not identify the pinned predecessor")
    if old["releasePurpose"] == "training" or any(e["split"] == "train" for e in old["records"]):
        raise ValueError("metadata-only migration is restricted to evaluation releases")
    old_payload = {k: v for k, v in old.items() if k not in MIGRATION_FIELDS}
    new_payload = {k: v for k, v in new.items() if k not in MIGRATION_FIELDS}
    if canonical_json(old_payload) != canonical_json(new_payload):
        raise ValueError("immutable manifest payload changed (records, hashes, splits, slices or policy)")
    aliases = {entry["leakageKeys"]["sourceArchiveId"]: entry["leakageKeys"]["sourceArchiveId"] for entry in old["records"]}
    if new.get("sourceArchiveAliases") != aliases:
        raise ValueError("successor must contain exactly the predecessor's self-mapped archive IDs")
    _verify_payload(predecessor, old)
    _verify_payload(successor, new)
    report = run_preflight(successor, expectations=Expectations(corpus_hash=new["corpusHash"]))
    if report["failedChecks"]:
        raise ValueError(f"successor preflight failed: {report['failedChecks']}")
    return {
        "schema": "https://tcger.app/reports/evaluation-release-migration/v1",
        "predecessor": {"releaseId": old["releaseId"], "corpusHash": old["corpusHash"]},
        "successor": {"releaseId": new["releaseId"], "corpusHash": new["corpusHash"]},
        "immutableManifestPayloadSha256": sha256_bytes(canonical_json(old_payload)),
        "recordsVerified": len(old["records"]),
        "imagesVerified": sum(len(entry["images"]) for entry in old["records"]),
        "recordBytesIdentical": True,
        "imageBytesIdentical": True,
        "splitsIdentical": True,
        "sceneSlicesIdentical": True,
        "preflightFailedChecks": report["failedChecks"],
    }


def migrate(
    predecessor: Path, successor: Path, *, release_id: str, expected_predecessor_hash: str
) -> dict[str, Any]:
    old = load_json(predecessor / "manifest.json")
    if old["corpusHash"] != expected_predecessor_hash or corpus_hash(old) != expected_predecessor_hash:
        raise ValueError("predecessor corpus hash mismatch")
    _verify_payload(predecessor, old)
    # Copy rather than hard-link frozen files: edits to the successor must never
    # modify the predecessor's bytes through a shared inode.
    shutil.copytree(predecessor, successor)
    new = copy.deepcopy(old)
    new.update({
        "schema": MANIFEST_SCHEMA_ID,
        "releaseId": release_id,
        "supersedes": {"releaseId": old["releaseId"], "corpusHash": old["corpusHash"]},
        "sourceArchiveAliases": {entry["leakageKeys"]["sourceArchiveId"]: entry["leakageKeys"]["sourceArchiveId"] for entry in old["records"]},
    })
    new["corpusHash"] = corpus_hash(new)
    write_json(successor / "manifest.json", new)
    report = verify_successor(predecessor, successor, expected_predecessor_hash=expected_predecessor_hash)
    write_json(successor / "migration-verification.json", report)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predecessor", type=Path, required=True)
    parser.add_argument("--successor", type=Path, required=True)
    parser.add_argument("--expected-predecessor-hash", required=True)
    parser.add_argument("--release-id", help="required when creating a successor")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.verify_only:
        report = verify_successor(args.predecessor, args.successor, expected_predecessor_hash=args.expected_predecessor_hash)
    else:
        if not args.release_id:
            parser.error("--release-id is required when creating a successor")
        report = migrate(args.predecessor, args.successor, release_id=args.release_id, expected_predecessor_hash=args.expected_predecessor_hash)
    write_json(args.report, report)
    print(f"verified {report['recordsVerified']} records: {report['predecessor']['corpusHash']} -> {report['successor']['corpusHash']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
