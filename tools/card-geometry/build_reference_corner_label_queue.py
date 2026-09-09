#!/usr/bin/env python3
"""Stage frozen archive references for manual corner review, without approvals.

Existing quads are retained; polygon-only references use the gated polygon fit
or a clearly identified enclosing rectangle. The queue and review journal are
separate from the frozen release. No model predictions are read.
"""
import argparse
import json
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

from archive_corner_label_server import validate_label_quad
from build_archive_corner_label_queue import SCHEMA
from build_real_smoke_release import _annotation_mask, _annotation_box
from corpus_release import load_json, sha256_file, write_json
from polygon_quad_fit import fit_polygon_quad, _order_quad


def reference_seed(instance, width, height):
    corners = instance.get("corners", [])
    if len(corners) == 4 and all(c.get("coordinateKnown") for c in corners):
        quad = [[c["point"]["x"], c["point"]["y"]] for c in corners]
        source = "existing-reference-quad"
    else:
        points = [(p["x"] * width, p["y"] * height) for p in instance["visibleMask"]["points"]]
        quad, outcome, _ = fit_polygon_quad(points)
        source = "reference-polygon-fit"
        if quad is None:
            quad = _order_quad(cv2.boxPoints(cv2.minAreaRect(np.asarray(points, dtype=np.float32))).tolist())
            source = f"reference-polygon-enclosing-box:{outcome}"
        quad = [[float(x) / width, float(y) / height] for x, y in quad]
    # Winding must be clockwise in image coordinates to avoid mirrored crops.
    # Keep the first corner; unknown printed-top order remains unknown.
    area = sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(quad, quad[1:]+quad[:1]))
    if area < 0:
        quad = [quad[0], quad[3], quad[2], quad[1]]
    validate_label_quad(quad)
    return {"seedCorners": quad, "seedSource": source,
            "seedOrientationKnown": bool(instance.get("orientationKnown")),
            "seedCornerVisibility": ["outsideFrame" if not (0 <= x <= 1 and 0 <= y <= 1) else "visible" for x, y in quad]}


def build_queue(release, canonical_corpus):
    manifest = load_json(release / "manifest.json")
    canonical = {r["id"]: r for line in canonical_corpus.read_text().splitlines() if line.strip() for r in [json.loads(line)]}
    frames, counts = [], Counter()
    for entry in sorted(manifest["records"], key=lambda e: e["recordId"]):
        if not entry["recordId"].startswith("coco-") or entry["split"] != "test":
            continue
        path = release / entry["path"]
        if sha256_file(path) != entry["sha256"]:
            raise ValueError(f"Reference record hash mismatch: {entry['recordId']}")
        record = load_json(path)
        source = record["source"]
        row = canonical[entry["recordId"].removeprefix("coco-")]
        if source["sha256"] != row["sha256"] or (source["width"], source["height"]) != (row["width"], row["height"]):
            raise ValueError(f"Canonical image binding mismatch: {entry['recordId']}")
        instances = []
        for instance in record["instances"]:
            index = int(instance["instanceId"].removeprefix("card-"))
            annotation = row["annotations"][index]
            mask, polygon = _annotation_mask(annotation, source["width"], source["height"])
            if mask != instance.get("visibleMask"):
                raise ValueError(f"Canonical annotation binding mismatch: {entry['recordId']}:{index}")
            seed = reference_seed(instance, source["width"], source["height"])
            instances.append({"instanceId": instance["instanceId"], "sourceAnnotationIndex": index,
                              "displayCardNumber": index + 1, "container": instance.get("container", "unknown"),
                              "seedBox": _annotation_box(annotation, polygon, source["width"], source["height"]),
                              "referencePolygon": [[p["x"], p["y"]] for p in mask["points"]], **seed})
            counts[seed["seedSource"]] += 1
        frames.append({"recordId": entry["recordId"], "canonicalRecordId": row["id"],
                       "split": entry["split"], "sceneSlice": entry["sceneSlice"],
                       "sourceArchiveId": entry["leakageKeys"]["sourceArchiveId"],
                       "imagePath": source["path"], "imageSha256": source["sha256"],
                       "width": source["width"], "height": source["height"], "instances": instances})
    return {"schema": SCHEMA, "releaseId": manifest["releaseId"], "corpusHash": manifest["corpusHash"],
            "manifestSha256": sha256_file(release / "manifest.json"),
            "canonicalCorpusSha256": sha256_file(canonical_corpus),
            "labelSidecarSchema": "https://tcger.app/schemas/card-geometry-archive-corner-labels/v1",
            "selection": {"rule": "Frozen test archive references, initialized from reference geometry only"},
            "presentation": {"kind": "reference-corners", "title": "Check the reference corners",
                             "subtitle": "TCGer · Reference corner review", "defaultColorFilter": "all",
                             "modelReviewUrl": "http://localhost:8768/model-review.html?set=imported",
                             "description": "Check the existing reference outline and rectified crop. Rotate the corner order if needed, then check Orientation certain. Drag points to correct the outline; C confirms a card. Your checks are saved separately from the original benchmark."},
            "counts": dict(counts), "frames": frames}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--canonical-corpus", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit("Use a new queue path; an existing queue may already have saved reviews.")
    queue = build_queue(args.release, args.canonical_corpus)
    write_json(args.output, queue)
    print(json.dumps({"photos": len(queue["frames"]), "cards": sum(len(f["instances"]) for f in queue["frames"]), "seeds": queue["counts"]}))
