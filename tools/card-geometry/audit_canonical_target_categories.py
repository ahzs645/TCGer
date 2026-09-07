#!/usr/bin/env python3
"""Trace geometry-release targets back to canonical annotation categories."""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path


def audit(canonical_path, release):
    with canonical_path.open() as stream:
        canonical = {r["sha256"]: r for r in map(json.loads, stream)}
    manifest = json.loads((release / "manifest.json").read_text())
    counts = defaultdict(Counter)
    details = []
    for entry in manifest["records"]:
        if not entry["recordId"].startswith("coco-"):
            continue
        path = release / entry["path"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError("Release record hash mismatch")
        record = json.loads(path.read_text())
        source = canonical[record["source"]["sha256"]]
        # This audit describes the original importer, which preserved annotation order.
        # Fail rather than assume alignment for a repaired or differently imported release.
        if len(record["instances"]) != len(source["annotations"]):
            raise ValueError(
                "Source annotation order cannot be inferred for this release"
            )
        split = entry["split"]
        counts[split]["records"] += 1
        bad = []
        cats = Counter(a["category"] for a in source["annotations"])
        counts[split]["recordsWithMultipleCardAnnotations"] += cats["card"] > 1
        for inst, ann in zip(record["instances"], source["annotations"]):
            known = all(c.get("coordinateKnown") for c in inst["corners"])
            counts[split][f"instances:{ann['category']}"] += 1
            counts[split][f"knownCorners:{ann['category']}"] += known
            if ann["category"] != "card":
                bad.append(
                    dict(
                        instanceId=inst["instanceId"],
                        sourceCategory=ann["category"],
                        knownCorners=known,
                        provenance=ann["provenance"],
                    )
                )
        if bad:
            counts[split]["affectedRecords"] += 1
            details.append(
                dict(
                    recordId=record["recordId"],
                    split=split,
                    sourceArchive=record["grouping"]["sourceArchiveId"],
                    misclassifiedInstances=bad,
                )
            )
    return dict(
        corpusHash=manifest["corpusHash"],
        canonicalSha256=hashlib.sha256(canonical_path.read_bytes()).hexdigest(),
        bySplit=dict(counts),
        affectedRecords=details,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canonical", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.canonical, args.release)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["bySplit"], indent=2))


if __name__ == "__main__":
    main()
