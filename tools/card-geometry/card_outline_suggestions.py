"""Local SAM 2.1 proposals. Inference never writes review labels or source photos."""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from pathlib import Path
from threading import Lock, Thread
from time import monotonic
from uuid import uuid4

MODEL_ID = "facebook/sam2.1-hiera-large"
MODEL_REVISION = "665f8e2ad61cf5f53d65644ff27c8ee525124610"


def masks_to_suggestions(masks, scores):
    """Keep straight, nearly complete outlines; reject bites, tiny details and repeats."""
    import cv2
    import numpy as np
    from polygon_quad_fit import ADAPTER_ID, fit_polygon_quad
    from reference_geometry import polygon_area, quad_iou

    rejected = Counter()
    fitted = []
    for mask, score in zip(masks, scores):
        mask = np.asarray(mask, dtype=np.uint8)
        height, width = mask.shape
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            rejected["empty"] += 1
            continue
        contour = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(contour)
        if not 0.005 <= area / mask.size <= 0.95:
            rejected["size"] += 1
            continue
        quad, reason, metrics = fit_polygon_quad([tuple(map(float, p)) for p in contour[:, 0, :]])
        if quad is None:
            rejected[reason] += 1
            continue
        if any(x < -0.4 * width or x > 1.4 * width or y < -0.4 * height or y > 1.4 * height for x, y in quad):
            rejected["outsideBounds"] += 1
            continue
        fitted.append({"quad": [[x / width, y / height] for x, y in quad],
                       "score": float(score), "cornerSource": "maskFit",
                       "cornerFit": ADAPTER_ID, "metrics": metrics})

    kept = []
    # Whole cards before art/text rectangles. Do not turn a partial mask into an
    # amodal card by fitting a minimum-area rectangle around the visible fragment.
    for candidate in sorted(fitted, key=lambda c: polygon_area(c["quad"]), reverse=True):
        quad = candidate["quad"]
        if any(quad_iou(quad, other["quad"]) >= 0.8 for other in kept):
            rejected["duplicate"] += 1
            continue
        if any(all(cv2.pointPolygonTest(np.asarray(other["quad"], dtype=np.float32), tuple(p), False) >= 0
                   for p in quad) for other in kept):
            rejected["interiorDetail"] += 1
            continue
        kept.append(candidate)
    # Readable photo order, independent of model score or printed orientation.
    kept.sort(key=lambda c: (round(sum(p[1] for p in c["quad"]) / 4, 1), sum(p[0] for p in c["quad"])))
    return {"candidates": kept[:64], "maskCount": len(masks), "rejected": dict(rejected)}


class LocalOutlineModel:
    def __init__(self):
        self.generator = None
        self.device = None

    def __call__(self, image_path, report):
        import torch
        from PIL import Image
        from transformers import pipeline

        started = monotonic()
        if self.generator is None:
            report("Loading SAM 2.1 Large locally…")
            self.device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
            self.generator = pipeline("mask-generation", model=MODEL_ID,
                                      revision=MODEL_REVISION, device=self.device)
        with Image.open(image_path) as source:
            image = source.convert("RGB")
        # Bound postprocessing memory without altering the source file. The
        # returned coordinates are fractions of this same uncropped photo.
        image.thumbnail((1280, 1280))
        report(f"Finding regions with SAM 2.1 Large ({self.device})…")
        with torch.inference_mode():
            output = self.generator(image, points_per_crop=16, points_per_batch=16,
                                    pred_iou_thresh=0.85, stability_score_thresh=0.90)
        report("Fitting card corners and removing duplicate regions…")
        result = masks_to_suggestions(output["masks"], output["scores"])
        return {**result, "model": MODEL_ID, "revision": MODEL_REVISION,
                "device": self.device, "seconds": round(monotonic() - started, 1)}


class SuggestionBusyError(Exception):
    pass


class OutlineSuggestionJobs:
    """One local inference at a time, with bounded, in-memory review results."""

    def __init__(self, runner=None):
        self.runner = runner or LocalOutlineModel()
        self.lock = Lock()
        self.jobs = {}
        self.active = None

    def start(self, sample_id: str, image_path: Path):
        with self.lock:
            if self.active:
                job = self.jobs[self.active]
                if job["sampleId"] == sample_id:
                    return deepcopy(job)
                raise SuggestionBusyError("Another photo is being processed. Try again when it finishes.")
            while len(self.jobs) >= 12:
                del self.jobs[next(iter(self.jobs))]
            job_id = uuid4().hex
            job = {"id": job_id, "sampleId": sample_id, "status": "running",
                   "message": "Starting local card suggestions…"}
            self.jobs[job_id] = job
            self.active = job_id
            snapshot = deepcopy(job)
        Thread(target=self._run, args=(job_id, image_path), daemon=True).start()
        return snapshot

    def get(self, job_id):
        with self.lock:
            return deepcopy(self.jobs[job_id])

    def _run(self, job_id, image_path):
        def report(message):
            with self.lock:
                self.jobs[job_id]["message"] = message
        try:
            result = self.runner(image_path, report)
            terminal = {"status": "complete", "result": result, "message": "Suggestions ready"}
        except Exception as error:
            terminal = {"status": "error", "message": f"Local segmentation failed: {error}"}
        with self.lock:
            self.jobs[job_id].update(terminal)
            self.active = None
