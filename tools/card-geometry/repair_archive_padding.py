#!/usr/bin/env python3
"""Build a derived release with verified reflected borders replaced by constant padding.

The correction file names exact source hashes and pixel content bounds. Images
retain their dimensions and all interior decoded pixels, so existing normalized
corner coordinates remain valid. Original archives and releases are untouched.
"""

from __future__ import annotations

import argparse
import copy
import json
import shutil
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

from corpus_release import corpus_hash, load_json, sha256_file, write_json

METHOD = "reflected-border-to-constant-v1"
FILL = (114, 114, 114)


def clip_box(box, bounds, width, height):
    left, top, right, bottom = bounds
    clipped = {"left": max(box["left"], left / width), "top": max(box["top"], top / height),
               "right": min(box["right"], right / width), "bottom": min(box["bottom"], bottom / height)}
    return clipped if clipped["right"] > clipped["left"] and clipped["bottom"] > clipped["top"] else None


def validate_correction(record, correction):
    source = record["source"]
    if correction["originalImageSha256"] != source["sha256"]:
        raise ValueError(f"Correction image hash mismatch: {record['recordId']}")
    bounds = correction["contentBounds"]
    if (len(bounds) != 4 or any(type(x) is not int for x in bounds)
            or not (0 <= bounds[0] < bounds[2] <= source["width"]
                    and 0 <= bounds[1] < bounds[3] <= source["height"])):
        raise ValueError("Invalid integer content bounds")
    if bounds == [0, 0, source["width"], source["height"]]:
        raise ValueError("Correction must identify an actual border")


def repair_record(record, correction, input_root, output_root):
    validate_correction(record, correction)
    record = copy.deepcopy(record)
    source = record["source"]
    image_path = input_root / source["path"]
    if sha256_file(image_path) != source["sha256"]:
        raise ValueError("Source image bytes changed")
    bounds = correction["contentBounds"]
    left, top, right, bottom = bounds
    with Image.open(image_path) as image:
        if image.size != (source["width"], source["height"]):
            raise ValueError("Source dimensions changed")
        pixels = np.array(image.convert("RGB"))
    cleaned = np.full_like(pixels, FILL)
    cleaned[top:bottom, left:right] = pixels[top:bottom, left:right]
    image_relative = str(Path(source["path"]).with_suffix(".png"))
    (output_root / image_relative).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(cleaned).save(output_root / image_relative, format="PNG")
    removed, clipped, retained = [], [], []
    for instance in record["instances"]:
        box = clip_box(instance["box"], bounds, source["width"], source["height"])
        if box is None:
            removed.append(instance["sourceAnnotationIndex"])
            continue
        if box != instance["box"]:
            clipped.append(instance["sourceAnnotationIndex"])
            instance["box"] = box
            # A fitted/human quad spanning mirrored pixels needs a fresh review.
            instance["corners"] = [{"coordinateKnown": False, "visibility": "unlabeled"} for _ in range(4)]
            instance["orientationKnown"] = False
            instance.pop("cornerFit", None)
        retained.append(instance)
    if not retained:
        raise ValueError("Correction would remove every card; review this frame separately")
    if sorted(removed) != sorted(correction["removeAnnotationIndices"]):
        raise ValueError(f"Removal list differs from content bounds: {record['recordId']}")
    record["instances"] = retained
    source["paddingCorrection"] = {"method": METHOD, "originalImageSha256": source["sha256"],
                                    "contentBounds": bounds, "fillRGB": list(FILL),
                                    "removedAnnotationIndices": removed, "clippedAnnotationIndices": clipped}
    source["path"] = image_relative
    source["sha256"] = sha256_file(output_root / image_relative)
    return record


def repair_release(input_root, output_root, corrections_path, release_id):
    if output_root.exists() and any(output_root.iterdir()):
        raise FileExistsError(f"Refusing to replace non-empty output: {output_root}")
    original = load_json(input_root / "manifest.json")
    corrections = load_json(corrections_path)
    if corrections["sourceCorpusHash"] != original["corpusHash"]:
        raise ValueError("Correction file belongs to another release")
    by_id = {r["recordId"]: r for r in corrections["frames"]}
    if len(by_id) != len(corrections["frames"]):
        raise ValueError("Duplicate correction record IDs")
    entries = {e["recordId"]: e for e in original["records"]}
    if set(by_id) - set(entries):
        raise ValueError("Unknown correction records")
    # This operation is intentionally restricted to training data.
    for rid, correction in by_id.items():
        entry = entries[rid]
        if entry["split"] != "train" or entry["leakageKeys"]["sourceArchiveId"] != corrections["sourceArchiveId"]:
            raise ValueError("Corrections must belong to the declared training archive")
        validate_correction(load_json(input_root / entry["path"]), correction)
    shutil.copytree(input_root, output_root, dirs_exist_ok=True)
    manifest = copy.deepcopy(original)
    stats = Counter()
    for entry in manifest["records"]:
        correction = by_id.get(entry["recordId"])
        if correction is None:
            continue
        old_record = load_json(input_root / entry["path"])
        repaired = repair_record(old_record, correction, input_root, output_root)
        write_json(output_root / entry["path"], repaired)
        entry["sha256"] = sha256_file(output_root / entry["path"])
        entry["images"] = [{"path": repaired["source"]["path"], "sha256": repaired["source"]["sha256"]}]
        if old_record["source"]["path"] != repaired["source"]["path"]:
            (output_root / old_record["source"]["path"]).unlink()
        metadata = repaired["source"]["paddingCorrection"]
        stats["imagesRepaired"] += 1
        stats["falseTargetsRemoved"] += len(metadata["removedAnnotationIndices"])
        stats["crossingTargetsClipped"] += len(metadata["clippedAnnotationIndices"])
    manifest["releaseId"] = release_id
    manifest["corpusHash"] = corpus_hash(manifest)
    write_json(output_root / "manifest.json", manifest)
    write_json(output_root / "padding-corrections.json", corrections)
    previous_summary = load_json(input_root / "build-summary.json") if (input_root / "build-summary.json").exists() else {}
    summary = {"release": str(output_root), "corpusHash": manifest["corpusHash"],
               "canonicalCorpusSha256": previous_summary.get("canonicalCorpusSha256"),
               "sourceRelease": str(input_root), "sourceCorpusHash": original["corpusHash"],
               "correctionSha256": sha256_file(corrections_path), "method": METHOD,
               "records": len(manifest["records"]), "stats": dict(stats)}
    write_json(output_root / "build-summary.json", summary)
    return summary


def migrate_journal(old_queue, old_release, old_journal, new_queue, new_release, new_journal):
    """Replay historical revisions into new pins, retaining interior labels verbatim."""
    from archive_corner_label_server import Store

    if new_journal.exists():
        raise FileExistsError(f"Refusing to replace a journal: {new_journal}")
    old = Store(old_queue, old_release, old_journal)
    new = Store(new_queue, new_release, new_journal)
    counts = Counter()
    for line in old_journal.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row["pins"] != old.pins:
            raise ValueError("Foreign revision in original journal")
        rid = row["recordId"]
        if rid not in new.frames:
            raise ValueError(f"Previously reviewed frame disappeared: {rid}")
        frame = new.frames[rid]
        if (frame["width"], frame["height"]) != (old.frames[rid]["width"], old.frames[rid]["height"]):
            raise ValueError("Migration requires identical coordinate systems")
        if frame.get("canonicalImageSha256", frame["imageSha256"]) != old.frames[rid]["imageSha256"]:
            raise ValueError("Migration image lineage does not match")
        allowed = {str(t["sourceAnnotationIndex"]) for t in frame["instances"]}
        clipped = {str(i) for i in frame.get("paddingCorrection", {}).get("clippedAnnotationIndices", [])}
        targets = {k: v for k, v in row["targets"].items() if k in allowed and k not in clipped}
        counts["historicalTargetEntriesRemoved"] += len(row["targets"]) - len(targets)
        saved = new.save(rid, {"reviewer": row["reviewer"], "notes": row.get("notes", ""),
                               "targets": targets, "direction": row.get("direction", 0),
                               "revision": new.saved.get(rid, {}).get("revision", 0)})
        if saved["revision"] != row["revision"]:
            raise ValueError("Historical revision sequence changed")
        counts["revisionsMigrated"] += 1
    counts["framesMigrated"] = len(new.saved)
    write_json(new_journal.with_suffix(".migration.json"), {
        "sourceJournal": str(old_journal), "sourceJournalSha256": sha256_file(old_journal),
        "originalPins": old.pins, "newPins": new.pins, "counts": dict(counts)})
    return dict(counts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--corrections", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    args = parser.parse_args()
    print(json.dumps(repair_release(args.release, args.output, args.corrections, args.release_id), indent=2))


if __name__ == "__main__":
    main()
