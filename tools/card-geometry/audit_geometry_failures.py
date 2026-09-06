#!/usr/bin/env python3
"""Capture frozen model outputs and a validation-only color-contract intervention.

Native outputs are post-framework NMS, before shared quad validation/NMS.
No optimizer steps or held-out parameter sweeps are performed.
"""

import argparse
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image

import evaluate_geometry_candidate as inference
from corpus_release import load_json, sha256_file
from reference_geometry import (
    _aspect_ratio,
    _is_convex,
    _is_valid,
    polygon_area,
    _convex_intersection,
    process_candidates,
    EPSILON,
)


def rejection_reasons(candidate, config):
    points = [(c["point"]["x"], c["point"]["y"]) for c in candidate["corners"]]
    reasons = []
    if candidate["confidence"] < config["minimumConfidence"]:
        reasons.append("confidence")
    if not all(np.isfinite(v) for p in points for v in p):
        reasons.append("nonfinite")
        return reasons
    if any(
        v < -config["exteriorMargin"] or v > 1 + config["exteriorMargin"]
        for p in points
        for v in p
    ):
        reasons.append("outside-margin")
    if not _is_convex(points):
        reasons.append("nonconvex")
    if polygon_area(points) < config["minimumQuadArea"]:
        reasons.append("area")
    if (
        polygon_area(
            _convex_intersection(
                points, [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
            )
        )
        <= EPSILON
    ):
        reasons.append("outside-frame")
    band = config["aspectRatioBands"][candidate.get("container", "unknown")]
    if not band[0] <= _aspect_ratio(points) <= band[1]:
        reasons.append("aspect")
    # Other validity failures (confidence range, corner scores, schema fields).
    if not reasons and not _is_valid(candidate, config):
        reasons.append("other-validity")
    assert bool(reasons) == (not _is_valid(candidate, config))
    return reasons


def run(args):
    bundle = load_json(args.inputs / "audit-inputs.json")
    spec = bundle["models"][args.candidate]
    from huggingface_hub import hf_hub_download, HfApi

    model_root = args.output / "model"
    model_root.mkdir(parents=True)
    for artifact in spec["files"]:
        source = Path(
            hf_hub_download(
                bundle["modelRepo"], artifact["hubPath"], revision=spec["revision"]
            )
        )
        assert sha256_file(source) == artifact["sha256"]
        target = model_root / artifact["localPath"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
    if args.candidate == "yolox-pose":
        from yolox_validation_fix import repair_source

        repair_source(Path("/work/mmyolo"))
    predictor = inference.Predictor(
        args.candidate, model_root, spec["checkpointSha256"], 640
    )
    captured = {}
    if args.candidate == "yolox-pose":
        import mmdet.apis

        original = mmdet.apis.inference_detector

        def capture(*a, **kw):
            result = original(*a, **kw)
            pred = result.pred_instances
            captured["boxes"] = inference.as_numpy(pred.bboxes).tolist()
            captured["scores"] = inference.as_numpy(pred.scores).tolist()
            return result

        mmdet.apis.inference_detector = capture
    else:
        original = predictor.model.predict

        def capture(*a, **kw):
            result = original(*a, **kw)
            captured["boxes"] = result[0].boxes.xyxy.cpu().numpy().tolist()
            captured["scores"] = result[0].boxes.conf.cpu().numpy().tolist()
            return result

        predictor.model.predict = capture
    rows = []
    parity = None
    for index, sample in enumerate(bundle["samples"]):
        source = args.inputs / sample["imagePath"]
        assert sha256_file(source) == sample["imageSha256"]
        margins = sample["margins"]
        inference.CONTEXT_MARGIN = margins
        image, w, h = inference.padded_image(source)
        if sample["scope"] == "validation":
            data = io.BytesIO()
            image.save(
                data, format="JPEG", quality=95, optimize=False, progressive=False
            )
            data.seek(0)
            image = Image.open(data).convert("RGB")
        variants = ["frozen"]
        if args.candidate == "yolo11s-pose" and sample["scope"] == "validation":
            variants.append("bgr-corrected")
        for variant in variants:
            supplied = (
                image
                if variant == "frozen"
                else Image.fromarray(np.asarray(image)[:, :, ::-1])
            )
            if args.candidate == "yolox-pose":
                raw = predictor.predict_yolox(supplied, w, h)
            else:
                raw = predictor.predict_yolo(supplied, w, h)
            native = []
            for box, score in zip(captured["boxes"], captured["scores"]):
                x1, y1, x2, y2 = box
                native.append(
                    {
                        "box": [
                            (x1 - margins["left"]) / w,
                            (y1 - margins["top"]) / h,
                            (x2 - margins["left"]) / w,
                            (y2 - margins["top"]) / h,
                        ],
                        "score": score,
                    }
                )
            accepted = process_candidates(
                raw,
                inference.DECODER_CONFIG,
                {"releaseVersion": 1, "artifactSha256": spec["checkpointSha256"]},
            )
            rows.append(
                {
                    "recordId": sample["recordId"],
                    "scope": sample["scope"],
                    "variant": variant,
                    "native": native,
                    "raw": raw,
                    "accepted": accepted,
                    "rejections": [
                        rejection_reasons(c, inference.DECODER_CONFIG) for c in raw
                    ],
                }
            )
            if (
                args.candidate == "yolo11s-pose"
                and variant == "bgr-corrected"
                and parity is None
            ):
                kwargs = dict(
                    imgsz=640, conf=0.01, iou=0.99, max_det=100, verbose=False
                )
                pil = original(source=image, **kwargs)[0]
                bgr = original(source=np.asarray(image)[:, :, ::-1].copy(), **kwargs)[0]
                np.testing.assert_allclose(
                    pil.boxes.data.cpu(), bgr.boxes.data.cpu(), atol=1e-5
                )
                np.testing.assert_allclose(
                    pil.keypoints.data.cpu(), bgr.keypoints.data.cpu(), atol=1e-5
                )
                parity = {
                    "pilBgrPredictionParityPassed": True,
                    "recordId": sample["recordId"],
                }
        if (index + 1) % 50 == 0:
            print(f"AUDIT_PROGRESS={index + 1}/{len(bundle['samples'])}", flush=True)
    report = {
        "diagnosticOnly": True,
        "candidate": args.candidate,
        "checkpointSha256": spec["checkpointSha256"],
        "inputSha256": sha256_file(args.inputs / "audit-inputs.json"),
        "decoderConfig": inference.DECODER_CONFIG,
        "nativeStage": "post-framework-NMS; pre-shared-quad-filter",
        "colorParity": parity,
        "rows": rows,
    }
    destination = args.output / "raw-audit.json"
    destination.write_text(json.dumps(report) + "\n")
    commit = HfApi().upload_file(
        repo_id=bundle["modelRepo"],
        path_or_fileobj=str(destination),
        path_in_repo=args.artifact_prefix + "/" + args.candidate + "/raw-audit.json",
        commit_message="Publish frozen-output geometry failure audit " + args.candidate,
    )
    print("AUDIT_RESULT_COMMIT=" + str(commit.oid), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--candidate", choices=["yolox-pose", "yolo11s-pose"], required=True
    )
    parser.add_argument("--artifact-prefix", required=True)
    run(parser.parse_args())
