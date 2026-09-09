#!/usr/bin/env python3
"""Verify the repeated 1/8-width letterbox reflection pattern in pk-detect v3.

This archive-specific audit searches around the dominant seams independently
on each edge. Smoothing compensates for JPEG/resampling phase differences;
high spatial correlation, low RGB error and non-flat texture must all agree.
The output is hash-bound input to repair_archive_padding.py, not an in-place edit.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from corpus_release import load_json, write_json
from repair_archive_padding import clip_box

ARCHIVE = "coco:pk-detect.v3i.coco"


def reflected_edges(pixels):
    pixels = pixels.astype(np.float32) / 255
    smooth = cv2.GaussianBlur(pixels, (0, 0), 2)
    height, width = pixels.shape[:2]
    bounds = [0, 0, width, height]
    evidence = {}
    for edge in ("left", "top", "right", "bottom"):
        raw = pixels if edge in ("top", "bottom") else pixels.transpose(1, 0, 2)
        blurred = smooth if edge in ("top", "bottom") else smooth.transpose(1, 0, 2)
        if edge in ("right", "bottom"):
            raw, blurred = raw[::-1], blurred[::-1]
        expected = round(len(raw) / 8)
        candidates = []
        for extent in range(max(10, expected - 2), expected + 3):
            if 2 * extent >= len(raw):
                continue
            first = blurred[4:extent-4, 5:-5]
            second = blurred[extent+4:2*extent-4, 5:-5][::-1]
            # Spatial luminance contrast, not differences between RGB channels.
            weights = np.array([.299, .587, .114])
            a, b = first @ weights, second @ weights
            contrast = min(float(a.std()), float(b.std()))
            corr = float(np.corrcoef(a.ravel(), b.ravel())[0, 1]) if contrast > 1e-6 else 0.0
            error = float(np.abs(first - second).mean())
            raw_error = float(np.abs(raw[:extent] - raw[extent:2*extent][::-1]).mean())
            candidates.append({"extent": extent, "smoothedRGBMAE": error,
                               "luminanceCorrelation": corr, "textureStd": contrast, "rawRGBMAE": raw_error})
        best = min(candidates, key=lambda c: c["smoothedRGBMAE"])
        best["verified"] = best["smoothedRGBMAE"] <= .006 and best["luminanceCorrelation"] >= .99 and best["textureStd"] >= .01
        evidence[edge] = best
        if best["verified"]:
            index = {"left": 0, "top": 1, "right": 2, "bottom": 3}[edge]
            bounds[index] = best["extent"] if edge in ("left", "top") else len(raw) - best["extent"]
    return bounds, evidence


def audit(release):
    manifest = load_json(release / "manifest.json")
    frames, unverified = [], []
    for entry in manifest["records"]:
        if entry["leakageKeys"]["sourceArchiveId"] != ARCHIVE or entry["split"] != "train":
            continue
        record = load_json(release / entry["path"])
        source = record["source"]
        pixels = cv2.cvtColor(cv2.imread(str(release / source["path"])), cv2.COLOR_BGR2RGB)
        bounds, evidence = reflected_edges(pixels)
        if not any(e["verified"] for e in evidence.values()):
            unverified.append({"recordId": entry["recordId"], "evidence": evidence})
            continue
        removed, crossing = [], []
        for instance in record["instances"]:
            box = clip_box(instance["box"], bounds, source["width"], source["height"])
            if box is None:
                removed.append(instance["sourceAnnotationIndex"])
            elif box != instance["box"]:
                crossing.append(instance["sourceAnnotationIndex"])
        frames.append({"recordId": entry["recordId"], "originalImageSha256": source["sha256"],
                       "contentBounds": bounds, "removeAnnotationIndices": removed,
                       "crossingAnnotationIndices": crossing, "evidence": evidence})
    return {"schema": "tcger-reflected-padding-corrections/v1", "sourceCorpusHash": manifest["corpusHash"],
            "sourceArchiveId": ARCHIVE,
            "criteria": "Independent edge tests near the archive's dominant 1/8-image seam, ±2px; Gaussian sigma2; normalized RGB MAE <=0.006; luminance correlation >=0.99; spatial std >=0.01. Interior pixels are retained verbatim after decoding.",
            "frames": frames, "unverified": unverified,
            "summary": {"framesAudited": len(frames) + len(unverified), "framesWithReflection": len(frames),
                        "verifiedSeams": sum(e["verified"] for f in frames for e in f["evidence"].values()),
                        "falseTargets": sum(len(f["removeAnnotationIndices"]) for f in frames),
                        "crossingTargets": sum(len(f["crossingAnnotationIndices"]) for f in frames)}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = audit(args.release)
    write_json(args.output, report)
    print(json.dumps(report["summary"], indent=2))
