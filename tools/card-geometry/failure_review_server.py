#!/usr/bin/env python3
"""Local, append-only human comparison of pinned geometry diagnostic outputs."""

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
STATIC = Path(__file__).with_name("failure-review")
DEFAULT_AUDIT = ROOT / "docs/scanner-system/benchmarks/2026-09-06-real-failure-audit"
CHOICES = {"yolox-pose", "yolo11s-pose", "tie", "neither", "unsure", "labels-only"}
ISSUES = {
    "missed-card",
    "extra-outline",
    "bad-corners",
    "wrong-crop",
    "wrong-identity",
    "slab-vs-card",
    "partial-card-label",
    "missing-label",
    "uncertain",
}
SCENES = {
    "single_card_archive",
    "single_handheld",
    "binder_page",
    "duel_field",
    "steep_playmat",
    "other",
    "uncertain",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_review(payload):
    if not isinstance(payload, dict):
        raise ValueError("Review must be an object")
    reviewer = payload.get("reviewer")
    if not isinstance(reviewer, str) or not 1 <= len(reviewer.strip()) <= 120:
        raise ValueError("Enter your reviewer name")
    if payload.get("winner") not in CHOICES:
        raise ValueError("Choose a comparison result")
    if payload.get("scene") not in SCENES:
        raise ValueError("Choose a scene")
    issues = payload.get("issues")
    if not isinstance(issues, list) or any(
        not isinstance(x, str) or x not in ISSUES for x in issues
    ):
        raise ValueError("Invalid issue selection")
    notes = payload.get("notes", "")
    if not isinstance(notes, str) or len(notes) > 10000:
        raise ValueError("Notes must be at most 10,000 characters")
    quads = payload.get("quads")
    if not isinstance(quads, list) or len(quads) > 100:
        raise ValueError("Invalid card outlines")
    for quad in quads:
        if not isinstance(quad, list) or len(quad) != 4:
            raise ValueError("Each outline needs four corners")
        for point in quad:
            if (
                not isinstance(point, list)
                or len(point) != 2
                or any(
                    type(x) not in (float, int)
                    or not math.isfinite(x)
                    or not -0.5 <= x <= 1.5
                    for x in point
                )
            ):
                raise ValueError(
                    "Corners must be finite image coordinates within the editing margin"
                )
        crosses = []
        for i, a in enumerate(quad):
            b, c = quad[(i + 1) % 4], quad[(i + 2) % 4]
            crosses.append(
                (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            )
        if not (all(x > 1e-8 for x in crosses) or all(x < -1e-8 for x in crosses)):
            raise ValueError("An outline crosses itself or has collapsed corners")
    return {k: payload[k] for k in ("winner", "scene", "issues", "quads")} | {
        "reviewer": reviewer.strip(),
        "notes": notes,
    }


class Store:
    def __init__(self, audit, images, training, journal):
        self.journal, self.lock = journal, threading.Lock()
        inputs = audit / "audit-inputs.json"
        samples = json.loads(inputs.read_text())["samples"]
        self.samples = {
            s["recordId"]: dict(s, imageFile=images / s["imagePath"], models={})
            for s in samples
        }
        self.pins = {"inputSha256": digest(inputs), "reports": {}}
        for candidate, filename in [
            ("yolox-pose", "yolox-raw-audit.json"),
            ("yolo11s-pose", "yolo11s-raw-audit.json"),
        ]:
            path = audit / filename
            report = json.loads(path.read_text())
            if report["inputSha256"] != self.pins["inputSha256"]:
                raise ValueError(f"{candidate}: audit input hash mismatch")
            self.pins["reports"][candidate] = {
                "sha256": digest(path),
                "checkpointSha256": report["checkpointSha256"],
            }
            for row in report["rows"]:
                if row["variant"] == "frozen":
                    self.samples[row["recordId"]]["models"][candidate] = row
            replay = json.loads(
                (
                    audit / "frozen-outputs" / candidate / "recognition-replay.json"
                ).read_text()
            )
            for row in replay["frames"]:
                if row["recordId"] in self.samples:
                    self.samples[row["recordId"]]["models"][candidate][
                        "recognition"
                    ] = row
        selection = audit / "real-training-review-samples.json"
        if selection.exists():
            for selected in json.loads(selection.read_text()):
                path = training / selected["path"]
                record = json.loads(path.read_text())
                s = dict(
                    recordId=selected["recordId"],
                    scope="training-labels",
                    sceneSlice="single_card_archive",
                    sourceKind="real",
                    sourceArchive=selected["sourceArchive"],
                    instances=record["instances"],
                    imageFile=training / record["source"]["path"],
                    imageSha256=record["source"]["sha256"],
                    recordSha256=digest(path),
                    models={},
                )
                from PIL import Image

                with Image.open(s["imageFile"]) as image:
                    s["width"], s["height"] = image.size
                self.samples[s["recordId"]] = s
        self.saved = {}
        if journal.exists():
            for line in journal.read_text().splitlines():
                row = json.loads(line)
                if row["pins"] != self.pins:
                    raise ValueError(
                        "Journal belongs to different diagnostic inputs; use another journal"
                    )
                self.saved[row["recordId"]] = row
        # Fail before showing any image if local bytes do not match the frozen source.
        for s in self.samples.values():
            if digest(s["imageFile"]) != s["imageSha256"]:
                raise ValueError(f"Image hash mismatch: {s['recordId']}")
        self.order = sorted(
            self.samples,
            key=lambda key: (
                {
                    "binder_page": 0,
                    "duel_field": 1,
                    "single_handheld": 2,
                    "steep_playmat": 3,
                }.get(self.samples[key]["sceneSlice"], 4),
                key,
            ),
        )

    def save(self, key, payload):
        s = self.samples[key]
        review = validate_review(payload)
        with self.lock:
            revision = self.saved.get(key, {}).get("revision", 0)
            if payload.get("revision") != revision:
                raise RuntimeError(
                    "This review changed in another tab. Reload before saving."
                )
            row = dict(
                schema="tcger-geometry-human-review/v1",
                recordId=key,
                scope=s["scope"],
                imageSha256=s["imageSha256"],
                recordSha256=s["recordSha256"],
                pins=self.pins,
                revision=revision + 1,
                savedAt=datetime.now(timezone.utc).isoformat(),
                **review,
            )
            self.journal.parent.mkdir(parents=True, exist_ok=True)
            with self.journal.open("a") as stream:
                stream.write(json.dumps(row, allow_nan=False) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            self.saved[key] = row
            return row


def handler(store):
    class Handler(BaseHTTPRequestHandler):
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
            if path == "/api/samples":
                return self.send(
                    [
                        dict(
                            id=k,
                            scope=store.samples[k]["scope"],
                            scene=store.samples[k]["sceneSlice"],
                            reviewed=k in store.saved,
                        )
                        for k in store.order
                    ]
                )
            if path == "/api/export":
                return self.send(
                    dict(pins=store.pins, reviews=list(store.saved.values()))
                )
            if path.startswith("/api/sample/") or path.startswith("/image/"):
                key = path.rsplit("/", 1)[-1]
                if key not in store.samples:
                    return self.send({"error": "Unknown record"}, status=404)
                s = store.samples[key]
                if path.startswith("/image/"):
                    return self.send(
                        s["imageFile"].read_bytes(),
                        mimetypes.guess_type(s["imageFile"])[0]
                        or "application/octet-stream",
                    )
                return self.send(
                    {k: v for k, v in s.items() if k != "imageFile"}
                    | {"review": store.saved.get(key)}
                )
            files = {
                "/": STATIC / "index.html",
                "/review.js": STATIC / "review.js",
                "/review.css": STATIC / "review.css",
                "/geometry.js": STATIC.parent / "corner-editor/geometry.js",
            }
            if path in files:
                return self.send(
                    files[path].read_bytes(), mimetypes.guess_type(files[path])[0]
                )
            self.send({"error": "Not found"}, status=404)

        def do_POST(self):
            path = urlparse(self.path).path
            origin = self.headers.get("Origin")
            if (
                origin and origin != f"http://{self.headers.get('Host')}"
            ) or self.headers.get("Content-Type") != "application/json":
                return self.send(
                    {"error": "Same-origin JSON requests only"}, status=403
                )
            key = path.removeprefix("/api/review/")
            if not path.startswith("/api/review/") or key not in store.samples:
                return self.send({"error": "Unknown record"}, status=404)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 100000:
                    raise ValueError("Invalid request size")
                result = store.save(key, json.loads(self.rfile.read(length)))
                self.send(result)
            except RuntimeError as error:
                self.send({"error": str(error)}, status=409)
            except (ValueError, TypeError) as error:
                self.send({"error": str(error)}, status=400)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", type=Path, default=DEFAULT_AUDIT)
    parser.add_argument(
        "--images",
        type=Path,
        default=ROOT / ".artifacts/card-geometry/failure-audit-inputs",
    )
    parser.add_argument(
        "--training",
        type=Path,
        default=ROOT
        / ".artifacts/card-geometry/releases/card-geometry-training-round-two-v1",
    )
    parser.add_argument(
        "--journal",
        type=Path,
        default=ROOT / ".artifacts/card-geometry/human-failure-review/reviews.jsonl",
    )
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()
    store = Store(args.audit, args.images, args.training, args.journal)
    print(
        f"Review {len(store.samples)} images at http://127.0.0.1:{args.port}; journal: {args.journal}",
        flush=True,
    )
    ThreadingHTTPServer(("127.0.0.1", args.port), handler(store)).serve_forever()


if __name__ == "__main__":
    main()
