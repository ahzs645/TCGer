#!/usr/bin/env python3
"""Build the deterministic final comparison for the geometry licensing bake-off."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


SCHEMA_ID = "https://tcger.app/reports/card-geometry-bakeoff-comparison/v1"
REQUIRED_REPORTS = (
    "run-train.json",
    "resolved-config.json",
    "real-v3.benchmark.json",
    "synthetic-duel-field.benchmark.json",
    "recognition-replay.json",
)
DEFAULT_BUDGETS = {
    "realRecallAt05Minimum": 0.98,
    "realRecallAt075Minimum": 0.85,
    "normalizedCornerP50Maximum": 0.03,
    "normalizedCornerP90Maximum": 0.10,
    "normalizedCornerP95Maximum": 0.15,
    "outsideFrameNormalizedP50Maximum": 0.08,
    "duplicateMaximum": 0,
    "extraPerImageMaximum": 3 / 61,
    "wrongAcceptMaximum": 0,
    "crossRuntimeCosineMinimum": 0.995,
}


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source(path: Path) -> dict[str, str]:
    return {"path": path.as_posix(), "sha256": sha256_file(path)}


def code_sources(paths: list[str]) -> dict[str, Any]:
    rows = []
    for raw in paths:
        path = Path(raw)
        data = path.read_bytes()
        rows.append(
            {
                **source(path),
                "bytes": len(data),
                "lines": len(data.splitlines()),
            }
        )
    return {
        "sources": rows,
        "bytes": sum(row["bytes"] for row in rows),
        "lines": sum(row["lines"] for row in rows),
    }


def check_details(report: dict[str, Any], code: str) -> dict[str, Any]:
    matches = [row for row in report["checks"] if row["code"] == code]
    if len(matches) != 1 or matches[0]["status"] != "pass":
        raise ValueError(f"training corpus preflight lacks one passing {code} check")
    return matches[0]["details"]


def training_corpus_summary(spec: dict[str, Any]) -> dict[str, Any]:
    path = Path(spec["trainingCorpusPreflight"])
    report = load_json(path)
    expected_hash = spec["trainingCorpusHash"]
    if report.get("readyFor") != "training" or report.get("failedChecks"):
        raise ValueError("training corpus preflight is not ready for training")
    if {
        report.get("declaredCorpusHash"),
        report.get("recomputedCorpusHash"),
    } != {expected_hash}:
        raise ValueError("training corpus preflight hash does not match bake-off corpus")
    readiness = check_details(report, "READINESS_MINIMUMS")
    source_tier = check_details(report, "SOURCE_TIER")
    check_details(report, "LEAKAGE_DISJOINT")
    check_details(report, "SPLIT_REAL_ONLY")
    return {
        "releaseId": report["releaseId"],
        "releasePurpose": report["releasePurpose"],
        "readyFor": report["readyFor"],
        "corpusHash": expected_hash,
        "policyId": report["readinessPolicyId"],
        "policySha256": report["readinessPolicySha256"],
        "allowedSourceTiers": source_tier["allowedSourceTiers"],
        "recordsPerSplit": readiness["recordsPerSplit"],
        "instancesPerSplit": readiness["instancesPerSplit"],
        "metricEligibleInstancesPerSplit": readiness[
            "metricEligibleInstancesPerSplit"
        ],
        "sceneSliceInstances": readiness["sceneSliceInstances"],
        "sceneSliceMetricEligibleInstances": readiness[
            "sceneSliceMetricEligibleInstances"
        ],
        "preflight": source(path),
    }


def outside_frame_p50(report: dict[str, Any]) -> float | None:
    row = report["cornerError"]["byTruthVisibility"].get("outsideFrame")
    return None if row is None else row["normalized"]["p50"]


def at_most(value: float | None, maximum: float) -> bool:
    """A missing percentile means the candidate did not produce a scorable sample."""
    return value is not None and value <= maximum


def parity_extrema(export: dict[str, Any]) -> tuple[float, float]:
    cosines = [row.get("minimumCosine", row.get("cosine")) for row in export["parity"]]
    differences = [
        row.get("maximumAbsoluteDifference", row.get("maxAbs")) for row in export["parity"]
    ]
    if any(value is None for value in [*cosines, *differences]):
        raise ValueError("export benchmark parity rows lack comparable metrics")
    return min(cosines), max(differences)


def effective_fairness_hash(config: dict[str, Any]) -> str:
    """Hash fair inputs while excluding tooling-bound preflight report identity."""
    corpus = config["corpus"]
    shared = {
        "bakeoffId": config["bakeoffId"],
        "corpus": {
            key: corpus[key]
            for key in (
                "datasetRepo",
                "datasetRevision",
                "releasePath",
                "corpusHash",
                "policyId",
                "policySha256",
            )
        },
        "fairness": config["fairness"],
        "evaluations": config["evaluations"],
        "measurements": config["measurements"],
    }
    return hashlib.sha256(canonical_json(shared)).hexdigest()


def candidate_row(
    candidate: dict[str, Any], budgets: dict[str, float]
) -> dict[str, Any]:
    root = Path(candidate["reportsRoot"])
    paths = {name: root / name for name in REQUIRED_REPORTS}
    missing = [path.as_posix() for path in paths.values() if not path.is_file()]
    if missing:
        raise ValueError(f"missing candidate reports: {missing}")
    run = load_json(paths["run-train.json"])
    config = load_json(paths["resolved-config.json"])
    real = load_json(paths["real-v3.benchmark.json"])
    synthetic = load_json(paths["synthetic-duel-field.benchmark.json"])
    recognition = load_json(paths["recognition-replay.json"])
    export_path = Path(candidate["exportBenchmark"])
    export = load_json(export_path) if export_path.is_file() else None
    minimum_cosine, maximum_difference = parity_extrema(export) if export else (None, None)
    detection = real["detection"]["overall"]
    corner = real["cornerError"]["overall"]["normalized"]
    outside_p50 = outside_frame_p50(real)
    recognition_counts = recognition["counts"]
    checks = {
        "realRecallAt05": detection["recall@0.5"] >= budgets["realRecallAt05Minimum"],
        "realRecallAt075": detection["recall@0.75"] >= budgets["realRecallAt075Minimum"],
        "normalizedCornerP50": at_most(corner["p50"], budgets["normalizedCornerP50Maximum"]),
        "normalizedCornerP90": at_most(corner["p90"], budgets["normalizedCornerP90Maximum"]),
        "normalizedCornerP95": at_most(corner["p95"], budgets["normalizedCornerP95Maximum"]),
        "outsideFrameNormalizedP50": at_most(
            outside_p50, budgets["outsideFrameNormalizedP50Maximum"]
        ),
        "duplicates": detection["duplicate"] <= budgets["duplicateMaximum"],
        "extras": detection["extraPerImage"] <= budgets["extraPerImageMaximum"],
        "wrongAccepts": recognition_counts["wrong"] <= budgets["wrongAcceptMaximum"],
        "crossRuntimeParity": (
            export is not None
            and minimum_cosine >= budgets["crossRuntimeCosineMinimum"]
        ),
        "physicalIosLatency": (
            export is not None
            and export["physicalDeviceLatency"]["ios"]["status"] == "measured"
        ),
        "physicalAndroidLatency": (
            export is not None
            and export["physicalDeviceLatency"]["android"]["status"] == "measured"
        ),
        "productionDecoders": bool(candidate.get("productionDecodersComplete", False)),
        "shippingLicense": run["licenseRoute"] in {"enterprise", "agpl", "permissive"},
    }
    metric_checks = {
        key: value
        for key, value in checks.items()
        if key
        not in {
            "physicalIosLatency",
            "physicalAndroidLatency",
            "productionDecoders",
            "shippingLicense",
        }
    }
    return {
        "candidate": run["candidate"],
        "framework": run["framework"],
        "licenseRoute": run["licenseRoute"],
        "experimentHash": run["experimentHash"],
        "fairnessHash": run["fairnessHash"],
        "effectiveFairnessHash": effective_fairness_hash(config),
        "trainingCorpusHash": config["corpus"]["corpusHash"],
        "deviations": config["deviations"],
        "training": {
            "jobId": candidate.get("jobId"),
            "elapsedSeconds": run["elapsedSeconds"],
            "l4GpuHours": run["elapsedSeconds"] / 3600,
            "attemptNotes": candidate.get("attemptNotes", []),
        },
        "real": {
            "corpusHash": real["corpusHash"],
            "recallAt05": detection["recall@0.5"],
            "recallAt075": detection["recall@0.75"],
            "recallAt09": detection["recall@0.9"],
            "meanMatchedIou": detection["meanMatchedIoU"],
            "normalizedCorner": corner,
            "outsideFrameNormalizedP50": outside_p50,
            "duplicates": detection["duplicate"],
            "extras": detection["extra"],
            "extraPerImage": detection["extraPerImage"],
            "orientationAccuracy": real["orientation"]["accuracy"],
            "orientationEligiblePairs": real["orientation"]["eligiblePairs"],
        },
        "synthetic": {
            "corpusHash": synthetic["corpusHash"],
            "recallAt05": synthetic["detection"]["overall"]["recall@0.5"],
            "recallAt075": synthetic["detection"]["overall"]["recall@0.75"],
            "recallAt09": synthetic["detection"]["overall"]["recall@0.9"],
            "normalizedCorner": synthetic["cornerError"]["overall"]["normalized"],
        },
        "recognition": recognition_counts,
        "export": (
            None
            if export is None
            else {
                "onnxBytes": export["artifacts"]["onnx"]["bytes"],
                "coremlBytes": export["artifacts"]["coreml"]["bytes"],
                "minimumCosine": minimum_cosine,
                "maximumAbsoluteDifference": maximum_difference,
                "latency": export["latency"],
                "physicalDeviceLatency": export["physicalDeviceLatency"],
            }
        ),
        "decoder": {
            "status": candidate.get("decoderStatus", "unknown"),
            "reference": code_sources(candidate.get("referenceDecoderSources", [])),
            "production": code_sources(candidate.get("productionDecoderSources", [])),
            "productionComplete": bool(candidate.get("productionDecodersComplete", False)),
            "notes": candidate.get("decoderNotes", []),
        },
        "checks": checks,
        "passesMeasuredMetricBudgets": all(metric_checks.values()),
        "productionReady": all(checks.values()),
        "sources": {
            **{name: source(path) for name, path in paths.items()},
            "exportBenchmark": source(export_path) if export_path.is_file() else None,
        },
    }


def build(spec: dict[str, Any]) -> dict[str, Any]:
    budgets = {**DEFAULT_BUDGETS, **spec.get("budgets", {})}
    training_corpus = training_corpus_summary(spec)
    candidates = [candidate_row(item, budgets) for item in spec["candidates"]]
    candidate_names = [row["candidate"] for row in candidates]
    if len(candidate_names) != len(set(candidate_names)):
        raise ValueError("candidate names must be unique")
    required_candidates = spec.get("requiredCandidates")
    if required_candidates is not None and set(candidate_names) != set(required_candidates):
        raise ValueError("comparison does not contain the required candidate shortlist")
    training_hashes = {row["trainingCorpusHash"] for row in candidates}
    if training_hashes != {spec["trainingCorpusHash"]}:
        raise ValueError("all candidates must use the declared training corpus")
    corpus_hashes = {row["real"]["corpusHash"] for row in candidates}
    synthetic_hashes = {row["synthetic"]["corpusHash"] for row in candidates}
    fairness_hashes = {row["effectiveFairnessHash"] for row in candidates}
    if len(corpus_hashes) != 1 or len(synthetic_hashes) != 1:
        raise ValueError("all candidates must use the same frozen evaluation corpora")
    if len(fairness_hashes) != 1:
        raise ValueError("all candidates must have the same effective fairness identity")
    measured_winners = [row["candidate"] for row in candidates if row["passesMeasuredMetricBudgets"]]
    production_winners = [row["candidate"] for row in candidates if row["productionReady"]]
    recommendation = (
        "promote-best-production-ready-candidate"
        if production_winners
        else "ship-none-retain-current-detector-and-safety-net"
    )
    return {
        "schema": SCHEMA_ID,
        "bakeoffId": spec["bakeoffId"],
        "requiredCandidates": required_candidates or candidate_names,
        "trainingCorpusHash": spec["trainingCorpusHash"],
        "trainingCorpus": training_corpus,
        "realEvaluationCorpusHash": next(iter(corpus_hashes)),
        "syntheticEvaluationCorpusHash": next(iter(synthetic_hashes)),
        "effectiveFairnessHash": next(iter(fairness_hashes)),
        "budgets": budgets,
        "candidates": candidates,
        "outcome": {
            "measuredMetricBudgetPassers": measured_winners,
            "productionReadyCandidates": production_winners,
            "recommendation": recommendation,
            "humanDecisionRemaining": spec.get("humanDecisionRemaining", []),
        },
        "notes": spec.get("notes", []),
    }


def _number(value: float | int | None, digits: int = 3) -> str:
    if value is None:
        return "—"
    return f"{value:.{digits}f}"


def _megabytes(value: int | None) -> str:
    return "—" if value is None else f"{value / 1_000_000:.1f}"


def render_markdown(report: dict[str, Any]) -> str:
    """Render the deterministic human review alongside the canonical JSON."""
    outcome = report["outcome"]
    recommendation = outcome["recommendation"]
    lines = [
        "# Shared card-geometry bake-off — 2026-09-04",
        "",
        "**Recommendation:** "
        + (
            "promote the best production-ready candidate."
            if recommendation == "promote-best-production-ready-candidate"
            else "ship none of the candidates; retain the current detector and the 0°/180° recognition safety net."
        ),
        "",
        "The comparison is bound to one production training corpus, one real evaluation corpus, "
        "one synthetic duel-field corpus, and one effective fairness identity:",
        "",
        f"- Training corpus: `{report['trainingCorpusHash']}`",
        f"- Real evaluation: `{report['realEvaluationCorpusHash']}`",
        f"- Synthetic evaluation: `{report['syntheticEvaluationCorpusHash']}`",
        f"- Effective fairness: `{report['effectiveFairnessHash']}`",
        "",
        "## Results",
        "",
        "| Candidate | License route | Real R@.5 | Real R@.75 | Corner p50 | p90 | p95 | Outside p50 | Synthetic R@.75 | Correct / wrong / abstain | ONNX MB | Core ML MB | Min parity cosine | L4 h | Production ready |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for row in report["candidates"]:
        export = row["export"]
        recognition = row["recognition"]
        lines.append(
            "| "
            + " | ".join(
                (
                    row["candidate"],
                    row["licenseRoute"],
                    _number(row["real"]["recallAt05"]),
                    _number(row["real"]["recallAt075"]),
                    _number(row["real"]["normalizedCorner"]["p50"]),
                    _number(row["real"]["normalizedCorner"]["p90"]),
                    _number(row["real"]["normalizedCorner"]["p95"]),
                    _number(row["real"]["outsideFrameNormalizedP50"]),
                    _number(row["synthetic"]["recallAt075"]),
                    f"{recognition['correct']} / {recognition['wrong']} / {recognition['abstain']}",
                    _megabytes(None if export is None else export["onnxBytes"]),
                    _megabytes(None if export is None else export["coremlBytes"]),
                    _number(None if export is None else export["minimumCosine"], 6),
                    _number(row["training"]["l4GpuHours"], 2),
                    "yes" if row["productionReady"] else "no",
                )
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "Corner errors are normalized by the mean truth-quad side length. Recognition counts "
            "exclude outcomes whose catalog identity is unavailable and preserve those as `unknown` in the JSON report.",
            "",
            "## Gates",
            "",
        ]
    )
    for row in report["candidates"]:
        failed = [name for name, passed in row["checks"].items() if not passed]
        lines.append(
            f"- **{row['candidate']}:** "
            + ("all gates passed" if not failed else "failed " + ", ".join(f"`{name}`" for name in failed))
            + "."
        )
    lines.extend(
        [
            "",
            "Physical iPhone and Android latency are production gates. An unavailable device is "
            "reported as unmeasured, never treated as a pass. Reference decoders and golden raw-tensor "
            "fixtures do not count as completed Swift, Kotlin, and TypeScript production integrations.",
            "",
            "## Human decisions remaining",
            "",
        ]
    )
    decisions = outcome.get("humanDecisionRemaining", [])
    lines.extend(f"- {decision}" for decision in decisions)
    if not decisions:
        lines.append("- None.")
    lines.extend(
        [
            "",
            "## Reproduction",
            "",
            "`comparison.json` is the canonical deterministic report. `comparison-spec.json` binds "
            "its inputs, candidate jobs, decoder sources, and human-only gates; all referenced input "
            "files carry SHA-256 identities inside the report.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--markdown", type=Path)
    args = parser.parse_args()
    report = build(load_json(args.spec))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(canonical_json(report))
    if args.markdown is not None:
        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text(render_markdown(report), encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
