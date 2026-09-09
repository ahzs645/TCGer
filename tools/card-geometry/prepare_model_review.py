#!/usr/bin/env python3
"""Prepare a pinned review catalog from already-evaluated YOLO11 predictions."""
import argparse
import json
from collections import Counter
from pathlib import Path

from benchmark_geometry import Truth, _prediction, _truth_geometry, match_record
from model_review import cards_from_results, fingerprints, normalized_image, sha, write_json

ROOT = Path(__file__).resolve().parents[2]


def scores(record, scene, results):
    source = record["source"]
    truths = [Truth(record["recordId"], i, scene, "real", source["width"], source["height"],
                    item, _truth_geometry(item), None) for i, item in enumerate(record["instances"])]
    matches, misses, extras, duplicates, _ = match_record(truths, [_prediction(r, i) for i, r in enumerate(results)])
    return {"expected": sum(t.geometry is not None for t in truths), "found": len(results),
            "misses": len(misses), "extras": len(extras), "duplicates": duplicates,
            "loose": sum(m.iou < .75 for m in matches)}


def prepare(args):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    release = args.release.resolve()
    manifest = json.loads((release / "manifest.json").read_text())
    current = {r["recordId"]: r["results"] for r in map(json.loads, args.predictions.read_text().splitlines())}
    previous = {r["recordId"]: r["results"] for r in map(json.loads, args.previous.read_text().splitlines())}
    model_sha = sha(args.checkpoint.read_bytes())
    if model_sha != args.model_sha256:
        raise ValueError("Checkpoint hash mismatch")
    frames, protected = [], set()
    for index, entry in enumerate(sorted(manifest["records"], key=lambda e: e["recordId"])):
        record_bytes = (release / entry["path"]).read_bytes()
        if sha(record_bytes) != entry["sha256"]:
            raise ValueError("Evaluation record hash mismatch")
        record = json.loads(record_bytes)
        key, source, scene = record["recordId"], record["source"], entry["sceneSlice"]
        image_path = release / source["path"]
        image_data = image_path.read_bytes()
        if sha(image_data) != source["sha256"]:
            raise ValueError("Evaluation image hash mismatch")
        results = current[key]
        if any(r["artifactSha256"] != model_sha for r in results):
            raise ValueError("Predictions belong to another checkpoint")
        protected.add(source["sha256"])
        frames.append({"id": key, "reference": f"R{index + 1:03d}", "name": key,
                       "scene": scene, "kind": "benchmark", "imagePath": str(image_path),
                       "imageSha256": source["sha256"], "width": source["width"], "height": source["height"],
                       **fingerprints(normalized_image(image_data)), "trainingCandidateEligible": False,
                       "warning": "Held-out benchmark · feedback is for evaluation only",
                       "proposals": cards_from_results(results), "previous": cards_from_results(previous[key]),
                       "referencePolygons": [list(map(list, polygon)) for i in record["instances"]
                                             if (polygon := _truth_geometry(i)) is not None],
                       "metrics": {"current": scores(record, scene, results), "previous": scores(record, scene, previous[key])}})
    for path in args.protect_release:
        for entry in json.loads((path / "manifest.json").read_text())["records"]:
            protected.update(image["sha256"] for image in entry["images"])
    # Include every rare binder page; otherwise four hard cases and two improvements per scene.
    starter = []
    for scene in sorted({f["scene"] for f in frames}, key=lambda s: (s == "single_card_archive", s)):
        group = [f for f in frames if f["scene"] == scene]
        def difficulty(f):
            m = f["metrics"]["current"]
            return m["misses"] * 4 + m["extras"] * 3 + m["loose"]
        def gain(f):
            m, old = f["metrics"]["current"], f["metrics"]["previous"]
            return sum(old[k] - m[k] for k in ("misses", "extras", "loose"))
        limit = 3 if scene == "single_card_archive" else 6
        selected = sorted(group, key=lambda f: (-difficulty(f), f["id"]))[:max(1, limit - 2)]
        selected += [f for f in sorted(group, key=lambda f: (-gain(f), f["id"])) if f not in selected][:limit - len(selected)]
        starter.extend(f["id"] for f in selected)
    catalog_path = output / "catalog.json"
    catalog = {"schema": "tcger-model-review-catalog/v1", "corpusHash": manifest["corpusHash"],
               "modelSha256": model_sha, "predictionsSha256": sha(args.predictions.read_bytes()),
               "previousPredictionsSha256": sha(args.previous.read_bytes()),
               "frames": frames, "protectedImageHashes": sorted(protected)}
    write_json(catalog_path, catalog)
    config = {"modelName": "Reviewed YOLO11s · September 8", "modelSha256": model_sha,
              "checkpoint": str(args.checkpoint.resolve()), "catalog": str(catalog_path),
              "catalogSha256": sha(catalog_path.read_bytes()), "storage": str(output / "feedback"), "starter": starter}
    write_json(output / "config.json", config)
    print(json.dumps({"config": str(output / "config.json"), "frames": len(frames), "starter": len(starter),
                      "scenes": Counter(f["scene"] for f in frames), "protectedHashes": len(protected)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--previous", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--model-sha256", required=True)
    parser.add_argument("--protect-release", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    prepare(parser.parse_args())
