#!/usr/bin/env python3
"""Diff a FiftyOne geometry-label snapshot against a pinned geometry release."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


SCHEMA_ID = "https://tcger.app/schemas/fiftyone-geometry-release-diff/v1"
STAMP_RE = re.compile(r"labels-(\d{8})-(\d{6})\.json$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def exported_at(path: Path) -> str:
    match = STAMP_RE.search(path.name)
    if not match:
        raise ValueError(f"label backup name has no export timestamp: {path.name}")
    value = datetime.strptime("".join(match.groups()), "%Y%m%d%H%M%S")
    return value.astimezone().isoformat(timespec="seconds")


def safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-")


def release_record_id(key: str) -> str:
    if "/" not in key:
        raise ValueError(f"frame key has no session separator: {key!r}")
    session_id, _ = key.split("/", 1)
    suffix = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    return safe_id(f"devmode-{session_id}-{suffix}")


def parse_quad(value: Any) -> list[list[float]] | None:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    if not isinstance(value, list) or len(value) != 4:
        return None
    quad: list[list[float]] = []
    for point in value:
        if (
            not isinstance(point, list)
            or len(point) != 2
            or isinstance(point[0], bool)
            or isinstance(point[1], bool)
            or not isinstance(point[0], (int, float))
            or not isinstance(point[1], (int, float))
        ):
            return None
        quad.append([float(point[0]), float(point[1])])
    return quad


def load_backup(path: Path) -> dict[str, dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, list):
        raise ValueError(f"label backup is not a JSON array: {path}")
    result: dict[str, dict[str, Any]] = {}
    for item in document:
        if not isinstance(item, dict) or not isinstance(item.get("key"), str):
            raise ValueError(f"label backup contains a record without a key: {path}")
        result[item["key"]] = item
    return result


def manual_quads(records: dict[str, dict[str, Any]]) -> dict[str, list[list[float]]]:
    result = {}
    for key, item in records.items():
        if item.get("fixed_quad_source") != "manual":
            continue
        quad = parse_quad(item.get("fixed_quad_json"))
        if quad is not None:
            result[key] = quad
    return result


def provenance_counts(records: dict[str, dict[str, Any]]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for item in records.values():
        quad = parse_quad(item.get("fixed_quad_json"))
        if quad is None:
            continue
        source = item.get("fixed_quad_source")
        if source == "manual":
            counts["human"] += 1
        elif isinstance(source, str) and source.strip():
            counts["detector"] += 1
        else:
            counts["skippedMissingSource"] += 1
    return {
        "human": counts["human"],
        "detector": counts["detector"],
        "skippedMissingSource": counts["skippedMissingSource"],
    }


def load_release(release_root: Path, prior_backup: Path) -> dict[str, Any]:
    manifest = json.loads((release_root / "manifest.json").read_text(encoding="utf-8"))
    prior_manual = manual_quads(load_backup(prior_backup))
    key_by_record = {release_record_id(key): key for key in prior_manual}
    devmode: dict[str, dict[str, Any]] = {}
    non_devmode_entries: list[dict[str, Any]] = []
    for entry in manifest["records"]:
        record = json.loads((release_root / entry["path"]).read_text(encoding="utf-8"))
        session_id = record.get("grouping", {}).get("sessionId")
        if session_id is None:
            non_devmode_entries.append({"entry": entry, "record": record})
            continue
        key = key_by_record.get(record["recordId"])
        if key is None:
            raise ValueError(
                f"cannot map pinned Dev Mode record to prior backup: {record['recordId']}"
            )
        corners = record["instances"][0]["corners"]
        quad = [[corner["point"][axis] for axis in ("x", "y")] for corner in corners]
        devmode[key] = {
            "quad": quad,
            "width": int(record["source"]["width"]),
            "height": int(record["source"]["height"]),
            "sceneSlice": entry["sceneSlice"],
            "split": entry["split"],
            "recordId": record["recordId"],
        }
    return {
        "manifest": manifest,
        "devmode": devmode,
        "nonDevmode": non_devmode_entries,
    }


def fiftyone_inventory(dataset_name: str) -> list[dict[str, Any]]:
    try:
        import fiftyone as fo
        from PIL import Image
    except ImportError as error:
        raise RuntimeError(
            "FiftyOne and Pillow are required for --dataset-name; run with the "
            "session-labeling virtual environment"
        ) from error
    if not fo.dataset_exists(dataset_name):
        raise ValueError(f"FiftyOne dataset does not exist: {dataset_name}")
    dataset = fo.load_dataset(dataset_name)
    result = []
    for sample in dataset.iter_samples():
        key = sample.get_field("key")
        if not isinstance(key, str) or "/" not in key:
            raise ValueError(f"FiftyOne sample has an invalid key: {key!r}")
        with Image.open(sample.filepath) as image:
            width, height = image.size
        frame_type = sample.get_field("frame_type")
        capture_mode = "binder" if frame_type == "binder" else "single"
        game = sample.get_field("game") or "unknown"
        result.append(
            {
                "key": key,
                "sessionId": key.split("/", 1)[0],
                "width": width,
                "height": height,
                "captureMode": capture_mode,
                "game": game,
                "sceneSlice": "binder_page" if capture_mode == "binder" else "single_handheld",
            }
        )
    return sorted(result, key=lambda item: item["key"])


def corner_deltas(
    before: list[list[float]],
    after: list[list[float]],
    width: int,
    height: int,
) -> list[dict[str, float]]:
    result = []
    for old, new in zip(before, after, strict=True):
        dx = (new[0] - old[0]) * width
        dy = (new[1] - old[1]) * height
        result.append(
            {
                "dx": round(dx, 6),
                "dy": round(dy, 6),
                "distance": round(math.hypot(dx, dy), 6),
            }
        )
    return result


def changed_quad(before: list[list[float]], after: list[list[float]]) -> bool:
    return any(
        not math.isclose(old_axis, new_axis, rel_tol=0.0, abs_tol=1e-12)
        for old, new in zip(before, after, strict=True)
        for old_axis, new_axis in zip(old, new, strict=True)
    )


def coverage_report(
    release: dict[str, Any],
    current_manual: dict[str, list[list[float]]],
    inventory_by_key: dict[str, dict[str, Any]],
    policy: dict[str, Any],
) -> dict[str, Any]:
    record_counts: Counter[str] = Counter()
    instance_counts: Counter[str] = Counter()
    slice_instances: Counter[tuple[str, str]] = Counter()
    metric_eligible_instances: Counter[str] = Counter()
    eligible_sources = set(policy["metricEligibleCornerSources"])
    for item in release["nonDevmode"]:
        entry, record = item["entry"], item["record"]
        record_counts[entry["split"]] += 1
        instance_counts[entry["split"]] += len(record["instances"])
        slice_instances[(entry["split"], entry["sceneSlice"])] += len(
            record["instances"]
        )
        metric_eligible_instances[entry["split"]] += sum(
            len(instance.get("corners", [])) == 4
            and all(
                corner.get("coordinateKnown")
                and corner.get("cornerSource") in eligible_sources
                for corner in instance.get("corners", [])
            )
            for instance in record["instances"]
        )
    for key in current_manual:
        inventory = inventory_by_key.get(key)
        if inventory is None:
            continue
        record_counts["test"] += 1
        instance_counts["test"] += 1
        slice_instances[("test", inventory["sceneSlice"])] += 1
        metric_eligible_instances["test"] += 1

    required_slices = []
    for requirement in policy["requiredSceneSlices"]:
        split = requirement["split"]
        scene_slice = requirement["sceneSlice"]
        actual = slice_instances[(split, scene_slice)]
        minimum = requirement["minimumInstances"]
        required_slices.append(
            {
                "split": split,
                "sceneSlice": scene_slice,
                "actualInstances": actual,
                "minimumInstances": minimum,
                "shortfall": max(0, minimum - actual),
                "meetsMinimum": actual >= minimum,
            }
        )

    split_coverage = {}
    for split in policy["requiredSplits"]:
        records = record_counts[split]
        instances = instance_counts[split]
        min_records = policy["minimumRecordsPerSplit"][split]
        min_instances = policy["minimumInstancesPerSplit"][split]
        split_coverage[split] = {
            "records": records,
            "minimumRecords": min_records,
            "recordShortfall": max(0, min_records - records),
            "instances": instances,
            "minimumInstances": min_instances,
            "instanceShortfall": max(0, min_instances - instances),
        }
    sessions = {item["sessionId"] for item in inventory_by_key.values() if item["key"] in current_manual}
    minimum_sessions = policy["minimumRealEvaluationSessions"]
    return {
        "policyId": policy["policyId"],
        "policyStatus": (
            "draft-unapproved" if "draft" in policy["policyId"] else "approved"
        ),
        "metricEligibleCorners": len(current_manual) * 4,
        "metricEligibleInstances": {
            split: {
                "actual": metric_eligible_instances[split],
                "minimum": policy.get("minimumMetricEligibleInstances", {}).get(split, 0),
                "shortfall": max(
                    0,
                    policy.get("minimumMetricEligibleInstances", {}).get(split, 0)
                    - metric_eligible_instances[split],
                ),
            }
            for split in policy["requiredSplits"]
        },
        "metricEligibleCornerSources": policy["metricEligibleCornerSources"],
        "realEvaluationSessions": len(sessions),
        "minimumRealEvaluationSessions": minimum_sessions,
        "realEvaluationSessionShortfall": max(0, minimum_sessions - len(sessions)),
        "splits": split_coverage,
        "requiredSceneSlices": required_slices,
        "observedSceneSliceInstances": {
            f"{split}:{scene_slice}": count
            for (split, scene_slice), count in sorted(slice_instances.items())
        },
    }


def build_report(
    *,
    current_backup: Path,
    prior_backup: Path,
    release_root: Path,
    inventory: Iterable[dict[str, Any]],
    policy_path: Path,
    dataset_repo: str,
    dataset_revision: str,
) -> dict[str, Any]:
    current_records = load_backup(current_backup)
    current_manual = manual_quads(current_records)
    release = load_release(release_root, prior_backup)
    baseline = release["devmode"]
    inventory_by_key = {item["key"]: item for item in inventory}
    all_keys = sorted(inventory_by_key)
    missing = sorted(set(current_manual) - set(inventory_by_key))
    if missing:
        raise ValueError(f"current manual labels are absent from FiftyOne inventory: {missing}")

    sessions: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "gainingManualQuad": [],
            "changedManualQuad": [],
            "losingManualQuad": [],
            "unchangedManualQuad": [],
            "detectorQuadFrames": [],
            "stillUnlabeled": [],
        }
    )
    detector_keys = {
        key
        for key, item in current_records.items()
        if parse_quad(item.get("fixed_quad_json")) is not None
        and isinstance(item.get("fixed_quad_source"), str)
        and item.get("fixed_quad_source") not in {"", "manual"}
    }
    inventory_by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in inventory_by_key.values():
        inventory_by_session[item["sessionId"]].append(item)
    for key in all_keys:
        session_id = inventory_by_key[key]["sessionId"]
        before = baseline.get(key)
        after = current_manual.get(key)
        if before is None and after is not None:
            sessions[session_id]["gainingManualQuad"].append(key)
        elif before is not None and after is None:
            sessions[session_id]["losingManualQuad"].append(key)
        elif before is not None and after is not None:
            if changed_quad(before["quad"], after):
                deltas = corner_deltas(
                    before["quad"], after, before["width"], before["height"]
                )
                sessions[session_id]["changedManualQuad"].append(
                    {
                        "key": key,
                        "cornerDeltasPixels": deltas,
                        "maximumCornerDeltaPixels": max(
                            delta["distance"] for delta in deltas
                        ),
                    }
                )
            else:
                sessions[session_id]["unchangedManualQuad"].append(key)
        if after is None:
            sessions[session_id]["stillUnlabeled"].append(key)
        if key in detector_keys:
            sessions[session_id]["detectorQuadFrames"].append(key)

    def breakdown(
        frames: list[dict[str, Any]], field: str
    ) -> dict[str, dict[str, int]]:
        values: dict[str, dict[str, int]] = {}
        for value in sorted({str(frame.get(field) or "unknown") for frame in frames}):
            keys = {frame["key"] for frame in frames if str(frame.get(field) or "unknown") == value}
            values[value] = {
                "frames": len(keys),
                "manualQuadFrames": len(keys & set(current_manual)),
                "detectorQuadFrames": len(keys & detector_keys),
                "stillUnlabeled": len(keys - set(current_manual)),
            }
        return values

    ordered_sessions = sorted(
        sessions,
        key=lambda session_id: (
            not any(
                frame.get("captureMode") == "binder"
                for frame in inventory_by_session[session_id]
            ),
            -sum(
                frame.get("captureMode") == "binder"
                and frame["key"] not in current_manual
                for frame in inventory_by_session[session_id]
            ),
            session_id,
        ),
    )
    session_rows = []
    for session_id in ordered_sessions:
        values = sessions[session_id]
        counts = {name: len(items) for name, items in values.items()}
        frames = inventory_by_session[session_id]
        session_rows.append(
            {
                "sessionId": session_id,
                "counts": counts,
                "breakdown": {
                    "captureMode": breakdown(frames, "captureMode"),
                    "game": breakdown(frames, "game"),
                },
                **values,
            }
        )
    binder_sessions = []
    for row in session_rows:
        binder = row["breakdown"]["captureMode"].get("binder")
        if binder is None:
            continue
        binder_sessions.append(
            {
                "sessionId": row["sessionId"],
                "games": sorted(row["breakdown"]["game"]),
                **binder,
            }
        )
    summary = {
        "sessions": len(session_rows),
        "inventoryFrames": len(all_keys),
        "currentManualQuadFrames": len(current_manual),
        "gainingManualQuad": sum(row["counts"]["gainingManualQuad"] for row in session_rows),
        "changedManualQuad": sum(row["counts"]["changedManualQuad"] for row in session_rows),
        "losingManualQuad": sum(row["counts"]["losingManualQuad"] for row in session_rows),
        "unchangedManualQuad": sum(row["counts"]["unchangedManualQuad"] for row in session_rows),
        "stillUnlabeled": sum(row["counts"]["stillUnlabeled"] for row in session_rows),
        "detectorQuadFrames": sum(row["counts"]["detectorQuadFrames"] for row in session_rows),
        "breakdown": {
            "captureMode": breakdown(list(inventory_by_key.values()), "captureMode"),
            "game": breakdown(list(inventory_by_key.values()), "game"),
        },
    }
    release_change_required = any(
        summary[name] for name in ("gainingManualQuad", "changedManualQuad", "losingManualQuad")
    )
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    manifest = release["manifest"]
    return {
        "schema": SCHEMA_ID,
        "export": {
            "path": f"TCGer-Labeling/fiftyone-sessions/backups/{current_backup.name}",
            "exportedAt": exported_at(current_backup),
            "sha256": sha256_file(current_backup),
            "labeledSamples": len(current_records),
        },
        "supersedes": {
            "path": f"TCGer-Labeling/fiftyone-sessions/backups/{prior_backup.name}",
            "exportedAt": exported_at(prior_backup),
            "sha256": sha256_file(prior_backup),
        },
        "pinnedRelease": {
            "datasetRepo": dataset_repo,
            "datasetRevision": dataset_revision,
            "releaseId": manifest["releaseId"],
            "corpusHash": manifest["corpusHash"],
        },
        "coordinateConvention": "image-edge: x * width, y * height",
        "provenanceMapping": {
            "manual": "human",
            "otherNamedSource": "detector",
            "missingSource": "skipped",
        },
        "provenanceCounts": provenance_counts(current_records),
        "summary": summary,
        "releaseChangeRequired": release_change_required,
        "binderSessionsFirst": binder_sessions,
        "sessions": session_rows,
        "coverage": coverage_report(
            release, current_manual, inventory_by_key, policy
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--current-backup", type=Path, required=True)
    parser.add_argument("--prior-backup", type=Path, required=True)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--dataset-name", default="tcger-sessions")
    parser.add_argument("--dataset-repo", required=True)
    parser.add_argument("--dataset-revision", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = build_report(
        current_backup=args.current_backup.resolve(),
        prior_backup=args.prior_backup.resolve(),
        release_root=args.release_root.resolve(),
        inventory=fiftyone_inventory(args.dataset_name),
        policy_path=args.policy.resolve(),
        dataset_repo=args.dataset_repo,
        dataset_revision=args.dataset_revision,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps({"output": str(args.output), **report["summary"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
