"""Local model review, isolated from immutable benchmarks and training labels."""
from __future__ import annotations

import base64
import copy
import getpass
import hashlib
import io
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def normalized_image(data):
    """One EXIF-aware pixel contract for uploads and duplicate detection."""
    try:
        with Image.open(io.BytesIO(data)) as opened:
            if opened.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Use a JPEG, PNG, or WebP photo")
            if opened.width * opened.height > 60_000_000:
                raise ValueError("Photo is too large (maximum 60 megapixels)")
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            image.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("This file could not be read as a photo") from error
    if min(image.size) < 32:
        raise ValueError("Photo must be at least 32 pixels on each side")
    return image


def fingerprints(image):
    # Grayscale dHash also groups color/black-and-white copies conservatively.
    small = list(image.convert("L").resize((9, 8)).getdata())
    bits = sum((small[y * 9 + x] > small[y * 9 + x + 1]) << (y * 8 + x)
               for y in range(8) for x in range(8))
    return {"pixelSha256": sha(str(image.size).encode() + image.tobytes()),
            "dHash": f"{bits:016x}"}


def cards_from_results(results):
    return [{"id": f"C{i + 1}", "corners": [[c["point"]["x"], c["point"]["y"]]
             for c in result["corners"]], "confidence": result["confidence"],
             "excluded": False, "orientationKnown": False, "occluded": False,
             "expectedCard": ""} for i, result in enumerate(results)]


class LocalPredictor:
    def __init__(self, checkpoint, digest):
        if sha(checkpoint.read_bytes()) != digest:
            raise ValueError("Trained checkpoint does not match its recorded SHA-256")
        from ultralytics import YOLO
        from evaluate_geometry_candidate import Predictor
        # Reuse the frozen evaluator's BGR input, 192px context and decoder.
        self.predictor = Predictor.__new__(Predictor)
        self.predictor.candidate = "yolo11s-pose"
        self.predictor.artifact_sha256 = digest
        self.predictor.resolution = 640
        self.predictor.yolo_input_color = "bgr"
        self.predictor.model = YOLO(str(checkpoint)).to("cpu")

    def __call__(self, path):
        return self.predictor(path)


class ReviewStore:
    def __init__(self, config_path, predictor=None):
        self.config = json.loads(config_path.read_text())
        self.root = Path(self.config["storage"])
        self.root.mkdir(parents=True, exist_ok=True)
        self.model_sha = self.config["modelSha256"]
        self.lock = threading.RLock()
        self.inference_lock = threading.Lock()
        self.predictor = predictor
        catalog_path = Path(self.config["catalog"])
        if sha(catalog_path.read_bytes()) != self.config["catalogSha256"]:
            raise ValueError("Model review catalog hash mismatch")
        catalog = json.loads(catalog_path.read_text())
        if catalog["modelSha256"] != self.model_sha:
            raise ValueError("Review catalog belongs to another checkpoint")
        self.frames = {f["id"]: f for f in catalog["frames"]}
        self.comparison = None
        self.comparison_frames = {}
        if self.config.get("comparison"):
            comparison_path = Path(self.config["comparison"])
            if sha(comparison_path.read_bytes()) != self.config["comparisonSha256"]:
                raise ValueError("Comparison report hash mismatch")
            self.comparison = json.loads(comparison_path.read_text())
            if (self.comparison["modelSha256"] != self.model_sha
                    or self.comparison["catalogSha256"] != self.config["catalogSha256"]):
                raise ValueError("Comparison does not match the review inputs")
            self.comparison_frames = {f["id"]: f for f in self.comparison["frames"]}
        self.protected_hashes = set(catalog.get("protectedImageHashes", []))
        for path in sorted((self.root / "uploads").glob("*/frame.json")):
            frame = json.loads(path.read_text())
            if frame["modelSha256"] != self.model_sha:
                raise ValueError("Uploads belong to a different model; use a separate review storage directory")
            self.frames[frame["id"]] = frame
        self.saved = {}
        self.journal = self.root / "reviews.jsonl"
        if self.journal.exists():
            for line in self.journal.read_text().splitlines():
                row = json.loads(line)
                frame = self.frames.get(row["id"])
                if (not frame or row["modelSha256"] != self.model_sha
                        or row["imageSha256"] != frame["imageSha256"]):
                    raise ValueError("Review journal image/model binding mismatch")
                self.saved[row["id"]] = row

    def summary(self):
        with self.lock:
            return {"model": self.config["modelName"], "modelSha256": self.model_sha,
                    "comparison": {k: v for k, v in self.comparison.items() if k != "frames"} if self.comparison else None,
                    "starter": self.config["starter"], "frames": [
                        {k: f.get(k) for k in ("id", "reference", "name", "scene", "kind", "warning", "metrics")}
                        | {"cards": len(f["proposals"]), "status": self.saved.get(f["id"], {}).get("verdict", "unreviewed"),
                           "comparisonStatus": self.comparison_frames.get(f["id"], {}).get("current", {}).get("status"),
                           "comparisonBasis": self.comparison_frames.get(f["id"], {}).get("current", {}).get("basis")}
                        for f in self.frames.values()]}

    def frame(self, key):
        with self.lock:
            if key not in self.frames:
                raise KeyError(key)
            return copy.deepcopy({k: v for k, v in self.frames[key].items() if k != "imagePath"}
                                 | {"review": self.saved.get(key), "modelSha256": self.model_sha,
                                    "comparison": self.comparison_frames.get(key)})

    def image(self, key):
        frame = self.frames[key]
        path = Path(frame["imagePath"])
        data = path.read_bytes()
        if sha(data) != frame["imageSha256"]:
            raise ValueError("Review image hash mismatch")
        return data, "image/png" if path.suffix == ".png" else "image/jpeg"

    def save(self, key, payload):
        from archive_corner_label_server import validate_label_quad
        if not isinstance(payload, dict):
            raise ValueError("Review must be an object")
        with self.lock:
            frame = self.frames[key]
            revision = self.saved.get(key, {}).get("revision", 0)
            if type(payload.get("revision")) is not int or payload["revision"] != revision:
                raise RuntimeError("This photo was saved elsewhere. Reload it before saving your edits.")
            if payload.get("imageSha256") != frame["imageSha256"] or payload.get("modelSha256") != self.model_sha:
                raise ValueError("Review image/model does not match")
            verdict = payload.get("verdict")
            if verdict not in {"approved", "needs-work", "unsure", "draft"}:
                raise ValueError("Choose a review status")
            notes = payload.get("notes", "")
            cards = payload.get("cards")
            if not isinstance(notes, str) or len(notes) > 10000:
                raise ValueError("Notes must be at most 10,000 characters")
            if not isinstance(cards, list) or len(cards) > 150:
                raise ValueError("Expected at most 150 cards")
            clean, ids = [], set()
            for card in cards:
                if not isinstance(card, dict) or not re.fullmatch(r"C[1-9][0-9]{0,3}", str(card.get("id", ""))):
                    raise ValueError("Invalid card reference")
                if card["id"] in ids:
                    raise ValueError("Duplicate card reference")
                ids.add(card["id"])
                validate_label_quad(card.get("corners"))
                for flag in ("excluded", "orientationKnown", "occluded"):
                    if type(card.get(flag)) is not bool:
                        raise ValueError(f"Invalid {flag} value")
                name = card.get("expectedCard", "")
                if not isinstance(name, str) or len(name) > 300:
                    raise ValueError("Card name/number must be at most 300 characters")
                clean.append({k: copy.deepcopy(card[k]) for k in
                              ("id", "corners", "excluded", "orientationKnown", "occluded")} | {"expectedCard": name})
            if not {c["id"] for c in frame["proposals"]}.issubset(ids):
                raise ValueError("Keep original card references; mark an extra detection as not a card")
            row = {"schema": "tcger-model-review/v1", "id": key, "revision": revision + 1,
                   "modelSha256": self.model_sha, "imageSha256": frame["imageSha256"],
                   "kind": frame["kind"], "verdict": verdict, "cards": clean, "notes": notes,
                   "reviewer": getpass.getuser(), "savedAt": datetime.now(timezone.utc).isoformat()}
            with self.journal.open("a") as handle:
                handle.write(json.dumps(row) + "\n")
                handle.flush()
                import os
                os.fsync(handle.fileno())
            self.saved[key] = row
            return copy.deepcopy(row)

    def upload(self, payload):
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), str):
            raise ValueError("Upload must contain a base64 photo")
        session = payload.get("session", "")
        if not isinstance(session, str) or not 1 <= len(session.strip()) <= 120:
            raise ValueError("Enter a collection session name (up to 120 characters)")
        name = payload.get("name", "photo")
        if not isinstance(name, str) or len(name) > 300:
            raise ValueError("Invalid photo name")
        try:
            raw = base64.b64decode(payload["data"], validate=True)
        except ValueError as error:
            raise ValueError("Invalid photo encoding") from error
        if len(raw) > 18_000_000:
            raise ValueError("Maximum photo size is 18 MB")
        image = normalized_image(raw)
        fp, raw_hash = fingerprints(image), sha(raw)
        with self.inference_lock:
            with self.lock:
                frames = list(self.frames.values())
            exact = next((f for f in frames if f.get("pixelSha256") == fp["pixelSha256"]
                          or f["imageSha256"] == raw_hash or f.get("originalSha256") == raw_hash), None)
            if exact:
                return {"id": exact["id"], "duplicate": True, "message": "This photo is already in the review library"}
            near = next((f for f in frames if f.get("dHash") and
                         (int(f["dHash"], 16) ^ int(fp["dHash"], 16)).bit_count() <= 4), None)
            known = raw_hash in self.protected_hashes
            warning = (f"Possible copy of {near['reference']}; excluded from training export pending duplicate review."
                       if near else "Already belongs to an existing dataset; excluded from training export." if known else "")
            key = "upload-" + fp["pixelSha256"]
            folder = self.root / "uploads" / key
            folder.mkdir(parents=True, exist_ok=True)
            image_path = folder / "image.png"
            image.save(image_path)
            if self.predictor is None:
                self.predictor = LocalPredictor(Path(self.config["checkpoint"]), self.model_sha)
            predictions = self.predictor(image_path)
            with self.lock:
                frame = {"id": key, "reference": f"U{1 + sum(f['kind'] == 'upload' for f in self.frames.values()):03d}",
                         "name": Path(name).name, "scene": "new_photo", "kind": "upload", "session": session.strip(),
                         "imagePath": str(image_path), "imageSha256": sha(image_path.read_bytes()),
                         "originalSha256": raw_hash, **fp, "width": image.width, "height": image.height,
                         "modelSha256": self.model_sha, "warning": warning,
                         "trainingCandidateEligible": not bool(near or known), "relatedTo": near["id"] if near else None,
                         "proposals": cards_from_results(predictions), "previous": [], "referencePolygons": []}
                write_json(folder / "predictions.json", predictions)
                write_json(folder / "frame.json", frame)
                self.frames[key] = frame
            return {"id": key, "duplicate": False, "message": warning or "Photo ready to review"}

    def export(self):
        with self.lock:
            frames = []
            for key, review in self.saved.items():
                frame = self.frames[key]
                if (frame["kind"] != "upload" or review["verdict"] != "approved"
                        or not frame.get("trainingCandidateEligible")):
                    continue
                frames.append({k: copy.deepcopy(frame[k]) for k in
                               ("id", "reference", "imageSha256", "originalSha256", "session", "width", "height")}
                              | {"imagePath": frame["imagePath"], "review": copy.deepcopy(review)})
            return {"schema": "tcger-model-review-training-candidates/v1", "modelSha256": self.model_sha,
                    "notice": "Candidates only. Group sessions/near-duplicates and assign a frozen split before ingestion. Benchmark feedback is excluded. Images remain on this computer.",
                    "frames": frames}
