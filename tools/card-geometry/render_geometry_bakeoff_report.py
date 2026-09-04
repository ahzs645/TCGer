#!/usr/bin/env python3
"""Render a deterministic human-readable geometry bake-off report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


EXPECTED_SCHEMA = "https://tcger.app/reports/card-geometry-bakeoff-comparison/v1"


def number(value: float | int | None, digits: int = 3) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, int):
        return str(value)
    return f"{value:.{digits}f}"


def status(value: bool) -> str:
    return "pass" if value else "fail"


def latency_summary(candidate: dict[str, Any]) -> str:
    export = candidate["export"]
    if export is None:
        return "not exported"
    rows = []
    latency = export.get("latency", {})
    for key in ("onnxCpu", "coremlCpu", "coremlAll"):
        row = latency.get(key)
        if row and row.get("meanMilliseconds") is not None:
            rows.append(f"{key} {row['meanMilliseconds']:.2f} ms")
    return "; ".join(rows) if rows else "not measured"


def render(report: dict[str, Any]) -> str:
    if report.get("schema") != EXPECTED_SCHEMA:
        raise ValueError("not a card-geometry bake-off comparison report")
    lines = [
        "# Shared card-geometry bake-off",
        "",
        "This document is generated from the deterministic comparison JSON. The JSON is the "
        "authoritative result; this page is its human-readable projection.",
        "",
        "## Frozen inputs",
        "",
        f"- Bake-off: `{report['bakeoffId']}`",
        f"- Training corpus: `{report['trainingCorpusHash']}`",
        f"- Real evaluation corpus: `{report['realEvaluationCorpusHash']}`",
        f"- Synthetic evaluation corpus: `{report['syntheticEvaluationCorpusHash']}`",
        f"- Effective fairness identity: `{report['effectiveFairnessHash']}`",
        "",
        "## Result",
        "",
        f"Recommendation: **{report['outcome']['recommendation']}**.",
        "",
        "| Candidate | License route | R@0.5 | R@0.75 | Corner p50 | p90 | p95 | "
        "Outside p50 | Duplicates | Extras | Wrong accepts | Parity cosine | Measured budgets | "
        "Production ready |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | "
        "---: | --- | --- |",
    ]
    for candidate in report["candidates"]:
        real = candidate["real"]
        corner = real["normalizedCorner"]
        export = candidate["export"]
        cosine = None if export is None else export["minimumCosine"]
        lines.append(
            "| "
            + " | ".join(
                [
                    candidate["candidate"],
                    candidate["licenseRoute"],
                    number(real["recallAt05"]),
                    number(real["recallAt075"]),
                    number(corner["p50"]),
                    number(corner["p90"]),
                    number(corner["p95"]),
                    number(real["outsideFrameNormalizedP50"]),
                    number(real["duplicates"]),
                    number(real["extras"]),
                    number(candidate["recognition"]["wrong"]),
                    number(cosine, 6),
                    status(candidate["passesMeasuredMetricBudgets"]),
                    status(candidate["productionReady"]),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## Candidate details",
            "",
        ]
    )
    for candidate in report["candidates"]:
        export = candidate["export"]
        physical = None if export is None else export["physicalDeviceLatency"]
        lines.extend(
            [
                f"### {candidate['candidate']}",
                "",
                f"- Framework: `{candidate['framework']}`; experiment "
                f"`{candidate['experimentHash']}`.",
                f"- Training: {candidate['training']['l4GpuHours']:.3f} L4 GPU hours; job "
                f"`{candidate['training']['jobId'] or 'not recorded'}`.",
                f"- Synthetic duel-field recall: R@0.5 {candidate['synthetic']['recallAt05']:.3f}, "
                f"R@0.75 {candidate['synthetic']['recallAt075']:.3f}, "
                f"R@0.9 {candidate['synthetic']['recallAt09']:.3f}.",
                f"- Exported bytes: ONNX {number(None if export is None else export['onnxBytes'])}; "
                f"Core ML {number(None if export is None else export['coremlBytes'])}.",
                f"- Local latency: {latency_summary(candidate)}.",
                "- Physical latency: "
                + (
                    "not exported"
                    if physical is None
                    else f"iOS {physical['ios']['status']}; Android {physical['android']['status']}."
                ),
                f"- Decoder: {candidate['decoder']['status']}; reference "
                f"{candidate['decoder']['reference']['bytes']} bytes / "
                f"{candidate['decoder']['reference']['lines']} lines; production "
                f"{candidate['decoder']['production']['bytes']} bytes / "
                f"{candidate['decoder']['production']['lines']} lines.",
                f"- Failed gates: {', '.join(key for key, passed in candidate['checks'].items() if not passed) or 'none'}.",
            ]
        )
        if candidate["deviations"]:
            lines.append(
                "- Recorded fairness deviations: "
                + "; ".join(
                    f"{item.get('kind', 'unspecified')}: {item.get('reason', item)}"
                    if isinstance(item, dict)
                    else str(item)
                    for item in candidate["deviations"]
                )
                + "."
            )
        lines.append("")

    lines.extend(
        [
            "## Production gate",
            "",
            "Measured geometry quality is only one gate. Production also requires a shipping-compatible "
            "license route, complete platform decoders, cross-runtime parity, and physical iPhone and "
            "Android latency measurements. Evaluation-only Ultralytics artifacts must not be published "
            "to the asset store.",
        ]
    )
    remaining = report["outcome"].get("humanDecisionRemaining", [])
    if remaining:
        lines.extend(["", "Human decisions still required:", ""])
        lines.extend(f"- {item}" for item in remaining)
    if report.get("notes"):
        lines.extend(["", "## Notes", ""])
        lines.extend(f"- {item}" for item in report["notes"])
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = json.loads(args.report.read_text(encoding="utf-8"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(render(report), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
