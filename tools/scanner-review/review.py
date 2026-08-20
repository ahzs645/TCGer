#!/usr/bin/env python3
"""Load TCGer's iOS replay corpus and historical model runs into FiftyOne OSS.

The source images and checked-in scanner labels are treated as read-only. FiftyOne
stores its database under this tool's ignored ``.fiftyone`` directory, and labels
edited in the App only leave that database when ``export-labels`` is run explicitly.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import cv2
from PIL import Image

from diagnostics import write_diagnostic_dashboards
from geometry import (
    CARD_HEIGHT,
    CARD_WIDTH,
    boundary_iou,
    corner_error,
    load_coco_geometry,
    normalized_points,
    perspective_distortion,
    polygon_points,
    polygon_iou,
    quad_from_annotation,
    render_rectification_preview,
)
from performance import (
    compact_image_embedding,
    decision_label,
    disagreement_score,
    file_sha256,
    normalize_card_name,
    render_metrics_table,
    render_performance_charts,
    run_metrics,
    write_metrics,
)


TOOL_DIR = Path(__file__).resolve().parent
DEFAULT_STATE_DIR = TOOL_DIR / ".fiftyone"
DEFAULT_DATASET_NAME = "tcger-scanner-ios-replay"
DEFAULT_PREVIEW_DATASET_NAME = "tcger-scanner-rectification-previews"
DEFAULT_SESSION_DATASET_NAME = "tcger-scanner-real-sessions"
DEFAULT_SHUTTER_DATASET_NAME = "tcger-scanner-shutter-benchmark"
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
    "nonPokemon",
    "noCard",
    "needsLabel",
    "unlabeled",
}

AUGMENTATION_POLICIES = {
    "tcgx-annotations-v7": "three-version export: right-angle rotation plus salt-and-pepper noise",
    "pokemon-card-detector-v1": "three-version export: flips, rotation, crop, shear, brightness, exposure, blur, noise",
    "pk-detect-v3": "three-version export: right-angle rotation, brightness, and blur",
    "pokefolio-v1": "no Roboflow augmentation",
    "labelyolo-v4": "no Roboflow augmentation",
}
AUGMENTED_DATASETS = {
    "tcgx-annotations-v7",
    "pokemon-card-detector-v1",
    "pk-detect-v3",
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


def name_prediction_verdict(label: dict[str, Any] | None, sample: dict[str, Any]) -> str:
    if not label or label.get("category") in {None, "needsLabel", "unlabeled"}:
        return "unscored"
    result = sample.get("result") or {}
    matched = bool(result.get("matched") and result.get("cardID"))
    if label.get("category") != "singleCard":
        return "declined" if not matched else "false_positive"
    if not matched:
        return "missed"
    expected = normalize_card_name(label.get("name"))
    predicted = normalize_card_name(result.get("name"))
    if not expected:
        return "unscored"
    return "correct" if predicted == expected else "wrong"


def configure_fiftyone_state(state_dir: Path) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("FIFTYONE_DATABASE_DIR", str(state_dir / "db"))
    os.environ.setdefault("FIFTYONE_DEFAULT_DATASET_DIR", str(state_dir / "datasets"))
    os.environ.setdefault("FIFTYONE_DEFAULT_APP_ADDRESS", "localhost")
    # Keep datasets isolated while sharing the user's installed FiftyOne plugins.
    # Without this override, FiftyOne derives a second empty plugin directory
    # beneath DEFAULT_DATASET_DIR and the App cannot see the TCGer operators.
    os.environ.setdefault(
        "FIFTYONE_PLUGINS_DIR", str(Path.home() / "fiftyone" / "__plugins__")
    )


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
    largest = max(record.annotations, key=lambda item: float(item.get("area") or 0), default=None)
    quad = quad_from_annotation(largest)[0] if largest else None
    return (
        fo.Polylines(polylines=polylines),
        fo.Keypoints(keypoints=keypoints),
        source,
        perspective_distortion(quad),
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
        "05 · Roboflow augmented datasets": dataset.match(
            field("provenance_kind") == "roboflow_augmented_dataset"
        ),
        "06 · Roboflow unaugmented datasets": dataset.match(
            field("provenance_kind") == "roboflow_unaugmented_dataset"
        ),
        "07 · Geometry holdout": dataset.match(
            field("geometry_evaluation_eligible") == True  # noqa: E712
        ),
        "08 · Source-group split leakage": dataset.match(
            field("source_group_split_leakage") == True  # noqa: E712
        ).sort_by("source_group_key"),
    }
    for run in runs:
        verdict_field = f"verdict_{run.field_suffix}"
        views[f"Failures · {run.field_suffix}"] = dataset.match(
            field(verdict_field).is_in(["wrong", "missed", "false_positive"])
        )
        views[f"Name failures · {run.field_suffix}"] = dataset.match(
            field(f"name_verdict_{run.field_suffix}").is_in(
                ["wrong", "missed", "false_positive"]
            )
        )
        views[f"Name right, printing wrong · {run.field_suffix}"] = dataset.match(
            (field(verdict_field) == "wrong")
            & (field(f"name_verdict_{run.field_suffix}") == "correct")
        )
    for name, view in views.items():
        dataset.save_view(name, view, overwrite=True)


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
    working_columns = dataset.values(
        ["sample_key", "label_category", "label_card_id", "label_card_name"]
    )
    working_rows = list(zip(*working_columns))
    working_labels = {
        sample_key: {
            "category": category or "unlabeled",
            "cardId": card_id or "",
            "name": card_name or "",
        }
        for sample_key, category, card_id, card_name in working_rows
    }
    for sample_key, category, card_id, _ in working_rows:
        record = record_by_key[sample_key]
        polygons, corners, geometry_source, distortion = record_geometry(fo, record)
        polygon_values.append(polygons)
        corner_values.append(corners)
        geometry_sources.append(geometry_source)
        card_counts.append(len(record.annotations))
        distortions.append(distortion)
        identity = None if category in {"needsLabel", "unlabeled"} else str(
            card_id or f"__{category}__"
        )
        truth_values.append(fo.Classification(label=identity) if identity else None)
    dataset.set_values("ground_truth_polygons", polygon_values)
    dataset.set_values("reference_corners", corner_values)
    dataset.set_values("geometry_source", geometry_sources)
    dataset.set_values("card_count", card_counts)
    dataset.set_values("perspective_distortion", distortions)
    dataset.set_values("ground_truth_identity", truth_values)

    group_splits: dict[str, set[str]] = {}
    for record in records:
        group_key = f"{record.source_dataset}:{record.label_key}"
        group_splits.setdefault(group_key, set()).add(record.split)
    source_group_keys = []
    provenance_kinds = []
    augmentation_policies = []
    augmentation_statuses = []
    evaluation_roles = []
    geometry_eligible = []
    recognition_eligible = []
    split_leakage = []
    for index, (sample_key, category, _, _) in enumerate(working_rows):
        record = record_by_key[sample_key]
        group_key = f"{record.source_dataset}:{record.label_key}"
        augmented = record.source_dataset in AUGMENTED_DATASETS
        source_group_keys.append(group_key)
        provenance_kinds.append(
            "roboflow_augmented_dataset" if augmented else "roboflow_unaugmented_dataset"
        )
        augmentation_policies.append(
            AUGMENTATION_POLICIES.get(record.source_dataset, "unknown")
        )
        augmentation_statuses.append(
            "unknown_member_of_augmented_export" if augmented else "not_augmented_by_export"
        )
        evaluation_roles.append(
            "roboflow_geometry_holdout"
            if record.split in {"test", "valid"}
            else "training_pool"
        )
        geometry_eligible.append(
            record.split in {"test", "valid"} and geometry_sources[index] == "source_polygon"
        )
        recognition_eligible.append(category not in {"needsLabel", "unlabeled"})
        split_leakage.append(len(group_splits[group_key]) > 1)
    dataset.set_values("provenance_kind", provenance_kinds)
    dataset.set_values("media_role", ["scanner_query"] * len(dataset))
    dataset.set_values("source_group_key", source_group_keys)
    dataset.set_values("augmentation_policy", augmentation_policies)
    dataset.set_values("augmentation_status", augmentation_statuses)
    dataset.set_values("is_synthetic", [False] * len(dataset))
    dataset.set_values("is_derived", [False] * len(dataset))
    dataset.set_values("evaluation_role", evaluation_roles)
    dataset.set_values("geometry_evaluation_eligible", geometry_eligible)
    dataset.set_values("recognition_evaluation_eligible", recognition_eligible)
    dataset.set_values("source_group_split_leakage", split_leakage)

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
    metrics_by_suffix = {
        run.field_suffix: run_metrics(
            working_labels, run.predictions, lambda sample_key: sample_key
        )
        for run in runs
    }
    for run in runs:
        prediction_field = f"pred_{run.field_suffix}"
        decision_field = f"decision_{run.field_suffix}"
        identified_id_field = f"identified_card_id_{run.field_suffix}"
        identified_name_field = f"identified_card_name_{run.field_suffix}"
        identified_confidence_field = f"identified_confidence_{run.field_suffix}"
        outcome_field = f"outcome_{run.field_suffix}"
        verdict_field = f"verdict_{run.field_suffix}"
        name_verdict_field = f"name_verdict_{run.field_suffix}"
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
        current_verdicts = []
        current_name_verdicts = []
        for sample_key in sample_keys:
            run_sample = run.predictions.get(sample_key)
            if run_sample is None:
                current_verdicts.append("not_run")
                current_name_verdicts.append("not_run")
            else:
                current_verdicts.append(
                    prediction_verdict(working_labels.get(sample_key), run_sample)
                )
                current_name_verdicts.append(
                    name_prediction_verdict(working_labels.get(sample_key), run_sample)
                )
        dataset.set_values(verdict_field, current_verdicts)
        dataset.set_values(name_verdict_field, current_name_verdicts)
        if (
            fingerprint_matches
            and {
                prediction_field,
                decision_field,
                identified_id_field,
                identified_name_field,
                identified_confidence_field,
                outcome_field,
                verdict_field,
                name_verdict_field,
                elapsed_field,
            }
            <= set(existing_schema)
        ):
            continue
        predictions: list[Any | None] = []
        decisions: list[Any | None] = []
        identified_ids: list[str] = []
        identified_names: list[str] = []
        identified_confidences: list[float | None] = []
        outcomes: list[str] = []
        elapsed_values: list[float | None] = []
        for sample_key in sample_keys:
            sample = run.predictions.get(sample_key)
            if sample is None:
                predictions.append(None)
                decisions.append(None)
                identified_ids.append("")
                identified_names.append("")
                identified_confidences.append(None)
                outcomes.append("not_run")
                elapsed_values.append(None)
                continue
            result = sample.get("result") or {}
            matched = bool(result.get("matched") and result.get("cardID"))
            diagnostic = result.get("diagnostic") or {}
            candidates = diagnostic.get("candidates") or []
            if matched:
                identified_ids.append(str(result["cardID"]))
                identified_names.append(str(result.get("name") or ""))
                identified_confidences.append(float(result.get("confidence") or 0))
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
                identified_ids.append("")
                identified_names.append("")
                identified_confidences.append(None)
                predictions.append(None)
                outcomes.append(str(result.get("failure") or "declined"))
            decisions.append(
                fo.Classification(
                    label=decision_label(sample),
                    confidence=float(result.get("confidence") or 0),
                )
            )
            elapsed_values.append(
                float(result["elapsedMs"]) if result.get("elapsedMs") is not None else None
            )
        dataset.set_values(prediction_field, predictions)
        dataset.set_values(decision_field, decisions)
        dataset.set_values(identified_id_field, identified_ids)
        dataset.set_values(identified_name_field, identified_names)
        dataset.set_values(identified_confidence_field, identified_confidences)
        dataset.set_values(outcome_field, outcomes)
        dataset.set_values(elapsed_field, elapsed_values)

    # Model disagreement is a useful no-download proxy for hard examples and
    # likely reference-label problems.
    disagreement_values = []
    issue_values = []
    for sample_key in sample_keys:
        label = working_labels.get(sample_key) or {}
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
                "identifiedCardIdField": f"identified_card_id_{run.field_suffix}",
                "identifiedCardNameField": f"identified_card_name_{run.field_suffix}",
                "identifiedConfidenceField": f"identified_confidence_{run.field_suffix}",
                "evaluationKey": f"identity_{run.field_suffix}",
                "metrics": metrics_by_suffix[run.field_suffix],
            }
            for run in runs
        ],
    }
    dataset.save()
    return dataset, runs, len(labels)


def performance_rows(dataset: Any) -> list[dict[str, Any]]:
    cohort = (dataset.info or {}).get("tcger_evaluation_cohort", "reviewed_ios_replay")
    return [
        {
            "name": item["field"].removeprefix("pred_"),
            "source": item["source"],
            "samples": item["samples"],
            "cohort": cohort,
            "metrics": item["metrics"],
        }
        for item in dataset.info.get("tcger_model_runs", [])
    ]


def write_performance_report(
    dataset: Any, output_dir: Path, session_dataset: Any | None = None
) -> Path:
    rows = performance_rows(dataset)
    output_dir.mkdir(parents=True, exist_ok=True)
    write_metrics(output_dir / "model-performance.json", rows)
    with (output_dir / "model-performance.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(
            [
                "run",
                "cohort",
                "samples",
                "scored",
                "positives",
                "negatives",
                "unscored",
                "precision",
                "recall",
                "f1",
                "name_recall",
                "end_to_end_accuracy",
                "correct",
                "name_correct",
                "name_scored",
                "declined",
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
                    row["cohort"],
                    row["samples"],
                    metrics.get("scored", 0),
                    metrics.get("positives", 0),
                    metrics.get("negatives", 0),
                    metrics.get("unscored", 0),
                    metrics["precision"],
                    metrics["recall"],
                    metrics["f1"],
                    metrics.get("name_recall", 0),
                    metrics["end_to_end_accuracy"],
                    metrics.get("correct", 0),
                    metrics.get("name_correct", 0),
                    metrics.get("name_scored", 0),
                    metrics.get("declined", 0),
                    metrics.get("wrong", 0),
                    metrics.get("missed", 0),
                    metrics.get("false_positive", 0),
                    metrics.get("mean_elapsed_ms"),
                ]
            )
    render_metrics_table(rows, output_dir / "model-performance.png")
    dashboard = render_performance_charts(rows, output_dir)["dashboard"]
    diagnostic_paths, _ = write_diagnostic_dashboards(
        dataset,
        output_dir,
        session_dataset=session_dataset,
        repo_root=TOOL_DIR.parents[1],
    )
    dashboard_paths = {
        "performance": str(dashboard.resolve()),
        **{
            name: str(path.resolve())
            for name, path in diagnostic_paths.items()
            if name != "data"
        },
    }
    dataset.info = {
        **(dataset.info or {}),
        "tcger_evaluation_cohort": "reviewed_ios_replay",
        "tcger_performance_dashboard": str(dashboard.resolve()),
        "tcger_dashboards": dashboard_paths,
        "tcger_diagnostic_data": str(diagnostic_paths["data"].resolve()),
    }
    dataset.save()
    return dashboard


def build_preview_dataset(
    dataset: Any,
    replay_dir: Path,
    runs: list[ModelRun],
    preview_dataset_name: str,
    output_dir: Path,
) -> tuple[Any, Path]:
    fo = import_fiftyone()
    records = {record.sample_key: record for record in load_replay_records(replay_dir)}
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
        main_sample = main_by_key[sample_key]
        category = main_sample.get_field("label_category") or "unlabeled"
        if category == "unlabeled":
            continue
        label = {
            "category": category,
            "cardId": main_sample.get_field("label_card_id") or "",
            "name": main_sample.get_field("label_card_name") or "",
        }
        basename = re.sub(r"[^a-zA-Z0-9_-]+", "_", record.label_key)[:80]
        preview_path = output_dir / "samples" / f"{basename}-{main_sample.id}.jpg"
        run_lines = []
        for run in ranked_runs:
            identified_name = main_sample.get_field(
                f"identified_card_name_{run.field_suffix}"
            )
            identified_id = main_sample.get_field(f"identified_card_id_{run.field_suffix}")
            verdict = main_sample.get_field(f"verdict_{run.field_suffix}")
            identity = identified_name or "declined"
            if identified_id:
                identity += f" [{identified_id}]"
            run_lines.append(f"{run.field_suffix}: {identity} · {verdict}")
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
            provenance_kind="derived_rectification",
            media_role="rectification_comparison",
            source_group_key=main_sample.get_field("source_group_key") or "",
            augmentation_policy=main_sample.get_field("augmentation_policy") or "",
            augmentation_status=main_sample.get_field("augmentation_status") or "",
            is_synthetic=False,
            is_derived=True,
            evaluation_role="visualization_only",
            geometry_evaluation_eligible=False,
            recognition_evaluation_eligible=False,
        )
        for run in runs:
            preview[f"verdict_{run.field_suffix}"] = main_sample.get_field(
                f"verdict_{run.field_suffix}"
            )
            decision = main_sample.get_field(f"decision_{run.field_suffix}")
            preview[f"decision_{run.field_suffix}"] = decision
            preview[f"identified_card_id_{run.field_suffix}"] = main_sample.get_field(
                f"identified_card_id_{run.field_suffix}"
            )
            preview[f"identified_card_name_{run.field_suffix}"] = main_sample.get_field(
                f"identified_card_name_{run.field_suffix}"
            )
            preview[f"identified_confidence_{run.field_suffix}"] = main_sample.get_field(
                f"identified_confidence_{run.field_suffix}"
            )
            preview[f"name_verdict_{run.field_suffix}"] = main_sample.get_field(
                f"name_verdict_{run.field_suffix}"
            )
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


def remap_quad_to_media(
    quad: Any,
    scanner_size: tuple[int, int] | None,
    media_size: tuple[int, int] | None,
    crop_rect: tuple[float, float, float, float] | None = None,
) -> Any:
    """Remaps scanner-input Vision coordinates into the displayed original."""
    if not isinstance(quad, list) or len(quad) != 4:
        return quad
    if not scanner_size or not media_size or scanner_size == media_size:
        return quad
    scanner_width, scanner_height = scanner_size
    media_width, media_height = media_size
    if min(scanner_width, scanner_height, media_width, media_height) <= 0:
        return quad

    if crop_rect is not None:
        crop_x, crop_y, crop_width, crop_height = crop_rect
        if crop_width <= 0 or crop_height <= 0:
            return quad
        remapped = []
        for point in quad:
            if not isinstance(point, list) or len(point) < 2:
                return quad
            x = (float(point[0]) * crop_width + crop_x) / media_width
            y = (float(point[1]) * crop_height + crop_y) / media_height
            remapped.append([min(1.0, max(0.0, x)), min(1.0, max(0.0, y))])
        return remapped

    scanner_aspect = scanner_width / scanner_height
    media_aspect = media_width / media_height
    # Older evidence sometimes stores a resized full frame rather than a
    # pixel-aligned guide crop. Normalized coordinates already match there.
    if abs(scanner_aspect / media_aspect - 1.0) <= 0.03:
        return quad
    if scanner_width > media_width or scanner_height > media_height:
        return quad

    offset_x = (media_width - scanner_width) / 2.0
    offset_y = (media_height - scanner_height) / 2.0
    remapped = []
    for point in quad:
        if not isinstance(point, list) or len(point) < 2:
            return quad
        x = (float(point[0]) * scanner_width + offset_x) / media_width
        y = (float(point[1]) * scanner_height + offset_y) / media_height
        remapped.append([min(1.0, max(0.0, x)), min(1.0, max(0.0, y))])
    return remapped


def _top_left_quad_points(quad: Any) -> list[list[float]]:
    if not isinstance(quad, list) or len(quad) != 4:
        return []
    points = [
        [float(point[0]), 1.0 - float(point[1])]
        for point in quad
        if isinstance(point, list) and len(point) >= 2
    ]
    return points if len(points) == 4 else []


def _vision_quad(
    fo: Any,
    quad: Any,
    scanner_size: tuple[int, int] | None = None,
    media_size: tuple[int, int] | None = None,
    crop_rect: tuple[float, float, float, float] | None = None,
) -> Any:
    if not isinstance(quad, list) or len(quad) != 4:
        return fo.Keypoints(keypoints=[])
    remapped = remap_quad_to_media(quad, scanner_size, media_size, crop_rect)
    points = _top_left_quad_points(remapped)
    if len(points) != 4:
        return fo.Keypoints(keypoints=[])
    return fo.Keypoints(
        keypoints=[
            fo.Keypoint(
                label="scanner_quad",
                points=points,
                coordinate_source=(
                    "Vision normalized scanner input, remapped to displayed original"
                    if scanner_size and media_size and scanner_size != media_size
                    else "Vision normalized, converted to top-left origin"
                ),
            )
        ]
    )


def summarize_binder_cards(attempts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Returns one representative recognition record per detected pocket."""
    by_pocket: dict[int, list[dict[str, Any]]] = {}
    for attempt in attempts:
        pocket = attempt.get("pocketIndex")
        if isinstance(pocket, int):
            by_pocket.setdefault(pocket, []).append(attempt)

    summaries = []
    for pocket, pocket_attempts in sorted(by_pocket.items()):
        def rank(attempt: dict[str, Any]) -> tuple[int, float]:
            candidates = [
                item for item in (attempt.get("topCandidates") or []) if isinstance(item, dict)
            ]
            similarity = float(candidates[0].get("similarity") or 0) if candidates else 0.0
            priority = 3 if attempt.get("outcome") == "accepted" else (2 if candidates else 1)
            return priority, similarity

        representative = max(pocket_attempts, key=rank)
        candidates = [
            item for item in (representative.get("topCandidates") or []) if isinstance(item, dict)
        ]
        top = candidates[0] if candidates else {}
        status_source = representative if representative.get("binderStatus") else next(
            (item for item in pocket_attempts if item.get("binderStatus")), representative
        )
        quad = next((item.get("quad") for item in pocket_attempts if item.get("quad")), None)
        summaries.append(
            {
                "pocket_index": pocket,
                "status": str(status_source.get("binderStatus") or "unmatched"),
                "included_by_default": bool(status_source.get("binderIncludedByDefault")),
                "policy_reason": str(status_source.get("binderPolicyReason") or ""),
                "outcome": str(representative.get("outcome") or "unknown"),
                "image_index": representative.get("imageIndex"),
                "quad": quad,
                "card_id": str(top.get("cardID") or ""),
                "card_name": str(top.get("name") or ""),
                "confidence": float(top["similarity"]) if top.get("similarity") is not None else None,
                "candidates": candidates[:10],
            }
        )
    return summaries


def _binder_regions(
    fo: Any,
    cards: list[dict[str, Any]],
    scanner_size: tuple[int, int] | None,
    media_size: tuple[int, int] | None,
    crop_rect: tuple[float, float, float, float] | None = None,
) -> Any:
    polylines = []
    for card in cards:
        remapped = remap_quad_to_media(
            card.get("quad"), scanner_size, media_size, crop_rect
        )
        points = _top_left_quad_points(remapped)
        if len(points) != 4:
            continue
        pocket_number = int(card["pocket_index"]) + 1
        name = card.get("card_name") or card.get("status") or "unmatched"
        polylines.append(
            fo.Polyline(
                label=f"P{pocket_number} · {name}",
                points=[points],
                closed=True,
                filled=True,
                confidence=card.get("confidence"),
                pocket_index=int(card["pocket_index"]),
                card_id=card.get("card_id") or "",
                card_name=card.get("card_name") or "",
                binder_status=card.get("status") or "unmatched",
                included_by_default=bool(card.get("included_by_default")),
                policy_reason=card.get("policy_reason") or "",
            )
        )
    return fo.Polylines(polylines=polylines)


def _image_size(path: Path) -> tuple[int, int] | None:
    try:
        with Image.open(path) as image:
            return int(image.width), int(image.height)
    except (OSError, ValueError):
        return None


def locate_scanner_crop(
    scanner_path: Path,
    media_path: Path,
) -> dict[str, Any]:
    """Locates the archived guide crop inside its full-resolution photo."""
    scanner_size = _image_size(scanner_path)
    media_size = _image_size(media_path)
    if not scanner_size or not media_size:
        return {"mode": "unavailable", "rect": None, "confidence": None}
    scanner_width, scanner_height = scanner_size
    media_width, media_height = media_size
    scanner_aspect = scanner_width / scanner_height
    media_aspect = media_width / media_height
    if abs(scanner_aspect / media_aspect - 1.0) <= 0.03:
        return {
            "mode": "normalized_full_frame",
            "rect": (0.0, 0.0, float(media_width), float(media_height)),
            "confidence": None,
        }
    if scanner_width <= media_width and scanner_height <= media_height:
        scanner = cv2.imread(str(scanner_path), cv2.IMREAD_GRAYSCALE)
        media = cv2.imread(str(media_path), cv2.IMREAD_GRAYSCALE)
        if scanner is not None and media is not None:
            result = cv2.matchTemplate(media, scanner, cv2.TM_CCOEFF_NORMED)
            _, confidence, _, location = cv2.minMaxLoc(result)
            if confidence >= 0.75:
                return {
                    "mode": "registered_guide_crop",
                    "rect": (
                        float(location[0]),
                        float(location[1]),
                        float(scanner_width),
                        float(scanner_height),
                    ),
                    "confidence": float(confidence),
                }
    return {
        "mode": "centered_crop_fallback",
        "rect": (
            max(0.0, (media_width - scanner_width) / 2.0),
            max(0.0, (media_height - scanner_height) / 2.0),
            float(min(scanner_width, media_width)),
            float(min(scanner_height, media_height)),
        ),
        "confidence": None,
    }


def capture_quality_issue(quality: Any, *, includes_framing: bool = True) -> str:
    """Mirror ScannerCaptureQualityReport.primaryIssue for archived evidence."""
    if not isinstance(quality, dict):
        return "missing"
    fill = quality.get("fillRatio")
    if includes_framing:
        if fill is None:
            return "noCard"
        if float(fill) < 0.30:
            return "tooFar"
        if float(fill) > 0.98:
            return "tooClose"
    luma = float(quality.get("meanLuma") or 0)
    clipped = float(quality.get("clippedHighlightFraction") or 0)
    glare = float(quality.get("glareFraction") or 0)
    angle = quality.get("angleDeviationDegrees")
    sharpness = float(quality.get("sharpness") or 0)
    if luma < 0.18:
        return "tooDark"
    if luma > 0.90 or clipped > 0.08:
        return "tooBright"
    if glare > 0.08:
        return "glare"
    if includes_framing and (angle is None or float(angle) > 12.0):
        return "angle"
    if sharpness < 0.001:
        return "blur"
    return "pass"


def percentile(values: Iterable[float], quantile: float) -> float | None:
    """Nearest-rank percentile used by the App-facing latency summary."""
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return None
    index = min(len(ordered) - 1, max(0, int(len(ordered) * quantile)))
    return ordered[index]


def shutter_verdict(
    expected_card_id: str | None,
    expected_no_match: bool | None,
    identified_card_id: str | None,
) -> str:
    """Scores an intentional photo capture without treating unlabeled data as wrong."""
    predicted = identified_card_id or None
    if expected_no_match is True:
        return "correct_decline" if predicted is None else "false_positive"
    if expected_card_id:
        if predicted is None:
            return "missed"
        return "correct" if predicted == expected_card_id else "wrong"
    return "unscored"


def latency_bucket(elapsed_ms: float | None) -> str:
    if elapsed_ms is None or elapsed_ms <= 0:
        return "unavailable"
    if elapsed_ms < 250:
        return "under_250ms"
    if elapsed_ms < 500:
        return "250_499ms"
    if elapsed_ms < 1_000:
        return "500_999ms"
    if elapsed_ms < 2_000:
        return "1_2s"
    return "2s_plus"


def assisted_shutter_suggestion(record: dict[str, Any]) -> dict[str, Any]:
    """Builds a conservative suggestion without presenting model output as truth."""
    try:
        candidates = json.loads(record.get("candidates_json") or "[]")
    except (TypeError, ValueError):
        candidates = []
    if not isinstance(candidates, list):
        candidates = []
    candidates = [candidate for candidate in candidates if isinstance(candidate, dict)]

    try:
        title_names = json.loads(record.get("title_ocr_names_json") or "[]")
    except (TypeError, ValueError):
        title_names = []
    if not isinstance(title_names, list):
        title_names = []
    title_names = [str(name) for name in title_names if name]

    try:
        verified_numbers = json.loads(record.get("ocr_verified_numbers_json") or "[]")
    except (TypeError, ValueError):
        verified_numbers = []
    if not isinstance(verified_numbers, list):
        verified_numbers = []

    identified_id = str(record.get("identified_card_id") or "")
    identified_name = str(record.get("identified_card_name") or "")
    confidence = record.get("identified_confidence")
    if identified_id:
        evidence = "accepted_visual_plus_ocr" if (verified_numbers or title_names) else "accepted_visual"
        return {
            "category": "pokemon_card",
            "printing_id": identified_id,
            "card_name": identified_name or (title_names[0] if title_names else ""),
            "confidence": confidence,
            "strength": "exact_printing",
            "source": evidence,
            "explanation": (
                "Scanner accepted an exact printing; OCR also supplied supporting evidence."
                if evidence == "accepted_visual_plus_ocr"
                else "Scanner accepted an exact printing. Confirm it against the original and rectified card."
            ),
        }

    top_candidate = candidates[0] if candidates else {}
    if title_names:
        matching = [
            candidate
            for candidate in candidates
            if normalize_card_name(str(candidate.get("name") or ""))
            == normalize_card_name(title_names[0])
        ]
        unique_ids = {str(candidate.get("cardID") or "") for candidate in matching}
        unique_ids.discard("")
        exact_id = next(iter(unique_ids)) if len(unique_ids) == 1 else ""
        return {
            "category": "pokemon_card",
            "printing_id": exact_id,
            "card_name": title_names[0],
            "confidence": None,
            "strength": "exact_printing" if exact_id else "pokemon_name_only",
            "source": "title_ocr",
            "explanation": (
                "OCR found a Pokémon name and only one matching candidate printing."
                if exact_id
                else "OCR found a likely Pokémon name, but the exact printing still needs confirmation."
            ),
        }

    if not candidates and record.get("capture_quality_issue") == "noCard":
        return {
            "category": "no_card",
            "printing_id": "",
            "card_name": "",
            "confidence": None,
            "strength": "negative_hint",
            "source": "capture_quality_no_card",
            "explanation": "No card was detected and there was no candidate or OCR evidence. Confirm visually.",
        }

    if top_candidate:
        return {
            "category": "needs_content_confirmation",
            "printing_id": str(top_candidate.get("cardID") or ""),
            "card_name": str(top_candidate.get("name") or ""),
            "confidence": top_candidate.get("similarity"),
            "strength": "candidate_hint_only",
            "source": "retrieval_candidate_only",
            "explanation": (
                "The scanner retrieved a candidate but did not accept it. First confirm that this is a Pokémon card."
            ),
        }

    return {
        "category": "needs_content_confirmation",
        "printing_id": "",
        "card_name": "",
        "confidence": None,
        "strength": "none",
        "source": "no_reliable_evidence",
        "explanation": "No reliable automated suggestion is available; label the visible content manually.",
    }


def apply_assisted_shutter_suggestions(dataset: Any) -> dict[str, int]:
    """Adds editable pre-labels while preserving human truth as a separate layer."""
    rows = zip(
        dataset.values("identified_card_id"),
        dataset.values("identified_card_name"),
        dataset.values("identified_confidence"),
        dataset.values("candidates_json"),
        dataset.values("title_ocr_names_json"),
        dataset.values("ocr_verified_numbers_json"),
        dataset.values("capture_quality_issue"),
        dataset.values("capture_mode"),
    )
    suggestions = [
        (
            {
                "category": "binder_page",
                "printing_id": "",
                "card_name": "",
                "confidence": None,
                "strength": "binder_multi_card",
                "source": "per_pocket_scanner_evidence",
                "explanation": "Review each detected binder pocket separately; no page-level card identity is assigned.",
            }
            if capture_mode == "binder_page"
            else assisted_shutter_suggestion(
                {
                    "identified_card_id": identified_id,
                    "identified_card_name": identified_name,
                    "identified_confidence": confidence,
                    "candidates_json": candidates,
                    "title_ocr_names_json": title_names,
                    "ocr_verified_numbers_json": verified_numbers,
                    "capture_quality_issue": quality_issue,
                }
            )
        )
        for (
            identified_id,
            identified_name,
            confidence,
            candidates,
            title_names,
            verified_numbers,
            quality_issue,
            capture_mode,
        ) in rows
    ]
    field_map = {
        "assisted_category": "category",
        "assisted_printing_id": "printing_id",
        "assisted_card_name": "card_name",
        "assisted_confidence": "confidence",
        "assisted_strength": "strength",
        "assisted_source": "source",
        "assisted_explanation": "explanation",
    }
    for dataset_field, suggestion_key in field_map.items():
        dataset.set_values(dataset_field, [item[suggestion_key] for item in suggestions])
    truth_available = [bool(value) for value in dataset.values("human_truth_available")]
    expected_ids = [str(value or "") for value in dataset.values("expected_card_id")]
    expected_no_match = [bool(value) for value in dataset.values("expected_no_match")]
    assisted_statuses = []
    for suggestion, has_truth, expected_id, expects_decline in zip(
        suggestions, truth_available, expected_ids, expected_no_match
    ):
        if not has_truth:
            assisted_statuses.append("suggested")
            continue
        matches = (
            bool(expected_id) and suggestion["printing_id"] == expected_id
        ) or (
            expects_decline and suggestion["category"] == "no_card"
        )
        assisted_statuses.append("confirmed" if matches else "adjusted")
    dataset.set_values(
        "assisted_review_status",
        assisted_statuses,
    )
    dataset.set_values(
        "assisted_requires_confirmation", [not value for value in truth_available]
    )

    fo = import_fiftyone()
    field = fo.ViewField
    assisted_views = {
        "12 · Assisted — exact printing suggestions": dataset.match(
            (field("benchmark_selected") == True)  # noqa: E712
            & (field("human_truth_available") == False)  # noqa: E712
            & (field("assisted_strength") == "exact_printing")
        ),
        "13 · Assisted — Pokémon name only": dataset.match(
            (field("benchmark_selected") == True)  # noqa: E712
            & (field("human_truth_available") == False)  # noqa: E712
            & (field("assisted_strength") == "pokemon_name_only")
        ),
        "14 · Assisted — candidate hint, confirm content": dataset.match(
            (field("benchmark_selected") == True)  # noqa: E712
            & (field("human_truth_available") == False)  # noqa: E712
            & (field("assisted_strength") == "candidate_hint_only")
        ),
        "15 · Assisted — likely no card": dataset.match(
            (field("benchmark_selected") == True)  # noqa: E712
            & (field("human_truth_available") == False)  # noqa: E712
            & (field("assisted_category") == "no_card")
        ),
        "16 · Assisted — no reliable suggestion": dataset.match(
            (field("benchmark_selected") == True)  # noqa: E712
            & (field("human_truth_available") == False)  # noqa: E712
            & (field("assisted_strength") == "none")
        ),
    }
    for name, view in assisted_views.items():
        dataset.save_view(name, view, overwrite=True)

    counts: dict[str, int] = {}
    for suggestion in suggestions:
        strength = str(suggestion["strength"])
        counts[strength] = counts.get(strength, 0) + 1
    info = dict(dataset.info or {})
    info["assistedSuggestionPolicy"] = (
        "TCGer consensus v1: accepted scanner decisions and OCR may prefill labels; "
        "retrieval-only results require content confirmation; suggestions never become truth automatically."
    )
    info["assistedSuggestionCounts"] = counts
    dataset.info = info
    dataset.save()
    return counts


def build_shutter_dataset(
    reference_root: Path,
    dataset_name: str,
    rebuild: bool,
) -> Any:
    """Builds one benchmark row per intentional photo capture.

    Full-resolution originals are the primary media. The guide crop and the
    accepted perspective-normalized attempt remain linked fields so a reviewer
    can inspect what the scanner actually used without counting derived crops
    as independent benchmark examples.
    """
    fo = import_fiftyone()
    sessions_root = reference_root / "TCGer-Session-Reference" / "sessions"
    if not sessions_root.is_dir():
        raise SystemExit(f"Session archive not found: {sessions_root}")
    if fo.dataset_exists(dataset_name) and rebuild:
        fo.delete_dataset(dataset_name)
    if fo.dataset_exists(dataset_name):
        dataset = fo.load_dataset(dataset_name)
        apply_assisted_shutter_suggestions(dataset)
        return dataset

    dataset = fo.Dataset(dataset_name)
    samples = []
    latency_values: list[float] = []
    full_resolution_count = 0
    truth_count = 0
    rectified_count = 0
    for session_dir in sorted(path for path in sessions_root.iterdir() if path.is_dir()):
        results_path = session_dir / "results.json"
        evidence_path = session_dir / "evidence.json"
        if not results_path.is_file() or not evidence_path.is_file():
            continue
        results = read_json(results_path)
        evidence = read_json(evidence_path)
        frames = results.get("frames") if isinstance(results, dict) else None
        if not isinstance(frames, list) or not isinstance(evidence, list):
            continue
        frames_by_image = {
            frame.get("imageFile"): frame
            for frame in frames
            if isinstance(frame, dict) and frame.get("imageFile")
        }
        for item in evidence:
            if not isinstance(item, dict) or item.get("source") != "photoCapture":
                continue
            image_file = str(item.get("imageFile") or "")
            frame = frames_by_image.get(image_file) or {}
            scanner_input_path = session_dir / image_file
            original_name = str(item.get("originalImageFile") or "")
            original_path = session_dir / original_name if original_name else None
            has_original = bool(original_path and original_path.is_file())
            media_path = original_path if has_original else scanner_input_path
            if not media_path.is_file():
                continue

            attempts = [attempt for attempt in (item.get("attempts") or []) if isinstance(attempt, dict)]
            attempt_files = [str(name) for name in (item.get("attemptImageFiles") or [])]
            capture_mode = "binder_page" if any(
                attempt.get("pocketIndex") is not None for attempt in attempts
            ) else "single_card"
            scanner_size = _image_size(scanner_input_path) if scanner_input_path.is_file() else None
            media_size = _image_size(media_path)
            crop_mapping = (
                locate_scanner_crop(scanner_input_path, media_path)
                if scanner_input_path.is_file()
                else {"mode": "unavailable", "rect": None, "confidence": None}
            )
            crop_rect = crop_mapping["rect"]
            binder_cards = summarize_binder_cards(attempts) if capture_mode == "binder_page" else []
            binder_rectified_paths = []
            for card in binder_cards:
                image_index = card.get("image_index")
                card_path = None
                if isinstance(image_index, int) and 0 <= image_index < len(attempt_files):
                    candidate_path = session_dir / attempt_files[image_index]
                    if candidate_path.is_file():
                        card_path = candidate_path.resolve()
                        binder_rectified_paths.append(str(card_path))
                card["rectified_filepath"] = str(card_path) if card_path else ""
            accepted_attempt = next(
                (attempt for attempt in attempts if attempt.get("outcome") == "accepted"),
                None,
            )
            rectified_path: Path | None = None
            if (
                capture_mode == "single_card"
                and accepted_attempt is not None
                and isinstance(accepted_attempt.get("imageIndex"), int)
            ):
                image_index = int(accepted_attempt["imageIndex"])
                if 0 <= image_index < len(attempt_files):
                    candidate_path = session_dir / attempt_files[image_index]
                    if candidate_path.is_file():
                        rectified_path = candidate_path
            if rectified_path is not None:
                rectified_count += 1

            capture_best_id = str(frame.get("bestMatchCardId") or "")
            capture_best_name = str(frame.get("bestMatchName") or "")
            capture_best_confidence = (
                float(frame["confidence"]) if frame.get("confidence") is not None else None
            )
            identified_id = capture_best_id if capture_mode == "single_card" else ""
            identified_name = capture_best_name if capture_mode == "single_card" else ""
            confidence = capture_best_confidence if capture_mode == "single_card" else None
            candidate_source = (
                accepted_attempt
                or next((attempt for attempt in attempts if attempt.get("topCandidates")), None)
            ) if capture_mode == "single_card" else None
            candidates = list((candidate_source or {}).get("topCandidates") or [])
            if not candidates and capture_mode == "single_card":
                candidates = [
                    {"cardID": card_id, "name": name}
                    for card_id, name in zip(
                        frame.get("alternativeCardIds") or [], frame.get("alternatives") or []
                    )
                ]
            similarities = [
                float(candidate["similarity"])
                for candidate in candidates
                if isinstance(candidate, dict) and candidate.get("similarity") is not None
            ]
            margin = similarities[0] - similarities[1] if len(similarities) >= 2 else None

            title_names = sorted({
                str(attempt["titleMatchedName"])
                for attempt in attempts
                if attempt.get("titleMatchedName")
            })
            footer_pairs = sorted({
                str(number)
                for attempt in attempts
                for number in (attempt.get("footerPairNumbers") or [])
            })
            verified_numbers = sorted({
                str(attempt["ocrVerifiedCollectorNumber"])
                for attempt in attempts
                if attempt.get("ocrVerifiedCollectorNumber")
            })
            ocr_used = bool(title_names or footer_pairs or verified_numbers)

            expected_id = str(frame.get("expectedCardId") or "")
            expected_no_match = frame.get("expectedNoMatch")
            has_truth = bool(expected_id or expected_no_match is True)
            verdict = shutter_verdict(expected_id or None, expected_no_match, identified_id or None)
            truth_label = expected_id if expected_id else ("__declined__" if expected_no_match is True else None)
            decision_label_value = identified_id or "__declined__"
            elapsed_ms = float(item.get("elapsedMs") or frame.get("elapsedMs") or 0)
            valid_elapsed = elapsed_ms if elapsed_ms > 0 else None
            if valid_elapsed is not None:
                latency_values.append(valid_elapsed)
            if has_original:
                full_resolution_count += 1
            if has_truth:
                truth_count += 1

            quality = item.get("captureQuality")
            prediction = (
                fo.Classification(label=identified_id, confidence=confidence, card_name=identified_name)
                if identified_id
                else None
            )
            sample = fo.Sample(
                filepath=str(media_path.resolve()),
                sample_key=f"{session_dir.name}:{image_file}",
                label_key=f"{session_dir.name}:{image_file}",
                capture_session=session_dir.name,
                frame_index=int(frame.get("index") or 0),
                scan_source="photoCapture",
                scan_pipeline=str(frame.get("pipeline") or "dev-mode photoCapture"),
                capture_mode=capture_mode,
                is_shutter_capture=True,
                has_full_resolution_original=has_original,
                original_filepath=str(original_path.resolve()) if has_original and original_path else "",
                scanner_input_filepath=str(scanner_input_path.resolve()) if scanner_input_path.is_file() else "",
                rectified_filepath=str(rectified_path.resolve()) if rectified_path else "",
                rectification_available=rectified_path is not None,
                attempt_filepaths_json=json.dumps(
                    [str((session_dir / name).resolve()) for name in attempt_files],
                    ensure_ascii=False,
                ),
                scanner_quad=(
                    _vision_quad(
                        fo, frame.get("quad"), scanner_size, media_size, crop_rect
                    )
                    if capture_mode == "single_card"
                    else fo.Keypoints(keypoints=[])
                ),
                scanner_crop_mapping=str(crop_mapping["mode"]),
                scanner_crop_registration_confidence=crop_mapping["confidence"],
                scanner_crop_rect_json=json.dumps(crop_rect),
                binder_regions=_binder_regions(
                    fo, binder_cards, scanner_size, media_size, crop_rect
                ),
                binder_cards_json=json.dumps(binder_cards, ensure_ascii=False),
                binder_manual_labels_json="[]",
                binder_reviewed_count=0,
                binder_detected_count=len(binder_cards),
                binder_matched_count=sum(card.get("status") == "matched" for card in binder_cards),
                binder_uncertain_count=sum(card.get("status") == "uncertain" for card in binder_cards),
                binder_unmatched_count=sum(card.get("status") == "unmatched" for card in binder_cards),
                binder_rectified_filepaths_json=json.dumps(binder_rectified_paths, ensure_ascii=False),
                binder_rectified_count=len(binder_rectified_paths),
                capture_best_match_card_id=capture_best_id,
                capture_best_match_card_name=capture_best_name,
                capture_best_match_confidence=capture_best_confidence,
                identified=bool(identified_id),
                identified_card_id=identified_id,
                identified_card_name=identified_name,
                identified_confidence=confidence,
                prediction=prediction,
                decision=(
                    fo.Classification(label=decision_label_value, confidence=confidence)
                    if capture_mode == "single_card"
                    else None
                ),
                outcome=str(item.get("outcome") or "unknown"),
                strategy=str(frame.get("strategy") or ""),
                candidates_json=json.dumps(candidates[:10], ensure_ascii=False),
                candidate_count=len(candidates),
                candidate_top_two_margin=margin,
                attempt_count=len(attempts),
                accepted_attempt_count=sum(attempt.get("outcome") == "accepted" for attempt in attempts),
                elapsed_ms=valid_elapsed,
                latency_bucket=latency_bucket(valid_elapsed),
                title_ocr_names_json=json.dumps(title_names, ensure_ascii=False),
                footer_ocr_pairs_json=json.dumps(footer_pairs, ensure_ascii=False),
                ocr_verified_numbers_json=json.dumps(verified_numbers, ensure_ascii=False),
                ocr_evidence_available=ocr_used,
                expected_card_id=expected_id,
                expected_no_match=expected_no_match,
                human_truth_available=has_truth,
                truth_provenance="ios_manual_correction" if has_truth else "",
                ground_truth_identity=fo.Classification(label=truth_label) if truth_label else None,
                prediction_verdict=verdict,
                prediction_correct=verdict in {"correct", "correct_decline"} if has_truth else None,
                benchmark_selected=False,
                benchmark_accuracy_eligible=False,
                label_category=(
                    "singleCard" if expected_id else ("outsideIndex" if expected_no_match is True else "unlabeled")
                ),
                label_card_id=expected_id,
                label_card_name="",
                label_notes="Imported from iOS manual correction" if has_truth else "",
                review_status="corrected" if has_truth else "unreviewed",
                review_geometry_notes="",
                capture_quality_available=isinstance(quality, dict),
                capture_quality_issue=capture_quality_issue(quality),
                capture_quality_pass=capture_quality_issue(quality) == "pass",
                capture_sharpness=float(quality["sharpness"]) if isinstance(quality, dict) and quality.get("sharpness") is not None else None,
                capture_mean_luma=float(quality["meanLuma"]) if isinstance(quality, dict) and quality.get("meanLuma") is not None else None,
                capture_clipped_highlight_fraction=float(quality["clippedHighlightFraction"]) if isinstance(quality, dict) and quality.get("clippedHighlightFraction") is not None else None,
                capture_glare_fraction=float(quality["glareFraction"]) if isinstance(quality, dict) and quality.get("glareFraction") is not None else None,
                capture_fill_ratio=float(quality["fillRatio"]) if isinstance(quality, dict) and quality.get("fillRatio") is not None else None,
                capture_angle_deviation_degrees=float(quality["angleDeviationDegrees"]) if isinstance(quality, dict) and quality.get("angleDeviationDegrees") is not None else None,
                capture_detector_confidence=float(quality["detectorConfidence"]) if isinstance(quality, dict) and quality.get("detectorConfidence") is not None else None,
                provenance_kind="real_camera_shutter",
                media_role="shutter_original" if has_original else "shutter_scanner_input",
                is_synthetic=False,
                is_derived=not has_original,
                evaluation_role="real_camera_shutter_benchmark" if has_truth else "labeling_candidate",
                geometry_evaluation_eligible=False,
                recognition_evaluation_eligible=False,
                source_group_key=f"{session_dir.name}:{image_file}",
                source_group_split_leakage=False,
            )
            sample.tags.extend([
                "source:photoCapture",
                f"capture-mode:{capture_mode}",
                f"latency:{latency_bucket(valid_elapsed)}",
                "truth:available" if has_truth else "truth:needed",
            ])
            samples.append(sample)

    dataset.add_samples(samples, progress=True)
    dataset.persistent = True
    full_original_keys = dataset.match(
        (fo.ViewField("has_full_resolution_original") == True)  # noqa: E712
        & (fo.ViewField("capture_mode") == "single_card")
    ).values("sample_key")
    benchmark_keys = set(
        sorted(
            full_original_keys,
            key=lambda key: hashlib.sha256(
                f"tcger-shutter-benchmark-v1\0{key}".encode("utf-8")
            ).hexdigest(),
        )[:200]
    )
    sample_keys = dataset.values("sample_key")
    benchmark_selected_values = [key in benchmark_keys for key in sample_keys]
    truth_available_values = dataset.values("human_truth_available")
    accuracy_eligible_values = [
        selected and bool(has_truth)
        for selected, has_truth in zip(benchmark_selected_values, truth_available_values)
    ]
    dataset.set_values("benchmark_selected", benchmark_selected_values)
    dataset.set_values("benchmark_accuracy_eligible", accuracy_eligible_values)
    dataset.set_values("recognition_evaluation_eligible", accuracy_eligible_values)
    field = fo.ViewField
    views = {
        "01 · Benchmark 200 — needs labels": dataset.match(
            (field("benchmark_selected") == True)  # noqa: E712
            & (field("human_truth_available") == False)  # noqa: E712
        ),
        "02 · Benchmark 200 — labelled": dataset.match(
            (field("benchmark_selected") == True)  # noqa: E712
            & (field("human_truth_available") == True)  # noqa: E712
        ),
        "03 · Existing manual-correction hard cases": dataset.match(
            field("truth_provenance") == "ios_manual_correction"
        ),
        "04 · Slow captures (1 second or more)": dataset.match(field("elapsed_ms") >= 1_000),
        "05 · Very slow captures (2 seconds or more)": dataset.match(field("elapsed_ms") >= 2_000),
        "06 · Wrong, missed, or false positive": dataset.match(
            field("prediction_verdict").is_in(["wrong", "missed", "false_positive"])
        ),
        "07 · OCR evidence used": dataset.match(field("ocr_evidence_available") == True),  # noqa: E712
        "08 · Rectified preview available": dataset.match(field("rectification_available") == True),  # noqa: E712
        "09 · Many-attempt latency hotspots": dataset.match(field("attempt_count") >= 4).sort_by(
            "elapsed_ms", reverse=True
        ),
        "10 · Binder pages — every detected pocket": dataset.match(
            field("capture_mode") == "binder_page"
        ),
        "11 · Single-card shutter — isolated": dataset.match(
            field("capture_mode") == "single_card"
        ),
    }
    for name, view in views.items():
        dataset.save_view(name, view, overwrite=True)
    scoring_view = dataset.match(field("benchmark_accuracy_eligible") == True)  # noqa: E712
    if len(scoring_view):
        scoring_view.evaluate_classifications(
            "decision",
            gt_field="ground_truth_identity",
            eval_key="shutter_identity",
            method="simple",
        )
    dataset.info = {
        "tcger_sessions_root": str(sessions_root.resolve()),
        "benchmarkScope": "single-card iOS photoCapture records only; binder pages are reviewed per pocket",
        "samples": len(samples),
        "singleCardShutterCaptures": len(
            dataset.match(field("capture_mode") == "single_card")
        ),
        "binderPageCaptures": len(dataset.match(field("capture_mode") == "binder_page")),
        "binderDetectedCards": sum(dataset.values("binder_detected_count")),
        "binderMatchedCards": sum(dataset.values("binder_matched_count")),
        "binderUncertainCards": sum(dataset.values("binder_uncertain_count")),
        "binderUnmatchedCards": sum(dataset.values("binder_unmatched_count")),
        "fullResolutionOriginals": full_resolution_count,
        "humanTruthSamples": truth_count,
        "manualCorrectionHardCases": truth_count,
        "benchmarkSelectionPolicy": "200 single-card full-resolution originals selected by outcome-independent SHA-256 order",
        "benchmarkSelected": len(benchmark_keys),
        "benchmarkLabels": sum(accuracy_eligible_values),
        "rectifiedPreviews": rectified_count,
        "latencySamples": len(latency_values),
        "latencyP50Ms": percentile(latency_values, 0.50),
        "latencyP90Ms": percentile(latency_values, 0.90),
        "latencyP95Ms": percentile(latency_values, 0.95),
        "latencyDefinition": "end-to-end coordinator time recorded by the iOS shutter path",
        "truthWarning": "Unlabelled captures are excluded from accuracy; derived crops are linked evidence, not independent rows.",
    }
    dataset.save()
    apply_assisted_shutter_suggestions(dataset)
    return dataset


def build_session_dataset(
    reference_root: Path,
    dataset_name: str,
    rebuild: bool,
) -> Any:
    """Loads real device sessions while keeping derived crops non-scoring."""
    fo = import_fiftyone()
    sessions_root = reference_root / "TCGer-Session-Reference" / "sessions"
    if not sessions_root.is_dir():
        raise SystemExit(f"Session archive not found: {sessions_root}")
    if fo.dataset_exists(dataset_name) and rebuild:
        fo.delete_dataset(dataset_name)
    if fo.dataset_exists(dataset_name):
        return fo.load_dataset(dataset_name)
    dataset = fo.Dataset(dataset_name)
    samples = []
    session_count = 0
    role_counts: dict[str, int] = {}
    for session_dir in sorted(path for path in sessions_root.iterdir() if path.is_dir()):
        results_path = session_dir / "results.json"
        if not results_path.is_file():
            continue
        results = read_json(results_path)
        frames = results.get("frames") if isinstance(results, dict) else None
        if not isinstance(frames, list):
            continue
        evidence_path = session_dir / "evidence.json"
        evidence = read_json(evidence_path) if evidence_path.is_file() else []
        evidence_by_image = {
            item.get("imageFile"): item
            for item in evidence
            if isinstance(item, dict) and item.get("imageFile")
        }
        session_count += 1
        for frame in frames:
            image_file = frame.get("imageFile")
            if not image_file:
                continue
            frame_index = int(frame.get("index") or 0)
            group_key = f"{session_dir.name}:frame-{frame_index:04d}"
            frame_evidence = evidence_by_image.get(image_file) or {}
            frame_quality = frame_evidence.get("captureQuality")
            files: list[tuple[str, Path, int | None, dict[str, Any] | None]] = []
            original_name = frame_evidence.get("originalImageFile")
            if original_name:
                files.append(("real_camera_original", session_dir / original_name, None, None))
            selected_path = session_dir / image_file
            files.append(("selected_scanner_crop", selected_path, None, None))
            attempts = frame_evidence.get("attempts") or []
            attempt_by_index: dict[int, dict[str, Any]] = {}
            for attempt in attempts:
                index = attempt.get("imageIndex")
                if isinstance(index, int):
                    current = attempt_by_index.get(index)
                    if current is None or attempt.get("outcome") == "accepted":
                        attempt_by_index[index] = attempt
            for index, attempt_name in enumerate(frame_evidence.get("attemptImageFiles") or []):
                files.append(
                    ("scanner_attempt_crop", session_dir / attempt_name, index, attempt_by_index.get(index))
                )

            for role, media_path, attempt_index, attempt in files:
                if not media_path.is_file():
                    continue
                if attempt is not None:
                    candidates = attempt.get("topCandidates") or []
                    top = candidates[0] if candidates else {}
                    identified_id = str(top.get("cardID") or "")
                    identified_name = str(top.get("name") or "")
                    confidence = (
                        float(top["similarity"]) if top.get("similarity") is not None else None
                    )
                    outcome = str(attempt.get("outcome") or "unknown")
                    quad = attempt.get("quad")
                    strategy = str(attempt.get("kind") or "")
                else:
                    identified_id = str(frame.get("bestMatchCardId") or "")
                    identified_name = str(frame.get("bestMatchName") or "")
                    confidence = (
                        float(frame["confidence"]) if frame.get("confidence") is not None else None
                    )
                    candidates = [
                        {"cardID": card_id, "name": name}
                        for card_id, name in zip(
                            frame.get("alternativeCardIds") or [], frame.get("alternatives") or []
                        )
                    ]
                    outcome = "identified" if frame.get("identified") else "unidentified"
                    quad = frame.get("quad")
                    strategy = str(frame.get("strategy") or "")
                derived = role != "real_camera_original"
                attempt_quality = attempt.get("captureQuality") if attempt is not None else None
                capture_quality = attempt_quality or frame_quality
                quality_scope = (
                    "attempt_crop"
                    if isinstance(attempt_quality, dict)
                    else "framed_capture"
                )
                quality_issue = capture_quality_issue(
                    capture_quality,
                    includes_framing=quality_scope == "framed_capture",
                )
                prediction = None
                if identified_id:
                    prediction = fo.Classification(
                        label=identified_id,
                        confidence=confidence,
                        card_name=identified_name,
                    )
                sample = fo.Sample(
                    filepath=str(media_path.resolve()),
                    sample_key=f"{group_key}:{role}:{attempt_index if attempt_index is not None else 0}",
                    label_key=group_key,
                    capture_session=session_dir.name,
                    frame_index=frame_index,
                    source_group_key=group_key,
                    provenance_kind="derived_camera_crop" if derived else "real_camera",
                    media_role=role,
                    is_synthetic=False,
                    is_derived=derived,
                    augmentation_policy="none",
                    augmentation_status="not_applicable",
                    evaluation_role=(
                        "visualization_only" if derived else "real_camera_benchmark_candidate"
                    ),
                    geometry_evaluation_eligible=False,
                    recognition_evaluation_eligible=False,
                    source_group_split_leakage=False,
                    identified=bool(identified_id),
                    identified_card_id=identified_id,
                    identified_card_name=identified_name,
                    identified_confidence=confidence,
                    prediction=prediction,
                    outcome=outcome,
                    strategy=strategy,
                    elapsed_ms=(
                        float(frame["elapsedMs"]) if frame.get("elapsedMs") is not None else None
                    ),
                    alternatives_json=json.dumps(candidates[:10], ensure_ascii=False),
                    scanner_quad=_vision_quad(fo, quad),
                    attempt_index=attempt_index,
                    gate_score=(
                        float(attempt["gateScore"])
                        if attempt is not None and attempt.get("gateScore") is not None
                        else None
                    ),
                    capture_quality_available=isinstance(capture_quality, dict),
                    capture_quality_scope=quality_scope,
                    capture_quality_issue=quality_issue,
                    capture_quality_pass=quality_issue == "pass",
                    capture_sharpness=(
                        float(capture_quality["sharpness"])
                        if isinstance(capture_quality, dict)
                        and capture_quality.get("sharpness") is not None
                        else None
                    ),
                    capture_mean_luma=(
                        float(capture_quality["meanLuma"])
                        if isinstance(capture_quality, dict)
                        and capture_quality.get("meanLuma") is not None
                        else None
                    ),
                    capture_clipped_highlight_fraction=(
                        float(capture_quality["clippedHighlightFraction"])
                        if isinstance(capture_quality, dict)
                        and capture_quality.get("clippedHighlightFraction") is not None
                        else None
                    ),
                    capture_glare_fraction=(
                        float(capture_quality["glareFraction"])
                        if isinstance(capture_quality, dict)
                        and capture_quality.get("glareFraction") is not None
                        else None
                    ),
                    capture_fill_ratio=(
                        float(capture_quality["fillRatio"])
                        if isinstance(capture_quality, dict)
                        and capture_quality.get("fillRatio") is not None
                        else None
                    ),
                    capture_angle_deviation_degrees=(
                        float(capture_quality["angleDeviationDegrees"])
                        if isinstance(capture_quality, dict)
                        and capture_quality.get("angleDeviationDegrees") is not None
                        else None
                    ),
                    capture_detector_confidence=(
                        float(capture_quality["detectorConfidence"])
                        if isinstance(capture_quality, dict)
                        and capture_quality.get("detectorConfidence") is not None
                        else None
                    ),
                    capture_quality_json=json.dumps(capture_quality or {}, ensure_ascii=False),
                    label_category="unlabeled",
                    label_card_id="",
                    label_card_name="",
                    label_notes="",
                    review_status="unreviewed",
                    review_geometry_notes="",
                )
                sample.tags.extend(
                    [
                        "provenance:real_camera" if not derived else "provenance:derived",
                        f"role:{role}",
                        f"session:{session_dir.name}",
                    ]
                )
                sample.tags.append(f"capture-quality:{quality_issue}")
                samples.append(sample)
                role_counts[role] = role_counts.get(role, 0) + 1
    dataset.add_samples(samples, progress=True)
    dataset.persistent = True
    field = fo.ViewField
    views = {
        "01 · Real camera originals": dataset.match(field("is_derived") == False),  # noqa: E712
        "02 · Selected scanner crops": dataset.match(
            field("media_role") == "selected_scanner_crop"
        ),
        "03 · Attempt crops": dataset.match(field("media_role") == "scanner_attempt_crop"),
        "04 · Identified cards": dataset.match(field("identified") == True),  # noqa: E712
        "05 · Unidentified cards": dataset.match(field("identified") == False),  # noqa: E712
        "06 · Originals needing labels": dataset.match(
            (field("is_derived") == False) & (field("label_category") == "unlabeled")  # noqa: E712
        ),
        "07 · Capture quality issues": dataset.match(
            (field("capture_quality_available") == True)  # noqa: E712
            & (field("capture_quality_pass") == False)  # noqa: E712
        ),
        "08 · Glare and foil-risk captures": dataset.match(
            field("capture_quality_issue") == "glare"
        ),
    }
    for name, view in views.items():
        dataset.save_view(name, view, overwrite=True)
    dataset.info = {
        "tcger_sessions_root": str(sessions_root.resolve()),
        "captureSessions": session_count,
        "mediaRoles": role_counts,
        "truthWarning": (
            "identified_card_* fields are recorded scanner predictions, not human truth. "
            "Label real_camera_original samples before benchmark scoring."
        ),
    }
    dataset.save()
    return dataset


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


def _prediction_points(values: Any, width: int, height: int) -> list[list[float]]:
    if not isinstance(values, list):
        return []
    if values and isinstance(values[0], (int, float)):
        values = [values[index : index + 2] for index in range(0, len(values), 2)]
    points = [[float(point[0]), float(point[1])] for point in values if len(point) >= 2]
    if points and max(max(abs(x), abs(y)) for x, y in points) > 1.5:
        return normalized_points(points, width, height)
    return points


def import_geometry_run(dataset_name: str, input_path: Path, model_name: str | None) -> None:
    """Imports a model's masks/corners and registers polygon evaluation metrics."""
    from PIL import Image

    fo = import_fiftyone()
    if not fo.dataset_exists(dataset_name):
        raise SystemExit(f"FiftyOne dataset does not exist: {dataset_name}")
    document = read_json(input_path)
    raw_samples = document.get("samples") if isinstance(document, dict) else None
    if not isinstance(raw_samples, list):
        raise SystemExit("Geometry input must contain a samples[] array")
    raw_name = model_name or document.get("model") or input_path.stem
    suffix = re.sub(r"[^a-zA-Z0-9]+", "_", str(raw_name)).strip("_").lower()
    if not suffix:
        raise SystemExit("Geometry model name is empty")
    by_key = {
        item.get("imagePath"): item
        for item in raw_samples
        if isinstance(item, dict) and item.get("imagePath")
    }

    dataset = fo.load_dataset(dataset_name)
    polygon_field = f"geometry_pred_{suffix}"
    corner_field = f"corners_pred_{suffix}"
    iou_field = f"mask_iou_{suffix}"
    boundary_iou_field = f"boundary_iou_{suffix}"
    corner_error_field = f"corner_error_{suffix}"
    verdict_field = f"geometry_verdict_{suffix}"
    rectified_field = f"rectified_path_{suffix}"
    rectification_valid_field = f"rectification_valid_{suffix}"
    rectified_aspect_error_field = f"rectified_aspect_error_{suffix}"
    polygon_values = []
    corner_values = []
    iou_values = []
    boundary_iou_values = []
    corner_errors = []
    verdicts = []
    rectified_paths = []
    rectification_valid_values = []
    rectified_aspect_errors = []
    scored_ious = []
    scored_boundary_ious = []
    scored_corners = []
    matched = 0
    missing = 0
    for sample in dataset:
        item = by_key.get(sample.sample_key)
        width, height = Image.open(sample.filepath).size
        raw_polygons = (item or {}).get("polygons") or []
        if raw_polygons and isinstance(raw_polygons[0], (int, float)):
            raw_polygons = [raw_polygons]
        polylines = []
        predicted_polygons = []
        for raw_polygon in raw_polygons:
            points = _prediction_points(raw_polygon, width, height)
            if len(points) < 3:
                continue
            predicted_polygons.append(points)
            polylines.append(
                fo.Polyline(
                    label="card",
                    points=[points],
                    closed=True,
                    filled=True,
                    confidence=float((item or {}).get("confidence") or 0),
                )
            )
        polygon_values.append(fo.Polylines(polylines=polylines))

        predicted_corners = _prediction_points((item or {}).get("corners") or [], width, height)
        keypoints = []
        if len(predicted_corners) == 4:
            keypoints.append(fo.Keypoint(label="card_corners", points=predicted_corners))
        corner_values.append(fo.Keypoints(keypoints=keypoints))
        raw_rectified_path = str((item or {}).get("rectifiedPath") or "")
        resolved_rectified_path = Path(raw_rectified_path).expanduser() if raw_rectified_path else None
        if resolved_rectified_path is not None and not resolved_rectified_path.is_absolute():
            resolved_rectified_path = input_path.parent / resolved_rectified_path
        rectification_valid = bool(resolved_rectified_path and resolved_rectified_path.is_file())
        aspect_error = None
        if rectification_valid and resolved_rectified_path is not None:
            try:
                rectified_width, rectified_height = Image.open(resolved_rectified_path).size
                expected_aspect = CARD_WIDTH / CARD_HEIGHT
                observed_aspect = rectified_width / rectified_height
                aspect_error = abs(observed_aspect - expected_aspect) / expected_aspect
            except OSError:
                rectification_valid = False
        rectified_paths.append(str(resolved_rectified_path.resolve()) if rectification_valid else raw_rectified_path)
        rectification_valid_values.append(rectification_valid)
        rectified_aspect_errors.append(aspect_error)

        truth_polygons = []
        if sample.ground_truth_polygons:
            truth_polygons = [
                polyline.points[0]
                for polyline in sample.ground_truth_polygons.polylines
                if polyline.points
            ]
        best_iou = None
        if truth_polygons and predicted_polygons:
            best_iou = max(
                polygon_iou(truth, prediction)
                for truth in truth_polygons
                for prediction in predicted_polygons
            )
            scored_ious.append(best_iou)
        iou_values.append(best_iou)
        best_boundary_iou = None
        if truth_polygons and predicted_polygons:
            best_boundary_iou = max(
                boundary_iou(truth, prediction)
                for truth in truth_polygons
                for prediction in predicted_polygons
            )
            scored_boundary_ious.append(best_boundary_iou)
        boundary_iou_values.append(best_boundary_iou)

        expected_corners = []
        if sample.reference_corners:
            expected_corners = [
                keypoint.points
                for keypoint in sample.reference_corners.keypoints
                if keypoint.geometry_source == "source_polygon" and len(keypoint.points) == 4
            ]
        best_corner_error = None
        if expected_corners and len(predicted_corners) == 4:
            best_corner_error = min(
                corner_error(predicted_corners, expected, 1, 1) for expected in expected_corners
            )
            scored_corners.append(best_corner_error)
        corner_errors.append(best_corner_error)

        has_truth = bool(truth_polygons)
        if not has_truth:
            verdict = "unscored"
        elif not predicted_polygons:
            verdict = "missed"
            missing += 1
        elif best_iou is not None and best_iou >= 0.8 and (
            best_corner_error is None or best_corner_error <= 0.03
        ):
            verdict = "pass"
            matched += 1
        else:
            verdict = "geometry_error"
        verdicts.append(verdict)

    dataset.set_values(polygon_field, polygon_values)
    dataset.set_values(corner_field, corner_values)
    dataset.set_values(iou_field, iou_values)
    dataset.set_values(boundary_iou_field, boundary_iou_values)
    dataset.set_values(corner_error_field, corner_errors)
    dataset.set_values(verdict_field, verdicts)
    dataset.set_values(rectified_field, rectified_paths)
    dataset.set_values(rectification_valid_field, rectification_valid_values)
    dataset.set_values(rectified_aspect_error_field, rectified_aspect_errors)

    eval_key = f"geometry_{suffix}"
    if eval_key in dataset.list_evaluations():
        dataset.delete_evaluation(eval_key)
    geometry_view = dataset.match(fo.ViewField("geometry_source") == "source_polygon")
    if len(geometry_view):
        geometry_view.evaluate_detections(
            polygon_field,
            gt_field="ground_truth_polygons",
            eval_key=eval_key,
            method="coco",
        )
    run_info = {
        "name": suffix,
        "source": str(input_path.resolve()),
        "samples": len(by_key),
        "polygonField": polygon_field,
        "cornerField": corner_field,
        "maskIoUField": iou_field,
        "boundaryIoUField": boundary_iou_field,
        "cornerErrorField": corner_error_field,
        "geometryVerdictField": verdict_field,
        "rectifiedPathField": rectified_field,
        "rectificationValidField": rectification_valid_field,
        "rectifiedAspectErrorField": rectified_aspect_error_field,
        "evaluationKey": eval_key,
        "metrics": {
            "meanMaskIoU": sum(scored_ious) / len(scored_ious) if scored_ious else None,
            "meanBoundaryIoU": (
                sum(scored_boundary_ious) / len(scored_boundary_ious)
                if scored_boundary_ious
                else None
            ),
            "meanCornerError": sum(scored_corners) / len(scored_corners) if scored_corners else None,
            "geometryPasses": matched,
            "missed": missing,
            "maskSamplesScored": len(scored_ious),
            "boundarySamplesScored": len(scored_boundary_ious),
            "cornerSamplesScored": len(scored_corners),
            "rectificationsValid": sum(rectification_valid_values),
            "rectificationsReported": sum(bool(value) for value in rectified_paths),
            "meanRectifiedAspectError": (
                sum(value for value in rectified_aspect_errors if value is not None)
                / sum(value is not None for value in rectified_aspect_errors)
                if any(value is not None for value in rectified_aspect_errors)
                else None
            ),
        },
    }
    existing = [
        item
        for item in (dataset.info or {}).get("tcger_geometry_runs", [])
        if item.get("name") != suffix
    ]
    dataset.info = {**(dataset.info or {}), "tcger_geometry_runs": [*existing, run_info]}
    dataset.save_view(
        f"Geometry failures · {suffix}",
        dataset.match(fo.ViewField(verdict_field).is_in(["missed", "geometry_error"])),
        overwrite=True,
    )
    dataset.save()
    print(json.dumps(run_info, indent=2))


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

    preview = subparsers.add_parser(
        "preview", help="Build paired source/rectified previews and open their dataset"
    )
    preview.add_argument("--reference-root", type=Path, default=DEFAULT_REFERENCE_ROOT)
    preview.add_argument("--replay-dir", type=Path)
    preview.add_argument("--dataset-name", default=DEFAULT_DATASET_NAME)
    preview.add_argument("--preview-dataset-name", default=DEFAULT_PREVIEW_DATASET_NAME)
    preview.add_argument("--output-dir", type=Path)
    preview.add_argument("--no-launch", action="store_true")
    preview.add_argument("--port", type=int, default=5152)

    brain = subparsers.add_parser(
        "brain", help="Compute compact similarity, uniqueness, and duplicate analysis"
    )
    brain.add_argument("--dataset-name", default=DEFAULT_DATASET_NAME)

    report = subparsers.add_parser(
        "report", help="Write JSON, CSV, and PNG model-performance summaries"
    )
    report.add_argument("--dataset-name", default=DEFAULT_DATASET_NAME)
    report.add_argument("--session-dataset-name", default=DEFAULT_SESSION_DATASET_NAME)
    report.add_argument("--output-dir", type=Path)

    geometry = subparsers.add_parser(
        "import-geometry", help="Import one model's polygons/corners and evaluate them"
    )
    geometry.add_argument("--dataset-name", default=DEFAULT_DATASET_NAME)
    geometry.add_argument("--input", type=Path, required=True)
    geometry.add_argument("--model-name")

    sessions = subparsers.add_parser(
        "sessions", help="Load real device sessions as a separate provenance-aware dataset"
    )
    sessions.add_argument("--reference-root", type=Path, default=DEFAULT_REFERENCE_ROOT)
    sessions.add_argument("--dataset-name", default=DEFAULT_SESSION_DATASET_NAME)
    sessions.add_argument("--rebuild", action="store_true")
    sessions.add_argument("--no-launch", action="store_true")
    sessions.add_argument("--port", type=int, default=5153)

    shutter = subparsers.add_parser(
        "shutter",
        help="Build one row per intentional photo capture with accuracy and latency evidence",
    )
    shutter.add_argument("--reference-root", type=Path, default=DEFAULT_REFERENCE_ROOT)
    shutter.add_argument("--dataset-name", default=DEFAULT_SHUTTER_DATASET_NAME)
    shutter.add_argument("--rebuild", action="store_true")
    shutter.add_argument("--no-launch", action="store_true")
    shutter.add_argument("--port", type=int, default=5154)

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

    if args.command == "brain":
        fo = import_fiftyone()
        if not fo.dataset_exists(args.dataset_name):
            raise SystemExit(f"FiftyOne dataset does not exist: {args.dataset_name}")
        dataset = fo.load_dataset(args.dataset_name)
        compute_brain_analysis(dataset)
        print(f"Brain analysis completed for {len(dataset)} samples")
        return

    if args.command == "report":
        fo = import_fiftyone()
        if not fo.dataset_exists(args.dataset_name):
            raise SystemExit(f"FiftyOne dataset does not exist: {args.dataset_name}")
        dataset = fo.load_dataset(args.dataset_name)
        session_dataset = (
            fo.load_dataset(args.session_dataset_name)
            if fo.dataset_exists(args.session_dataset_name)
            else None
        )
        output_dir = args.output_dir or (args.state_dir / "previews")
        result = write_performance_report(
            dataset,
            output_dir.expanduser().resolve(),
            session_dataset=session_dataset,
        )
        print(f"Performance report: {result}")
        return

    if args.command == "import-geometry":
        import_geometry_run(
            args.dataset_name,
            args.input.expanduser().resolve(),
            args.model_name,
        )
        return

    if args.command == "sessions":
        dataset = build_session_dataset(
            args.reference_root.expanduser().resolve(), args.dataset_name, args.rebuild
        )
        print(f"Session dataset: {dataset.name} ({len(dataset)} samples)")
        print(f"Media roles: {dataset.info.get('mediaRoles', {})}")
        if not args.no_launch:
            fo = import_fiftyone()
            session = fo.launch_app(dataset, port=args.port, address="localhost", auto=True)
            print(f"Real sessions are available at http://localhost:{args.port}")
            session.wait()
        return

    if args.command == "shutter":
        dataset = build_shutter_dataset(
            args.reference_root.expanduser().resolve(), args.dataset_name, args.rebuild
        )
        print(f"Shutter dataset: {dataset.name} ({len(dataset)} captures)")
        print(
            "Coverage: "
            f"{dataset.info.get('fullResolutionOriginals', 0)} full-resolution originals; "
            f"{dataset.info.get('humanTruthSamples', 0)} human labels; "
            f"{dataset.info.get('latencySamples', 0)} timings"
        )
        print(
            "Latency: "
            f"p50 {dataset.info.get('latencyP50Ms')} ms; "
            f"p90 {dataset.info.get('latencyP90Ms')} ms; "
            f"p95 {dataset.info.get('latencyP95Ms')} ms"
        )
        if not args.no_launch:
            fo = import_fiftyone()
            session = fo.launch_app(dataset, port=args.port, address="localhost", auto=True)
            print(f"Shutter benchmark is available at http://localhost:{args.port}")
            session.wait()
        return

    replay_dir = args.replay_dir or (args.reference_root / REPLAY_RELATIVE_PATH)
    dataset, runs, label_count = build_dataset(
        replay_dir.expanduser().resolve(), args.dataset_name, getattr(args, "rebuild", False)
    )
    print_summary(dataset, runs, label_count)

    if args.command == "preview":
        output_dir = args.output_dir or (args.state_dir / "previews")
        preview_dataset, summary_path = build_preview_dataset(
            dataset,
            replay_dir.expanduser().resolve(),
            runs,
            args.preview_dataset_name,
            output_dir.expanduser().resolve(),
        )
        print(f"Preview dataset: {preview_dataset.name} ({len(preview_dataset)} samples)")
        print(f"Performance summary: {summary_path}")
        if not args.no_launch:
            fo = import_fiftyone()
            session = fo.launch_app(preview_dataset, port=args.port, address="localhost", auto=True)
            print(f"FiftyOne previews are available at http://localhost:{args.port}")
            session.wait()
        return

    if not args.no_launch:
        fo = import_fiftyone()
        session = fo.launch_app(dataset, port=args.port, address="localhost", auto=True)
        print(f"FiftyOne is available at http://localhost:{args.port}")
        session.wait()


if __name__ == "__main__":
    main()
    polygon_iou,
