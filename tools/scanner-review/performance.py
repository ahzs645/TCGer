"""Recognition-run metrics and lightweight image embeddings."""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


CHART_BACKGROUND = "#f6f8fb"
CHART_PANEL = "#ffffff"
CHART_INK = "#17212b"
CHART_MUTED = "#617183"
CHART_GRID = "#dce4ec"
CHART_BLUE = "#2878b8"
CHART_GOLD = "#d39b25"
CHART_ORANGE = "#dc6b32"
CHART_OLIVE = "#738d3a"
CHART_PINK = "#b5537c"
CHART_GREY = "#9aa8b5"


def decision_label(sample: dict[str, Any] | None) -> str:
    if not sample:
        return "__not_run__"
    result = sample.get("result") or {}
    if result.get("matched") and result.get("cardID"):
        return str(result["cardID"])
    return "__declined__"


def normalize_card_name(value: str | None) -> str:
    return re.sub(r"[^\w]+", "", (value or "").casefold(), flags=re.UNICODE)


def run_metrics(labels: dict[str, dict[str, Any]], predictions: dict[str, dict[str, Any]], label_key) -> dict[str, Any]:
    counts = Counter()
    confusion: dict[str, Counter[str]] = defaultdict(Counter)
    elapsed: list[float] = []
    for sample_key, prediction in predictions.items():
        truth = labels.get(label_key(sample_key))
        if not truth or truth.get("category") in {"needsLabel", "unlabeled", None}:
            counts["unscored"] += 1
            continue
        expected = str(truth.get("cardId") or f"__{truth['category']}__")
        predicted = decision_label(prediction)
        confusion[expected][predicted] += 1
        result = prediction.get("result") or {}
        if result.get("elapsedMs") is not None:
            elapsed.append(float(result["elapsedMs"]))
        if truth.get("category") == "singleCard":
            counts["positives"] += 1
            if predicted == expected:
                counts["correct"] += 1
            elif predicted == "__declined__":
                counts["missed"] += 1
            else:
                counts["wrong"] += 1
            expected_name = normalize_card_name(truth.get("name"))
            if expected_name:
                counts["name_scored"] += 1
                predicted_name = normalize_card_name(result.get("name"))
                if predicted == "__declined__":
                    counts["name_missed"] += 1
                elif predicted_name == expected_name:
                    counts["name_correct"] += 1
                else:
                    counts["name_wrong"] += 1
        else:
            counts["negatives"] += 1
            if predicted == "__declined__":
                counts["declined"] += 1
            else:
                counts["false_positive"] += 1

    accepted = counts["correct"] + counts["wrong"] + counts["false_positive"]
    precision = counts["correct"] / accepted if accepted else 0.0
    recall = counts["correct"] / counts["positives"] if counts["positives"] else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    scored = counts["positives"] + counts["negatives"]
    end_to_end = (counts["correct"] + counts["declined"]) / scored if scored else 0.0
    name_recall = (
        counts["name_correct"] / counts["name_scored"] if counts["name_scored"] else 0.0
    )
    return {
        **counts,
        "scored": scored,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "end_to_end_accuracy": end_to_end,
        "name_recall": name_recall,
        "mean_elapsed_ms": sum(elapsed) / len(elapsed) if elapsed else None,
        "confusion": {key: dict(value) for key, value in sorted(confusion.items())},
    }


def disagreement_score(decisions: Iterable[str], expected: str | None) -> tuple[float, float]:
    values = [value for value in decisions if value != "__not_run__"]
    if not values:
        return 0.0, 0.0
    counts = Counter(values)
    probabilities = [count / len(values) for count in counts.values()]
    entropy = -sum(probability * math.log(probability) for probability in probabilities)
    normalized_entropy = entropy / math.log(len(counts)) if len(counts) > 1 else 0.0
    majority = counts.most_common(1)[0][0]
    label_issue = normalized_entropy
    if expected and majority not in {expected, "__declined__"}:
        label_issue = max(label_issue, counts[majority] / len(values))
    return normalized_entropy, label_issue


def compact_image_embedding(path: Path) -> np.ndarray:
    """A deterministic no-download visual embedding for duplicates/outliers."""
    with Image.open(path) as image:
        rgb = ImageOps.fit(image.convert("RGB"), (32, 32))
        pixels = np.asarray(rgb, dtype=np.float32) / 255.0
        thumbnail = np.asarray(rgb.convert("L").resize((16, 16)), dtype=np.float32).reshape(-1) / 255.0
        histograms = [np.histogram(pixels[:, :, channel], bins=16, range=(0, 1), density=True)[0] for channel in range(3)]
        vector = np.concatenate([thumbnail, *histograms]).astype(np.float32)
        norm = np.linalg.norm(vector)
        return vector / norm if norm else vector


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_metrics(path: Path, runs: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"schemaVersion": 1, "runs": list(runs)}, indent=2) + "\n")


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    try:
        return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)
    except OSError:
        return ImageFont.load_default()


def render_metrics_table(runs: Iterable[dict[str, Any]], output: Path) -> Path:
    rows = sorted(runs, key=lambda item: item["metrics"]["f1"], reverse=True)
    width = 1660
    row_height = 54
    height = 150 + row_height * len(rows)
    image = Image.new("RGB", (width, height), "#10151c")
    draw = ImageDraw.Draw(image)
    draw.text((40, 28), "TCGer scanner model performance", fill="white", font=_font(32, True))
    draw.text(
        (40, 72),
        "Recognition runs on reviewed replay samples · geometry metrics remain N/A until models export masks/corners",
        fill="#9fb0c0",
        font=_font(18),
    )
    columns = [
        (40, "Run"),
        (510, "Precision"),
        (665, "Recall"),
        (800, "F1"),
        (900, "Name recall"),
        (1065, "End-to-end"),
        (1245, "Wrong"),
        (1360, "Missed"),
        (1480, "Mean ms"),
    ]
    for x, title in columns:
        draw.text((x, 115), title, fill="#7ee2c3", font=_font(17, True))
    for index, row in enumerate(rows):
        y = 145 + index * row_height
        if index % 2:
            draw.rectangle((25, y - 5, width - 25, y + row_height - 7), fill="#161e27")
        metrics = row["metrics"]
        elapsed = metrics.get("mean_elapsed_ms")
        values = [
            row["name"],
            f"{metrics['precision']:.1%}",
            f"{metrics['recall']:.1%}",
            f"{metrics['f1']:.1%}",
            f"{metrics.get('name_recall', 0):.1%}",
            f"{metrics['end_to_end_accuracy']:.1%}",
            str(metrics.get("wrong", 0) + metrics.get("false_positive", 0)),
            str(metrics.get("missed", 0)),
            f"{elapsed:.0f}" if elapsed is not None else "—",
        ]
        for (x, _), value in zip(columns, values):
            draw.text((x, y + 8), value[:44], fill="#e5edf5", font=_font(18))
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)
    return output


def wilson_interval(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """Return a Wilson score interval for a binomial proportion."""
    if total <= 0:
        return 0.0, 0.0
    proportion = successes / total
    denominator = 1 + z * z / total
    centre = (proportion + z * z / (2 * total)) / denominator
    margin = (
        z
        * math.sqrt(
            proportion * (1 - proportion) / total + z * z / (4 * total * total)
        )
        / denominator
    )
    return max(0.0, centre - margin), min(1.0, centre + margin)


def _chart_canvas(
    title: str, subtitle: str, height: int = 620
) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (1200, height), CHART_PANEL)
    draw = ImageDraw.Draw(image)
    draw.text((38, 25), title, fill=CHART_INK, font=_font(29, True))
    draw.text((38, 67), subtitle, fill=CHART_MUTED, font=_font(16))
    return image, draw


def _save_chart(image: Image.Image, output: Path) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)
    return output


def _short_label(value: str, maximum: int = 27) -> str:
    label = value.replace("_", " ")
    return label if len(label) <= maximum else label[: maximum - 1] + "…"


def _percent_axis(
    draw: ImageDraw.ImageDraw, left: int, right: int, top: int, bottom: int
) -> None:
    for tick in (0, 0.25, 0.5, 0.75, 1.0):
        x = round(left + tick * (right - left))
        draw.line((x, top, x, bottom), fill=CHART_GRID, width=1)
        draw.text(
            (x - 14, bottom + 8),
            f"{tick:.0%}",
            fill=CHART_MUTED,
            font=_font(13),
        )


def _benchmark_counts(rows: list[dict[str, Any]]) -> tuple[int, int, int]:
    if not rows:
        return 0, 0, 0
    metrics = rows[0]["metrics"]
    return (
        int(metrics.get("positives", 0)),
        int(metrics.get("negatives", 0)),
        int(metrics.get("unscored", 0)),
    )


def render_model_metrics_chart(
    runs: Iterable[dict[str, Any]], output: Path
) -> Path:
    rows = sorted(runs, key=lambda item: item["metrics"]["f1"], reverse=True)
    positives, negatives, unscored = _benchmark_counts(rows)
    image, draw = _chart_canvas(
        "Recognition metrics by model run",
        f"Same reviewed replay cohort · {positives} positive + {negatives} negative scored images · {unscored} unscored",
    )
    left, right, top, bottom = 245, 1150, 128, 555
    _percent_axis(draw, left, right, top, bottom)
    series = [
        ("Precision", "precision", CHART_BLUE),
        ("Recall", "recall", CHART_ORANGE),
        ("F1", "f1", CHART_OLIVE),
    ]
    legend_x = 640
    for label, _, color in series:
        draw.rectangle((legend_x, 96, legend_x + 15, 111), fill=color)
        draw.text((legend_x + 21, 93), label, fill=CHART_MUTED, font=_font(14))
        legend_x += 145
    row_height = (bottom - top) / max(len(rows), 1)
    for index, row in enumerate(rows):
        centre_y = top + (index + 0.5) * row_height
        draw.text(
            (38, centre_y - 9),
            _short_label(row["name"]),
            fill=CHART_INK,
            font=_font(14, index == 0),
        )
        metrics = row["metrics"]
        for offset, (_, field, color) in zip((-8, 0, 8), series):
            value = float(metrics.get(field, 0))
            x = left + value * (right - left)
            draw.line(
                (left, centre_y + offset, x, centre_y + offset),
                fill=color,
                width=5,
            )
            draw.ellipse(
                (x - 4, centre_y + offset - 4, x + 4, centre_y + offset + 4),
                fill=color,
            )
    return _save_chart(image, output)


def render_name_printing_chart(
    runs: Iterable[dict[str, Any]], output: Path
) -> Path:
    rows = sorted(
        runs,
        key=lambda item: item["metrics"].get("name_recall", 0),
        reverse=True,
    )
    positives, _, _ = _benchmark_counts(rows)
    image, draw = _chart_canvas(
        "Pokémon name versus exact-printing recall",
        f"95% Wilson intervals · positive-card denominator n={positives}; name and printing are scored independently",
    )
    left, right, top, bottom = 245, 1085, 128, 555
    _percent_axis(draw, left, right, top, bottom)
    legend_x = 720
    for label, color in (("Pokémon name", CHART_BLUE), ("Exact printing", CHART_GOLD)):
        draw.ellipse((legend_x, 97, legend_x + 13, 110), fill=color)
        draw.text((legend_x + 20, 93), label, fill=CHART_MUTED, font=_font(14))
        legend_x += 180
    row_height = (bottom - top) / max(len(rows), 1)
    for index, row in enumerate(rows):
        y = top + (index + 0.5) * row_height
        metrics = row["metrics"]
        draw.text(
            (38, y - 9),
            _short_label(row["name"]),
            fill=CHART_INK,
            font=_font(14),
        )
        values = [
            (
                float(metrics.get("name_recall", 0)),
                int(metrics.get("name_correct", 0)),
                int(metrics.get("name_scored", 0)),
                y - 5,
                CHART_BLUE,
            ),
            (
                float(metrics.get("recall", 0)),
                int(metrics.get("correct", 0)),
                int(metrics.get("positives", 0)),
                y + 5,
                CHART_GOLD,
            ),
        ]
        for value, successes, total, point_y, color in values:
            low, high = wilson_interval(successes, total)
            x_low = left + low * (right - left)
            x_high = left + high * (right - left)
            x = left + value * (right - left)
            draw.line((x_low, point_y, x_high, point_y), fill=color, width=2)
            draw.line((x_low, point_y - 4, x_low, point_y + 4), fill=color, width=2)
            draw.line((x_high, point_y - 4, x_high, point_y + 4), fill=color, width=2)
            draw.ellipse(
                (x - 5, point_y - 5, x + 5, point_y + 5),
                fill=color,
                outline=CHART_INK,
            )
        draw.text(
            (1095, y - 9),
            f"{metrics.get('name_recall', 0):.0%}/{metrics.get('recall', 0):.0%}",
            fill=CHART_MUTED,
            font=_font(13),
        )
    return _save_chart(image, output)


def render_speed_quality_chart(
    runs: Iterable[dict[str, Any]], output: Path
) -> Path:
    rows = [
        row for row in runs if row["metrics"].get("mean_elapsed_ms") is not None
    ]
    positives, negatives, _ = _benchmark_counts(rows)
    image, draw = _chart_canvas(
        "Recognition quality versus processing time",
        f"Each point is one run on the same {positives + negatives}-image scored cohort · higher and farther left is better",
    )
    left, right, top, bottom = 105, 1130, 125, 535
    maximum = max(
        (float(row["metrics"]["mean_elapsed_ms"]) for row in rows), default=1000
    )
    maximum = max(1000.0, math.ceil(maximum / 500) * 500)
    for tick in range(0, int(maximum) + 1, 500):
        x = left + tick / maximum * (right - left)
        draw.line((x, top, x, bottom), fill=CHART_GRID, width=1)
        draw.text(
            (x - 20, bottom + 12),
            f"{tick / 1000:g}s",
            fill=CHART_MUTED,
            font=_font(13),
        )
    for tick in (0, 0.25, 0.5, 0.75, 1.0):
        y = bottom - tick * (bottom - top)
        draw.line((left, y, right, y), fill=CHART_GRID, width=1)
        draw.text((40, y - 8), f"{tick:.0%}", fill=CHART_MUTED, font=_font(13))
    draw.text((520, 575), "Mean elapsed time", fill=CHART_MUTED, font=_font(15))
    draw.text((22, 285), "F1", fill=CHART_MUTED, font=_font(15, True))
    ordered = sorted(rows, key=lambda item: item["metrics"]["f1"], reverse=True)
    placed_labels: list[tuple[float, float, float, float]] = []
    for index, row in enumerate(ordered):
        metrics = row["metrics"]
        x = left + float(metrics["mean_elapsed_ms"]) / maximum * (right - left)
        y = bottom - float(metrics["f1"]) * (bottom - top)
        color = CHART_BLUE if index == 0 else CHART_ORANGE
        radius = 8 if index == 0 else 6
        draw.ellipse(
            (x - radius, y - radius, x + radius, y + radius),
            fill=color,
            outline=CHART_INK,
        )
        label = _short_label(row["name"], 21)
        font = _font(12, index == 0)
        text_box = draw.textbbox((0, 0), label, font=font)
        text_width = text_box[2] - text_box[0]
        text_height = text_box[3] - text_box[1]
        candidates = [
            (x + 10, y - 25),
            (x + 10, y + 10),
            (x - text_width - 10, y - 25),
            (x - text_width - 10, y + 10),
            (x + 10, y - 45),
            (x - text_width - 10, y + 30),
            (x + 10, y + 30),
            (x - text_width - 10, y - 45),
        ]
        chosen = None
        for candidate_x, candidate_y in candidates:
            box = (
                candidate_x - 2,
                candidate_y - 2,
                candidate_x + text_width + 2,
                candidate_y + text_height + 2,
            )
            inside = (
                box[0] >= left
                and box[2] <= right
                and box[1] >= top
                and box[3] <= bottom
            )
            overlaps = any(
                not (
                    box[2] < other[0]
                    or box[0] > other[2]
                    or box[3] < other[1]
                    or box[1] > other[3]
                )
                for other in placed_labels
            )
            if inside and not overlaps:
                chosen = (candidate_x, candidate_y, box)
                break
        if chosen is not None:
            label_x, label_y, box = chosen
            placed_labels.append(box)
            anchor_x = label_x if label_x > x else label_x + text_width
            anchor_y = label_y + text_height / 2
            draw.line((x, y, anchor_x, anchor_y), fill=CHART_GREY, width=1)
            draw.text(
                (label_x, label_y),
                label,
                fill=CHART_INK,
                font=font,
            )
    return _save_chart(image, output)


def render_failure_composition_chart(
    runs: Iterable[dict[str, Any]], output: Path
) -> Path:
    rows = sorted(runs, key=lambda item: item["metrics"]["f1"], reverse=True)
    positives, negatives, unscored = _benchmark_counts(rows)
    image, draw = _chart_canvas(
        "Scored outcome composition by model run",
        f"Counts normalized within {positives + negatives} scored images; {unscored} additional images are excluded",
    )
    segments = [
        ("Correct print", "correct", CHART_BLUE),
        ("Correct decline", "declined", CHART_OLIVE),
        ("Wrong", "wrong", CHART_ORANGE),
        ("False positive", "false_positive", CHART_PINK),
        ("Missed", "missed", CHART_GREY),
    ]
    legend_x = 390
    for label, _, color in segments:
        draw.rectangle(
            (legend_x, 97, legend_x + 14, 111), fill=color, outline=CHART_INK
        )
        draw.text((legend_x + 20, 93), label, fill=CHART_MUTED, font=_font(13))
        legend_x += 150
    left, right, top, bottom = 245, 1150, 130, 555
    row_height = (bottom - top) / max(len(rows), 1)
    for index, row in enumerate(rows):
        y = top + (index + 0.5) * row_height
        draw.text(
            (38, y - 9),
            _short_label(row["name"]),
            fill=CHART_INK,
            font=_font(14),
        )
        metrics = row["metrics"]
        total = max(int(metrics.get("scored", 0)), 1)
        x = left
        for _, field, color in segments:
            count = int(metrics.get(field, 0))
            width = (right - left) * count / total
            draw.rectangle(
                (x, y - 10, x + width, y + 10),
                fill=color,
                outline=CHART_PANEL,
            )
            if width >= 28 and count:
                draw.text(
                    (x + width / 2 - 4, y - 8),
                    str(count),
                    fill=CHART_INK,
                    font=_font(11, True),
                )
            x += width
        draw.rectangle((left, y - 10, right, y + 10), outline=CHART_INK, width=1)
    return _save_chart(image, output)


def render_positive_stages_chart(
    runs: Iterable[dict[str, Any]], output: Path
) -> Path:
    rows = list(runs)
    best = max(rows, key=lambda item: item["metrics"]["f1"], default=None)
    image, draw = _chart_canvas(
        "Positive-card recognition stages",
        "Best-F1 run only · detector/segmentation/rectification stages await exported geometry results",
    )
    if best is None:
        draw.text(
            (38, 145), "No model runs available", fill=CHART_MUTED, font=_font(20)
        )
        return _save_chart(image, output)
    metrics = best["metrics"]
    positives = int(metrics.get("positives", 0))
    stages = [
        ("Reviewed positive cards", positives),
        (
            "Model accepted a card",
            int(metrics.get("correct", 0)) + int(metrics.get("wrong", 0)),
        ),
        ("Pokémon name correct", int(metrics.get("name_correct", 0))),
        ("Exact printing correct", int(metrics.get("correct", 0))),
    ]
    draw.text(
        (38, 101),
        f"Run: {best['name'].replace('_', ' ')}",
        fill=CHART_BLUE,
        font=_font(17, True),
    )
    left, right = 325, 1110
    maximum = max(positives, 1)
    for index, (label, count) in enumerate(stages):
        y = 165 + index * 92
        width = (right - left) * count / maximum
        draw.text((38, y + 8), label, fill=CHART_INK, font=_font(17))
        draw.rectangle((left, y, right, y + 42), fill="#edf2f6")
        color = CHART_BLUE if index < 2 else CHART_GOLD
        draw.rectangle((left, y, left + width, y + 42), fill=color)
        draw.text(
            (left + 12, y + 9),
            f"{count}/{positives}  ({count / maximum:.1%})",
            fill=CHART_INK,
            font=_font(16, True),
        )
    draw.text(
        (38, 550),
        "This is a recognition-stage view, not yet a full scanner geometry funnel.",
        fill=CHART_MUTED,
        font=_font(15),
    )
    return _save_chart(image, output)


def _render_coverage_notes(runs: list[dict[str, Any]]) -> Image.Image:
    positives, negatives, unscored = _benchmark_counts(runs)
    image, draw = _chart_canvas(
        "Evidence coverage and interpretation", "Guardrails used by this dashboard"
    )
    notes = [
        (
            "Recognition cohort",
            f"{positives} positive and {negatives} negative reviewed replay images per run",
        ),
        ("Unscored media", f"{unscored} images are excluded from accuracy metrics"),
        ("Uncertainty", "Name and exact-printing recall show 95% Wilson intervals"),
        (
            "Provenance",
            "Canonical, synthetic/augmented, and real-camera evaluations stay separate",
        ),
        (
            "Geometry",
            "Mask IoU, corner error, and rectification validity require import-geometry",
        ),
        (
            "Interpretation",
            "Reference-image OCR benchmarks are not comparable to phone-camera results",
        ),
    ]
    for index, (label, value) in enumerate(notes):
        y = 130 + index * 70
        draw.ellipse(
            (42, y + 4, 54, y + 16),
            fill=CHART_BLUE if index < 3 else CHART_GOLD,
        )
        draw.text((72, y), label, fill=CHART_INK, font=_font(17, True))
        draw.text((280, y), value, fill=CHART_MUTED, font=_font(16))
    return image


def render_performance_charts(
    runs: Iterable[dict[str, Any]], output_dir: Path
) -> dict[str, Path]:
    """Render individual charts plus a single dashboard preview."""
    rows = list(runs)
    paths = {
        "metrics": render_model_metrics_chart(
            rows, output_dir / "model-metrics.png"
        ),
        "name_printing": render_name_printing_chart(
            rows, output_dir / "name-vs-printing.png"
        ),
        "speed_quality": render_speed_quality_chart(
            rows, output_dir / "speed-vs-quality.png"
        ),
        "failures": render_failure_composition_chart(
            rows, output_dir / "failure-composition.png"
        ),
        "stages": render_positive_stages_chart(
            rows, output_dir / "positive-card-stages.png"
        ),
    }
    dashboard = Image.new("RGB", (2440, 2090), CHART_BACKGROUND)
    draw = ImageDraw.Draw(dashboard)
    draw.text(
        (40, 25),
        "TCGer scanner performance dashboard",
        fill=CHART_INK,
        font=_font(38, True),
    )
    draw.text(
        (40, 78),
        "Recognition model comparison · reviewed iOS replay cohort · generated from model-performance.json",
        fill=CHART_MUTED,
        font=_font(18),
    )
    panels = [
        Image.open(paths["metrics"]),
        Image.open(paths["name_printing"]),
        Image.open(paths["speed_quality"]),
        Image.open(paths["failures"]),
        Image.open(paths["stages"]),
        _render_coverage_notes(rows),
    ]
    positions = [
        (20, 130),
        (1220, 130),
        (20, 750),
        (1220, 750),
        (20, 1370),
        (1220, 1370),
    ]
    for panel, position in zip(panels, positions):
        dashboard.paste(panel, position)
        panel.close()
    dashboard_path = output_dir / "model-performance-dashboard.png"
    _save_chart(dashboard, dashboard_path)
    paths["dashboard"] = dashboard_path
    return paths
