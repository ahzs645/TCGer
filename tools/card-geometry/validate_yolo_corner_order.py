#!/usr/bin/env python3
"""Run a small real training/checkpoint round trip before the full experiment."""
import argparse
import copy
import csv
import json
from pathlib import Path

import numpy as np
import torch
from ultralytics import YOLO

from corpus_release import corpus_hash, sha256_file, write_json
from train_yolo_pose import materialize_yolo
from training_geometry import has_corner_supervision
from yolo_corner_order import CornerOrderPoseTrainer, DISABLED_AUGMENTATIONS


def run(args):
    torch.set_num_threads(4)
    args.output = args.output.resolve()
    manifest = json.loads((args.release / "manifest.json").read_text())
    selected, groups = [], set()
    required = {(split,kind) for split,kinds in (
        ("train",("real-known","real-unknown","real-box","synthetic")),
        ("validation",("real-unknown","real-box","synthetic"))) for kind in kinds}
    for row in manifest["records"]:
        if row["split"] not in {"train", "validation"}:
            continue
        record = json.loads((args.release / row["path"]).read_text())
        kind = record["source"]["kind"]
        if kind == "real":
            known = [i for i in record["instances"] if has_corner_supervision(i)]
            kind += "-known" if any(i["orientationKnown"] for i in known) else "-unknown" if known else "-box"
        group = (row["split"], kind)
        if group in groups:
            continue
        assert sha256_file(args.release / row["path"]) == row["sha256"]
        groups.add(group)
        selected.append(row)
        if required <= groups:
            break
    if not required <= groups:
        raise ValueError(f"smoke is missing supervision groups: {required-groups}")
    args.output.mkdir(parents=True, exist_ok=False)
    release = args.output / "subset"
    release.mkdir()
    for folder in ("images", "records"):
        (release / folder).symlink_to((args.release / folder).resolve(), target_is_directory=True)
    subset = copy.deepcopy(manifest)
    subset["records"] = selected
    subset["corpusHash"] = corpus_hash(subset)
    write_json(release / "manifest.json", subset)
    config = json.loads(args.config.read_text())
    data = args.output / "dataset"
    materialization = materialize_yolo(release, data, config["fairness"]["realContextMarginPolicy"], "cyclic-unknown-v1")
    baseline = YOLO(str(args.checkpoint))
    baseline.train(trainer=CornerOrderPoseTrainer, data=str(data/"dataset.yaml"),
        epochs=2, imgsz=320, batch=2, device=args.device, workers=0, amp=False,
        seed=20260905, deterministic=True, project=str(args.output/"training"), name="smoke",
        plots=False, verbose=False, save=True, save_period=1, close_mosaic=0,
        **dict.fromkeys(DISABLED_AUGMENTATIONS, 0.))
    run_dir = args.output / "training/smoke"
    rows = list(csv.DictReader((run_dir/"results.csv").open()))
    if len(rows) != 2 or not all(np.isfinite(float(v)) for row in rows for k,v in row.items() if "loss" in k):
        raise ValueError("two finite training/validation epochs were not produced")
    runtime = json.loads((run_dir/"corner-order-loss.json").read_text())
    if not sum(runtime["positiveAnchorPhaseCounts"]):
        raise ValueError("custom loss was not exercised by the training loop")
    checkpoint = run_dir / "weights/best.pt"
    restored = YOLO(str(checkpoint))
    if type(restored.model).__module__ != "ultralytics.nn.tasks" or type(restored.model).__name__ != "PoseModel":
        raise ValueError("checkpoint acquired a custom inference class")
    if restored.model.criterion is not None or list(restored.model.model[-1].kpt_shape) != [4,3]:
        raise ValueError("checkpoint did not preserve the standard inference contract")
    sample = next((data/"images/validation").glob("*.jpg"))
    result = restored.predict(str(sample), imgsz=320, device=args.device, verbose=False)[0]
    if result.keypoints is not None and result.keypoints.data.shape[1:] != (4,3):
        raise ValueError("reloaded inference changed corner output shape")
    report = {"passed":True, "trainingEpochs":2, "device":args.device,
        "sourceCorpusHash":manifest["corpusHash"], "diagnosticSubsetHash":subset["corpusHash"],
        "records":[{"recordId":r["recordId"],"split":r["split"],"sha256":r["sha256"]} for r in selected],
        "initialCheckpointSha256":sha256_file(args.checkpoint), "smokeCheckpointSha256":sha256_file(checkpoint),
        "materialization":materialization, "runtime":runtime, "standardCheckpointReload":True,
        "scope":"Diagnostic optimizer steps only; this checkpoint is not a candidate and is not evaluated on the held-out benchmark."}
    write_json(args.output/"validation.json",report)
    print(json.dumps(report,indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release",type=Path,required=True)
    parser.add_argument("--config",type=Path,required=True)
    parser.add_argument("--checkpoint",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--device",default="cpu")
    run(parser.parse_args())
