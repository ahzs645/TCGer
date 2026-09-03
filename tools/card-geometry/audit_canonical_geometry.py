#!/usr/bin/env python3
"""Audit scene coverage and usable mask quads in a canonical corpus JSONL."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_real_smoke_release import _points, conservative_mask_quad  # noqa: E402
from corpus_release import sha256_file  # noqa: E402


SCHEMA = "https://tcger.app/reports/canonical-geometry-audit/v1"


def _polygon(annotation: dict[str, Any]) -> tuple[list[float], list[tuple[float, float]]]:
    segmentation = annotation.get("segmentation")
    candidates = segmentation if isinstance(segmentation, list) else []
    flat = max(
        (candidate for candidate in candidates if isinstance(candidate, list)),
        key=len,
        default=[],
    )
    return flat, _points(flat)


def audit(path: Path) -> dict[str, Any]:
    totals: Counter[str] = Counter()
    by_source: dict[str, Counter[str]] = defaultdict(Counter)
    by_split: dict[str, Counter[str]] = defaultdict(Counter)
    scene_candidates: Counter[str] = Counter()
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            totals["records"] += 1
            source = row.get("provenance", [{}])[0].get("source", "unknown")
            split = row.get("split", "unknown")
            card_annotations = [
                annotation
                for annotation in row.get("annotations", [])
                if annotation.get("category") == "card"
            ]
            scene = (
                "unannotated"
                if not card_annotations
                else "single_card_archive"
                if len(card_annotations) == 1
                else "multi_card_unclassified"
            )
            scene_candidates[scene] += 1
            for bucket in (totals, by_source[source], by_split[split]):
                bucket["cardInstances"] += len(card_annotations)
                bucket[f"sceneCandidate:{scene}"] += 1
            for annotation in card_annotations:
                quality = annotation.get("geometryQuality", "unknown")
                for bucket in (totals, by_source[source], by_split[split]):
                    bucket[f"geometryQuality:{quality}"] += 1
                if quality != "source-polygon":
                    continue
                flat, points = _polygon(annotation)
                raw_points = [
                    (float(flat[index]), float(flat[index + 1]))
                    for index in range(0, len(flat), 2)
                ] if len(flat) >= 6 and len(flat) % 2 == 0 else []
                closing_removed = (
                    len(raw_points) > 1 and raw_points[0] == raw_points[-1]
                )
                _, outcome = conservative_mask_quad(points)
                for bucket in (totals, by_source[source], by_split[split]):
                    bucket["sourcePolygonInstances"] += 1
                    bucket[f"quadFit:{outcome}"] += 1
                    if closing_removed:
                        bucket["closingPointNormalized"] += 1

    def complete(counter: Counter[str]) -> dict[str, int]:
        return dict(sorted(counter.items()))

    return {
        "schema": SCHEMA,
        "input": path.name,
        "inputSha256": sha256_file(path),
        "summary": complete(totals),
        "sceneCandidates": complete(scene_candidates),
        "bySource": {key: complete(value) for key, value in sorted(by_source.items())},
        "bySplit": {key: complete(value) for key, value in sorted(by_split.items())},
        "sceneClassification": {
            "single_card_archive": "exactly one card annotation; not evidence of handheld capture",
            "multi_card_unclassified": "two or more card annotations; requires visual review before binder_page or duel_field assignment",
            "unannotated": "no card annotation",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.corpus.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(report["summary"], indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
