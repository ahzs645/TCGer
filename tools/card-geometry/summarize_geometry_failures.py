#!/usr/bin/env python3
"""Attribute saved diagnostic misses without changing thresholds or rerunning models."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

from benchmark_geometry import (
    Truth,
    _geometry_source,
    _prediction,
    _truth_geometry,
    match_record,
)
from reference_geometry import _is_convex, quad_iou


def box_quad(b):
    return [(b[0], b[1]), (b[2], b[1]), (b[2], b[3]), (b[0], b[3])]


def extent(points):
    return [
        min(p[0] for p in points),
        min(p[1] for p in points),
        max(p[0] for p in points),
        max(p[1] for p in points),
    ]


def summarize_row(sample, row):
    truths = [
        Truth(
            sample["recordId"],
            i,
            sample["sceneSlice"],
            sample["sourceKind"],
            sample["width"],
            sample["height"],
            inst,
            _truth_geometry(inst),
            _geometry_source(inst),
        )
        for i, inst in enumerate(sample["instances"])
    ]
    predictions = [_prediction(result, i) for i, result in enumerate(row["accepted"])]
    matches, missed, _, duplicates, extras = match_record(truths, predictions)
    raw = [_prediction(result, i) for i, result in enumerate(row["raw"])]
    details = []
    for truth in missed:
        native_iou = max(
            (
                quad_iou(box_quad(extent(truth.geometry)), box_quad(n["box"]))
                for n in row["native"]
            ),
            default=0,
        )
        candidates = [
            (quad_iou(list(truth.geometry), list(p.quad)), p.index)
            for p in raw
            if _is_convex(list(p.quad))
        ]
        raw_iou, raw_index = max(candidates, default=(0, None))
        valid_raw_iou = max(
            (iou for iou, i in candidates if not row["rejections"][i]), default=0
        )
        if valid_raw_iou >= 0.5:
            stage = "shared-nms-or-one-to-one-assignment"
        elif raw_iou >= 0.5:
            stage = "shared-decoder-filter"
        elif native_iou >= 0.5:
            stage = "native-box-found-but-quad-missed"
        else:
            stage = "no-matching-post-framework-box"
        details.append(
            dict(
                instanceIndex=truth.instance_index,
                stage=stage,
                nativeBoxIoU=native_iou,
                bestConvexRawQuadIoU=raw_iou,
                bestValidRawQuadIoU=valid_raw_iou,
                bestRawIndex=raw_index,
                bestRawRejections=row["rejections"][raw_index]
                if raw_index is not None
                else [],
            )
        )
    return dict(
        recordId=sample["recordId"],
        scope=row["scope"],
        scene=sample["sceneSlice"],
        sourceKind=sample["sourceKind"],
        variant=row["variant"],
        truths=sum(t.geometry is not None for t in truths),
        native=len(row["native"]),
        raw=len(raw),
        accepted=len(predictions),
        matches=len(matches),
        misses=len(missed),
        matches75=sum(m.iou >= 0.75 for m in matches),
        matches90=sum(m.iou >= 0.9 for m in matches),
        duplicates=duplicates,
        extras=extras,
        missDetails=details,
        matched=[
            dict(
                instanceIndex=m.truth.instance_index,
                predictionIndex=m.prediction.index,
                iou=m.iou,
            )
            for m in matches
        ],
    )


def aggregate(rows):
    total = Counter()
    stages = Counter()
    for row in rows:
        total.update(
            {
                k: row[k]
                for k in [
                    "truths",
                    "native",
                    "raw",
                    "accepted",
                    "matches",
                    "misses",
                    "matches75",
                    "matches90",
                    "duplicates",
                    "extras",
                ]
            }
        )
        stages.update(d["stage"] for d in row["missDetails"])
    return dict(
        records=len(rows),
        **total,
        missStages=dict(stages),
        recall50=total["matches"] / total["truths"] if total["truths"] else None,
        recall75=total["matches75"] / total["truths"] if total["truths"] else None,
        recall90=total["matches90"] / total["truths"] if total["truths"] else None,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", type=Path, required=True)
    args = parser.parse_args()
    manifest = args.audit / "audit-inputs.json"
    inputs = json.loads(manifest.read_text())
    samples = {s["recordId"]: s for s in inputs["samples"]}
    output = {
        "method": "Frozen one-to-one benchmark matching. Miss stages describe candidate availability, not proven training causes. Native boxes are post-framework NMS. Raw-quad matching only uses convex quads.",
        "models": {},
    }
    for short, candidate in [("yolox", "yolox-pose"), ("yolo11s", "yolo11s-pose")]:
        report = json.loads((args.audit / f"{short}-raw-audit.json").read_text())
        assert (
            report["inputSha256"] == hashlib.sha256(manifest.read_bytes()).hexdigest()
        )
        rows = [summarize_row(samples[row["recordId"]], row) for row in report["rows"]]
        groups = defaultdict(list)
        for row in rows:
            for slice_name in ["all", row["scene"], row["sourceKind"]]:
                groups[f"{row['scope']}/{row['variant']}/{slice_name}"].append(row)
        output["models"][candidate] = {
            "groups": {key: aggregate(value) for key, value in sorted(groups.items())},
            "rows": rows,
        }
    (args.audit / "failure-analysis.json").write_text(
        json.dumps(output, indent=2) + "\n"
    )
    for model, data in output["models"].items():
        print(model)
        for key, group in data["groups"].items():
            if key.endswith(("/all", "/binder_page", "/duel_field", "/real")):
                print(key, json.dumps(group))


if __name__ == "__main__":
    main()
