#!/usr/bin/env python3
"""Derive training data that honors explicit not-a-card review decisions."""
import argparse
import copy
import json
import shutil
from pathlib import Path

from corpus_release import corpus_hash, load_json, sha256_file, write_json


def exclude_record(record, review, journal_sha, split):
    rejected = [int(k) for k, target in review["targets"].items() if target.get("skip") == "not-a-card"]
    if not rejected:
        return copy.deepcopy(record), []
    if split != "train" or record["source"]["kind"] != "real":
        raise ValueError("Only real training records may have reviewed exclusions")
    if review["recordId"] != record["recordId"] or review["imageSha256"] != record["source"]["sha256"]:
        raise ValueError("Review record or image hash mismatch")
    if not review.get("reviewer") or not review.get("savedAt") or not review.get("complete") or review.get("drafts"):
        raise ValueError("Exclusions require a complete saved review")
    available = {i["sourceAnnotationIndex"] for i in record["instances"]}
    if not set(rejected) <= available or len(rejected) == len(available):
        raise ValueError("Unknown exclusion or removal of every target requires separate review")
    if record["source"].get("reviewedNonCardAnnotations"):
        raise ValueError("Record already has reviewed exclusions")
    result = copy.deepcopy(record)
    result["instances"] = [i for i in result["instances"] if i["sourceAnnotationIndex"] not in rejected]
    result["source"]["reviewedNonCardAnnotations"] = [
        {"sourceAnnotationIndex": i, "reason": "not-a-card", "reviewer": review["reviewer"],
         "savedAt": review["savedAt"], "journalSha256": journal_sha} for i in sorted(rejected)
    ]
    return result, sorted(rejected)


def derive(release, journal, output, release_id):
    if output.exists():
        raise FileExistsError(output)
    journal_sha = sha256_file(journal)
    reviews = {}
    for line in journal.read_text().splitlines():
        row = json.loads(line)
        reviews[row["recordId"]] = row
    manifest = load_json(release / "manifest.json")
    if corpus_hash(manifest) != manifest["corpusHash"]:
        raise ValueError("Input manifest hash mismatch")
    changed = {}
    for entry in manifest["records"]:
        review = reviews.get(entry["recordId"])
        if not review or not any(t.get("skip") == "not-a-card" for t in review["targets"].values()):
            continue
        path = release / entry["path"]
        if sha256_file(path) != entry["sha256"]:
            raise ValueError("Input record hash mismatch")
        record = load_json(path)
        if sha256_file(release / record["source"]["path"]) != record["source"]["sha256"]:
            raise ValueError("Input image hash mismatch")
        changed[entry["recordId"]] = exclude_record(record, review, journal_sha, entry["split"])
    expected = {k for k,r in reviews.items() if any(t.get("skip") == "not-a-card" for t in r["targets"].values())}
    if set(changed) != expected:
        raise ValueError("Review refers to a missing record")
    shutil.copytree(release, output)
    for entry in manifest["records"]:
        if entry["recordId"] in changed:
            write_json(output / entry["path"], changed[entry["recordId"]][0])
            entry["sha256"] = sha256_file(output / entry["path"])
    original_hash = manifest["corpusHash"]
    manifest["releaseId"] = release_id
    manifest["corpusHash"] = corpus_hash(manifest)
    write_json(output / "manifest.json", manifest)
    report = {"method": "saved-not-a-card-review-exclusions-v1", "sourceCorpusHash": original_hash,
              "corpusHash": manifest["corpusHash"], "journalSha256": journal_sha,
              "removedTargets": sum(len(v[1]) for v in changed.values()),
              "records": {k:v[1] for k,v in changed.items()}}
    write_json(output / "reviewed-non-card-exclusions.json", report)
    summary = load_json(output / "build-summary.json")
    write_json(output / "source-build-summary.json", summary)
    summary.update(release=str(output), corpusHash=manifest["corpusHash"], sourceCorpusHash=original_hash,
                   reviewedNonCardExclusions=report)
    write_json(output / "build-summary.json", summary)
    shutil.copyfile(journal, output / "review-journal.jsonl")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("release", "journal", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    args = parser.parse_args()
    print(json.dumps(derive(args.release, args.journal, args.output, args.release_id), indent=2))
