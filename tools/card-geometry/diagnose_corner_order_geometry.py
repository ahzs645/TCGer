#!/usr/bin/env python3
"""Compare saved quads on identical references, separating borders and corner phase."""
import argparse
import collections
import json
import math
import statistics
from pathlib import Path

from compare_corner_order_run import predictions
from compare_reviewed_model import compare
from corpus_release import load_json, sha256_file, write_json


def summary(rows):
    common = [r for r in rows if r["baseline"] and r["candidate"]]
    human = [r for r in common if r["baseline"].get("human")]
    known = [r for r in human if r["orientationKnown"]]
    result = {"targets": len(rows), "commonMatched": len(common), "commonHumanQuads": len(human),
              "commonKnownOrientation": len(known)}
    for version in ("baseline", "candidate"):
        result[version] = {
            "matched": sum(r[version] is not None for r in rows),
            "tight": sum(r[version] is not None and r[version]["iou"] >= .9 for r in rows),
            "commonMedianIou": statistics.median(r[version]["iou"] for r in common) if common else None,
            "commonHumanMedianCyclicError": statistics.median(r[version]["meanCornerFraction"] for r in human) if human else None,
            "commonHumanMedianFixedError": statistics.median(r[version]["printedOrderMeanPixels"]/r["meanSidePixels"] for r in human) if human else None,
            "knownPhases": dict(collections.Counter(r[version]["bestCornerRoll"] for r in known)),
        }
    result["tightLost"] = sum(r["baseline"] is not None and r["baseline"]["iou"] >= .9
                             and (r["candidate"] is None or r["candidate"]["iou"] < .9) for r in rows)
    result["tightGained"] = sum(r["candidate"] is not None and r["candidate"]["iou"] >= .9
                               and (r["baseline"] is None or r["baseline"]["iou"] < .9) for r in rows)
    result["newMisses"] = sum(r["baseline"] is not None and r["candidate"] is None for r in rows)
    result["recoveredMisses"] = sum(r["candidate"] is not None and r["baseline"] is None for r in rows)
    return result


def run(args):
    download = load_json(args.run_root / "results-download.json")
    candidate = Path(download["root"]) / "training-output/evaluation"
    baseline = args.run_root / "comparison-inputs/baseline"
    manifest = load_json(args.release / "manifest.json")
    sources = {v: predictions(p/"real-v3.predictions.jsonl") for v,p in (("baseline",baseline),("candidate",candidate))}
    for version,path in (("baseline",baseline),("candidate",candidate)):
        benchmark = load_json(path/"real-v3.benchmark.json")
        assert benchmark["corpusHash"] == manifest["corpusHash"]
        assert sha256_file(path/"real-v3.predictions.jsonl") == benchmark["predictionsSha256"]
    reviewed = load_json(args.run_root / "comparison/reviewed-reference-comparison.json")
    checked = {f["id"]: f for f in reviewed["frames"]}
    queue = load_json(args.reference_queue)
    refs = {f["recordId"]: f"F{i+1}" for i,f in enumerate(queue["frames"])}
    all_rows, all_frames = [], []
    for index,entry in enumerate(manifest["records"]):
        rid = entry["recordId"]
        path = args.release/entry["path"]
        assert sha256_file(path) == entry["sha256"]
        record = load_json(path)
        versions = {v:compare(record,entry["sceneSlice"],sources[v][rid]) for v in sources}
        frame = {"recordId": rid, "reference": refs.get(rid, f"E{index+1}"), "scene": entry["sceneSlice"],
                 "source": record["source"], "versions": versions, "predictions": {v:sources[v][rid] for v in sources},
                 "reviewed": checked.get(rid)}
        all_frames.append(frame)
        matches = {v:{m["truthId"]:m for m in result["matches"]} for v,result in versions.items()}
        for i,instance in enumerate(record["instances"]):
            key = f"T{i+1}"
            row = {"recordId": rid,"reference":frame["reference"],"scene":frame["scene"],"truthId":key,
                   "instanceId":instance["instanceId"],"orientationKnown":instance.get("orientationKnown",False),
                   **{v:matches[v].get(key) for v in versions}}
            corners = instance.get("corners",[])
            if len(corners)==4 and all(c.get("coordinateKnown") for c in corners):
                pixels = [(c["point"]["x"]*record["source"]["width"],c["point"]["y"]*record["source"]["height"]) for c in corners]
                row["meanSidePixels"] = sum(math.dist(pixels[j],pixels[(j+1)%4]) for j in range(4))/4
                angle = math.degrees(math.atan2(pixels[1][1]-pixels[0][1],pixels[1][0]-pixels[0][0]))
                row["printedAngle"] = angle if row["orientationKnown"] else None
                row["sideways"] = row["orientationKnown"] and 45 <= abs(angle) <= 135
            all_rows.append(row)
    reviewed_rows = []
    for frame in reviewed["frames"]:
        matches = {v:{m["truthId"]:m for m in frame[v]["matches"]} for v in sources}
        for truth in frame["baseline"]["referenceInstances"]:
            source = next(f["source"] for f in all_frames if f["recordId"]==frame["id"])
            pixels = [(x*source["width"],y*source["height"]) for x,y in truth["corners"]]
            angle = math.degrees(math.atan2(pixels[1][1]-pixels[0][1],pixels[1][0]-pixels[0][0]))
            reviewed_rows.append({"recordId":frame["id"], "reference":refs[frame["id"]], "truthId":truth["id"],
                "orientationKnown":truth["orientationKnown"],"meanSidePixels":sum(math.dist(pixels[j],pixels[(j+1)%4]) for j in range(4))/4,
                "printedAngle":angle if truth["orientationKnown"] else None,
                "sideways":truth["orientationKnown"] and 45 <= abs(angle) <= 135,
                **{v:matches[v].get(truth["id"]) for v in sources}})
    report = {"diagnosticOnly":True,"corpusHash":manifest["corpusHash"],
        "full":summary(all_rows),"reviewed":summary(reviewed_rows),
        "byScene":{s:summary([r for r in all_rows if r["scene"]==s]) for s in sorted({r["scene"] for r in all_rows})},
        "sidewaysKnown":summary([r for r in all_rows if r.get("sideways")]),
        "reviewedSidewaysKnown":summary([r for r in reviewed_rows if r["sideways"]]),
        "frames":all_frames,"targets":all_rows,"reviewedTargets":reviewed_rows}
    for v,path in (("baseline",baseline),("candidate",candidate)):
        published=load_json(path/"real-v3.benchmark.json")["detection"]["overall"]
        assert report["full"][v]["matched"] == published["matches"]
        assert report["full"][v]["tight"] == round(published["recall@0.9"]*700)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    write_json(args.output,report)
    print(json.dumps({k:v for k,v in report.items() if k not in ("frames","targets","reviewedTargets")},indent=2))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('run-root','release','reference-queue','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    run(parser.parse_args())
