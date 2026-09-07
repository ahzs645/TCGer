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

ROOT = Path(__file__).resolve().parents[2]
STATIC = Path(__file__).with_name("archive-labeler")
SIDECAR_SCHEMA = "https://tcger.app/schemas/card-geometry-archive-corner-labels/v1"
JOURNAL_SCHEMA = "tcger-archive-corner-labels-journal/v1"
SKIP_REASONS = {"occluded", "not-a-card", "cut-off", "unsure"}
VISIBILITIES = {"visible", "occluded", "outsideFrame"}
MIN_SEED_BOX_IOU = 0.5


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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


def validate_save(frame, payload):
    """Return the journal-ready label body for one frame or raise ValueError."""
    if not isinstance(payload, dict):
        raise ValueError("Label must be an object")
    reviewer = payload.get("reviewer")
    if not isinstance(reviewer, str) or not 1 <= len(reviewer.strip()) <= 120:
        raise ValueError("Enter your reviewer name")
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
        quad = value.get("corners")
        validate_quad(quad)
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
        labeled[key] = {"corners": [[float(x), float(y)] for x, y in quad],
                        "cornerVisibility": list(visibility), "orientationKnown": orientation}
    complete = all(str(t["sourceAnnotationIndex"]) in labeled for t in frame["instances"])
    direction = payload.get("direction", 0)
    if direction not in (0, 1, 2, 3):
        raise ValueError("direction must be 0, 1, 2 or 3 quarter turns")
    return {"reviewer": reviewer.strip(), "notes": notes, "targets": labeled, "complete": complete, "direction": direction}


class Store:
    def __init__(self, queue_path: Path, release: Path, journal: Path, scene_slices=None,
                 canonical_corpus_sha256: str | None = None):
        self.journal, self.lock = journal, threading.Lock()
        queue = json.loads(queue_path.read_text())
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
            self.frames[frame["recordId"]] = dict(frame, imageFile=image)
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
        labeled = sum(sum(1 for t in r["targets"].values() if "corners" in t) for r in self.saved.values())
        skipped = sum(sum(1 for t in r["targets"].values() if "skip" in t) for r in self.saved.values())
        return {"frames": len(self.frames), "framesComplete": frames_done, "targets": targets,
                "targetsLabeled": labeled, "targetsSkipped": skipped}

    def save(self, key, payload):
        frame = self.frames[key]
        body = validate_save(frame, payload)
        with self.lock:
            revision = self.saved.get(key, {}).get("revision", 0)
            if payload.get("revision") != revision:
                raise RuntimeError("This frame changed in another tab. Reload before saving.")
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

    def export(self):
        """Completed frames as an archive corner-label sidecar (skipped targets omitted)."""
        frames = []
        for key in self.order:
            row = self.saved.get(key)
            if not row or not row["complete"]:
                continue
            instances = [
                {"sourceAnnotationIndex": int(index), "corners": t["corners"],
                 "cornerVisibility": t["cornerVisibility"], "orientationKnown": t["orientationKnown"]}
                for index, t in sorted(row["targets"].items(), key=lambda kv: int(kv[0])) if "corners" in t
            ]
            if not instances:
                continue
            frames.append({"canonicalRecordId": row["canonicalRecordId"], "imageSha256": row["imageSha256"],
                           "reviewer": row["reviewer"], "labeledAt": row["savedAt"], "instances": instances})
        return {"schema": SIDECAR_SCHEMA, "canonicalCorpusSha256": self.canonical_corpus_sha, "frames": frames}


def handler(store):
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
            if path == "/api/frames":
                return self.send({
                    "pins": store.pins, "progress": store.progress(),
                    "frames": [dict(id=k, scene=store.frames[k]["sceneSlice"], archive=store.frames[k]["sourceArchiveId"],
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
                     "/labeler.css": STATIC / "labeler.css", "/geometry.js": STATIC.parent / "corner-editor/geometry.js"}
            if path in files:
                return self.send(files[path].read_bytes(), mimetypes.guess_type(files[path])[0])
            self.send({"error": "Not found"}, status=404)

        def do_POST(self):
            path = urlparse(self.path).path
            origin = self.headers.get("Origin")
            if (origin and origin != f"http://{self.headers.get('Host')}") or self.headers.get("Content-Type") != "application/json":
                return self.send({"error": "Same-origin JSON requests only"}, status=403)
            key = path.removeprefix("/api/label/")
            if not path.startswith("/api/label/") or key not in store.frames:
                return self.send({"error": "Unknown frame"}, status=404)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 200000:
                    raise ValueError("Invalid request size")
                self.send(store.save(key, json.loads(self.rfile.read(length))))
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
    args = parser.parse_args()
    store = Store(args.queue, args.release, args.journal, args.scene_slice, args.canonical_corpus_sha256)
    if args.export:
        sidecar = store.export()
        args.export.parent.mkdir(parents=True, exist_ok=True)
        args.export.write_text(json.dumps(sidecar, indent=2, sort_keys=True) + "\n")
        print(json.dumps({"frames": len(sidecar["frames"]), "targets": sum(len(f["instances"]) for f in sidecar["frames"]),
                          "canonicalCorpusSha256": sidecar["canonicalCorpusSha256"]}))
        return
    progress = store.progress()
    print(f"Label {progress['targets']} targets in {progress['frames']} frames at http://127.0.0.1:{args.port}; journal: {args.journal}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), handler(store)).serve_forever()


if __name__ == "__main__":
    main()
