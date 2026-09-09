#!/usr/bin/env python3
"""Diagnostic replay of saved geometry with two or four cyclic crop orientations.

Leaves the frozen evaluator, predictions, model and thresholds unchanged. The
four-way branch rewarps the source quad before rectification; rotating a badly
stretched portrait crop by 90 degrees would not restore its aspect ratio.
"""
import argparse
import collections
import json
from pathlib import Path

import numpy as np
from PIL import Image

from compare_corner_order_run import predictions
from corpus_release import load_json, sha256_file, write_json
from crop_parity import warp_reference
from evaluate_geometry_candidate import _recognition_decision, classify_replay_outcome
from replay_label_crop_recognition import load_runtimes, trusted_label_quad


def cyclic_crops(image, quad):
    def warp(points):
        return Image.fromarray(warp_reference(image, points, mapping="imageEdge",
                              kernel="bilinear", inset=0.0, border="black"))
    upright = warp(quad)
    quarter = warp(quad[1:] + quad[:1])
    # Preserve the historical first two crops and their tie-breaking exactly.
    return [(0, upright), (2, upright.rotate(180)),
            (1, quarter), (3, quarter.rotate(180))]


def outcome(case, families, value):
    if value is None:
        row = {"family": None, "accepted": False, "topScore": None,
               "rivalMargin": None, "phase": None}
    else:
        phase, (family, accepted, score, margin) = value
        row = {"family": family, "accepted": bool(accepted), "topScore": score,
               "rivalMargin": margin, "phase": phase}
    row["outcome"] = classify_replay_outcome(case["expectation"], accepted=row["accepted"],
        family=row["family"], expected_families=families.get(str(case.get("expectedCardId")), set()),
        forbidden_families=families.get(str(case.get("forbiddenCardId")), set()))
    return row


def best_value(scored):
    return max(scored, key=lambda value: value[1][2], default=None)


def run(args):
    root = args.run_root
    download = load_json(root / "results-download.json")
    candidate = args.candidate_evaluation or Path(download["root"]) / "training-output/evaluation"
    versions = ("candidate",) if args.candidate_only else ("baseline", "candidate", "humanLabel")
    baseline = root / "comparison-inputs/baseline"
    config = load_json(root / "yolo11s-pose.json")
    pins = config["evaluations"]["recognitionModels"]["games"]
    for game, pin in pins.items():
        folder = args.models_root / game
        for kind in ("onnx", "metadata", "vectors"):
            assert sha256_file(folder / Path(pin[kind]["path"]).name) == pin[kind]["sha256"]
        policy = load_json(folder / "policy.json")
        assert all(policy[k] == pin[k] for k in ("strongThreshold", "queryNormalization"))
    manifest = load_json(args.release / "manifest.json")
    entries = {entry["recordId"]: entry for entry in manifest["records"]}
    reports = {v: load_json(path / "recognition-replay.json")
               for v, path in (("baseline", baseline), ("candidate", candidate))}
    predictions_by_version = {}
    for version, folder in (("baseline", baseline), ("candidate", candidate)):
        path = folder / "real-v3.predictions.jsonl"
        assert sha256_file(path) == reports[version]["predictionsSha256"]
        assert manifest["corpusHash"] == reports[version]["corpusHash"]
        assert sha256_file(args.release / "recognition-replay.json") == reports[version]["replayManifestSha256"]
        predictions_by_version[version] = predictions(path)
    runtimes, families, verified_pins = load_runtimes(args.models_root)
    frozen = {v: {row["recordId"]: row for row in report["frames"]} for v, report in reports.items()}
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / "crops").mkdir()
    rows = []
    for index, case in enumerate(load_json(args.release / "recognition-replay.json")["records"]):
        rid = case["recordId"]
        entry = entries[rid]
        path = args.release / entry["path"]
        assert sha256_file(path) == entry["sha256"]
        record = load_json(path)
        source = args.release / record["source"]["path"]
        assert sha256_file(source) == record["source"]["sha256"]
        with Image.open(source) as opened:
            image = np.asarray(opened.convert("RGB"))
        row = {"recordId": rid, "game": case["game"], "expectation": case["expectation"],
               "imageSha256": record["source"]["sha256"], "versions": {}}
        for version in versions:
            quad = trusted_label_quad(record) if version == "humanLabel" else None
            top = None
            if version != "humanLabel":
                top = max(predictions_by_version[version].get(rid, []), key=lambda r: r["confidence"], default=None)
                if top:
                    quad = [[c["point"]["x"], c["point"]["y"]] for c in top["corners"]]
            if version == "humanLabel" and quad is None:
                row["versions"][version] = {"noTrustedLabel": True}
                continue
            crops = cyclic_crops(image, quad) if quad is not None else []
            scored = [(phase, _recognition_decision(runtimes[case["game"]], [crop]))
                      for phase, crop in crops]
            two = outcome(case, families[case["game"]], best_value(scored[:2]))
            four = outcome(case, families[case["game"]], best_value(scored))
            detail = {"two": two, "four": four, "quad": quad,
                      "phases": [outcome(case, families[case["game"]], value) for value in scored]}
            if version != "humanLabel":
                old = frozen[version][rid]
                detail["frozenOutcome"] = old["outcome"]
                detail["frozenParity"] = (two["outcome"] == old["outcome"]
                    and two["family"] == old["acceptedFamily"]
                    and two["accepted"] == old["accepted"])
                detail["scoreDifference"] = abs(two["topScore"] - old["topScore"]) if two["topScore"] is not None else None
            if case["expectation"] != "unknown" and crops:
                for label, selection in (("two", two), ("four", four)):
                    name = f"{rid}-{version}-{label}.jpg"
                    dict(crops)[selection["phase"]].save(args.output / "crops" / name, quality=92)
                    detail[label]["crop"] = "crops/" + name
            row["versions"][version] = detail
        rows.append(row)
        print(f"Replayed {index + 1}/57: {rid}", flush=True)
    summaries = {}
    for version in versions:
        group = [r for r in rows if not r["versions"][version].get("noTrustedLabel")]
        summaries[version] = {mode: dict(collections.Counter(r["versions"][version][mode]["outcome"] for r in group))
                              for mode in ("two", "four")}
        summaries[version]["frames"] = len(group)
        summaries[version]["byExpectation"] = {expectation: {mode: dict(collections.Counter(
            r["versions"][version][mode]["outcome"] for r in group if r["expectation"] == expectation))
            for mode in ("two", "four")} for expectation in ("identify", "forbidden-accept", "unknown")}
    parity = [r["versions"][v] for r in rows for v in versions if v != "humanLabel"]
    report = {"diagnosticOnly": True, "corpusHash": manifest["corpusHash"], "recognitionModels": verified_pins,
        "candidateEvaluation": str(candidate.resolve()),
        "candidatePredictionsSha256": sha256_file(candidate / "real-v3.predictions.jsonl"),
        "cropContract": {"destination": [720, 1000], "fourWay": "source quad phases 0,2,1,3; clockwise winding preserved",
                         "twoWay": "frozen 0/180 crop rotation", "selection": "highest encoder top score; unchanged thresholds"},
        "frozenParity": {"cases": len(parity), "sameDecision": sum(p["frozenParity"] for p in parity),
                         "maxScoreDifference": max(p["scoreDifference"] or 0 for p in parity)},
        "summary": summaries, "frames": rows}
    write_json(args.output / "recognition-diagnosis.json", report)
    print(json.dumps({k: report[k] for k in ("frozenParity", "summary")}, indent=2), flush=True)
    assert report["frozenParity"]["sameDecision"] == len(parity), "CPU replay disagrees with frozen decisions; investigate before attributing changes"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("run-root", "release", "models-root", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--candidate-evaluation", type=Path, help="Optional saved evaluation for another checkpoint")
    parser.add_argument("--candidate-only", action="store_true", help="Reuse existing control evidence; replay only this candidate")
    run(parser.parse_args())
