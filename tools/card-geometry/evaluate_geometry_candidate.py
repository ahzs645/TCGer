#!/usr/bin/env python3
"""Emit portable predictions and frozen geometry reports for one candidate."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from export_geometry_candidate import find_one
from reference_geometry import process_candidates
from train_fastvit_four_corner import letterbox_geometry
from train_yolo_pose import load_json, sha256_file


CONTEXT_MARGIN = {"left": 192, "top": 192, "right": 192, "bottom": 192}
DECODER_CONFIG = {
    "minimumConfidence": 0.05,
    "minimumQuadArea": 0.001,
    "exteriorMargin": 0.25,
    "nmsIouThreshold": 0.5,
    "aspectRatioBands": {
        "rawCard": [0.5, 3.0],
        "slab": [0.5, 3.0],
        "unknown": [0.5, 3.0],
    },
}


def padded_image(source: Path) -> tuple[Image.Image, int, int]:
    with Image.open(source) as opened:
        image = opened.convert("RGB")
    width, height = image.size
    padded = Image.new(
        "RGB",
        (
            width + CONTEXT_MARGIN["left"] + CONTEXT_MARGIN["right"],
            height + CONTEXT_MARGIN["top"] + CONTEXT_MARGIN["bottom"],
        ),
        (0, 0, 0),
    )
    padded.paste(image, (CONTEXT_MARGIN["left"], CONTEXT_MARGIN["top"]))
    return padded, width, height


def source_point(x: float, y: float, width: int, height: int) -> dict[str, float]:
    return {
        "x": (x - CONTEXT_MARGIN["left"]) / width,
        "y": (y - CONTEXT_MARGIN["top"]) / height,
    }


def candidate_result(
    points: list[tuple[float, float]], confidence: float, corner_confidences: list[float]
) -> dict[str, Any]:
    return {
        "corners": [
            {"point": {"x": float(x), "y": float(y)}, "confidence": float(corner_confidence)}
            for (x, y), corner_confidence in zip(points, corner_confidences)
        ],
        "confidence": float(confidence),
        "cornerOrderConfidence": None,
        "side": "unknown",
        "container": "rawCard",
    }


class Predictor:
    def __init__(self, candidate: str, output: Path, artifact_sha256: str, resolution: int) -> None:
        self.candidate = candidate
        self.output = output
        self.artifact_sha256 = artifact_sha256
        self.resolution = resolution
        if candidate.startswith("yolo11"):
            from ultralytics import YOLO

            checkpoint = find_one(output, ("training/repeat-0/weights/best.pt", "**/weights/best.pt"))
            self.model = YOLO(str(checkpoint))
        elif candidate == "fastvit-t8-four-corner":
            import torch

            from export_geometry_candidate import load_fastvit

            checkpoint = find_one(output, ("training/repeat-0/best.pt", "**/best.pt"))
            self.model = load_fastvit(checkpoint).cuda()
            self.model.eval()
            self.torch = torch
        else:
            from mmdet.apis import init_detector

            checkpoint = find_one(output, ("training/repeat-0/*.pth", "**/*.pth"))
            config = find_one(output, ("yolox-pose-card.py", "**/yolox-pose-card.py"))
            self.model = init_detector(str(config), str(checkpoint), device="cuda:0")

    def predict_yolo(self, image: Image.Image, width: int, height: int) -> list[dict[str, Any]]:
        result = self.model.predict(
            source=np.asarray(image),
            imgsz=self.resolution,
            conf=0.01,
            iou=0.99,
            max_det=100,
            verbose=False,
        )[0]
        if result.keypoints is None or result.boxes is None:
            return []
        coordinates = result.keypoints.xy.detach().cpu().numpy()
        keypoint_confidence = result.keypoints.conf
        confidences = result.boxes.conf.detach().cpu().numpy()
        rows = []
        for index, points in enumerate(coordinates):
            if len(points) != 4:
                continue
            corner_scores = (
                keypoint_confidence[index].detach().cpu().numpy().tolist()
                if keypoint_confidence is not None
                else [float(confidences[index])] * 4
            )
            rows.append(
                candidate_result(
                    [
                        tuple(source_point(float(x), float(y), width, height).values())
                        for x, y in points
                    ],
                    float(confidences[index]),
                    [float(value) for value in corner_scores],
                )
            )
        return rows

    def predict_fastvit(self, image: Image.Image, width: int, height: int) -> list[dict[str, Any]]:
        torch = self.torch
        geometry = letterbox_geometry(width, height, CONTEXT_MARGIN, self.resolution)
        resized = image.resize(
            (int(geometry["resizedWidth"]), int(geometry["resizedHeight"])),
            Image.Resampling.BILINEAR,
        )
        canvas = Image.new("RGB", (self.resolution, self.resolution), (0, 0, 0))
        canvas.paste(resized, (int(geometry["padLeft"]), int(geometry["padTop"])))
        pixels = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1) / 255.0
        pixels = (pixels - np.asarray([0.485, 0.456, 0.406])[:, None, None]) / np.asarray(
            [0.229, 0.224, 0.225]
        )[:, None, None]
        tensor = torch.from_numpy(pixels.astype(np.float32)).unsqueeze(0).cuda()
        with torch.no_grad():
            heatmap_logits, corner_logits = self.model(tensor)
            heatmap = heatmap_logits.sigmoid()
            peaks = heatmap.eq(torch.nn.functional.max_pool2d(heatmap, 3, 1, 1)) * heatmap
            scores, indices = torch.topk(peaks.flatten(), k=min(100, peaks.numel()))
            corners = corner_logits.sigmoid()[0]
        rows = []
        output_width = corners.shape[-1]
        for score, index in zip(scores.detach().cpu().tolist(), indices.detach().cpu().tolist()):
            if score < 0.01:
                break
            y, x = divmod(index, output_width)
            normalized = corners[:, y, x].detach().cpu().numpy().reshape(4, 2)
            points = []
            for normalized_x, normalized_y in normalized:
                model_x = float(normalized_x) * self.resolution
                model_y = float(normalized_y) * self.resolution
                padded_x = (model_x - int(geometry["padLeft"])) / float(geometry["scale"])
                padded_y = (model_y - int(geometry["padTop"])) / float(geometry["scale"])
                mapped = source_point(padded_x, padded_y, width, height)
                points.append((mapped["x"], mapped["y"]))
            rows.append(candidate_result(points, float(score), [float(score)] * 4))
        return rows

    def predict_yolox(self, image: Image.Image, width: int, height: int) -> list[dict[str, Any]]:
        from mmdet.apis import inference_detector

        result = inference_detector(self.model, np.asarray(image))
        predictions = result.pred_instances
        if not hasattr(predictions, "keypoints"):
            return []
        keypoints = predictions.keypoints.detach().cpu().numpy()
        scores = predictions.scores.detach().cpu().numpy()
        keypoint_scores = getattr(predictions, "keypoint_scores", None)
        if keypoint_scores is not None:
            keypoint_scores = keypoint_scores.detach().cpu().numpy()
        rows = []
        for index, points in enumerate(keypoints):
            if len(points) != 4:
                continue
            mapped = [
                tuple(source_point(float(x), float(y), width, height).values())
                for x, y in points
            ]
            corner_scores = (
                keypoint_scores[index].tolist() if keypoint_scores is not None else [scores[index]] * 4
            )
            rows.append(
                candidate_result(mapped, float(scores[index]), [float(value) for value in corner_scores])
            )
        return rows

    def __call__(self, source: Path) -> list[dict[str, Any]]:
        image, width, height = padded_image(source)
        if self.candidate.startswith("yolo11"):
            candidates = self.predict_yolo(image, width, height)
        elif self.candidate == "fastvit-t8-four-corner":
            candidates = self.predict_fastvit(image, width, height)
        else:
            candidates = self.predict_yolox(image, width, height)
        return process_candidates(
            candidates,
            DECODER_CONFIG,
            {"releaseVersion": 1, "artifactSha256": self.artifact_sha256},
        )


def write_predictions(
    release: Path, destination: Path, predictor: Predictor, localizer_id: str
) -> None:
    manifest = load_json(release / "manifest.json")
    with destination.open("w", encoding="utf-8") as handle:
        for entry in manifest["records"]:
            record = load_json(release / entry["path"])
            row = {
                "recordId": entry["recordId"],
                "localizerId": localizer_id,
                "results": predictor(release / record["source"]["path"]),
            }
            handle.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")


def evaluate(candidate: str) -> dict[str, Any]:
    output = Path(os.environ["TCGER_GEOMETRY_OUTPUT_DIR"])
    checkpoint = find_one(
        output,
        (
            "training/repeat-0/weights/best.pt",
            "training/repeat-0/best.pt",
            "training/repeat-0/*.pth",
        ),
    )
    checkpoint_sha = sha256_file(checkpoint)
    predictor = Predictor(
        candidate,
        output,
        checkpoint_sha,
        int(os.environ["TCGER_GEOMETRY_INPUT_RESOLUTION"]),
    )
    evaluation_dir = output / "evaluation"
    evaluation_dir.mkdir()
    results = {}
    for name, root_env, hash_env in (
        ("real-v3", "TCGER_GEOMETRY_EVAL_REAL_ROOT", "TCGER_GEOMETRY_EVAL_REAL_HASH"),
        (
            "synthetic-duel-field",
            "TCGER_GEOMETRY_EVAL_SYNTHETIC_ROOT",
            "TCGER_GEOMETRY_EVAL_SYNTHETIC_HASH",
        ),
    ):
        release = Path(os.environ[root_env])
        predictions = evaluation_dir / f"{name}.predictions.jsonl"
        report = evaluation_dir / f"{name}.benchmark.json"
        write_predictions(release, predictions, predictor, candidate)
        subprocess.run(
            [
                "python",
                "tools/card-geometry/benchmark_geometry.py",
                "--release-root",
                str(release),
                "--predictions",
                str(predictions),
                "--expected-corpus-hash",
                os.environ[hash_env],
                "--tooling-revision",
                os.environ.get("TCGER_GEOMETRY_TOOLING_REVISION", "unknown"),
                "--report",
                str(report),
            ],
            check=True,
        )
        results[name] = {
            "predictionsSha256": sha256_file(predictions),
            "reportSha256": sha256_file(report),
        }
    summary = {
        "schema": "https://tcger.app/reports/card-geometry-candidate-evaluation/v1",
        "candidate": candidate,
        "checkpointSha256": checkpoint_sha,
        "decoderConfig": DECODER_CONFIG,
        "evaluations": results,
    }
    (evaluation_dir / "evaluation-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--candidate",
        required=True,
        choices=("yolo11n-pose", "yolo11s-pose", "yolox-pose", "fastvit-t8-four-corner"),
    )
    args = parser.parse_args()
    print(json.dumps(evaluate(args.candidate), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
