#!/usr/bin/env python3
"""Verify the single corner-order run and compare it with frozen baseline inputs."""
import argparse
import copy
import json
import statistics
from collections import Counter
from pathlib import Path

from compare_reviewed_model import compare
from corpus_release import load_json, sha256_file, write_json


def predictions(path):
    result = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        if row["recordId"] in result:
            raise ValueError("duplicate prediction record")
        result[row["recordId"]] = row["results"]
    return result


def summarize_frames(frames, version):
    # Counter addition discards zero totals, including a successful zero-duplicate result.
    counts = Counter()
    for frame in frames:
        counts.update(frame[version]["counts"])
    matches = [m for f in frames for m in f[version]["matches"]]
    return {"counts":dict(counts),
        "matchedAtIou":{str(t):sum(m["iou"]>=t for m in matches) for t in (.5,.75,.9)},
        "statuses":dict(Counter(f[version]["status"] for f in frames)),
        "medianMeanCornerFraction":statistics.median(m["meanCornerFraction"] for m in matches) if matches else None}


def reviewed_comparison(release, sidecar, baseline, candidate):
    manifest = load_json(release / "manifest.json")
    entries = {e["recordId"]:e for e in manifest["records"]}
    frames = []
    for frame in sidecar["frames"]:
        record_id = "coco-" + frame["canonicalRecordId"]
        entry = entries[record_id]
        path = release / entry["path"]
        assert sha256_file(path) == entry["sha256"]
        record = copy.deepcopy(load_json(path))
        assert record["source"]["sha256"] == frame["imageSha256"]
        labels = {f"card-{i['sourceAnnotationIndex']}":i for i in frame["instances"]}
        assert set(labels) == {i["instanceId"] for i in record["instances"]}
        for instance in record["instances"]:
            label = labels[instance["instanceId"]]
            instance["corners"] = [{"point":{"x":x,"y":y}, "coordinateKnown":True,
                "cornerSource":label["cornerSource"], "visibility":visibility}
                for (x,y),visibility in zip(label["corners"],label["cornerVisibility"],strict=True)]
            instance["orientationKnown"] = label["orientationKnown"]
        frames.append({"id":record_id, "baseline":compare(record,entry["sceneSlice"],baseline[record_id]),
                       "candidate":compare(record,entry["sceneSlice"],candidate[record_id])})
    assert len(frames) == 502
    result = {"photos":len(frames), "baseline":summarize_frames(frames,"baseline"),
              "candidate":summarize_frames(frames,"candidate"), "frames":frames}
    assert result["baseline"]["counts"]["truth"] == result["candidate"]["counts"]["truth"] == 561
    return result


def overall(benchmark):
    detection = benchmark["detection"]["overall"]
    return {**{k:detection[k] for k in ("recall@0.5","recall@0.75","recall@0.9","extra","duplicate","miss")},
        "cornerP50":benchmark["cornerError"]["overall"]["normalized"]["p50"]}


def run(args):
    frozen = load_json(args.inputs / "inputs.json")
    for name,digest in frozen["files"].items():
        assert sha256_file(args.inputs/name) == digest, name
    config = load_json(args.config)
    trainer = load_json(args.training_output/"trainer-summary.json")
    assert trainer["training"]["cornerOrderPolicy"] == "cyclic-unknown-v1"
    assert trainer["training"]["epochs"] == 50
    assert trainer["materialization"]["corpusHash"] == config["corpus"]["corpusHash"] == frozen["trainingCorpusHash"]
    from run_card_geometry_hf_job import descriptor, resolve_config
    assert trainer["experimentHash"] == descriptor(resolve_config(config))["experimentHash"]
    evaluation = args.training_output/"evaluation"
    summary = load_json(evaluation/"evaluation-summary.json")
    baseline = args.inputs/"baseline"
    old_summary = load_json(baseline/"evaluation-summary.json")
    assert summary["decoderConfig"] == old_summary["decoderConfig"]
    assert summary["evaluationContract"] == old_summary["evaluationContract"]
    assert summary["checkpointSha256"] == trainer["artifacts"]["best"]["sha256"]
    assert sha256_file(args.training_output/trainer["artifacts"]["best"]["path"]) == summary["checkpointSha256"]
    assert old_summary["checkpointSha256"] == frozen["baselineCheckpointSha256"]
    result = {"experimentHash":trainer["experimentHash"], "baselineCheckpointSha256":old_summary["checkpointSha256"],
        "candidateCheckpointSha256":summary["checkpointSha256"], "trainingCorpusHash":frozen["trainingCorpusHash"],
        "reviewedSidecarSha256":frozen["files"]["reviewed-reference-corners.json"],
        "change":"Unknown orientation uses cyclic coordinate loss and cyclic validation OKS; data, known-orientation semantics, architecture, base initialization, budget and frozen external evaluation remain unchanged."}
    for name,key in (("real-v3","real"),("synthetic-duel-field","synthetic")):
        new,old = load_json(evaluation/f"{name}.benchmark.json"),load_json(baseline/f"{name}.benchmark.json")
        assert new["corpusHash"] == old["corpusHash"]
        assert sha256_file(evaluation/f"{name}.benchmark.json") == summary["evaluations"][name]["reportSha256"]
        assert sha256_file(evaluation/f"{name}.predictions.jsonl") == summary["evaluations"][name]["predictionsSha256"]
        result[key] = {"corpusHash":new["corpusHash"],"baseline":overall(old),"candidate":overall(new)}
    assert sha256_file(evaluation/"recognition-replay.json") == summary["evaluations"]["recognitionReplay"]["reportSha256"]
    result["recognition"] = {"baseline":load_json(baseline/"recognition-replay.json")["counts"],
                             "candidate":load_json(evaluation/"recognition-replay.json")["counts"]}
    reviewed = reviewed_comparison(args.release,load_json(args.inputs/"reviewed-reference-corners.json"),
                                   predictions(baseline/"real-v3.predictions.jsonl"),predictions(evaluation/"real-v3.predictions.jsonl"))
    result["reviewedReferences"] = {k:v for k,v in reviewed.items() if k != "frames"}
    args.output.mkdir(parents=True,exist_ok=False)
    write_json(args.output/"reviewed-reference-comparison.json",reviewed)
    write_json(args.output/"comparison.json",result)
    lines = ["# Corner-order YOLO11s comparison", "", result["change"], "",
        "## Your reviewed references: 502 photos / 561 cards", "",
        "| Metric | Previous YOLO11s | Corner-order YOLO11s |", "|---|---:|---:|"]
    for threshold in ("0.5","0.75","0.9"):
        lines.append(f"| Matches at IoU {threshold} | {reviewed['baseline']['matchedAtIou'][threshold]} | {reviewed['candidate']['matchedAtIou'][threshold]} |")
    for key in ("misses","extras","duplicates"):
        lines.append(f"| {key.title()} | {reviewed['baseline']['counts'][key]} | {reviewed['candidate']['counts'][key]} |")
    for key in ("real","synthetic"):
        lines += ["",f"## Frozen {key} evaluation","","| Metric | Previous | Candidate |","|---|---:|---:|"]
        for metric,value in result[key]["baseline"].items():
            lines.append(f"| {metric} | {value} | {result[key]['candidate'][metric]} |")
    lines += ["", "Recognition counts: " + json.dumps(result["recognition"],sort_keys=True), "",
        "One seed. Isolated loss tests establish correct supervision semantics, not a guaranteed accuracy improvement. The reviewed references remain evaluation-only; the existing benchmark has guided development, so fresh held-out sessions are needed for stronger generalization evidence.",
        "", "Checkpoint and evaluation hashes were verified. No production deployment was performed."]
    (args.output/"RESULTS.md").write_text("\n".join(lines)+"\n")
    write_json(args.output/"verification.json",{"passed":True,"inputs":frozen,
        "outputs":{p.name:sha256_file(p) for p in args.output.iterdir() if p.is_file()}})
    print(json.dumps({k:v for k,v in result.items() if k != "reviewedReferences"},indent=2))


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("inputs","config","training-output","release","output"):
        parser.add_argument("--"+name,type=Path,required=True)
    run(parser.parse_args())
