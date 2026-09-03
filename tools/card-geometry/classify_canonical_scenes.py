#!/usr/bin/env python3
"""Classify canonical multi-card frames with reviewable geometry features."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import statistics
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any


SCHEMA = "https://tcger.app/reports/canonical-multi-card-scene-assignments/v1"
HEURISTIC = "grid-size-overlap-rotation-v1"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _card_geometry(annotation: dict[str, Any]) -> dict[str, float]:
    bbox = annotation["bbox"]
    x, y, width, height = (float(value) for value in bbox)
    angle = 0.0
    segmentation = annotation.get("segmentation")
    if isinstance(segmentation, list) and segmentation:
        flat = max(
            (value for value in segmentation if isinstance(value, list)),
            key=len,
            default=[],
        )
        points = [
            (float(flat[index]), float(flat[index + 1]))
            for index in range(0, len(flat) - 1, 2)
        ]
        if len(points) > 1 and points[0] == points[-1]:
            points.pop()
        edges = [
            (math.dist(first, second), second[0] - first[0], second[1] - first[1])
            for first, second in zip(points, points[1:] + points[:1])
        ]
        if edges:
            _, dx, dy = max(edges)
            angle = math.degrees(math.atan2(dy, dx)) % 90.0
    return {
        "x0": x,
        "y0": y,
        "x1": x + width,
        "y1": y + height,
        "cx": x + width / 2,
        "cy": y + height / 2,
        "width": width,
        "height": height,
        "scale": math.sqrt(max(width * height, 0.0)),
        "angle": angle,
    }


def _circular_spread(angles: list[float]) -> float:
    if len(angles) < 2:
        return 0.0
    doubled = [math.radians(value * 4) for value in angles]
    mean = math.atan2(
        sum(math.sin(value) for value in doubled),
        sum(math.cos(value) for value in doubled),
    )
    center = math.degrees(mean) / 4 % 90
    distances = [abs((value - center + 45) % 90 - 45) for value in angles]
    return max(distances)


def features(cards: list[dict[str, float]]) -> dict[str, float | int]:
    count = len(cards)
    scales = [card["scale"] for card in cards]
    mean_scale = statistics.fmean(scales)
    size_cv = statistics.pstdev(scales) / mean_scale if mean_scale else 1.0
    aligned = 0
    for index, card in enumerate(cards):
        peers = cards[:index] + cards[index + 1 :]
        if any(
            abs(card["cy"] - peer["cy"])
            <= 0.25 * statistics.fmean([card["height"], peer["height"]])
            or abs(card["cx"] - peer["cx"])
            <= 0.25 * statistics.fmean([card["width"], peer["width"]])
            for peer in peers
        ):
            aligned += 1
    overlap_pairs = 0
    pair_count = count * (count - 1) // 2
    maximum_overlap = 0.0
    for index, first in enumerate(cards):
        for second in cards[index + 1 :]:
            intersection = max(
                0.0,
                min(first["x1"], second["x1"])
                - max(first["x0"], second["x0"]),
            ) * max(
                0.0,
                min(first["y1"], second["y1"])
                - max(first["y0"], second["y0"]),
            )
            smaller = min(first["width"] * first["height"], second["width"] * second["height"])
            ratio = intersection / smaller if smaller else 0.0
            maximum_overlap = max(maximum_overlap, ratio)
            overlap_pairs += ratio >= 0.05
    return {
        "cardCount": count,
        "gridAlignment": round(aligned / count, 6),
        "sizeCoefficientOfVariation": round(size_cv, 6),
        "rotationSpreadDegrees": round(
            _circular_spread([card["angle"] for card in cards]), 6
        ),
        "overlapPairFraction": round(overlap_pairs / pair_count, 6) if pair_count else 0.0,
        "maximumPairOverlap": round(maximum_overlap, 6),
    }


def classify(values: dict[str, float | int]) -> tuple[str, str]:
    count = int(values["cardCount"])
    grid = float(values["gridAlignment"])
    size_cv = float(values["sizeCoefficientOfVariation"])
    rotation = float(values["rotationSpreadDegrees"])
    overlap = float(values["overlapPairFraction"])
    if count >= 4 and grid >= 0.75 and size_cv <= 0.25 and rotation <= 10 and overlap <= 0.05:
        return "binder_page", "regular grid, near-uniform card size, low rotation and overlap"
    if overlap >= 0.05 or rotation >= 12:
        return "duel_field", "card overlap or rotation spread suggests a play surface"
    return "other", "does not meet the conservative binder or duel heuristic"


def build_assignments(corpus: Path) -> dict[str, Any]:
    assignments = []
    with corpus.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            annotations = [
                item
                for item in row.get("annotations", [])
                if item.get("category") == "card"
            ]
            if len(annotations) < 2:
                continue
            measured = features([_card_geometry(item) for item in annotations])
            assignment, reason = classify(measured)
            assignments.append(
                {
                    "recordId": row["id"],
                    "archive": row["archive"],
                    "imageMember": row["imageMember"],
                    "source": row.get("provenance", [{}])[0].get("source", "unknown"),
                    "split": row.get("split"),
                    "assignment": assignment,
                    "reason": reason,
                    "features": measured,
                }
            )
    assignments.sort(key=lambda item: item["recordId"])
    counts = Counter(item["assignment"] for item in assignments)
    sample = []
    for assignment in ("binder_page", "duel_field", "other"):
        candidates = [item for item in assignments if item["assignment"] == assignment]
        if not candidates:
            continue
        step = max(1, len(candidates) // 8)
        sample.extend(item["recordId"] for item in candidates[::step][:8])
    return {
        "schema": SCHEMA,
        "input": {"name": corpus.name, "sha256": _sha256(corpus)},
        "heuristic": {
            "id": HEURISTIC,
            "binderRule": "cardCount>=4, gridAlignment>=0.75, sizeCV<=0.25, rotationSpread<=10deg, overlapPairFraction<=0.05",
            "duelRule": "not binder and (overlapPairFraction>=0.05 or rotationSpread>=12deg)",
            "otherRule": "everything else",
            "status": "provisional-until-human-spot-check",
        },
        "counts": dict(sorted(counts.items())),
        "spotCheckRecordIds": sample,
        "assignments": assignments,
    }


def render_spot_check(report: dict[str, Any], raw_dir: Path, output: Path) -> None:
    from PIL import Image, ImageDraw

    by_id = {item["recordId"]: item for item in report["assignments"]}
    chosen = [by_id[record_id] for record_id in report["spotCheckRecordIds"]]
    cells = []
    for item in chosen:
        with zipfile.ZipFile(raw_dir / item["archive"]) as archive:
            image = Image.open(io.BytesIO(archive.read(item["imageMember"]))).convert("RGB")
        image.thumbnail((320, 240))
        cell = Image.new("RGB", (340, 285), "white")
        cell.paste(image, ((340 - image.width) // 2, 0))
        draw = ImageDraw.Draw(cell)
        draw.text((8, 244), f"{item['assignment']} | {item['source']}", fill="black")
        draw.text((8, 262), item["recordId"][:28], fill="black")
        cells.append(cell)
    columns = 4
    rows = math.ceil(len(cells) / columns)
    sheet = Image.new("RGB", (columns * 340, rows * 285), (225, 225, 225))
    for index, cell in enumerate(cells):
        sheet.paste(cell, ((index % columns) * 340, (index // columns) * 285))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, quality=88)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--raw-dir", type=Path)
    parser.add_argument("--spot-check-output", type=Path)
    args = parser.parse_args()
    report = build_assignments(args.corpus.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    if args.spot_check_output:
        if not args.raw_dir:
            parser.error("--raw-dir is required with --spot-check-output")
        render_spot_check(report, args.raw_dir.resolve(), args.spot_check_output.resolve())
    print(json.dumps(report["counts"], indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
