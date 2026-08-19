"""Recognition-run metrics and lightweight image embeddings."""

from __future__ import annotations

import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


def decision_label(sample: dict[str, Any] | None) -> str:
    if not sample:
        return "__not_run__"
    result = sample.get("result") or {}
    if result.get("matched") and result.get("cardID"):
        return str(result["cardID"])
    return "__declined__"


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
    return {
        **counts,
        "scored": scored,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "end_to_end_accuracy": end_to_end,
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
    width = 1500
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
        (910, "End-to-end"),
        (1090, "Wrong"),
        (1200, "Missed"),
        (1320, "Mean ms"),
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
