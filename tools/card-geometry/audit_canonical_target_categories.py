#!/usr/bin/env python3
"""Trace geometry-release targets back to canonical annotation categories.

Two alignment modes exist and are never mixed inside one record:

* records from the category-aware importer carry `sourceAnnotationIndex` on
  every instance and `source.annotationCategories`; the audit aligns exactly
  through those indices and verifies both against the canonical corpus;
* legacy records (the original importer) carry no provenance and preserved the
  canonical annotation order, so positional alignment is valid only while the
  instance count equals the annotation count. Anything else fails rather than
  guessing.
"""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path


def _align(record, source):
    """Yield (instance, canonical annotation) pairs or raise when ambiguous."""
    instances = record["instances"]
    annotations = source["annotations"]
    indexed = [i for i in instances if "sourceAnnotationIndex" in i]
    if indexed:
        if len(indexed) != len(instances):
            raise ValueError(f"{record['recordId']}: partial provenance on instances")
        pairs = []
        for instance in instances:
            index = instance["sourceAnnotationIndex"]
            if not 0 <= index < len(annotations):
                raise ValueError(f"{record['recordId']}: sourceAnnotationIndex out of range")
            annotation = annotations[index]
            if instance.get("sourceCategory") != annotation["category"]:
                raise ValueError(
                    f"{record['recordId']}: instance {instance['instanceId']} claims "
                    f"{instance.get('sourceCategory')!r} but canonical says {annotation['category']!r}"
                )
            pairs.append((instance, annotation))
        declared = record["source"].get("annotationCategories")
        actual = dict(Counter(a["category"] for a in annotations))
        if declared != actual:
            raise ValueError(
                f"{record['recordId']}: annotationCategories {declared} != canonical {actual}"
            )
        return pairs, "provenance"
    # This branch describes the original importer, which preserved annotation
    # order. Fail rather than assume alignment for a differently imported release.
    if len(instances) != len(annotations):
        raise ValueError(
            f"{record['recordId']}: source annotation order cannot be inferred for this release"
        )
    return list(zip(instances, annotations)), "positional"


def audit(canonical_path, release):
    with canonical_path.open() as stream:
        canonical = {r["sha256"]: r for r in map(json.loads, stream)}
    manifest = json.loads((release / "manifest.json").read_text())
    counts = defaultdict(Counter)
    details = []
    alignment = Counter()
    for entry in manifest["records"]:
        if not entry["recordId"].startswith("coco-"):
            continue
        path = release / entry["path"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError("Release record hash mismatch")
        record = json.loads(path.read_text())
        source = canonical[record["source"]["sha256"]]
        pairs, mode = _align(record, source)
        alignment[mode] += 1
        split = entry["split"]
        counts[split]["records"] += 1
        bad = []
        cats = Counter(a["category"] for a in source["annotations"])
        counts[split]["recordsWithMultipleCardAnnotations"] += cats["card"] > 1
        for category, count in cats.items():
            counts[split][f"canonicalAnnotations:{category}"] += count
        for inst, ann in pairs:
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
        targetSemantics=manifest.get("targetSemantics"),
        alignment=dict(alignment),
        bySplit={split: dict(counter) for split, counter in counts.items()},
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
    print(json.dumps({"alignment": result["alignment"], "bySplit": result["bySplit"]}, indent=2))


if __name__ == "__main__":
    main()
