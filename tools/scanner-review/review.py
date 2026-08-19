#!/usr/bin/env python3
"""Load TCGer's iOS replay corpus and historical model runs into FiftyOne OSS.

The source images and checked-in scanner labels are treated as read-only. FiftyOne
stores its database under this tool's ignored ``.fiftyone`` directory, and labels
edited in the App only leave that database when ``export-labels`` is run explicitly.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from geometry import (
    load_coco_geometry,
    normalized_points,
    perspective_distortion,
    polygon_points,
    quad_from_annotation,
    render_rectification_preview,
)
from performance import (
    compact_image_embedding,
    decision_label,
    disagreement_score,
    file_sha256,
    render_metrics_table,
    run_metrics,
    write_metrics,
)


TOOL_DIR = Path(__file__).resolve().parent
DEFAULT_STATE_DIR = TOOL_DIR / ".fiftyone"
DEFAULT_DATASET_NAME = "tcger-scanner-ios-replay"
DEFAULT_PREVIEW_DATASET_NAME = "tcger-scanner-rectification-previews"
DEFAULT_REFERENCE_ROOT = (
    Path.home()
    / "Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/TCG/Reference"
)
REPLAY_RELATIVE_PATH = Path("TCGer-Scanner-Datasets/ios-replay")
MANIFEST_FILENAME = "roboflow-ios-replay.json"
LABELS_FILENAME = "scanner-labels.json"
VALID_LABEL_CATEGORIES = {
    "singleCard",
    "cardBack",
    "multiCard",
    "foreignLanguage",
    "outsideIndex",
    "needsLabel",
    "unlabeled",
}


@dataclass(frozen=True)
class ReplayRecord:
    sample_key: str
    filepath: Path
    label_key: str
    source_dataset: str
    split: str
    width: int
    height: int
    annotations: tuple[dict[str, Any], ...]


@dataclass(frozen=True)
class ModelRun:
    field_suffix: str
    source_path: Path
    generated_at: str | None
    predictions: dict[str, dict[str, Any]]


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as error:
        raise SystemExit(f"Required file not found: {path}") from error
    except json.JSONDecodeError as error:
        raise SystemExit(f"Invalid JSON in {path}: {error}") from error


def label_key_for_path(path: str | Path) -> str:
    """Match ScannerReferenceLibrary.labelKey, including Roboflow hash removal."""
    filename = Path(path).name
    if ".rf." in filename:
        return filename.split(".rf.", 1)[0]
    return Path(filename).stem


def load_replay_records(replay_dir: Path) -> list[ReplayRecord]:
    document = read_json(replay_dir / MANIFEST_FILENAME)
    raw_records = document.get("records")
    if not isinstance(raw_records, list):
        raise SystemExit(f"{MANIFEST_FILENAME} has no records[]")

    coco_geometry = load_coco_geometry(replay_dir)
    records: list[ReplayRecord] = []
    missing: list[Path] = []
    seen_keys: set[str] = set()
    for raw in raw_records:
        sample_key = raw["imagePath"]
        if sample_key in seen_keys:
            raise SystemExit(f"Duplicate imagePath in replay manifest: {sample_key}")
        seen_keys.add(sample_key)
        filepath = replay_dir / sample_key
        if not filepath.is_file():
            missing.append(filepath)
        source_annotations = coco_geometry.get(sample_key)
        records.append(
            ReplayRecord(
                sample_key=sample_key,
                filepath=filepath,
                label_key=label_key_for_path(sample_key),
                source_dataset=raw["dataset"],
                split=raw["split"],
                width=int(raw["width"]),
                height=int(raw["height"]),
                annotations=source_annotations
                if source_annotations is not None
                else tuple(raw.get("annotations") or ()),
            )
        )

    if missing:
        examples = "\n".join(f"  - {path}" for path in missing[:5])
        raise SystemExit(f"Replay manifest references {len(missing)} missing images:\n{examples}")
    return records


def load_scanner_labels(replay_dir: Path) -> dict[str, dict[str, Any]]:
    document = read_json(replay_dir / LABELS_FILENAME)
    if document.get("schemaVersion") != 1 or not isinstance(document.get("labels"), dict):
        raise SystemExit(f"Unsupported {LABELS_FILENAME} schema")

    labels: dict[str, dict[str, Any]] = document["labels"]
    invalid = sorted(
        (key, value.get("category"))
        for key, value in labels.items()
        if value.get("category") not in VALID_LABEL_CATEGORIES - {"unlabeled"}
    )
    if invalid:
        raise SystemExit(f"Invalid scanner label categories: {invalid[:5]}")
    return labels


def report_suffix(path: Path) -> str:
    stem = path.stem
    if stem == "tcger-roboflow-ios-report":
        value = "baseline"
    elif stem.startswith("tcger-roboflow-ios-report-"):
        value = stem.removeprefix("tcger-roboflow-ios-report-")
    elif stem.startswith("tcger-roboflow-ios-recognition-"):
        value = f"{stem.removeprefix('tcger-roboflow-ios-recognition-')}-recognition"
    elif stem.startswith("tcger-recognition-gate-"):
        value = f"gate-{stem.removeprefix('tcger-recognition-gate-')}"
    else:
        value = stem
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()
    if not value:
        raise SystemExit(f"Could not derive a model-run name from {path.name}")
    return value


def discover_model_runs(replay_dir: Path) -> list[ModelRun]:
    runs: list[ModelRun] = []
    used_suffixes: dict[str, Path] = {}
    for path in sorted(replay_dir.glob("*.json")):
        if path.name in {MANIFEST_FILENAME, LABELS_FILENAME}:
            continue
        document = read_json(path)
        samples = document.get("recognitionSamples") if isinstance(document, dict) else None
        if not isinstance(samples, list):
            continue

        suffix = report_suffix(path)
        if suffix in used_suffixes:
            # Both a full replay report and a recognition-only report may have
            # the same human suffix. Keep both fields explicit rather than
            # silently replacing one run.
            suffix = f"{suffix}_{re.sub(r'[^a-z0-9]+', '_', path.stem.lower()).strip('_')}"
        used_suffixes[suffix] = path

        predictions: dict[str, dict[str, Any]] = {}
        for sample in samples:
            sample_key = sample.get("imagePath")
            if not sample_key:
                continue
            if sample_key in predictions:
                raise SystemExit(f"Duplicate recognition sample in {path}: {sample_key}")
            predictions[sample_key] = sample
        runs.append(
            ModelRun(
                field_suffix=suffix,
                source_path=path,
                generated_at=document.get("generatedAt"),
                predictions=predictions,
            )
        )
    return runs


def normalized_bbox(annotation: dict[str, Any], width: int, height: int) -> list[float] | None:
    bbox = annotation.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4 or width <= 0 or height <= 0:
        return None
    left, top, box_width, box_height = (float(value) for value in bbox)
    left = max(0.0, min(left, float(width)))
    top = max(0.0, min(top, float(height)))
    box_width = max(0.0, min(box_width, float(width) - left))
    box_height = max(0.0, min(box_height, float(height) - top))
    if box_width == 0 or box_height == 0:
        return None
    return [left / width, top / height, box_width / width, box_height / height]


def prediction_verdict(label: dict[str, Any] | None, sample: dict[str, Any]) -> str:
    if not label or label.get("category") in {None, "needsLabel", "unlabeled"}:
        return "unscored"
    result = sample.get("result") or {}
    predicted_id = result.get("cardID") if result.get("matched") else None
    category = label.get("category")
    if category == "singleCard":
        if not predicted_id:
            return "missed"
        return "correct" if predicted_id == label.get("cardId") else "wrong"
    return "declined" if not predicted_id else "false_positive"


def configure_fiftyone_state(state_dir: Path) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("FIFTYONE_DATABASE_DIR", str(state_dir / "db"))
    os.environ.setdefault("FIFTYONE_DEFAULT_DATASET_DIR", str(state_dir / "datasets"))
    os.environ.setdefault("FIFTYONE_DEFAULT_APP_ADDRESS", "localhost")


def import_fiftyone():
    try:
        import fiftyone as fo
    except ImportError as error:
        raise SystemExit(
            "FiftyOne is not installed in this Python environment. Run:\n"
            "  uv sync --project tools/scanner-review --python 3.13"
        ) from error
    return fo


def make_detection(fo: Any, annotation: dict[str, Any], record: ReplayRecord) -> Any | None:
    bbox = normalized_bbox(annotation, record.width, record.height)
    if bbox is None:
        return None
    return fo.Detection(
        label="card",
        bounding_box=bbox,
        source_category=str(annotation.get("category") or "card"),
        source_area=float(annotation.get("area") or 0),
    )


def make_polyline(fo: Any, annotation: dict[str, Any], record: ReplayRecord) -> Any | None:
    points = polygon_points(annotation, allow_bbox=False)
    if not points:
        return None
    return fo.Polyline(
        label="card",
        points=[normalized_points(points, record.width, record.height)],
        closed=True,
        filled=True,
        source_category=str(annotation.get("category") or "card"),
        source_area=float(annotation.get("area") or 0),
    )


def make_keypoint(fo: Any, annotation: dict[str, Any], record: ReplayRecord) -> Any | None:
    quad, geometry_source = quad_from_annotation(annotation)
    if quad is None:
        return None
    return fo.Keypoint(
        label="card_corners",
        points=normalized_points(quad.tolist(), record.width, record.height),
        geometry_source=geometry_source,
    )


def record_geometry(fo: Any, record: ReplayRecord) -> tuple[Any, Any, str, float | None]:
    polylines = [
        polyline
        for annotation in record.annotations
        if (polyline := make_polyline(fo, annotation, record)) is not None
    ]
    keypoints = [
        keypoint
        for annotation in record.annotations
        if (keypoint := make_keypoint(fo, annotation, record)) is not None
    ]
    sources = [keypoint.geometry_source for keypoint in keypoints]
    source = (
        "source_polygon"
        if "source_polygon" in sources
        else "bbox_fallback"
        if sources
        else "unavailable"
    )


def save_review_views(dataset: Any, runs: Iterable[ModelRun]) -> None:
    fo = import_fiftyone()
    field = fo.ViewField
    views = {
        "01 · Needs manual labels": dataset.match(
            field("label_category").is_in(["needsLabel", "unlabeled"])
        ),
        "02 · Likely label issues": dataset.match(field("needs_model_review") == True).sort_by(  # noqa: E712
            "label_issue_score", reverse=True
        ),
        "03 · Filled segmentation truth": dataset.match(
            field("geometry_source") == "source_polygon"
        ),
        "04 · Perspective stress cases": dataset.match(
            field("perspective_distortion") > 0.15
        ).sort_by("perspective_distortion", reverse=True),
    }
    for run in runs:
        verdict_field = f"verdict_{run.field_suffix}"
        views[f"Failures · {run.field_suffix}"] = dataset.match(
            field(verdict_field).is_in(["wrong", "missed", "false_positive"])
        )
    for name, view in views.items():
        dataset.save_view(name, view, overwrite=True)
    largest = max(record.annotations, key=lambda item: float(item.get("area") or 0), default=None)
    quad = quad_from_annotation(largest)[0] if largest else None
    return (
        fo.Polylines(polylines=polylines),
        fo.Keypoints(keypoints=keypoints),
        source,
        perspective_distortion(quad),
    )


def build_dataset(
    replay_dir: Path,
    dataset_name: str,
    rebuild: bool,
) -> tuple[Any, list[ModelRun], int]:
    fo = import_fiftyone()
    records = load_replay_records(replay_dir)
    labels = load_scanner_labels(replay_dir)
    runs = discover_model_runs(replay_dir)

    if fo.dataset_exists(dataset_name) and rebuild:
        fo.delete_dataset(dataset_name)

    if fo.dataset_exists(dataset_name):
        dataset = fo.load_dataset(dataset_name)
        existing_keys = set(dataset.values("sample_key"))
        manifest_keys = {record.sample_key for record in records}
        if existing_keys != manifest_keys:
            raise SystemExit(
                f"Dataset {dataset_name!r} does not match the current replay manifest. "
                "Run again with --rebuild."
            )
    else:
        dataset = fo.Dataset(dataset_name)
        samples = []
        for record in records:
            label = labels.get(record.label_key) or {}
            detections = [
                detection
                for annotation in record.annotations
                if (detection := make_detection(fo, annotation, record)) is not None
            ]
            polygons, corners, geometry_source, distortion = record_geometry(fo, record)
            category = label.get("category", "unlabeled")
            identity = None
            if category not in {"needsLabel", "unlabeled"}:
                identity = str(label.get("cardId") or f"__{category}__")
            sample = fo.Sample(
                filepath=str(record.filepath.resolve()),
                sample_key=record.sample_key,
                label_key=record.label_key,
                source_dataset=record.source_dataset,
                source_split=record.split,
                label_category=category,
                label_card_id=label.get("cardId") or "",
                label_card_name=label.get("name") or "",
                label_notes=label.get("notes") or "",
                review_status="unreviewed",
                review_geometry_notes="",
                ground_truth_identity=fo.Classification(label=identity) if identity else None,
                ground_truth_boxes=fo.Detections(detections=detections),
                ground_truth_polygons=polygons,
                reference_corners=corners,
                geometry_source=geometry_source,
                card_count=len(record.annotations),
                perspective_distortion=distortion,
            )
            sample.tags.extend(
                [
                    f"dataset:{record.source_dataset}",
                    f"split:{record.split}",
                    f"label:{label.get('category', 'unlabeled')}",
                ]
            )
            samples.append(sample)
        dataset.add_samples(samples, progress=True)
        dataset.persistent = True

    # Geometry can be enriched after the first import because the original replay
    # manifest omitted its source COCO segmentation arrays.
    polygon_values = []
    corner_values = []
    geometry_sources = []
    card_counts = []
    distortions = []
    truth_values = []
    record_by_key = {record.sample_key: record for record in records}
    for sample_key in dataset.values("sample_key"):
        record = record_by_key[sample_key]
        polygons, corners, geometry_source, distortion = record_geometry(fo, record)
        polygon_values.append(polygons)
        corner_values.append(corners)
        geometry_sources.append(geometry_source)
        card_counts.append(len(record.annotations))
        distortions.append(distortion)
        label = labels.get(record.label_key) or {}
        category = label.get("category", "unlabeled")
        identity = None if category in {"needsLabel", "unlabeled"} else str(
            label.get("cardId") or f"__{category}__"
        )
        truth_values.append(fo.Classification(label=identity) if identity else None)
    dataset.set_values("ground_truth_polygons", polygon_values)
    dataset.set_values("reference_corners", corner_values)
    dataset.set_values("geometry_source", geometry_sources)
    dataset.set_values("card_count", card_counts)
    dataset.set_values("perspective_distortion", distortions)
    dataset.set_values("ground_truth_identity", truth_values)

    existing_schema = dataset.get_field_schema()
    if "review_status" not in existing_schema:
        dataset.set_values("review_status", ["unreviewed"] * len(dataset))
    if "review_geometry_notes" not in existing_schema:
        dataset.set_values("review_geometry_notes", [""] * len(dataset))

    sample_keys = dataset.values("sample_key")
    existing_schema = dataset.get_field_schema()
    previous_run_info = {
        item.get("field"): item
        for item in (dataset.info or {}).get("tcger_model_runs", [])
        if isinstance(item, dict)
    }
    updated_runs: set[str] = set()
    metrics_by_suffix = {
        run.field_suffix: run_metrics(labels, run.predictions, label_key_for_path) for run in runs
    }
    for run in runs:
        prediction_field = f"pred_{run.field_suffix}"
        decision_field = f"decision_{run.field_suffix}"
        outcome_field = f"outcome_{run.field_suffix}"
        verdict_field = f"verdict_{run.field_suffix}"
        elapsed_field = f"elapsed_ms_{run.field_suffix}"
        source_stat = run.source_path.stat()
        previous = previous_run_info.get(prediction_field) or {}
        fingerprint_matches = (
            previous.get("size") == source_stat.st_size
            and previous.get("mtimeNs") == source_stat.st_mtime_ns
        ) or (
            "size" not in previous
            and previous.get("source") == str(run.source_path.resolve())
            and previous.get("generatedAt") == run.generated_at
        )
        if (
            fingerprint_matches
            and {prediction_field, decision_field, outcome_field, verdict_field, elapsed_field}
            <= set(existing_schema)
        ):
            continue
        predictions: list[Any | None] = []
        decisions: list[Any | None] = []
        outcomes: list[str] = []
        verdicts: list[str] = []
        elapsed_values: list[float | None] = []
        for sample_key in sample_keys:
            sample = run.predictions.get(sample_key)
            label = labels.get(label_key_for_path(sample_key))
            if sample is None:
                predictions.append(None)
                decisions.append(None)
                outcomes.append("not_run")
                verdicts.append("not_run")
                elapsed_values.append(None)
                continue
            result = sample.get("result") or {}
            matched = bool(result.get("matched") and result.get("cardID"))
            diagnostic = result.get("diagnostic") or {}
            candidates = diagnostic.get("candidates") or []
            if matched:
                predictions.append(
                    fo.Classification(
                        label=str(result["cardID"]),
                        confidence=float(result.get("confidence") or 0),
                        card_name=str(result.get("name") or ""),
                        strategy=str(result.get("strategy") or ""),
                        candidates_json=json.dumps(candidates[:10], ensure_ascii=False),
                    )
                )
                outcomes.append("matched")
            else:
                predictions.append(None)
                outcomes.append(str(result.get("failure") or "declined"))
            decisions.append(
                fo.Classification(
                    label=decision_label(sample),
                    confidence=float(result.get("confidence") or 0),
                )
            )
            verdicts.append(prediction_verdict(label, sample))
            elapsed_values.append(
                float(result["elapsedMs"]) if result.get("elapsedMs") is not None else None
            )
        dataset.set_values(prediction_field, predictions)
        dataset.set_values(decision_field, decisions)
        dataset.set_values(outcome_field, outcomes)
        dataset.set_values(verdict_field, verdicts)
        dataset.set_values(elapsed_field, elapsed_values)
        updated_runs.add(run.field_suffix)

    # Model disagreement is a useful no-download proxy for hard examples and
    # likely reference-label problems.
    disagreement_values = []
    issue_values = []
    for sample_key in sample_keys:
        label = labels.get(label_key_for_path(sample_key)) or {}
        expected = label.get("cardId") if label.get("category") == "singleCard" else None
        decisions = [decision_label(run.predictions.get(sample_key)) for run in runs]
        disagreement, issue = disagreement_score(decisions, expected)
        disagreement_values.append(disagreement)
        issue_values.append(issue)
    dataset.set_values("model_disagreement", disagreement_values)
    dataset.set_values("label_issue_score", issue_values)
    dataset.set_values("needs_model_review", [value >= 0.5 for value in issue_values])

    # Register each historical run with FiftyOne's evaluation system so the
    # Model Evaluation panel can open confusion matrices and individual errors.
    for run in runs:
        decision_field = f"decision_{run.field_suffix}"
        eval_key = f"identity_{run.field_suffix}"
        if run.field_suffix in updated_runs or eval_key not in dataset.list_evaluations():
            if eval_key in dataset.list_evaluations():
                dataset.delete_evaluation(eval_key)
            evaluation_view = dataset.exists(decision_field).exists("ground_truth_identity")
            if len(evaluation_view):
                evaluation_view.evaluate_classifications(
                    decision_field,
                    gt_field="ground_truth_identity",
                    eval_key=eval_key,
                    method="simple",
                )

    save_review_views(dataset, runs)

    dataset.info = {
        **(dataset.info or {}),
        "tcger_replay_dir": str(replay_dir.resolve()),
        "tcger_manifest": MANIFEST_FILENAME,
        "tcger_labels": LABELS_FILENAME,
        "tcger_model_runs": [
            {
                "field": f"pred_{run.field_suffix}",
                "source": str(run.source_path.resolve()),
                "generatedAt": run.generated_at,
                "samples": len(run.predictions),
                "size": run.source_path.stat().st_size,
                "mtimeNs": run.source_path.stat().st_mtime_ns,
                "decisionField": f"decision_{run.field_suffix}",
                "evaluationKey": f"identity_{run.field_suffix}",
                "metrics": metrics_by_suffix[run.field_suffix],
            }
            for run in runs
        ],
    }
    dataset.save()
    return dataset, runs, len(labels)


def performance_rows(dataset: Any) -> list[dict[str, Any]]:
    return [
        {
            "name": item["field"].removeprefix("pred_"),
            "source": item["source"],
            "samples": item["samples"],
            "metrics": item["metrics"],
        }
        for item in dataset.info.get("tcger_model_runs", [])
    ]


def write_performance_report(dataset: Any, output_dir: Path) -> Path:
    rows = performance_rows(dataset)
    output_dir.mkdir(parents=True, exist_ok=True)
    write_metrics(output_dir / "model-performance.json", rows)
    with (output_dir / "model-performance.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(
            [
                "run",
                "samples",
                "scored",
                "precision",
                "recall",
                "f1",
                "end_to_end_accuracy",
                "correct",
                "wrong",
                "missed",
                "false_positive",
                "mean_elapsed_ms",
            ]
        )
        for row in sorted(rows, key=lambda item: item["metrics"]["f1"], reverse=True):
            metrics = row["metrics"]
            writer.writerow(
                [
                    row["name"],
                    row["samples"],
                    metrics.get("scored", 0),
                    metrics["precision"],
                    metrics["recall"],
                    metrics["f1"],
                    metrics["end_to_end_accuracy"],
                    metrics.get("correct", 0),
                    metrics.get("wrong", 0),
                    metrics.get("missed", 0),
                    metrics.get("false_positive", 0),
                    metrics.get("mean_elapsed_ms"),
                ]
            )
    return render_metrics_table(rows, output_dir / "model-performance.png")


def build_preview_dataset(
    dataset: Any,
    replay_dir: Path,
    runs: list[ModelRun],
    preview_dataset_name: str,
    output_dir: Path,
) -> tuple[Any, Path]:
    fo = import_fiftyone()
    records = {record.sample_key: record for record in load_replay_records(replay_dir)}
    labels = load_scanner_labels(replay_dir)
    ranked_runs = sorted(
        runs,
        key=lambda run: dataset.info["tcger_model_runs"][
            next(
                index
                for index, item in enumerate(dataset.info["tcger_model_runs"])
                if item["field"] == f"pred_{run.field_suffix}"
            )
        ]["metrics"]["f1"],
        reverse=True,
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    if fo.dataset_exists(preview_dataset_name):
        fo.delete_dataset(preview_dataset_name)
    previews = fo.Dataset(preview_dataset_name)
    preview_samples = []
    main_by_key = {sample.sample_key: sample for sample in dataset}
    for sample_key, record in records.items():
        label = labels.get(record.label_key)
        if not label:
            continue
        main_sample = main_by_key[sample_key]
        basename = re.sub(r"[^a-zA-Z0-9_-]+", "_", record.label_key)[:80]
        preview_path = output_dir / "samples" / f"{basename}-{main_sample.id}.jpg"
        run_lines = [
            f"{run.field_suffix}: {main_sample.get_field(f'verdict_{run.field_suffix}')}"
            for run in ranked_runs
        ]
        preview_path, rectified_path, geometry_source, distortion = render_rectification_preview(
            record.filepath,
            record.annotations,
            preview_path,
            title=label.get("name") or record.label_key,
            run_lines=run_lines,
        )
        preview = fo.Sample(
            filepath=str(preview_path),
            sample_key=sample_key,
            label_key=record.label_key,
            original_filepath=str(record.filepath),
            rectified_filepath=str(rectified_path) if rectified_path else "",
            geometry_source=geometry_source,
            perspective_distortion=distortion,
            label_category=label.get("category", "unlabeled"),
            label_card_id=label.get("cardId") or "",
            label_card_name=label.get("name") or "",
            review_status=main_sample.get_field("review_status") or "unreviewed",
            model_disagreement=main_sample.get_field("model_disagreement") or 0.0,
            label_issue_score=main_sample.get_field("label_issue_score") or 0.0,
        )
        for run in runs:
            preview[f"verdict_{run.field_suffix}"] = main_sample.get_field(
                f"verdict_{run.field_suffix}"
            )
            decision = main_sample.get_field(f"decision_{run.field_suffix}")
            preview[f"decision_{run.field_suffix}"] = decision
        preview_samples.append(preview)
    previews.add_samples(preview_samples, progress=True)
    previews.persistent = True
    previews.info = {
        "tcger_source_dataset": dataset.name,
        "geometry_warning": (
            "Rectifications are generated from source COCO polygons or bbox fallbacks. "
            "They are reference previews, not detector predictions."
        ),
        "tcger_model_runs": dataset.info.get("tcger_model_runs", []),
    }
    previews.save()
    summary_path = write_performance_report(dataset, output_dir)
    return previews, summary_path


def compute_brain_analysis(dataset: Any) -> None:
    """Computes no-download similarity, uniqueness, and exact duplicate groups."""
    import fiftyone.brain as fob

    paths = [Path(path) for path in dataset.values("filepath")]
    embeddings = np.stack([compact_image_embedding(path) for path in paths])
    brain_key = "tcger_visual_similarity"
    if brain_key in dataset.list_brain_runs():
        dataset.delete_brain_run(brain_key)
    similarity = fob.compute_similarity(dataset, embeddings=embeddings, brain_key=brain_key)
    fob.compute_uniqueness(
        dataset,
        embeddings=embeddings,
        similarity_index=similarity,
        uniqueness_field="tcger_uniqueness",
    )

    hashes = [file_sha256(path) for path in paths]
    groups: dict[str, list[int]] = {}
    for index, digest in enumerate(hashes):
        groups.setdefault(digest, []).append(index)
    duplicate_ids = {
        index: f"duplicate-{group_index:04d}"
        for group_index, indexes in enumerate(
            (indexes for indexes in groups.values() if len(indexes) > 1), start=1
        )
        for index in indexes
    }
    dataset.set_values(
        "exact_duplicate_group",
        [duplicate_ids.get(index, "") for index in range(len(paths))],
    )
    dataset.set_values(
        "is_exact_duplicate", [index in duplicate_ids for index in range(len(paths))]
    )
    dataset.info = {
        **(dataset.info or {}),
        "tcger_embedding": {
            "method": "32x32 RGB histogram + 16x16 luminance thumbnail",
            "dimensions": int(embeddings.shape[1]),
            "downloads": False,
            "purpose": "near-duplicate and outlier review, not semantic card recognition",
        },
    }
    dataset.save()


def export_labels(dataset_name: str, output: Path, overwrite: bool) -> None:
    fo = import_fiftyone()
    if not fo.dataset_exists(dataset_name):
        raise SystemExit(f"FiftyOne dataset does not exist: {dataset_name}")
    if output.exists() and not overwrite:
        raise SystemExit(f"Refusing to overwrite {output}; pass --overwrite if intentional")

    dataset = fo.load_dataset(dataset_name)
    exported: dict[str, dict[str, str]] = {}
    for sample in dataset:
        category = (sample.get_field("label_category") or "unlabeled").strip()
        if category in {"", "unlabeled"}:
            continue
        if category not in VALID_LABEL_CATEGORIES:
            raise SystemExit(f"Invalid category on {sample.sample_key}: {category}")
        label: dict[str, str] = {"category": category}
        card_id = (sample.get_field("label_card_id") or "").strip()
        card_name = (sample.get_field("label_card_name") or "").strip()
        notes = (sample.get_field("label_notes") or "").strip()
        if category == "singleCard" and not card_id:
            raise SystemExit(f"singleCard label has no card ID: {sample.sample_key}")
        if card_id:
            label["cardId"] = card_id
        if card_name:
            label["name"] = card_name
        if notes:
            label["notes"] = notes
        if sample.label_key in exported:
            if exported[sample.label_key] != label:
                raise SystemExit(
                    "Conflicting edits for replay images that share label key "
                    f"{sample.label_key!r}; make the duplicate samples agree before export"
                )
            continue
        exported[sample.label_key] = label

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps({"schemaVersion": 1, "labels": exported}, indent=2, ensure_ascii=False)
        + "\n"
    )
    print(f"Exported {len(exported)} labels to {output}")


def print_summary(dataset: Any, runs: Iterable[ModelRun], label_count: int) -> None:
    print(f"Dataset: {dataset.name}")
    print(f"Samples: {len(dataset)}")
    print(f"Labels loaded: {label_count}")
    print(f"Model runs loaded: {len(list(runs))}")
    print("Prediction fields:")
    for item in dataset.info.get("tcger_model_runs", []):
        print(f"  - {item['field']}: {item['samples']} samples ({Path(item['source']).name})")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument(
        "--state-dir",
        type=Path,
        default=DEFAULT_STATE_DIR,
        help="Local FiftyOne database/runtime directory (never place this in Google Drive)",
    )
    subparsers = result.add_subparsers(dest="command", required=True)

    load = subparsers.add_parser("load", help="Load/update the replay corpus and open the App")
    load.add_argument("--reference-root", type=Path, default=DEFAULT_REFERENCE_ROOT)
    load.add_argument("--replay-dir", type=Path)
    load.add_argument("--dataset-name", default=DEFAULT_DATASET_NAME)
    load.add_argument("--rebuild", action="store_true")
    load.add_argument("--no-launch", action="store_true")
    load.add_argument("--port", type=int, default=5151)

    export = subparsers.add_parser(
        "export-labels", help="Export App-edited labels without touching source files"
    )
    export.add_argument("--dataset-name", default=DEFAULT_DATASET_NAME)
    export.add_argument("--output", type=Path, required=True)
    export.add_argument("--overwrite", action="store_true")
    return result


def main() -> None:
    args = parser().parse_args()
    configure_fiftyone_state(args.state_dir.expanduser().resolve())
    if args.command == "export-labels":
        export_labels(args.dataset_name, args.output.expanduser().resolve(), args.overwrite)
        return

    replay_dir = args.replay_dir or (args.reference_root / REPLAY_RELATIVE_PATH)
    dataset, runs, label_count = build_dataset(
        replay_dir.expanduser().resolve(), args.dataset_name, args.rebuild
    )
    print_summary(dataset, runs, label_count)
    if not args.no_launch:
        fo = import_fiftyone()
        session = fo.launch_app(dataset, port=args.port, address="localhost", auto=True)
        print(f"FiftyOne is available at http://localhost:{args.port}")
        session.wait()


if __name__ == "__main__":
    main()
