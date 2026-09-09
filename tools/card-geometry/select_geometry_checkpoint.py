#!/usr/bin/env python3
"""Select a development checkpoint with scene and recognition regression guards.

This does not promote a production model. Even a passing result needs an
independent evaluation: these reports may already have guided development.
"""
import argparse
import math
from collections import Counter
from pathlib import Path

from corpus_release import load_json, sha256_file, write_json

POLICY = "scene-guarded-checkpoint-v1"


def validation_coverage(release):
    """Audit actual validation records, never infer printed orientation from order."""
    manifest = load_json(release / "manifest.json")
    counts = Counter(realFrames=0, realKnownOrientationFrames=0,
                     realKnownOrientationCards=0, realSidewaysFrames=0)
    scenes = Counter()
    for entry in manifest["records"]:
        if entry["split"] != "validation" or entry.get("leakageKeys", {}).get("sourceKind") != "real":
            continue
        path = release / entry["path"]
        if sha256_file(path) != entry["sha256"]:
            raise ValueError(f"validation record hash mismatch: {entry['recordId']}")
        record = load_json(path)
        counts["realFrames"] += 1
        scenes[entry["sceneSlice"]] += 1
        known = sideways = 0
        for instance in record["instances"]:
            corners = instance.get("corners", [])
            if not instance.get("orientationKnown") or len(corners) != 4 or not all(c.get("coordinateKnown") for c in corners):
                continue
            known += 1
            a, b = (c["point"] for c in corners[:2])
            dx = (b["x"]-a["x"])*record["source"]["width"]
            dy = (b["y"]-a["y"])*record["source"]["height"]
            sideways += abs(dy) > abs(dx)
        counts["realKnownOrientationCards"] += known
        counts["realKnownOrientationFrames"] += bool(known)
        counts["realSidewaysFrames"] += bool(sideways)
    gaps = [name for name in ("realFrames", "realKnownOrientationFrames", "realSidewaysFrames") if counts[name] == 0]
    return dict(corpusHash=manifest["corpusHash"], manifestSha256=sha256_file(release/"manifest.json"),
                counts=dict(counts), realScenes=dict(scenes), missingCoverage=gaps,
                orientationSelectionReady=not gaps,
                caveat="Nonzero counts are a coverage check, not evidence of sufficient sample size or independence.")


def checkpoint_inventory(output, coverage):
    """Retain the complete saved shortlist; upstream best.pt is only one candidate."""
    candidates = []
    for path in sorted((output/"training/repeat-0/weights").glob("*.pt")):
        candidates.append(dict(id=path.stem, path=str(path.relative_to(output)), sha256=sha256_file(path)))
    if not candidates:
        raise ValueError("no checkpoint candidates")
    return dict(schema="tcger-checkpoint-candidates/v1", policy=POLICY,
                status="awaiting-scene-and-recognition-evaluation", selectedCheckpoint=None,
                candidates=candidates, validationCoverage=coverage,
                upstreamBestRole="candidate selected by framework fitness; not a release recommendation")


def recognition_groups(report):
    groups = {}
    seen = set()
    for row in report["frames"]:
        if row["recordId"] in seen:
            raise ValueError("duplicate recognition frame")
        seen.add(row["recordId"])
        key = row["game"] + ":" + row["expectation"]
        group = groups.setdefault(key, Counter(correct=0, wrong=0, correctReject=0, abstain=0, unknown=0))
        group[row["outcome"]] += 1
    return {k:dict(v) for k,v in groups.items()}


def metrics(benchmark, recognition):
    scenes = benchmark["detection"]["bySceneSlice"]
    if not scenes:
        raise ValueError("missing scene metrics")
    for scene, row in scenes.items():
        for key in ("records", "truthInstances", "matches", "extra", "duplicate"):
            if type(row[key]) is not int or row[key] < 0:
                raise ValueError(f"invalid {scene} {key}")
        if not row["records"] or not row["truthInstances"] or row["matches"] > row["truthInstances"]:
            raise ValueError("invalid scene denominator")
        tight = row["recall@0.9"]
        if not math.isfinite(tight) or not 0 <= tight <= 1:
            raise ValueError("invalid border recall")
    orientation = benchmark["orientation"]
    if any(type(orientation[k]) is not int or orientation[k] < 0 for k in ("correctPairs", "eligiblePairs")):
        raise ValueError("invalid orientation counts")
    if orientation["correctPairs"] > orientation["eligiblePairs"]:
        raise ValueError("invalid orientation denominator")
    return dict(scenes=scenes, orientation=orientation, recognition=recognition_groups(recognition),
                macroTightRecall=sum(r["recall@0.9"] for r in scenes.values())/len(scenes))


def select(candidates, incumbent):
    by_id = {c["id"]:c for c in candidates}
    if len(by_id) != len(candidates) or incumbent not in by_id:
        raise ValueError("duplicate candidate IDs or missing incumbent")
    base = by_id[incumbent]["metrics"]
    decisions = []
    for candidate in candidates:
        current = candidate["metrics"]
        if current["scenes"].keys() != base["scenes"].keys() or current["recognition"].keys() != base["recognition"].keys():
            raise ValueError("candidate coverage differs from incumbent")
        reasons = []
        for scene, old in base["scenes"].items():
            new = current["scenes"][scene]
            if any(new[k] != old[k] for k in ("records", "truthInstances")):
                raise ValueError("scene denominators differ")
            for key, higher_good in (("matches", True), ("extra", False), ("duplicate", False)):
                regressed = new[key] < old[key] if higher_good else new[key] > old[key]
                if regressed:
                    reasons.append(f"{scene}: {key} {old[key]} -> {new[key]}")
        # Correct known-order matches use a fixed truth population. Counting
        # correctPairs prevents a candidate improving its rate by missing cards.
        if current["orientation"]["correctPairs"] < base["orientation"]["correctPairs"]:
            reasons.append(f"correct printed-order matches: {base['orientation']['correctPairs']} -> {current['orientation']['correctPairs']}")
        for group, old in base["recognition"].items():
            new = current["recognition"][group]
            if sum(new.values()) != sum(old.values()):
                raise ValueError("recognition denominators differ")
            for key, higher_good in (("correct", True), ("correctReject", True), ("wrong", False)):
                regressed = new[key] < old[key] if higher_good else new[key] > old[key]
                if regressed:
                    reasons.append(f"recognition {group}: {key} {old[key]} -> {new[key]}")
        decisions.append(dict(id=candidate["id"], passesGuards=not reasons, reasons=reasons,
                              macroTightRecall=current["macroTightRecall"]))
    def rank(row):
        return (-row["macroTightRecall"], row["id"] != incumbent, row["id"])
    ranked = sorted(decisions, key=rank)
    return dict(policy=POLICY, incumbent=incumbent,
                recommendedDevelopmentCheckpoint=next(c["id"] for c in ranked if c["passesGuards"]),
                bestBorderCheckpoint=ranked[0]["id"], candidates=decisions,
                rule="No regression in detection/extras/duplicates per scene, known-order correct matches, or recognition per game/label type; rank passing candidates by mean scene tight recall, ties retain incumbent.")


def verified(path, digest):
    path = Path(path)
    if sha256_file(path) != digest:
        raise ValueError(f"hash mismatch: {path.name}")
    return path


def run(config):
    release = Path(config["release"])
    manifest = load_json(verified(release/"manifest.json", config["releaseManifestSha256"]))
    rows, contracts = [], []
    expected_cases = {(r["recordId"],r["game"],r["expectation"])
                      for r in load_json(release/"recognition-replay.json")["records"]}
    identities = None
    for candidate in config["candidates"]:
        verified(candidate["checkpoint"], candidate["checkpointSha256"])
        prediction = verified(candidate["predictions"], candidate["predictionsSha256"])
        evidence = load_json(verified(candidate["evaluationEvidence"], candidate["evaluationEvidenceSha256"]))
        recognition = load_json(verified(candidate["recognition"], candidate["recognitionSha256"]))
        source_sha = evidence.get("checkpointSha256") or evidence.get("checkpointSource", {}).get("checkpointSha256")
        if source_sha != candidate["checkpointSha256"]:
            raise ValueError("checkpoint evidence mismatch")
        # Both published job evaluations and recovered local evaluations are supported.
        if "evaluations" in evidence:
            source = evidence["evaluations"]["real-v3"]
            prediction_sha, benchmark_sha = source["predictionsSha256"], source["reportSha256"]
        else:
            prediction_sha = evidence["outputs"]["real-v3.predictions.jsonl"]
            benchmark_sha = evidence["outputs"]["real-v3.benchmark.json"]
        benchmark = load_json(verified(prediction.parent/"real-v3.benchmark.json", benchmark_sha))
        if prediction_sha != candidate["predictionsSha256"] or recognition["predictionsSha256"] != prediction_sha or benchmark["predictionsSha256"] != prediction_sha:
            raise ValueError("prediction evidence mismatch")
        if benchmark["corpusHash"] != manifest["corpusHash"] or recognition["corpusHash"] != manifest["corpusHash"]:
            raise ValueError("corpus mismatch")
        if recognition["replayManifestSha256"] != sha256_file(release/"recognition-replay.json"):
            raise ValueError("recognition labels mismatch")
        cases = {(r["recordId"],r["game"],r["expectation"]) for r in recognition["frames"]}
        if cases != expected_cases:
            raise ValueError("recognition report does not cover the frozen replay")
        if identities is not None and cases != identities:
            raise ValueError("recognition cases differ")
        identities = cases
        contracts.append([evidence["decoderConfig"], evidence["evaluationContract"],
                          recognition["cropContract"], recognition["recognitionModels"]])
        rows.append(dict(id=candidate["id"], checkpointSha256=candidate["checkpointSha256"],
                         metrics=metrics(benchmark, recognition)))
    if not contracts or any(c != contracts[0] for c in contracts[1:]):
        raise ValueError("mixed decoder, crop, or recognition model contracts")
    if len({c["checkpointSha256"] for c in rows}) != len(rows):
        raise ValueError("duplicate checkpoint hashes")
    return {**select(rows, config["incumbent"]), "diagnosticOnly": True,
            "productionPromotion": False, "corpusHash": manifest["corpusHash"],
            "evaluationSplits": dict(Counter(e["split"] for e in manifest["records"])),
            "evidence": rows, "inputs":config,
            "caveat":"Saved test outputs guide development only. A new independent holdout is needed to confirm a replacement."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output already exists; preserve frozen selection reports")
    write_json(args.output, run(load_json(args.config)))
