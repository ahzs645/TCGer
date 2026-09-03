#!/usr/bin/env python3
"""Local browser editor for dragging ordered card corners.

The FiftyOne Python panel cannot receive continuous pointer-move events. This
companion UI keeps the drag loop in the browser and persists its output to the
same ``tcger-sessions`` samples and append-only labeling journal.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
PLUGIN_DIR = ROOT / "mobile-apps/ios/scripts/session-labeling/plugin/tcger-card-labeler"
STATIC_DIR = Path(__file__).with_name("corner-editor")
SCENE_MINIMUMS = {
    "single_handheld": 50,
    "binder_page": 20,
    "steep_playmat": 20,
    "duel_field": 30,
}

import sys  # noqa: E402

sys.path.insert(0, str(PLUGIN_DIR))
from geometry_editor import (  # noqa: E402
    default_geometry_metadata,
    geometry_record,
    manual_quads,
    quad_validation_error,
)


def sample_key(sample):
    return field_value(sample, "key") or str(sample.id)


def field_value(sample, name, default=None):
    """Read an optional FiftyOne field without making it part of the schema."""
    try:
        if hasattr(sample, "has_field") and not sample.has_field(name):
            return default
        value = sample.get_field(name)
        return default if value is None else value
    except (AttributeError, KeyError):
        return default


def load_editor_metadata(sample, quads):
    """Return saved metadata when it still aligns with the stored quads."""
    metadata = default_geometry_metadata(sample_key(sample), quads)
    try:
        saved = json.loads(field_value(sample, "manual_instances_json") or "null")
    except (TypeError, json.JSONDecodeError):
        saved = None
    instances = (saved or {}).get("instances") or []
    if len(instances) != len(quads):
        return metadata
    for index, item in enumerate(instances):
        metadata[index] = {
            "physicalCardId": item.get("physicalCardId")
            or f"{sample_key(sample)}:card-{index}",
            "occlusionOrder": int(item.get("occlusionOrder", index)),
            "orientationKnown": bool(item.get("orientationKnown", True)),
            "side": item.get("side", "faceUp"),
            "cornerVisibility": list(
                item.get("cornerVisibility") or metadata[index]["cornerVisibility"]
            ),
        }
    return metadata


def polyline_quads(sample, field, *, preferred_label=None, limit=None):
    """Read four-point quads from a FiftyOne polyline field."""
    try:
        lines = list(sample[field].polylines)
    except Exception:
        return []
    if preferred_label is not None:
        lines.sort(
            key=lambda line: 0
            if getattr(line, "label", None) == preferred_label
            else 1
        )
    if limit is not None:
        lines = lines[:limit]
    result = []
    for line in lines:
        points = line.points[0] if line.points else []
        if len(points) == 5 and points[0] == points[-1]:
            points = points[:-1]
        if len(points) != 4:
            continue
        quad = [[float(x), float(y)] for x, y in points]
        signed_area = sum(
            quad[index][0] * quad[(index + 1) % 4][1]
            - quad[(index + 1) % 4][0] * quad[index][1]
            for index in range(4)
        ) / 2
        if signed_area < 0:
            quad.reverse()
        result.append(quad)
    return result


def durable_geometry(sample):
    try:
        value = json.loads(field_value(sample, "manual_instances_json") or "null")
    except (TypeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def scene_slice_for(sample, requested=None):
    """Choose an explicit editor slice without rewriting finalized truth."""
    saved = (durable_geometry(sample) or {}).get("sceneSlice")
    value = saved or requested or field_value(sample, "geometry_scene_slice")
    if value is None:
        value = (
            "binder_page"
            if field_value(sample, "frame_type") == "binder"
            else "single_handheld"
        )
    if value not in SCENE_MINIMUMS:
        raise ValueError(f"invalid scene slice: {value}")
    return value


def geometry_is_finalized(sample, quads):
    """True only when the durable payload contains these exact current quads."""
    instances = (durable_geometry(sample) or {}).get("instances") or []
    if not quads or len(instances) != len(quads):
        return False
    try:
        return all(
            all(
                abs(float(saved) - float(current)) <= 1e-9
                for saved_point, current_point in zip(item["corners"], quad)
                for saved, current in zip(saved_point, current_point)
            )
            for item, quad in zip(instances, quads)
        )
    except (KeyError, TypeError, ValueError):
        return False


def validate_payload(payload):
    """Validate and normalize a save payload without requiring FiftyOne."""
    raw_quads = payload.get("quads")
    raw_metadata = payload.get("metadata")
    if not isinstance(raw_quads, list) or not raw_quads:
        raise ValueError("at least one card quad is required")
    if not isinstance(raw_metadata, list) or len(raw_metadata) != len(raw_quads):
        raise ValueError("metadata must have one item per card")

    quads = []
    metadata = []
    orders = set()
    for index, (raw_quad, raw_item) in enumerate(zip(raw_quads, raw_metadata)):
        quad = [[float(x), float(y)] for x, y in raw_quad]
        error = quad_validation_error(quad)
        if error:
            raise ValueError(f"card {index + 1}: {error}")
        side = raw_item.get("side", "faceUp")
        if side not in {"faceUp", "faceDown", "unknown"}:
            raise ValueError(f"card {index + 1}: invalid side")
        order = int(raw_item.get("occlusionOrder", index))
        if order in orders:
            raise ValueError("occlusion orders must be unique within a frame")
        orders.add(order)
        visibility = list(raw_item.get("cornerVisibility") or [])
        if len(visibility) != 4 or any(
            item not in {"visible", "occluded", "outsideFrame"}
            for item in visibility
        ):
            raise ValueError(f"card {index + 1}: invalid corner visibility")
        quads.append(quad)
        metadata.append(
            {
                "physicalCardId": str(raw_item.get("physicalCardId") or f"card-{index}"),
                "occlusionOrder": order,
                "orientationKnown": bool(raw_item.get("orientationKnown", True)),
                "side": side,
                "cornerVisibility": visibility,
            }
        )
    return quads, metadata


def journal_path(sample):
    override = os.environ.get("TCGER_LABELING_STATE_DIR")
    if override:
        return Path(override).expanduser() / "journal.jsonl"
    frame_path = Path(sample.filepath).expanduser().resolve()
    try:
        sessions_dir = frame_path.parents[1]
        session_root = sessions_dir.parent
        if sessions_dir.name == "sessions" and session_root.name == "TCGer-Session-Reference":
            return session_root.parent / "TCGer-Labeling/fiftyone-sessions/journal.jsonl"
        if sessions_dir.name == "sessions":
            return session_root / "labeling/journal.jsonl"
    except IndexError:
        pass
    return Path.home() / ".local/share/TCGer/labeling/journal.jsonl"


def append_journal(sample):
    """Append the fields consumed by the existing label restore tool."""
    import datetime

    record = {
        "ts": datetime.datetime.now().isoformat(timespec="seconds"),
        "key": sample_key(sample),
    }
    for field in (
        "verdict", "corrected_card_id", "fixed_quad_json", "fixed_quad_source",
        "rerun_top5_json", "binder_rerun_json", "binder_labels_json",
        "manual_instances_json",
    ):
        record[field] = sample.get_field(field) if sample.has_field(field) else None
    quads = manual_quads(sample)
    if quads:
        record["manual_quad_points"] = quads[-1]
    path = journal_path(sample)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


class EditorStore:
    def __init__(self, dataset_name, view_name, scene_slice=None):
        import fiftyone as fo

        self.fo = fo
        self.dataset = fo.load_dataset(dataset_name)
        self.view_name = view_name
        if scene_slice is not None and scene_slice not in SCENE_MINIMUMS:
            raise ValueError(f"invalid scene slice: {scene_slice}")
        self.requested_scene_slice = scene_slice
        view = self.dataset.load_saved_view(view_name)
        self.sample_ids = [str(value) for value in view.values("id")]

    def list_samples(self):
        result = []
        for value in self.sample_ids:
            sample = self.dataset[value]
            quads = manual_quads(sample)
            draft_source = None
            if not quads:
                quads = polyline_quads(
                    sample, "detection_quads", preferred_label="decisive", limit=1
                )
                draft_source = "detector"
            result.append(
                {
                    "id": value,
                    "key": sample_key(sample),
                    "cards": len(quads),
                    "finalized": geometry_is_finalized(sample, quads),
                    "draftSource": draft_source,
                }
            )
        return result

    def progress(self):
        samples = self.list_samples()
        scene_slices = {
            scene_slice_for(self.dataset[value], self.requested_scene_slice)
            for value in self.sample_ids
        }
        if len(scene_slices) != 1:
            finalized = sum(1 for item in samples if item["finalized"])
            return {
                "sceneSlice": "mixed_review",
                "minimum": len(samples),
                "finalizedInstances": finalized,
                "ready": finalized >= len(samples),
            }
        finalized = sum(item["cards"] for item in samples if item["finalized"])
        scene_slice = next(iter(scene_slices))
        minimum = SCENE_MINIMUMS[scene_slice]
        return {
            "sceneSlice": scene_slice,
            "minimum": minimum,
            "finalizedInstances": finalized,
            "ready": finalized >= minimum,
        }

    def sample_payload(self, value):
        if value not in self.sample_ids:
            raise KeyError(value)
        sample = self.dataset[value]
        quads = manual_quads(sample)
        draft_source = None
        if not quads:
            quads = polyline_quads(
                sample, "detection_quads", preferred_label="decisive", limit=1
            )
            draft_source = "detector"
        with Image.open(sample.filepath) as image:
            width, height = image.size
        return {
            "id": value,
            "key": sample_key(sample),
            "game": field_value(sample, "game", "pokemon"),
            "frameType": field_value(sample, "frame_type", "binder"),
            "sceneSlice": scene_slice_for(sample, self.requested_scene_slice),
            "width": width,
            "height": height,
            "imageUrl": f"/api/image/{value}",
            "quads": quads,
            "metadata": load_editor_metadata(sample, quads),
            "finalized": geometry_is_finalized(sample, quads),
            "draftSource": draft_source,
        }

    def image_path(self, value):
        if value not in self.sample_ids:
            raise KeyError(value)
        return Path(self.dataset[value].filepath)

    def save(self, value, payload):
        if value not in self.sample_ids:
            raise KeyError(value)
        quads, metadata = validate_payload(payload)
        sample = self.dataset[value]
        sample["manual_quad"] = self.fo.Polylines(
            polylines=[
                self.fo.Polyline(
                    label="card",
                    points=[[tuple(point) for point in quad]],
                    closed=True,
                    filled=False,
                )
                for quad in quads
            ]
        )
        if bool(payload.get("finalize")):
            scene_slice = scene_slice_for(sample, payload.get("sceneSlice"))
            record = geometry_record(
                sample_key(sample), field_value(sample, "game"), scene_slice, quads, metadata
            )
            if not self.dataset.has_sample_field("manual_instances_json"):
                self.dataset.add_sample_field(
                    "manual_instances_json", self.fo.StringField
                )
            sample["manual_instances_json"] = json.dumps(record, sort_keys=True)
        sample.save()
        append_journal(sample)
        return {"ok": True, "cards": len(quads), "finalized": bool(payload.get("finalize"))}


class EditorHandler(BaseHTTPRequestHandler):
    server_version = "TCGerCornerEditor/1.0"

    @property
    def store(self):
        return self.server.store

    def log_message(self, fmt, *args):
        print(f"[corner-editor] {self.address_string()} {fmt % args}")

    def send_json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload, sort_keys=True).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, path, content_type=None):
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or mimetypes.guess_type(path)[0] or "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/api/samples":
                return self.send_json(
                    {
                        "view": self.store.view_name,
                        "samples": self.store.list_samples(),
                        "progress": self.store.progress(),
                    }
                )
            if path.startswith("/api/sample/"):
                return self.send_json(self.store.sample_payload(path.rsplit("/", 1)[-1]))
            if path.startswith("/api/image/"):
                return self.send_file(self.store.image_path(path.rsplit("/", 1)[-1]))
            relative = "index.html" if path in {"", "/"} else path.lstrip("/")
            target = (STATIC_DIR / relative).resolve()
            if STATIC_DIR.resolve() not in target.parents and target != STATIC_DIR.resolve():
                raise FileNotFoundError(path)
            return self.send_file(target)
        except KeyError:
            self.send_json({"error": "sample not found"}, HTTPStatus.NOT_FOUND)
        except FileNotFoundError:
            self.send_json({"error": "file not found"}, HTTPStatus.NOT_FOUND)
        except Exception as error:  # pragma: no cover
            self.send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_PUT(self):  # noqa: N802
        path = unquote(urlparse(self.path).path)
        if not path.startswith("/api/sample/"):
            return self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            self.send_json(self.store.save(path.rsplit("/", 1)[-1], payload))
        except KeyError:
            self.send_json({"error": "sample not found"}, HTTPStatus.NOT_FOUND)
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except Exception as error:  # pragma: no cover
            self.send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="tcger-sessions")
    parser.add_argument("--view", default="geometry: binder first batch")
    parser.add_argument("--scene-slice", choices=sorted(SCENE_MINIMUMS))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5152)
    args = parser.parse_args()
    store = EditorStore(args.dataset, args.view, args.scene_slice)
    server = ThreadingHTTPServer((args.host, args.port), EditorHandler)
    server.store = store
    print(f"TCGer corner editor: http://{args.host}:{args.port} ({len(store.sample_ids)} samples from {args.view!r})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
