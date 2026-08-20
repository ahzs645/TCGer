"""Extended diagnostic dashboards for TCGer's FiftyOne review workbench."""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageDraw

from performance import (
    CHART_BACKGROUND,
    CHART_BLUE,
    CHART_GOLD,
    CHART_GREY,
    CHART_GRID,
    CHART_INK,
    CHART_MUTED,
    CHART_OLIVE,
    CHART_ORANGE,
    CHART_PANEL,
    CHART_PINK,
    _font,
    wilson_interval,
)


PANEL_SIZE = (1200, 620)
SCORED_VERDICTS = {"correct", "wrong", "false_positive", "missed", "declined"}
ACCEPTED_VERDICTS = {"correct", "wrong", "false_positive"}
_RECOGNITION_ROW_CACHE: dict[tuple[int, str], list[dict[str, Any]]] = {}


def _panel(title: str, subtitle: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", PANEL_SIZE, CHART_PANEL)
    draw = ImageDraw.Draw(image)
    draw.text((38, 25), title, fill=CHART_INK, font=_font(29, True))
    draw.text((38, 67), subtitle, fill=CHART_MUTED, font=_font(16))
    return image, draw


def _save(image: Image.Image, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)
    return path


def _placeholder(title: str, subtitle: str, required: Iterable[str]) -> Image.Image:
    image, draw = _panel(title, subtitle)
    draw.rounded_rectangle(
        (38, 125, 1162, 545), radius=14, fill="#f1f5f8", outline=CHART_GRID, width=2
    )
    draw.text((72, 160), "Waiting for instrumentation", fill=CHART_GOLD, font=_font(21, True))
    draw.text(
        (72, 205),
        "This panel is intentionally unavailable rather than displaying inferred or zero values.",
        fill=CHART_INK,
        font=_font(17),
    )
    for index, field in enumerate(required):
        y = 260 + index * 52
        draw.ellipse((76, y + 5, 88, y + 17), fill=CHART_GOLD)
        draw.text((106, y), field, fill=CHART_MUTED, font=_font(16))
    return image


def _compose(title: str, subtitle: str, panels: list[Image.Image], output: Path) -> Path:
    rows = math.ceil(len(panels) / 2)
    dashboard = Image.new("RGB", (2440, 130 + rows * 620 + 20), CHART_BACKGROUND)
    draw = ImageDraw.Draw(dashboard)
    draw.text((40, 25), title, fill=CHART_INK, font=_font(38, True))
    draw.text((40, 78), subtitle, fill=CHART_MUTED, font=_font(18))
    for index, panel in enumerate(panels):
        x = 20 if index % 2 == 0 else 1220
        y = 130 + (index // 2) * 620
        dashboard.paste(panel, (x, y))
        panel.close()
    return _save(dashboard, output)


def _run_items(dataset: Any) -> list[dict[str, Any]]:
    return sorted(
        (dataset.info or {}).get("tcger_model_runs", []),
        key=lambda item: item.get("metrics", {}).get("f1", 0),
        reverse=True,
    )


def _suffix(item: dict[str, Any]) -> str:
    return str(item["field"]).removeprefix("pred_")


def _recognition_rows(dataset: Any, suffix: str) -> list[dict[str, Any]]:
    cache_key = (id(dataset), suffix)
    if cache_key in _RECOGNITION_ROW_CACHE:
        return _RECOGNITION_ROW_CACHE[cache_key]
    fields = [
        "sample_key",
        f"verdict_{suffix}",
        f"name_verdict_{suffix}",
        f"identified_confidence_{suffix}",
        "label_card_id",
        "label_category",
        "label_card_name",
        f"identified_card_id_{suffix}",
        f"identified_card_name_{suffix}",
        "source_dataset",
        "provenance_kind",
        "perspective_distortion",
    ]
    columns = dataset.values(fields)
    rows = []
    for values in zip(*columns):
        record = dict(zip(fields, values))
        verdict = record[f"verdict_{suffix}"]
        if verdict not in SCORED_VERDICTS:
            continue
        rows.append(
            {
                "sample_key": record["sample_key"],
                "verdict": verdict,
                "name_verdict": record[f"name_verdict_{suffix}"],
                "confidence": record[f"identified_confidence_{suffix}"],
                "expected_id": record["label_card_id"] or record["label_category"],
                "expected_name": record["label_card_name"] or "",
                "predicted_id": record[f"identified_card_id_{suffix}"] or "__declined__",
                "predicted_name": record[f"identified_card_name_{suffix}"] or "declined",
                "category": record["label_category"],
                "source_dataset": record["source_dataset"] or "unknown",
                "provenance_kind": record["provenance_kind"] or "unknown",
                "perspective_distortion": record["perspective_distortion"],
            }
        )
    _RECOGNITION_ROW_CACHE[cache_key] = rows
    return rows


def _risk_coverage_panel(dataset: Any, run_items: list[dict[str, Any]]) -> tuple[Image.Image, dict[str, Any]]:
    image, draw = _panel(
        "Selective risk versus accepted coverage",
        "Accepted predictions only · coverage denominator is all scored images · lower risk is better",
    )
    left, right, top, bottom = 105, 1125, 130, 530
    for tick in (0, 0.25, 0.5, 0.75, 1.0):
        x = left + tick * (right - left)
        y = bottom - tick * (bottom - top)
        draw.line((x, top, x, bottom), fill=CHART_GRID, width=1)
        draw.line((left, y, right, y), fill=CHART_GRID, width=1)
        draw.text((x - 14, bottom + 10), f"{tick:.0%}", fill=CHART_MUTED, font=_font(13))
        draw.text((42, y - 7), f"{tick:.0%}", fill=CHART_MUTED, font=_font(13))
    draw.text((515, 570), "Accepted coverage", fill=CHART_MUTED, font=_font(15))
    draw.text((20, 300), "Risk", fill=CHART_MUTED, font=_font(15, True))
    palette = [CHART_BLUE, CHART_ORANGE, CHART_OLIVE, CHART_PINK, CHART_GOLD]
    result: dict[str, Any] = {}
    for index, item in enumerate(run_items[:5]):
        suffix = _suffix(item)
        rows = _recognition_rows(dataset, suffix)
        scored = len(rows)
        accepted = [row for row in rows if row["verdict"] in ACCEPTED_VERDICTS and row["confidence"] is not None]
        points = []
        for threshold in [value / 100 for value in range(0, 101, 2)]:
            kept = [row for row in accepted if float(row["confidence"]) >= threshold]
            if not kept:
                continue
            errors = sum(row["verdict"] != "correct" for row in kept)
            points.append(
                {
                    "threshold": threshold,
                    "coverage": len(kept) / scored if scored else 0,
                    "risk": errors / len(kept),
                    "accepted": len(kept),
                }
            )
        result[suffix] = points
        color = palette[index]
        coordinates = [
            (
                left + point["coverage"] * (right - left),
                bottom - point["risk"] * (bottom - top),
            )
            for point in points
        ]
        if len(coordinates) >= 2:
            draw.line(coordinates, fill=color, width=3)
        for x, y in coordinates[:: max(1, len(coordinates) // 8)]:
            draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=color)
        legend_x = 465 + (index % 3) * 225
        legend_y = 96 + (index // 3) * 24
        draw.line((legend_x, legend_y + 7, legend_x + 22, legend_y + 7), fill=color, width=3)
        draw.text((legend_x + 30, legend_y), suffix.replace("_", " "), fill=CHART_MUTED, font=_font(13))
    return image, result


def _calibration_panel(dataset: Any, best: dict[str, Any]) -> tuple[Image.Image, dict[str, Any]]:
    suffix = _suffix(best)
    rows = [
        row
        for row in _recognition_rows(dataset, suffix)
        if row["verdict"] in ACCEPTED_VERDICTS and row["confidence"] is not None
    ]
    rows.sort(key=lambda row: float(row["confidence"]))
    image, draw = _panel(
        "Confidence reliability",
        f"Run {suffix.replace('_', ' ')} · accepted predictions n={len(rows)} · four equal-count bins; exploratory at this sample size",
    )
    left, right, top, bottom = 120, 1090, 130, 535
    for tick in (0, 0.25, 0.5, 0.75, 1.0):
        x = left + tick * (right - left)
        y = bottom - tick * (bottom - top)
        draw.line((x, top, x, bottom), fill=CHART_GRID, width=1)
        draw.line((left, y, right, y), fill=CHART_GRID, width=1)
        draw.text((x - 14, bottom + 10), f"{tick:.0%}", fill=CHART_MUTED, font=_font(13))
        draw.text((52, y - 7), f"{tick:.0%}", fill=CHART_MUTED, font=_font(13))
    draw.line((left, bottom, right, top), fill=CHART_GREY, width=2)
    bins = []
    if rows:
        bin_count = min(4, len(rows))
        for index in range(bin_count):
            start = round(index * len(rows) / bin_count)
            stop = round((index + 1) * len(rows) / bin_count)
            members = rows[start:stop]
            if not members:
                continue
            confidence = sum(float(row["confidence"]) for row in members) / len(members)
            accuracy = sum(row["verdict"] == "correct" for row in members) / len(members)
            bins.append({"confidence": confidence, "accuracy": accuracy, "n": len(members)})
            x = left + confidence * (right - left)
            y = bottom - accuracy * (bottom - top)
            draw.line((x, bottom, x, y), fill=CHART_BLUE, width=12)
            draw.ellipse((x - 8, y - 8, x + 8, y + 8), fill=CHART_BLUE, outline=CHART_INK)
            draw.text((x + 10, y - 8), f"n={len(members)}", fill=CHART_MUTED, font=_font(12))
    draw.text((500, 575), "Mean recorded confidence", fill=CHART_MUTED, font=_font(15))
    draw.text((18, 300), "Accuracy", fill=CHART_MUTED, font=_font(15, True))
    return image, {"run": suffix, "bins": bins, "accepted": len(rows)}


def _threshold_heatmap_panel(dataset: Any, run_items: list[dict[str, Any]]) -> tuple[Image.Image, dict[str, Any]]:
    thresholds = [0.0, 0.70, 0.75, 0.80, 0.85, 0.90]
    image, draw = _panel(
        "Accepted precision by confidence threshold",
        "Cell shows precision and accepted count · declined samples remain uncovered",
    )
    left, top = 285, 135
    cell_width, cell_height = 140, 34
    for column, threshold in enumerate(thresholds):
        draw.text(
            (left + column * cell_width + 36, 104),
            f"≥{threshold:.0%}",
            fill=CHART_MUTED,
            font=_font(13, True),
        )
    result: dict[str, Any] = {}
    for row_index, item in enumerate(run_items):
        suffix = _suffix(item)
        rows = [
            row
            for row in _recognition_rows(dataset, suffix)
            if row["verdict"] in ACCEPTED_VERDICTS and row["confidence"] is not None
        ]
        draw.text((38, top + row_index * cell_height + 7), suffix.replace("_", " "), fill=CHART_INK, font=_font(13))
        cells = []
        for column, threshold in enumerate(thresholds):
            kept = [row for row in rows if float(row["confidence"]) >= threshold]
            precision = (
                sum(row["verdict"] == "correct" for row in kept) / len(kept) if kept else None
            )
            cells.append({"threshold": threshold, "precision": precision, "accepted": len(kept)})
            x = left + column * cell_width
            y = top + row_index * cell_height
            if precision is None:
                fill = "#edf1f4"
                label = "—"
            else:
                intensity = int(235 - 120 * precision)
                fill = (intensity, min(245, intensity + 35), 248)
                label = f"{precision:.0%} · {len(kept)}"
            draw.rectangle((x, y, x + cell_width - 4, y + cell_height - 4), fill=fill, outline=CHART_GRID)
            draw.text((x + 33, y + 7), label, fill=CHART_INK, font=_font(12, True))
        result[suffix] = cells
    return image, result


def _accepted_errors_panel(dataset: Any, best: dict[str, Any]) -> tuple[Image.Image, list[dict[str, Any]]]:
    suffix = _suffix(best)
    errors = Counter()
    for row in _recognition_rows(dataset, suffix):
        if row["verdict"] in {"wrong", "false_positive"}:
            expected = row["expected_name"] or row["expected_id"]
            errors[f"{expected} → {row['predicted_name']} [{row['predicted_id']}]"] += 1
    image, draw = _panel(
        "Accepted error pairs",
        f"Best-F1 run {suffix.replace('_', ' ')} · ranked accepted mistakes only",
    )
    ranked = [{"pair": pair, "count": count} for pair, count in errors.most_common(8)]
    if not ranked:
        draw.text((38, 155), "No accepted errors in this run.", fill=CHART_OLIVE, font=_font(22, True))
    else:
        maximum = max(item["count"] for item in ranked)
        for index, item in enumerate(ranked):
            y = 135 + index * 55
            label = item["pair"]
            if len(label) > 54:
                label = label[:53] + "…"
            draw.text((38, y + 8), label, fill=CHART_INK, font=_font(14))
            width = 320 * item["count"] / maximum
            draw.rectangle((820, y, 820 + width, y + 30), fill=CHART_ORANGE)
            draw.text((830 + width, y + 6), str(item["count"]), fill=CHART_MUTED, font=_font(14, True))
    draw.text(
        (38, 565),
        "Use the corresponding FiftyOne failure view for image-level inspection.",
        fill=CHART_MUTED,
        font=_font(14),
    )
    return image, ranked


def render_decision_dashboard(dataset: Any, output_dir: Path) -> tuple[Path, dict[str, Any]]:
    runs = _run_items(dataset)
    if not runs:
        raise ValueError("No recognition runs are registered on the dataset")
    risk_panel, risk_data = _risk_coverage_panel(dataset, runs)
    calibration_panel, calibration_data = _calibration_panel(dataset, runs[0])
    heatmap_panel, heatmap_data = _threshold_heatmap_panel(dataset, runs)
    errors_panel, error_data = _accepted_errors_panel(dataset, runs[0])
    path = _compose(
        "TCGer decision-quality dashboard",
        "Threshold selection, confidence reliability, and accepted-error diagnostics",
        [risk_panel, calibration_panel, heatmap_panel, errors_panel],
        output_dir / "decision-quality-dashboard.png",
    )
    return path, {
        "riskCoverage": risk_data,
        "calibration": calibration_data,
        "thresholdHeatmap": heatmap_data,
        "acceptedErrors": error_data,
    }


def _geometry_reference_panel(dataset: Any) -> tuple[Image.Image, dict[str, int]]:
    counts = Counter(dataset.values("geometry_source"))
    image, draw = _panel(
        "Reference geometry coverage",
        f"All replay media · n={sum(counts.values())}; polygon truth is preferred over box fallback",
    )
    items = [
        ("Source polygon", counts.get("source_polygon", 0), CHART_BLUE),
        ("Box fallback", counts.get("bbox_fallback", 0), CHART_GOLD),
        ("Unavailable", counts.get("unavailable", 0), CHART_GREY),
    ]
    maximum = max((count for _, count, _ in items), default=1)
    for index, (label, count, color) in enumerate(items):
        y = 160 + index * 105
        draw.text((45, y + 12), label, fill=CHART_INK, font=_font(18))
        width = 760 * count / maximum if maximum else 0
        draw.rectangle((285, y, 285 + width, y + 48), fill=color)
        draw.text((300 + width, y + 12), f"{count:,}", fill=CHART_MUTED, font=_font(17, True))
    return image, dict(counts)


def _perspective_distribution_panel(dataset: Any) -> tuple[Image.Image, dict[str, Any]]:
    values = [float(value) for value in dataset.values("perspective_distortion") if value is not None]
    image, draw = _panel(
        "Reference perspective-distortion distribution",
        f"Geometry-derived score across replay media · n={len(values)}; not a camera-angle measurement",
    )
    if not values:
        return _placeholder("Reference perspective-distortion distribution", "No scores available", ["perspective_distortion"]), {}
    maximum = max(values)
    bins = 20
    counts = [0] * bins
    for value in values:
        index = min(bins - 1, int(value / maximum * bins)) if maximum else 0
        counts[index] += 1
    left, right, top, bottom = 95, 1135, 135, 520
    count_max = max(counts)
    for index, count in enumerate(counts):
        x0 = left + index * (right - left) / bins
        x1 = left + (index + 1) * (right - left) / bins - 2
        height = (bottom - top) * count / count_max if count_max else 0
        draw.rectangle((x0, bottom - height, x1, bottom), fill=CHART_BLUE)
    for tick in range(5):
        value = maximum * tick / 4
        x = left + (right - left) * tick / 4
        draw.text((x - 18, bottom + 12), f"{value:.2f}", fill=CHART_MUTED, font=_font(13))
    ordered = sorted(values)
    quantiles = {
        "median": ordered[len(ordered) // 2],
        "p90": ordered[min(len(ordered) - 1, round(0.9 * (len(ordered) - 1)))],
        "max": maximum,
    }
    draw.text((38, 565), f"Median {quantiles['median']:.3f} · P90 {quantiles['p90']:.3f} · Max {maximum:.3f}", fill=CHART_MUTED, font=_font(15))
    return image, {"bins": counts, **quantiles, "n": len(values)}


def _ecdf_panel(
    title: str,
    subtitle: str,
    series: list[tuple[str, list[float], str]],
    x_max: float,
    x_label: str,
    higher_better: bool = False,
) -> Image.Image:
    image, draw = _panel(title, subtitle)
    left, right, top, bottom = 105, 1125, 130, 530
    for tick in (0, 0.25, 0.5, 0.75, 1.0):
        x = left + tick * (right - left)
        y = bottom - tick * (bottom - top)
        draw.line((x, top, x, bottom), fill=CHART_GRID, width=1)
        draw.line((left, y, right, y), fill=CHART_GRID, width=1)
        draw.text((x - 18, bottom + 10), f"{x_max * tick:.2f}", fill=CHART_MUTED, font=_font(13))
        draw.text((45, y - 7), f"{tick:.0%}", fill=CHART_MUTED, font=_font(13))
    for index, (label, values, color) in enumerate(series):
        ordered = sorted(value for value in values if value is not None)
        coordinates = []
        for position, value in enumerate(ordered):
            fraction = (len(ordered) - position) / len(ordered) if higher_better else (position + 1) / len(ordered)
            coordinates.append(
                (
                    left + min(value, x_max) / x_max * (right - left),
                    bottom - fraction * (bottom - top),
                )
            )
        if len(coordinates) >= 2:
            draw.line(coordinates, fill=color, width=3)
        draw.line((760 + index * 170, 103, 782 + index * 170, 103), fill=color, width=3)
        draw.text((790 + index * 170, 95), label, fill=CHART_MUTED, font=_font(13))
    draw.text((500, 570), x_label, fill=CHART_MUTED, font=_font(15))
    draw.text((18, 300), "Fraction ≥ x" if higher_better else "Fraction ≤ x", fill=CHART_MUTED, font=_font(14, True))
    return image


def render_geometry_dashboard(dataset: Any, output_dir: Path) -> tuple[Path, dict[str, Any]]:
    coverage_panel, coverage_data = _geometry_reference_panel(dataset)
    perspective_panel, perspective_data = _perspective_distribution_panel(dataset)
    runs = (dataset.info or {}).get("tcger_geometry_runs", [])
    geometry_data: dict[str, Any] = {"referenceCoverage": coverage_data, "perspective": perspective_data, "runs": []}
    if runs:
        latest = runs[-1]
        corner_values = [value for value in dataset.values(latest.get("cornerErrorField", f"corner_error_{latest['name']}")) if value is not None]
        mask_values = [value for value in dataset.values(latest.get("maskIoUField", f"mask_iou_{latest['name']}")) if value is not None]
        boundary_field = latest.get("boundaryIoUField", f"boundary_iou_{latest['name']}")
        schema = dataset.get_field_schema()
        boundary_values = [value for value in dataset.values(boundary_field) if value is not None] if boundary_field in schema else []
        corner_panel = _ecdf_panel(
            "Normalized corner-error ECDF",
            f"Geometry run {latest['name']} · lower is better",
            [("Corner error", corner_values, CHART_ORANGE)],
            max(0.05, max(corner_values, default=0.05)),
            "Normalized mean four-corner error",
        )
        iou_panel = _ecdf_panel(
            "Mask and boundary IoU survival curves",
            f"Geometry run {latest['name']} · higher at any IoU threshold is better",
            [("Mask IoU", mask_values, CHART_BLUE), ("Boundary IoU", boundary_values, CHART_GOLD)],
            1.0,
            "IoU",
            higher_better=True,
        )
        geometry_data["runs"].append({"name": latest["name"], "corner": corner_values, "mask": mask_values, "boundary": boundary_values})
    else:
        corner_panel = _placeholder(
            "Normalized corner-error ECDF",
            "Populates automatically after a geometry run is imported",
            ["corners_pred_<model>", "corner_error_<model>", "geometry_verdict_<model>"],
        )
        iou_panel = _placeholder(
            "Mask and boundary IoU ECDF",
            "Populates automatically after a segmenter run is imported",
            ["geometry_pred_<model>", "mask_iou_<model>", "boundary_iou_<model>"],
        )
    path = _compose(
        "TCGer geometry and rectification dashboard",
        "Reference coverage now; prediction distributions appear after import-geometry",
        [coverage_panel, perspective_panel, corner_panel, iou_panel],
        output_dir / "geometry-dashboard.png",
    )
    return path, geometry_data


def _metric_for_rows(rows: list[dict[str, Any]], metric: str) -> tuple[float | None, int, int]:
    if metric == "end_to_end":
        eligible = rows
        success = sum(row["verdict"] in {"correct", "declined"} for row in eligible)
    elif metric == "name_recall":
        eligible = [row for row in rows if row["category"] == "singleCard" and row["expected_name"]]
        success = sum(row["name_verdict"] == "correct" for row in eligible)
    else:
        eligible = [row for row in rows if row["category"] == "singleCard"]
        success = sum(row["verdict"] == "correct" for row in eligible)
    return (success / len(eligible) if eligible else None, success, len(eligible))


def _robustness_heatmap(dataset: Any, best: dict[str, Any]) -> tuple[Image.Image, list[dict[str, Any]]]:
    suffix = _suffix(best)
    rows = _recognition_rows(dataset, suffix)
    groups = defaultdict(list)
    for row in rows:
        groups[row["source_dataset"]].append(row)
    metrics = [("Exact recall", "exact_recall"), ("Name recall", "name_recall"), ("End-to-end", "end_to_end")]
    image, draw = _panel(
        "Performance by source dataset",
        f"Best-F1 run {suffix.replace('_', ' ')} · each cell prints rate and denominator",
    )
    left, top, cell_width, cell_height = 410, 155, 220, 70
    for index, (label, _) in enumerate(metrics):
        draw.text((left + index * cell_width + 40, 115), label, fill=CHART_MUTED, font=_font(14, True))
    output = []
    for row_index, (group, members) in enumerate(sorted(groups.items())):
        y = top + row_index * cell_height
        draw.text((38, y + 18), group, fill=CHART_INK, font=_font(16))
        record = {"source": group, "scored": len(members)}
        for column, (_, metric) in enumerate(metrics):
            value, success, total = _metric_for_rows(members, metric)
            record[metric] = {"value": value, "success": success, "n": total}
            x = left + column * cell_width
            if value is None:
                fill, label = "#edf1f4", "—"
            else:
                intensity = int(240 - 125 * value)
                fill = (intensity, min(245, intensity + 35), 248)
                label = f"{value:.0%} · n={total}"
            draw.rectangle((x, y, x + cell_width - 8, y + cell_height - 8), fill=fill, outline=CHART_GRID)
            draw.text((x + 45, y + 20), label, fill=CHART_INK, font=_font(14, True))
        output.append(record)
    return image, output


def _provenance_panel(dataset: Any, best: dict[str, Any]) -> tuple[Image.Image, list[dict[str, Any]]]:
    suffix = _suffix(best)
    groups = defaultdict(list)
    for row in _recognition_rows(dataset, suffix):
        groups[row["provenance_kind"]].append(row)
    image, draw = _panel(
        "Performance by provenance",
        "End-to-end accuracy with 95% Wilson intervals · augmented-dataset membership is not per-file augmentation proof",
    )
    output = []
    left, right = 420, 1080
    for index, (group, members) in enumerate(sorted(groups.items())):
        value, success, total = _metric_for_rows(members, "end_to_end")
        if value is None:
            continue
        low, high = wilson_interval(success, total)
        y = 175 + index * 120
        label = group.replace("roboflow_", "").replace("_", " ")
        draw.text((38, y - 9), label, fill=CHART_INK, font=_font(17))
        x_low = left + low * (right - left)
        x_high = left + high * (right - left)
        x = left + value * (right - left)
        draw.line((x_low, y, x_high, y), fill=CHART_BLUE, width=3)
        draw.line((x_low, y - 8, x_low, y + 8), fill=CHART_BLUE, width=2)
        draw.line((x_high, y - 8, x_high, y + 8), fill=CHART_BLUE, width=2)
        draw.ellipse((x - 8, y - 8, x + 8, y + 8), fill=CHART_BLUE, outline=CHART_INK)
        draw.text((1090, y - 9), f"{value:.0%} · n={total}", fill=CHART_MUTED, font=_font(14))
        output.append({"provenance": group, "value": value, "success": success, "n": total, "low": low, "high": high})
    for tick in (0, 0.25, 0.5, 0.75, 1.0):
        x = left + tick * (right - left)
        draw.line((x, 125, x, 500), fill=CHART_GRID, width=1)
        draw.text((x - 14, 515), f"{tick:.0%}", fill=CHART_MUTED, font=_font(13))
    return image, output


def _perspective_tercile_panel(dataset: Any, best: dict[str, Any]) -> tuple[Image.Image, list[dict[str, Any]]]:
    suffix = _suffix(best)
    rows = [
        row
        for row in _recognition_rows(dataset, suffix)
        if row["category"] == "singleCard" and row["perspective_distortion"] is not None
    ]
    rows.sort(key=lambda row: float(row["perspective_distortion"]))
    groups = []
    labels = ["Low distortion", "Middle distortion", "High distortion"]
    for index, label in enumerate(labels):
        start = round(index * len(rows) / 3)
        stop = round((index + 1) * len(rows) / 3)
        members = rows[start:stop]
        groups.append((label, members))
    image, draw = _panel(
        "Recognition by perspective-distortion tercile",
        "Positive cards only · score is reference geometry distortion, not measured camera angle",
    )
    output = []
    left, right = 390, 1090
    for index, (label, members) in enumerate(groups):
        y = 160 + index * 125
        exact, exact_success, total = _metric_for_rows(members, "exact_recall")
        name, name_success, _ = _metric_for_rows(members, "name_recall")
        low_score = float(members[0]["perspective_distortion"]) if members else 0
        high_score = float(members[-1]["perspective_distortion"]) if members else 0
        draw.text((38, y), label, fill=CHART_INK, font=_font(17, True))
        draw.text((38, y + 27), f"score {low_score:.3f}–{high_score:.3f} · n={total}", fill=CHART_MUTED, font=_font(13))
        for offset, value, color, series_label in ((0, exact or 0, CHART_GOLD, "Exact"), (32, name or 0, CHART_BLUE, "Name")):
            width = (right - left) * value
            draw.rectangle((left, y + offset, right, y + offset + 22), fill="#edf2f6")
            draw.rectangle((left, y + offset, left + width, y + offset + 22), fill=color)
            draw.text((left + 8, y + offset + 2), f"{series_label} {value:.0%}", fill=CHART_INK, font=_font(12, True))
        output.append({"label": label, "scoreLow": low_score, "scoreHigh": high_score, "n": total, "exact": exact, "name": name, "exactSuccess": exact_success, "nameSuccess": name_success})
    return image, output


def render_robustness_dashboard(dataset: Any, output_dir: Path) -> tuple[Path, dict[str, Any]]:
    runs = _run_items(dataset)
    best = runs[0]
    source_panel, source_data = _robustness_heatmap(dataset, best)
    provenance_panel, provenance_data = _provenance_panel(dataset, best)
    perspective_panel, perspective_data = _perspective_tercile_panel(dataset, best)
    coverage_panel = _placeholder(
        "Capture-condition robustness",
        "Source and perspective are available; physical-condition tags are not yet recorded",
        ["blur severity", "glare/foil reflection", "occlusion/crop fraction", "card pixel size", "lighting and device model"],
    )
    path = _compose(
        "TCGer robustness dashboard",
        "Cohorts remain separated and every computed comparison retains its denominator",
        [source_panel, provenance_panel, perspective_panel, coverage_panel],
        output_dir / "robustness-dashboard.png",
    )
    return path, {"run": _suffix(best), "sources": source_data, "provenance": provenance_data, "perspectiveTerciles": perspective_data}


def _sinnoh_summary_panel(repo_root: Path) -> tuple[Image.Image, dict[str, Any]]:
    path = repo_root / "docs/benchmarks/2026-07-02-sinnoh-rectify/full-1s-titleocr.eval-v2-tol5.json"
    image, draw = _panel(
        "Separate Sinnoh video benchmark",
        "Different cohort and scoring method · shown for context, never pooled with iOS replay",
    )
    if not path.is_file():
        return _placeholder("Separate Sinnoh video benchmark", "Benchmark file not found", [str(path)]), {}
    summary = json.loads(path.read_text()).get("summary", {})
    metrics = [
        ("Top-1 name", float(summary.get("top1NameAccuracy", 0)) / 100, int(summary.get("windows", 0)), CHART_BLUE),
        ("Top-1 exact print", float(summary.get("top1ExternalIdAccuracy", 0)) / 100, int(summary.get("externalIdWindows", 0)), CHART_GOLD),
        ("Candidate name recall", float(summary.get("candidateNameRecall", 0)) / 100, int(summary.get("windows", 0)), CHART_OLIVE),
        ("Candidate print recall", float(summary.get("candidateExternalIdRecall", 0)) / 100, int(summary.get("externalIdWindows", 0)), CHART_ORANGE),
    ]
    for index, (label, value, total, color) in enumerate(metrics):
        y = 145 + index * 90
        draw.text((38, y + 8), label, fill=CHART_INK, font=_font(17))
        draw.rectangle((320, y, 1080, y + 38), fill="#edf2f6")
        draw.rectangle((320, y, 320 + 760 * value, y + 38), fill=color)
        draw.text((335, y + 8), f"{value:.1%} · n={total}", fill=CHART_INK, font=_font(15, True))
    return image, {"path": str(path), "summary": summary}


def render_ocr_dashboard(dataset: Any, output_dir: Path, repo_root: Path) -> tuple[Path, dict[str, Any]]:
    sinnoh_panel, sinnoh_data = _sinnoh_summary_panel(repo_root)
    evidence_panel = _placeholder(
        "Accuracy versus usable OCR evidence",
        "The old presentation sampled clean reference words; TCGer needs actual OCR output",
        ["raw OCR text or token list per sample", "usable token count and OCR confidence", "name/exact-print verdict", "visible-card fraction or OCR region coverage"],
    )
    legacy_panel = _placeholder(
        "Set-specific versus master reference model",
        "The downloaded repository contains plotting code and pickles but no generated TSV evaluation tables",
        ["acc_set_model_on_reference.tsv", "acc_master_model_on_reference.tsv", "set name and sample count"],
    )
    instrumentation_panel = _placeholder(
        "OCR decision contribution",
        "Current replay reports store final identity/confidence but not how OCR changed the decision",
        ["OCR triggered flag", "pre-OCR and post-OCR candidate rank", "recognized collector/set tokens", "OCR latency and agreement verdict"],
    )
    path = _compose(
        "TCGer OCR and reference-benchmark dashboard",
        "Available external cohort shown separately; missing token-level evidence is explicit",
        [sinnoh_panel, evidence_panel, legacy_panel, instrumentation_panel],
        output_dir / "ocr-reference-dashboard.png",
    )
    return path, {"sinnoh": sinnoh_data, "ocrEvidenceAvailable": False, "legacyReferenceTablesAvailable": False}


def _session_records(session_dataset: Any) -> list[dict[str, Any]]:
    fields = [
        "capture_session",
        "frame_index",
        "source_group_key",
        "media_role",
        "identified",
        "identified_card_id",
        "identified_card_name",
        "identified_confidence",
        "outcome",
        "strategy",
        "scanner_quad.keypoints.points",
        "capture_quality_available",
        "capture_quality_issue",
        "capture_quality_pass",
        "capture_sharpness",
        "capture_mean_luma",
        "capture_clipped_highlight_fraction",
        "capture_glare_fraction",
        "capture_fill_ratio",
        "capture_angle_deviation_degrees",
    ]
    columns = session_dataset.values(fields)
    records = []
    for values in zip(*columns):
        record = dict(zip(fields, values))
        nested_points = record["scanner_quad.keypoints.points"] or []
        points = nested_points[0] if nested_points else []
        records.append(
            {
                "session": record["capture_session"],
                "frame": int(record["frame_index"]),
                "group": record["source_group_key"],
                "role": record["media_role"],
                "identified": bool(record["identified"]),
                "card_id": record["identified_card_id"] or "",
                "name": record["identified_card_name"] or "",
                "confidence": record["identified_confidence"],
                "outcome": record["outcome"] or "unknown",
                "strategy": record["strategy"] or "unknown",
                "quad": points,
                "quality_available": bool(record["capture_quality_available"]),
                "quality_issue": record["capture_quality_issue"] or "missing",
                "quality_pass": bool(record["capture_quality_pass"]),
                "sharpness": record["capture_sharpness"],
                "mean_luma": record["capture_mean_luma"],
                "clipped": record["capture_clipped_highlight_fraction"],
                "glare": record["capture_glare_fraction"],
                "fill_ratio": record["capture_fill_ratio"],
                "angle": record["capture_angle_deviation_degrees"],
            }
        )
    return records


def _session_timeline_panel(records: list[dict[str, Any]]) -> tuple[Image.Image, dict[str, Any]]:
    attempts = [
        record
        for record in records
        if record["role"] == "scanner_attempt_crop" and record["confidence"] is not None
    ]
    best_by_frame: dict[tuple[str, int], dict[str, Any]] = {}
    for record in attempts:
        key = (record["session"], record["frame"])
        current = best_by_frame.get(key)
        if current is None or float(record["confidence"]) > float(current["confidence"]):
            best_by_frame[key] = record
    session_counts = Counter(session for session, _ in best_by_frame)
    session = session_counts.most_common(1)[0][0] if session_counts else "none"
    rows = sorted(
        (record for (record_session, _), record in best_by_frame.items() if record_session == session),
        key=lambda record: record["frame"],
    )
    image, draw = _panel(
        "Real-session prediction timeline",
        f"Most scored frames: {session} · best-confidence attempt per frame; diagnostic only",
    )
    if not rows:
        return image, {"session": session, "frames": []}
    left, right, top, bottom = 95, 1135, 135, 525
    max_frame = max(record["frame"] for record in rows) or 1
    for tick in (0, 0.25, 0.5, 0.75, 1.0):
        y = bottom - tick * (bottom - top)
        draw.line((left, y, right, y), fill=CHART_GRID, width=1)
        draw.text((38, y - 7), f"{tick:.0%}", fill=CHART_MUTED, font=_font(13))
    previous_name = None
    coordinates = []
    for record in rows:
        confidence = float(record["confidence"] or 0)
        x = left + record["frame"] / max_frame * (right - left)
        y = bottom - confidence * (bottom - top)
        coordinates.append((x, y))
        color = CHART_BLUE if record["identified"] else CHART_GREY
        draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=color, outline=CHART_INK)
        if record["name"] and record["name"] != previous_name:
            label = record["name"] if len(record["name"]) <= 18 else record["name"][:17] + "…"
            label_y = top + 18 + (record["frame"] % 4) * 34
            draw.line((x, y, x, label_y + 14), fill=CHART_GREY, width=1)
            draw.text((min(x + 4, right - 145), label_y), label, fill=CHART_INK, font=_font(11))
        previous_name = record["name"] or previous_name
    if len(coordinates) >= 2:
        draw.line(coordinates, fill=CHART_BLUE, width=2)
    draw.text((500, 570), "Frame index", fill=CHART_MUTED, font=_font(15))
    return image, {"session": session, "frames": rows}


def _attempt_outcomes_panel(records: list[dict[str, Any]]) -> tuple[Image.Image, list[dict[str, Any]]]:
    attempts = [record for record in records if record["role"] == "scanner_attempt_crop"]
    counts = Counter((record["strategy"], record["outcome"]) for record in attempts)
    ranked = counts.most_common(10)
    image, draw = _panel(
        "Attempt outcomes by scanner strategy",
        f"Derived attempt crops · n={len(attempts)}; diagnostic counts without ground truth",
    )
    maximum = max((count for _, count in ranked), default=1)
    output = []
    for index, ((strategy, outcome), count) in enumerate(ranked):
        y = 125 + index * 43
        label = f"{strategy} · {outcome}"
        if len(label) > 42:
            label = label[:41] + "…"
        draw.text((38, y + 5), label, fill=CHART_INK, font=_font(13))
        width = 520 * count / maximum
        color = CHART_BLUE if outcome in {"accepted", "identified"} else CHART_GREY
        draw.rectangle((570, y, 570 + width, y + 25), fill=color)
        draw.text((582 + width, y + 4), str(count), fill=CHART_MUTED, font=_font(13, True))
        output.append({"strategy": strategy, "outcome": outcome, "count": count})
    return image, output


def _capture_quality_outcomes_panel(
    records: list[dict[str, Any]],
) -> tuple[Image.Image, list[dict[str, Any]]]:
    attempts = [
        record
        for record in records
        if record["role"] == "scanner_attempt_crop" and record["quality_available"]
    ]

    def outcome_group(outcome: str) -> str:
        if outcome in {"accepted", "identified"}:
            return "accepted"
        if outcome in {"printingAmbiguous", "titlePrintingUnresolved"}:
            return "ambiguous"
        if outcome == "belowAcceptanceThreshold":
            return "below threshold"
        if outcome in {"noCandidates", "unidentified", "noMatch"}:
            return "no candidates"
        if outcome == "rejectedInput":
            return "rejected input"
        return "other"

    counts = Counter(
        (record["quality_issue"], outcome_group(record["outcome"]))
        for record in attempts
    )
    issue_totals = Counter(record["quality_issue"] for record in attempts)
    issues = [name for name, _ in issue_totals.most_common(8)]
    image, draw = _panel(
        "Scanner outcomes by capture condition",
        f"Recorded quality evidence on attempt crops · n={len(attempts)}; diagnostic, not accuracy",
    )
    colors = {
        "accepted": CHART_OLIVE,
        "ambiguous": CHART_GOLD,
        "below threshold": CHART_ORANGE,
        "no candidates": CHART_GREY,
        "rejected input": CHART_PINK,
        "other": CHART_BLUE,
    }
    left, right = 330, 1085
    output = []
    for index, issue in enumerate(issues):
        y = 125 + index * 52
        total = issue_totals[issue]
        draw.text((38, y + 5), issue, fill=CHART_INK, font=_font(14, True))
        cursor = left
        groups = {}
        for group in (
            "accepted",
            "ambiguous",
            "below threshold",
            "no candidates",
            "rejected input",
            "other",
        ):
            count = counts[(issue, group)]
            groups[group] = count
            width = (right - left) * count / total if total else 0
            if width > 0:
                draw.rectangle((cursor, y, cursor + width, y + 27), fill=colors[group])
            cursor += width
        draw.text((1095, y + 5), f"n={total}", fill=CHART_MUTED, font=_font(12))
        output.append({"issue": issue, "n": total, "outcomes": groups})
    legend_x = 330
    for label in (
        "accepted",
        "ambiguous",
        "below threshold",
        "no candidates",
        "rejected input",
        "other",
    ):
        draw.rectangle((legend_x, 565, legend_x + 15, 580), fill=colors[label])
        draw.text((legend_x + 21, 562), label, fill=CHART_MUTED, font=_font(12))
        legend_x += 138
    if not attempts:
        draw.text(
            (38, 180),
            "No archived capture-quality evidence was loaded.",
            fill=CHART_MUTED,
            font=_font(17),
        )
    return image, output


def _quad_jitter_panel(records: list[dict[str, Any]]) -> tuple[Image.Image, dict[str, Any]]:
    groups = defaultdict(list)
    for record in records:
        if record["quad"] and len(record["quad"]) == 4:
            groups[record["group"]].append(record["quad"])
    jitter = []
    for quads in groups.values():
        if len(quads) < 2:
            continue
        means = [
            (
                sum(quad[index][0] for quad in quads) / len(quads),
                sum(quad[index][1] for quad in quads) / len(quads),
            )
            for index in range(4)
        ]
        errors = []
        for quad in quads:
            errors.extend(
                math.hypot(point[0] - means[index][0], point[1] - means[index][1])
                for index, point in enumerate(quad)
            )
        jitter.append(sum(errors) / len(errors))
    image, draw = _panel(
        "Within-frame quad jitter",
        f"Mean normalized corner deviation across repeated attempts · frame groups n={len(jitter)}; lower is steadier",
    )
    if not jitter:
        return _placeholder("Within-frame quad jitter", "Repeated four-corner quads are unavailable", ["scanner_quad on at least two attempts per frame"]), {}
    max_value = max(jitter)
    bins = 16
    counts = [0] * bins
    for value in jitter:
        index = min(bins - 1, int(value / max_value * bins)) if max_value else 0
        counts[index] += 1
    left, right, top, bottom = 100, 1130, 145, 520
    max_count = max(counts)
    for index, count in enumerate(counts):
        x0 = left + index * (right - left) / bins
        x1 = left + (index + 1) * (right - left) / bins - 3
        height = (bottom - top) * count / max_count if max_count else 0
        draw.rectangle((x0, bottom - height, x1, bottom), fill=CHART_ORANGE)
    ordered = sorted(jitter)
    median = ordered[len(ordered) // 2]
    p90 = ordered[min(len(ordered) - 1, round(0.9 * (len(ordered) - 1)))]
    draw.text((38, 565), f"Median {median:.4f} · P90 {p90:.4f} · Max {max_value:.4f}", fill=CHART_MUTED, font=_font(15))
    return image, {"n": len(jitter), "median": median, "p90": p90, "max": max_value, "bins": counts}


def _frame_agreement_panel(records: list[dict[str, Any]]) -> tuple[Image.Image, list[dict[str, Any]]]:
    groups = defaultdict(list)
    for record in records:
        if record["card_id"]:
            groups[(record["session"], record["group"])].append(record["card_id"])
    session_values = defaultdict(list)
    for (session, _), values in groups.items():
        if len(values) < 2:
            continue
        majority = Counter(values).most_common(1)[0][1]
        session_values[session].append(majority / len(values))
    ranked = sorted(
        (
            {
                "session": session,
                "agreement": sum(values) / len(values),
                "frames": len(values),
            }
            for session, values in session_values.items()
            if len(values) >= 5
        ),
        key=lambda item: (item["agreement"], item["frames"]),
        reverse=True,
    )[:10]
    image, draw = _panel(
        "Within-frame identity agreement by session",
        "Majority share among repeated identified attempts · sessions with ≥5 frames; no human truth",
    )
    for index, item in enumerate(ranked):
        y = 125 + index * 43
        label = item["session"].replace("scan-session-", "")
        draw.text((38, y + 5), label, fill=CHART_INK, font=_font(13))
        draw.rectangle((300, y, 1050, y + 25), fill="#edf2f6")
        draw.rectangle((300, y, 300 + 750 * item["agreement"], y + 25), fill=CHART_OLIVE)
        draw.text((1060, y + 4), f"{item['agreement']:.0%} · n={item['frames']}", fill=CHART_MUTED, font=_font(13))
    return image, ranked


def render_session_dashboard(session_dataset: Any, output_dir: Path) -> tuple[Path, dict[str, Any]]:
    records = _session_records(session_dataset)
    timeline_panel, timeline_data = _session_timeline_panel(records)
    outcomes_panel, outcomes_data = _attempt_outcomes_panel(records)
    quality_panel, quality_data = _capture_quality_outcomes_panel(records)
    jitter_panel, jitter_data = _quad_jitter_panel(records)
    agreement_panel, agreement_data = _frame_agreement_panel(records)
    path = _compose(
        "TCGer real-session stability dashboard",
        "Recorded scanner behaviour only; originals require human labels before performance scoring",
        [timeline_panel, outcomes_panel, quality_panel, jitter_panel, agreement_panel],
        output_dir / "session-stability-dashboard.png",
    )
    return path, {
        "timeline": timeline_data,
        "attemptOutcomes": outcomes_data,
        "captureQualityOutcomes": quality_data,
        "quadJitter": jitter_data,
        "identityAgreement": agreement_data,
    }


def write_diagnostic_dashboards(
    dataset: Any,
    output_dir: Path,
    session_dataset: Any | None = None,
    repo_root: Path | None = None,
) -> tuple[dict[str, Path], dict[str, Any]]:
    """Write every extended dashboard and its reviewed chart-ready data."""
    _RECOGNITION_ROW_CACHE.clear()
    repo_root = repo_root or Path(__file__).resolve().parents[2]
    paths: dict[str, Path] = {}
    data: dict[str, Any] = {"schemaVersion": 1}
    paths["decision_quality"], data["decisionQuality"] = render_decision_dashboard(dataset, output_dir)
    paths["geometry"], data["geometry"] = render_geometry_dashboard(dataset, output_dir)
    paths["robustness"], data["robustness"] = render_robustness_dashboard(dataset, output_dir)
    paths["ocr_reference"], data["ocrReference"] = render_ocr_dashboard(dataset, output_dir, repo_root)
    if session_dataset is not None:
        paths["session_stability"], data["sessionStability"] = render_session_dashboard(session_dataset, output_dir)
    else:
        panel = _placeholder(
            "Real-session stability",
            "Load the real-session dataset before generating this dashboard",
            ["tcger-scanner-real-sessions dataset"],
        )
        paths["session_stability"] = _compose(
            "TCGer real-session stability dashboard",
            "Session dataset unavailable",
            [panel],
            output_dir / "session-stability-dashboard.png",
        )
        data["sessionStability"] = {"available": False}
    data_path = output_dir / "diagnostic-data.json"
    data_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    paths["data"] = data_path
    return paths, data
