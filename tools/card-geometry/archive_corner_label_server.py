#!/usr/bin/env python3
"""Local, append-only four-corner labeling of archive training targets.

Serves the frames of an archive corner-label queue (see
`build_archive_corner_label_queue.py`) with their seed boxes, records every
save as a journal revision bound to the queue, corpus and image hashes, and
exports completed frames as a `card-geometry-archive-corner-labels` v1 sidecar
that `build_real_smoke_release.py --archive-corner-labels` ingests.

Labels never modify the release or the canonical corpus. A frame is complete
when every queued target carries a valid quad or an explicit skip reason.
"""

from __future__ import annotations

import argparse
import copy
import getpass
import hashlib
import json
import math
import mimetypes
import os
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from card_layer_order import validate_relations

ROOT = Path(__file__).resolve().parents[2]
STATIC = Path(__file__).with_name("archive-labeler")
SIDECAR_SCHEMA = "https://tcger.app/schemas/card-geometry-archive-corner-labels/v1"
JOURNAL_SCHEMA = "tcger-archive-corner-labels-journal/v1"
SKIP_REASONS = {"occluded", "not-a-card", "cut-off", "unsure", "reflected-padding"}
VISIBILITIES = {"visible", "occluded", "outsideFrame"}
MIN_SEED_BOX_IOU = 0.5


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def image_color_mode(path: Path) -> str:
    """Classify decoded pixels for queue display without changing its hash/pins."""
    try:
        from PIL import Image, ImageChops, ImageStat
    except ImportError:
        return "unknown"
    with Image.open(path) as image:
        red, green, blue = image.convert("RGB").resize((128, 128)).split()
    spread = ImageChops.subtract(ImageChops.lighter(ImageChops.lighter(red, green), blue),
                                 ImageChops.darker(ImageChops.darker(red, green), blue))
    return "grayscale" if ImageStat.Stat(spread).mean[0] < 1.0 else "color"


def _box_iou(a, b):
    w = max(0.0, min(a["right"], b["right"]) - max(a["left"], b["left"]))
    h = max(0.0, min(a["bottom"], b["bottom"]) - max(a["top"], b["top"]))
    inter = w * h
    area = lambda x: max(0.0, x["right"] - x["left"]) * max(0.0, x["bottom"] - x["top"])  # noqa: E731
    union = area(a) + area(b) - inter
    return inter / union if union > 0 else 0.0


def validate_quad(quad):
    if not isinstance(quad, list) or len(quad) != 4:
        raise ValueError("Each card needs four corners")
    for point in quad:
        if (
            not isinstance(point, list) or len(point) != 2
            or any(type(v) not in (float, int) or not math.isfinite(v) or not -0.5 <= v <= 1.5 for v in point)
        ):
            raise ValueError("Corners must be finite coordinates within the editing margin")
    crosses = []
    for i, a in enumerate(quad):
        b, c = quad[(i + 1) % 4], quad[(i + 2) % 4]
        crosses.append((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
    if not (all(x > 1e-8 for x in crosses) or all(x < -1e-8 for x in crosses)):
        raise ValueError("An outline crosses itself or has collapsed corners")


def validate_label_quad(quad):
    """Validate a human TL/TR/BR/BL quad without changing generic homography rules."""
    validate_quad(quad)
    area2 = sum(
        point[0] * quad[(index + 1) % 4][1]
        - quad[(index + 1) % 4][0] * point[1]
        for index, point in enumerate(quad)
    )
    if area2 <= 1e-5:
        raise ValueError("Corners must be ordered TL, TR, BR, BL around the card; redraw clockwise")


def validate_save(frame, payload, default_reviewer=None):
    """Return the journal-ready label body for one frame or raise ValueError.

    The reviewer name is recorded with every revision but is not something to
    type per page: a blank name falls back to the server's default reviewer
    (the local account by default), so the field can stay out of the way.
    """
    if not isinstance(payload, dict):
        raise ValueError("Label must be an object")
    reviewer = payload.get("reviewer")
    if reviewer is None or (isinstance(reviewer, str) and not reviewer.strip()):
        reviewer = default_reviewer
    if not isinstance(reviewer, str) or not 1 <= len(reviewer.strip()) <= 120:
        raise ValueError("Enter your reviewer name or start the server with --default-reviewer")
    notes = payload.get("notes", "")
    if not isinstance(notes, str) or len(notes) > 10000:
        raise ValueError("Notes must be at most 10,000 characters")
    targets = payload.get("targets")
    if not isinstance(targets, dict):
        raise ValueError("Targets must be an object keyed by annotation index")
    queued = {str(t["sourceAnnotationIndex"]): t for t in frame["instances"]}
    unknown = sorted(set(targets) - set(queued))
    if unknown:
        raise ValueError(f"Unknown target indices: {unknown}")
    labeled = {}
    for key, value in targets.items():
        if not isinstance(value, dict):
            raise ValueError(f"Target {key} must be an object")
        if value.get("skip") is not None:
            if value["skip"] not in SKIP_REASONS:
                raise ValueError(f"Target {key}: unknown skip reason")
            labeled[key] = {"skip": value["skip"]}
            continue
        status = value.get("status")
        if status not in (None, "confirmed"):
            raise ValueError(f"Target {key}: only confirmed labels may be saved")
        quad = value.get("corners")
        validate_label_quad(quad)
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        box = {"left": max(0.0, min(xs)), "top": max(0.0, min(ys)),
               "right": min(1.0, max(xs)), "bottom": min(1.0, max(ys))}
        if _box_iou(box, queued[key]["seedBox"]) < MIN_SEED_BOX_IOU:
            raise ValueError(f"Target {key}: the outline does not cover its seed box; is it the right card?")
        visibility = value.get("cornerVisibility", ["visible"] * 4)
        if not isinstance(visibility, list) or len(visibility) != 4 or any(v not in VISIBILITIES for v in visibility):
            raise ValueError(f"Target {key}: corner visibility must be four of visible/occluded/outsideFrame")
        for point, vis in zip(quad, visibility):
            outside = not (0 <= point[0] <= 1 and 0 <= point[1] <= 1)
            if outside and vis == "visible":
                raise ValueError(f"Target {key}: a corner beyond the image must be marked outsideFrame")
        orientation = value.get("orientationKnown", True)
        if not isinstance(orientation, bool):
            raise ValueError(f"Target {key}: orientationKnown must be true or false")
        source = value.get("cornerSource", "human")
        if source not in ("human", "detector"):
            raise ValueError(f"Target {key}: cornerSource must be human or detector")
        labeled[key] = {"corners": [[float(x), float(y)] for x, y in quad],
                        "cornerVisibility": list(visibility), "orientationKnown": orientation,
                        "cornerSource": source}
    complete = all(str(t["sourceAnnotationIndex"]) in labeled for t in frame["instances"])
    direction = payload.get("direction", 0)
    if type(direction) is not int or direction not in (0, 1, 2, 3):
        raise ValueError("direction must be 0, 1, 2 or 3 quarter turns")
    return {"reviewer": reviewer.strip(), "notes": notes, "targets": labeled, "complete": complete, "direction": direction}


def validate_drafts(frame, drafts):
    """Persist unfinished outlines separately; never export them as labels."""
    queued = {str(t["sourceAnnotationIndex"]) for t in frame["instances"]}
    if not isinstance(drafts, dict) or set(drafts) - queued:
        raise ValueError("Drafts must use queued target indices")
    for key, target in drafts.items():
        if not isinstance(target, dict) or target.get("status") not in ("seeded", "edited") or "skip" in target:
            raise ValueError(f"Draft {key}: expected an unfinished outline")
        quad = target.get("corners")
        # A draft can temporarily cross itself while a handle is being moved.
        if not isinstance(quad, list) or len(quad) != 4 or any(
            not isinstance(p, list) or len(p) != 2 or any(
                type(v) not in (int, float) or not math.isfinite(v) or not -.5 <= v <= 1.5 for v in p
            ) for p in quad
        ):
            raise ValueError(f"Draft {key}: expected four finite corners within the editing margin")
        if (not isinstance(target.get("cornerVisibility"), list) or len(target["cornerVisibility"]) != 4
                or any(v not in VISIBILITIES for v in target["cornerVisibility"])
                or type(target.get("orientationKnown")) is not bool):
            raise ValueError(f"Draft {key}: invalid visibility or orientation")
        if target.get("cornerSource", "human") not in ("human", "detector"):
            raise ValueError(f"Draft {key}: invalid corner source")
    return copy.deepcopy(drafts)


class Store:
    def __init__(self, queue_path: Path, release: Path, journal: Path, scene_slices=None,
                 canonical_corpus_sha256: str | None = None, default_reviewer: str | None = None):
        self.journal, self.lock = journal, threading.Lock()
        self.default_reviewer = default_reviewer
        queue = json.loads(queue_path.read_text())
        self.presentation = queue.get("presentation", {})
        if queue.get("labelSidecarSchema") != SIDECAR_SCHEMA:
            raise ValueError("queue does not target the archive corner-label sidecar schema")
        self.pins = {"queueSha256": digest(queue_path), "corpusHash": queue["corpusHash"],
                     "releaseId": queue["releaseId"], "manifestSha256": queue["manifestSha256"]}
        manifest = json.loads((release / "manifest.json").read_text())
        if manifest["corpusHash"] != queue["corpusHash"]:
            raise ValueError("release corpus hash differs from the queue")
        self.canonical_corpus_sha = canonical_corpus_sha256 or queue.get("canonicalCorpusSha256")
        if not self.canonical_corpus_sha:
            raise ValueError("queue carries no canonicalCorpusSha256; pass --canonical-corpus-sha256")
        self.frames = {}
        for frame in queue["frames"]:
            if scene_slices and frame["sceneSlice"] not in scene_slices:
                continue
            image = release / frame["imagePath"]
            if digest(image) != frame["imageSha256"]:
                raise ValueError(f"Image hash mismatch: {frame['recordId']}")
            self.frames[frame["recordId"]] = dict(frame, imageFile=image, colorMode=image_color_mode(image))
        order = {"multi_card_grid_archive": 0, "multi_card_scatter_archive": 1, "multi_card_other_archive": 2}
        self.order = sorted(self.frames, key=lambda k: (order.get(self.frames[k]["sceneSlice"], 9), k))
        self.saved = {}
        if journal.exists():
            for line in journal.read_text().splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("pins") != self.pins:
                    raise ValueError("Journal belongs to a different queue; use another journal")
                if row["recordId"] in self.frames:
                    self.saved[row["recordId"]] = row

    def progress(self):
        frames_done = sum(1 for r in self.saved.values() if r["complete"])
        targets = sum(len(f["instances"]) for f in self.frames.values())
        labeled = sum(sum(1 for k, t in r["targets"].items() if "corners" in t and k not in r.get("drafts", {})) for r in self.saved.values())
        skipped = sum(sum(1 for k, t in r["targets"].items() if "skip" in t and k not in r.get("drafts", {})) for r in self.saved.values())
        return {"frames": len(self.frames), "framesComplete": frames_done, "targets": targets,
                "targetsLabeled": labeled, "targetsSkipped": skipped}

    def save(self, key, payload):
        frame = self.frames[key]
        body = validate_save(frame, payload, self.default_reviewer)
        drafts = validate_drafts(frame, payload.get("drafts", {}))
        if set(drafts) & set(body["targets"]):
            raise ValueError("A card cannot be submitted as both a draft and a confirmed label")
        with self.lock:
            revision = self.saved.get(key, {}).get("revision", 0)
            if payload.get("revision") != revision:
                raise RuntimeError("This frame changed in another tab. Reload before saving.")
            # An older browser may omit provenance when re-saving bot labels.
            # Preserve it unless the person explicitly confirms or edits them.
            previous = self.saved.get(key, {}).get("targets", {})
            previous_drafts = self.saved.get(key, {}).get("drafts", {})
            if previous_drafts and "drafts" not in payload:
                raise ValueError("This frame has saved drafts. Reload the labeler before saving.")
            missing = (set(previous) | set(previous_drafts)) - set(body["targets"]) - set(drafts)
            if missing:
                raise ValueError("Save would remove existing cards. Reload the labeler to save drafts safely; browser drafts are retained.")
            for index, target in body["targets"].items():
                old = previous.get(index, {})
                if ("corners" in target and "cornerSource" not in payload["targets"][index]
                        and old.get("cornerSource") == "detector"
                        and all(target[field] == old.get(field)
                                for field in ("corners", "cornerVisibility", "orientationKnown"))):
                    target["cornerSource"] = "detector"
            # Keep the last confirmed geometry underneath an unfinished edit.
            # The draft makes this frame incomplete and excludes it from export.
            for index in drafts:
                if index in previous:
                    body["targets"][index] = copy.deepcopy(previous[index])
            # Older clients can keep saving without discarding the layer metadata.
            relations = payload.get("occlusionRelations", self.saved.get(key, {}).get("occlusionRelations", []))
            current = {**body["targets"], **drafts}
            body["occlusionRelations"] = validate_relations(relations, [int(k) for k, t in current.items() if "corners" in t])
            body["drafts"] = drafts
            body["complete"] = not drafts and all(str(t["sourceAnnotationIndex"]) in body["targets"] for t in frame["instances"])
            row = dict(schema=JOURNAL_SCHEMA, recordId=key, canonicalRecordId=frame["canonicalRecordId"],
                       imageSha256=frame["imageSha256"], sceneSlice=frame["sceneSlice"], pins=self.pins,
                       revision=revision + 1, savedAt=datetime.now(timezone.utc).isoformat(), **body)
            self.journal.parent.mkdir(parents=True, exist_ok=True)
            with self.journal.open("a") as stream:
                stream.write(json.dumps(row, allow_nan=False) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            self.saved[key] = row
            return row

    def backup_browser_drafts(self, payload):
        drafts = payload.get("drafts") if isinstance(payload, dict) else None
        if not isinstance(drafts, dict) or set(drafts) - set(self.frames) or any(not isinstance(v, str) for v in drafts.values()):
            raise ValueError("Expected browser draft strings for known frames")
        folder = self.journal.parent / "browser-draft-backups"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ") + ".json")
        with path.open("x") as stream:
            json.dump({"pins": self.pins, "drafts": drafts}, stream, allow_nan=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        return {"frames": len(drafts), "backupFile": str(path)}

    def export(self):
        """Completed frames as an archive corner-label sidecar (skipped targets omitted)."""
        frames = []
        for key in self.order:
            row = self.saved.get(key)
            if not row or not row["complete"]:
                continue
            instances = [
                {"sourceAnnotationIndex": int(index), "corners": t["corners"],
                 "cornerVisibility": t["cornerVisibility"], "orientationKnown": t["orientationKnown"],
                 "cornerSource": t.get("cornerSource", "human")}
                for index, t in sorted(row["targets"].items(), key=lambda kv: int(kv[0])) if "corners" in t
            ]
            if not instances:
                continue
            # Padding repair keeps dimensions and every interior coordinate.
            # Bind the portable sidecar back to the original canonical image;
            # the journal itself stays pinned to the corrected displayed bytes.
            canonical_image_sha = self.frames[key].get("canonicalImageSha256", row["imageSha256"])
            frames.append({"canonicalRecordId": row["canonicalRecordId"], "imageSha256": canonical_image_sha,
                           "reviewer": row["reviewer"], "labeledAt": row["savedAt"], "instances": instances})
            if row.get("occlusionRelations"):
                frames[-1]["occlusionRelations"] = copy.deepcopy(row["occlusionRelations"])
        return {"schema": SIDECAR_SCHEMA, "canonicalCorpusSha256": self.canonical_corpus_sha, "frames": frames}


def handler(store, review=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, data, content_type="application/json", status=200):
            if not isinstance(data, bytes):
                data = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urlparse(self.path).path
            if path.startswith("/api/model-review/"):
                if review is None:
                    return self.send({"error": "Start the server with --model-review-config to enable model review"}, status=503)
                try:
                    if path == "/api/model-review/frames":
                        return self.send(review.summary())
                    if path == "/api/model-review/export":
                        return self.send(review.export())
                    if path.startswith("/api/model-review/frame/"):
                        return self.send(review.frame(path.rsplit("/", 1)[-1]))
                    if path.startswith("/api/model-review/image/"):
                        data, mime = review.image(path.rsplit("/", 1)[-1])
                        return self.send(data, mime)
                except KeyError:
                    return self.send({"error": "Unknown review photo"}, status=404)
                except ValueError as error:
                    return self.send({"error": str(error)}, status=409)
                return self.send({"error": "Not found"}, status=404)
            if path == "/api/frames":
                return self.send({
                    "pins": store.pins, "progress": store.progress(), "defaultReviewer": store.default_reviewer,
                    "presentation": store.presentation,
                    "frames": [dict(id=k, scene=store.frames[k]["sceneSlice"], archive=store.frames[k]["sourceArchiveId"],
                                    colorMode=store.frames[k]["colorMode"],
                                    targets=len(store.frames[k]["instances"]),
                                    complete=bool(store.saved.get(k, {}).get("complete")),
                                    saved=k in store.saved) for k in store.order]})
            if path == "/api/export":
                return self.send(store.export())
            if path.startswith("/api/frame/") or path.startswith("/image/"):
                key = path.rsplit("/", 1)[-1]
                if key not in store.frames:
                    return self.send({"error": "Unknown frame"}, status=404)
                f = store.frames[key]
                if path.startswith("/image/"):
                    return self.send(f["imageFile"].read_bytes(),
                                     mimetypes.guess_type(f["imageFile"])[0] or "application/octet-stream")
                return self.send({k: v for k, v in f.items() if k != "imageFile"} | {"label": store.saved.get(key)})
            files = {"/": STATIC / "index.html", "/labeler.js": STATIC / "labeler.js",
                     "/model-review.html": STATIC / "model-review.html",
                     "/model-review.js": STATIC / "model-review.js",
                     "/model-review.css": STATIC / "model-review.css",
                     "/layers.js": STATIC / "layers.js",
                     "/draft-recovery.html": STATIC / "draft-recovery.html",
                     "/labeler.css": STATIC / "labeler.css", "/geometry.js": STATIC.parent / "corner-editor/geometry.js"}
            if path in files:
                return self.send(files[path].read_bytes(), mimetypes.guess_type(files[path])[0])
            self.send({"error": "Not found"}, status=404)

        def do_POST(self):
            path = urlparse(self.path).path
            origin = self.headers.get("Origin")
            if (origin and origin != f"http://{self.headers.get('Host')}") or self.headers.get("Content-Type") != "application/json":
                return self.send({"error": "Same-origin JSON requests only"}, status=403)
            if path.startswith("/api/model-review/"):
                if review is None:
                    return self.send({"error": "Model review is not configured"}, status=503)
                try:
                    upload = path == "/api/model-review/upload"
                    key = path.rsplit("/", 1)[-1]
                    if not upload and (not path.startswith("/api/model-review/save/") or key not in review.frames):
                        return self.send({"error": "Unknown review photo"}, status=404)
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= (25000000 if upload else 300000):
                        raise ValueError("Invalid request size")
                    payload = json.loads(self.rfile.read(length))
                    return self.send(review.upload(payload) if upload else review.save(key, payload))
                except RuntimeError as error:
                    return self.send({"error": str(error)}, status=409)
                except (ValueError, TypeError) as error:
                    return self.send({"error": str(error)}, status=400)
            key = path.removeprefix("/api/label/")
            if path != "/api/draft-backup" and (not path.startswith("/api/label/") or key not in store.frames):
                return self.send({"error": "Unknown frame"}, status=404)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= (2000000 if path == "/api/draft-backup" else 200000):
                    raise ValueError("Invalid request size")
                payload = json.loads(self.rfile.read(length))
                self.send(store.backup_browser_drafts(payload) if path == "/api/draft-backup" else store.save(key, payload))
            except RuntimeError as error:
                self.send({"error": str(error)}, status=409)
            except (ValueError, TypeError) as error:
                self.send({"error": str(error)}, status=400)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--queue", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True, help="release root the queue was built from")
    parser.add_argument("--journal", type=Path, default=ROOT / ".artifacts/card-geometry/archive-corner-labels/journal.jsonl")
    parser.add_argument("--scene-slice", action="append", default=None, help="restrict to these queue slices")
    parser.add_argument("--canonical-corpus-sha256", help="overrides the queue's canonical corpus hash binding")
    parser.add_argument("--export", type=Path, help="write the sidecar from the journal and exit")
    parser.add_argument("--port", type=int, default=8768)
    parser.add_argument("--model-review-config", type=Path, help="enable the trained-model review and upload view")
    parser.add_argument("--default-reviewer", default=getpass.getuser(),
                        help="reviewer recorded when the browser sends no name (default: local account name)")
    args = parser.parse_args()
    store = Store(args.queue, args.release, args.journal, args.scene_slice, args.canonical_corpus_sha256,
                  args.default_reviewer)
    if args.export:
        sidecar = store.export()
        args.export.parent.mkdir(parents=True, exist_ok=True)
        args.export.write_text(json.dumps(sidecar, indent=2, sort_keys=True) + "\n")
        print(json.dumps({"frames": len(sidecar["frames"]), "targets": sum(len(f["instances"]) for f in sidecar["frames"]),
                          "canonicalCorpusSha256": sidecar["canonicalCorpusSha256"]}))
        return
    progress = store.progress()
    print(f"Label {progress['targets']} targets in {progress['frames']} frames at http://127.0.0.1:{args.port}; journal: {args.journal}", flush=True)
    review = None
    if args.model_review_config:
        from model_review import ReviewStore
        review = ReviewStore(args.model_review_config)
        print(f"Try trained model: http://localhost:{args.port}/model-review.html", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), handler(store, review)).serve_forever()


if __name__ == "__main__":
    main()
