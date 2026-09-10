#!/usr/bin/env python3
"""Evaluate fixed saved checkpoints on an immutable reviewed-session snapshot.

This is a geometry-only diagnostic, not a training release or checkpoint search.
It reuses the shared decoder, prediction schema, matcher, and metric scorer.
"""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import shutil
import statistics
import time

from PIL import Image

from benchmark_geometry import Truth, _truth_geometry, _prediction_validator, evaluate, load_predictions
from compare_reviewed_model import compare, POLICY
from corpus_release import load_json, sha256_file, write_json
from diagnose_corner_order_geometry import summary
from evaluate_geometry_candidate import Predictor, DECODER_CONFIG, EVALUATION_CONTRACT, CONTEXT_MARGIN


def checked(path, expected):
    path = Path(path)
    if sha256_file(path) != expected:
        raise ValueError(f"Input hash mismatch: {path.name}")
    return path


def session_records(backup, derived):
    """Adapt the lossless editor snapshot without claiming a new blind annotation."""
    labels = {r["key"]: r for r in derived["records"]}
    if len(labels) != len(derived["records"]) or set(labels) != {r["key"] for r in backup["records"]}:
        raise ValueError("Backup and evaluation copy contain different or duplicate photos")
    records = []
    for frame, saved in enumerate(backup["records"], 1):
        label = labels[saved["key"]]
        if [i["corners"] for i in label["instances"]] != saved["manual_quads"]:
            raise ValueError("Evaluation copy changed reviewed corners")
        path = checked(saved["imagePath"], saved["imageSha256"])
        with Image.open(path) as image:
            width, height = image.size
            if image.getexif().get(274, 1) != 1:
                raise ValueError("EXIF-rotated source requires an explicit pixel contract")
        instances = copy.deepcopy(label["instances"])
        for item in instances:
            points = item["corners"]
            item["corners"] = [
                {"point": {"x": x, "y": y}, "coordinateKnown": True,
                 "cornerSource": "human", "visibility": v}
                for (x, y), v in zip(points, item.pop("cornerVisibility"), strict=True)
            ]
        # Studio keys are paths; portable record IDs cannot contain slashes.
        records.append({"recordId": saved["key"].replace("/", ":"), "key": saved["key"], "reference": f"F{frame}",
                        "sampleId": saved["sampleId"], "sceneSlice": label["sceneSlice"],
                        "source": {"path": str(path), "sha256": saved["imageSha256"],
                                   "width": width, "height": height, "kind": "real"},
                        "instances": instances, "occlusionRelations": label.get("occlusionRelations", [])})
    return records


def exact_overlap(records, releases):
    hashes = {r["source"]["sha256"] for r in records}
    audit = []
    for root in releases:
        manifest = load_json(root / "manifest.json")
        shared = [{"recordId": e["recordId"], "split": e["split"], "sha256": image["sha256"]}
                  for e in manifest["records"] for image in e.get("images", []) if image["sha256"] in hashes]
        audit.append({"release": str(root), "manifestSha256": sha256_file(root / "manifest.json"),
                      "records": len(manifest["records"]), "exactImageMatches": shared})
        if shared:
            raise ValueError("Session contains exact images in an existing release")
    return audit


def score_records(records, predictions):
    manifest = {"records": [{"recordId": r["recordId"], "sceneSlice": r["sceneSlice"],
                             "leakageKeys": {"sourceKind": "real"}} for r in records]}
    truths = [Truth(r["recordId"], i, r["sceneSlice"], "real", r["source"]["width"], r["source"]["height"],
                    item, _truth_geometry(item), "quad") for r in records for i, item in enumerate(r["instances"])]
    return evaluate(manifest=manifest, policy={"metricEligibleCornerSources": ["human"]},
                    truths=truths, prediction_rows=predictions)


def target_rows(records, frames):
    rows = []
    for record, frame in zip(records, frames, strict=True):
        matches = {v: {m["truthId"]: m for m in frame["versions"][v]["matches"]} for v in ("baseline", "candidate")}
        for i, instance in enumerate(record["instances"]):
            points = [(c["point"]["x"] * record["source"]["width"],
                       c["point"]["y"] * record["source"]["height"]) for c in instance["corners"]]
            angle = math.degrees(math.atan2(points[1][1]-points[0][1], points[1][0]-points[0][0]))
            rows.append({"recordId": record["recordId"], "reference": record["reference"], "card": i+1,
                         "scene": record["sceneSlice"], "multiCard": len(record["instances"]) > 1,
                         "orientationKnown": instance["orientationKnown"], "printedAngle": angle,
                         "sideways": instance["orientationKnown"] and 45 <= abs(angle) <= 135,
                         "upsideDown": instance["orientationKnown"] and abs(angle) > 135,
                         "hasNonvisibleCorner": any(c["visibility"] != "visible" for c in instance["corners"]),
                         "meanSidePixels": sum(math.dist(points[j], points[(j+1)%4]) for j in range(4))/4,
                         **{v: matches[v].get(f"T{i+1}") for v in matches}})
    return rows


def run(args):
    import torch
    import ultralytics
    if ultralytics.__version__ != "8.4.138":
        raise ValueError("Use the validated Ultralytics 8.4.138 runtime")
    receipt = load_json(args.receipt)
    labels = checked(receipt["backupPath"], receipt["backupSha256"])
    derived = checked(receipt["evaluationGeometryPath"], receipt["evaluationGeometrySha256"])
    records = session_records(load_json(labels), load_json(derived))
    validator = _prediction_validator()
    if len({r["recordId"] for r in records}) != len(records):
        raise ValueError("Record ID collision")
    for record in records:
        validator.validate({"recordId": record["recordId"], "localizerId": "session-preflight", "results": []})
    inventory = load_json(args.candidates)
    choices = {"baseline": getattr(args, "baseline_id", "previous"),
               "candidate": getattr(args, "candidate_id", "cyclic-epoch50")}
    selected = {name: next(c for c in inventory["candidates"] if c["id"] == identifier)
                for name, identifier in choices.items()}
    for model in selected.values():
        checked(model["checkpoint"], model["checkpointSha256"])
    source_paths = [Path(__file__)] + [Path(__file__).with_name(name) for name in (
        "evaluate_geometry_candidate.py", "reference_geometry.py", "benchmark_geometry.py",
        "compare_reviewed_model.py", "diagnose_corner_order_geometry.py")]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    source_dir = output / "source"
    source_dir.mkdir()
    for path in source_paths:
        shutil.copy2(path, source_dir / path.name)
    write_json(output / "session-inputs.json", records)
    # Write the complete protocol BEFORE inference. No model/threshold search.
    protocol = {"schema": "tcger-reviewed-session-evaluation/v1", "createdAt": datetime.now(timezone.utc).isoformat(),
                "purpose": "reserved session comparison of two preselected checkpoints; no checkpoint ranking on this session",
                "receipt": str(args.receipt.resolve()), "receiptSha256": sha256_file(args.receipt),
                "labelsSha256": sha256_file(labels), "derivedGeometrySha256": sha256_file(derived),
                "sessionInputsSha256": sha256_file(output / "session-inputs.json"),
                "models": {name: {k: model[k] for k in ("id", "checkpoint", "checkpointSha256")} for name, model in selected.items()},
                "resolution": 640, "device": "cpu", "threads": 4, "torch": torch.__version__,
                "ultralytics": ultralytics.__version__, "decoder": DECODER_CONFIG,
                "evaluationContract": EVALUATION_CONTRACT, "contextMargin": CONTEXT_MARGIN,
                "matching": "shared deterministic one-to-one greedy IoU matcher", "triagePolicy": POLICY,
                "sourceHashes": {p.name: sha256_file(p) for p in source_paths},
                "exactOverlapAudit": exact_overlap(records, args.exclude_release),
                "uniqueImageHashes": len({r["source"]["sha256"] for r in records}),
                "limitations": ["One session with repeated views; 106 instances are not 106 independent physical cards.",
                                "This session has already been inspected during development; repeat results are diagnostic, not a fresh blind test.",
                                "Labels are reviewer-approved starting outlines, not an independent blind second annotation.",
                                "No verified recognition identities; recognition accuracy cannot be scored.",
                                "Exact-hash exclusion does not prove physical-card or near-duplicate independence.",
                                "No production promotion or checkpoint selection from this session."]}
    write_json(output / "protocol.json", protocol)
    torch.set_num_threads(4)
    predictions = {}; benchmarks = {}; timings = {}
    started = time.monotonic()
    for name, model in selected.items():
        predictor = Predictor("yolo11s-pose", Path(model["checkpoint"]).parent, model["checkpointSha256"],
                              640, device="cpu", checkpoint_path=Path(model["checkpoint"]))
        predictor.model.to("cpu")
        elapsed = []
        destination = output / f"{name}.predictions.jsonl"
        with destination.open("x") as handle:
            for i, record in enumerate(records):
                path = checked(record["source"]["path"], record["source"]["sha256"])
                begin = time.monotonic()
                result = predictor(path)
                elapsed.append(time.monotonic()-begin)
                handle.write(json.dumps({"recordId": record["recordId"], "localizerId": model["id"], "results": result}, sort_keys=True)+"\n")
                handle.flush()
                if (i+1) % 15 == 0:
                    print(f"{name}: {i+1}/{len(records)} photos · total {time.monotonic()-started:.1f}s", flush=True)
        _, predictions[name] = load_predictions(destination, {r["recordId"] for r in records})
        benchmarks[name] = score_records(records, predictions[name])
        write_json(output / f"{name}.metrics.json", benchmarks[name])
        timings[name] = {"totalSeconds": sum(elapsed), "firstSeconds": elapsed[0],
                         "subsequentMedianSeconds": statistics.median(elapsed[1:]) if len(elapsed)>1 else None}
        del predictor
    frames = [{"id": r["recordId"], "key": r["key"], "reference": r["reference"], "scene": r["sceneSlice"],
               "source": r["source"], "sampleId": r["sampleId"],
               "versions": {name: compare(r, r["sceneSlice"], values[r["recordId"]]) for name, values in predictions.items()},
               "predictions": {name: values[r["recordId"]] for name, values in predictions.items()}} for r in records]
    rows = target_rows(records, frames)
    report = {"schema": "tcger-reviewed-session-comparison/v1", "protocolSha256": sha256_file(output / "protocol.json"),
              "counts": {"photos": len(records), "cardInstances": len(rows)}, "models": protocol["models"],
              "metrics": benchmarks, "paired": summary(rows),
              "slices": {key: summary([r for r in rows if r[key]]) for key in ("multiCard", "sideways", "upsideDown", "hasNonvisibleCorner")},
              "timings": timings, "frames": frames, "targets": rows, "limitations": protocol["limitations"]}
    write_json(output / "comparison.json", report)
    for path in source_paths:
        checked(path, protocol["sourceHashes"][path.name])
    checked(labels, protocol["labelsSha256"]); checked(derived, protocol["derivedGeometrySha256"])
    for model in selected.values():
        checked(model["checkpoint"], model["checkpointSha256"])
    write_json(output / "verification.json", {"passed": True, "photosPerModel": len(records),
        "predictionRowsSchemaValidated": True, "inputsReverified": True, "liveLabelsWritten": False,
        "outputs": {p.name: sha256_file(p) for p in output.glob("*.json*")}})
    print(json.dumps({"output": str(output), "counts": report["counts"], "paired": report["paired"], "timings": timings}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--candidates", type=Path, required=True)
    parser.add_argument("--baseline-id", default="previous")
    parser.add_argument("--candidate-id", default="cyclic-epoch50")
    parser.add_argument("--exclude-release", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    run(parser.parse_args())
