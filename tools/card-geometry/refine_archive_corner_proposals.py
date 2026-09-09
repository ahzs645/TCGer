#!/usr/bin/env python3
"""Tighten reviewed model corner proposals using local image contours.

The model supplies approximate semantic corner order. This CPU-only step finds
nearby card-shaped contours and retains alternative quads for visual review.
An edge candidate is not an approval: apply_archive_corner_proposals.py requires
an explicit reviewed index list before anything can be saved.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

def iou(a, b):
    x = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    y = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    n = x * y
    return n / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - n)

def fit_candidates(im, prior, box):
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    g = cv2.GaussianBlur(g, (3, 3), 0.65)
    variants = []
    for th in [0, 60, 100, 140, 180, 210]:
        typ = cv2.THRESH_BINARY + (cv2.THRESH_OTSU if th == 0 else 0)
        _, binary = cv2.threshold(g, th, 255, typ)
        variants.extend([binary, 255 - binary])
    for a, b in [(20, 60), (50, 120), (90, 180)]:
        edges = cv2.Canny(g, a, b)
        variants.extend([edges, cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))])
    candidates = []
    seedarea = (box[2] - box[0]) * (box[3] - box[1])
    diag = np.linalg.norm([box[2] - box[0], box[3] - box[1]])
    for mask in variants:
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if not 0.45 * seedarea < area < 1.15 * seedarea:
                continue
            for eps in [0.01, 0.018, 0.028, 0.04]:
                q = cv2.approxPolyDP(contour, eps * cv2.arcLength(contour, True), True)
                if len(q) != 4 or not cv2.isContourConvex(q):
                    continue
                q = q[:, 0, :].astype(float)
                if q[:, 0].min() < 2 or q[:, 1].min() < 2 or q[:, 0].max() > im.shape[1] - 3 or (q[:, 1].max() > im.shape[0] - 3):
                    continue
                center = q.mean(0)
                q = q[np.argsort(np.arctan2(q[:, 1] - center[1], q[:, 0] - center[0]))]
                q = min([np.roll(q, k, axis=0) for k in range(4)], key=lambda p: np.linalg.norm(p - prior, axis=1).mean())
                bbox = [q[:, 0].min(), q[:, 1].min(), q[:, 0].max(), q[:, 1].max()]
                ov = iou(bbox, box)
                if ov < 0.62:
                    continue
                dist = np.linalg.norm(q - prior, axis=1).mean() / diag
                area_ratio = abs(cv2.contourArea(q.astype(np.float32))) / seedarea
                score = 0.65 * ov + 0.25 * area_ratio - 0.5 * dist
                candidates.append((score, q, {'boxIoU': round(ov, 4), 'areaRatio': round(area_ratio, 4), 'distanceToLuna': round(dist, 4)}))
    candidates.sort(key=lambda c: c[0], reverse=True)
    unique = []
    for c in candidates:
        if not any((np.linalg.norm(c[1] - d[1], axis=1).mean() < 3 for d in unique)):
            unique.append(c)
    return unique[:5]


def refine(packet, proposals, preview_dir=None):
    packets = {p["recordId"]: p for p in packet}
    if len(packets) != len(packet):
        raise ValueError("Duplicate packet record IDs")
    proposals = json.loads(json.dumps(proposals))
    for p in proposals:
        frame = packets[p["recordId"]]
        if frame["imageSha256"] != p["imageSha256"]:
            raise ValueError("Proposal and crop packet image hashes differ")
        targets = {t["sourceAnnotationIndex"]: t for t in frame["targets"]}
        image = cv2.imread(frame["imagePath"])
        for target in p["targets"]:
            meta = targets[target["sourceAnnotationIndex"]]
            if target.get("cornersPixels") is None:
                target["edgeCandidates"] = []
                continue
            origin = np.array(meta["cropOriginPixels"])
            crop = cv2.imread(meta["cropPath"])
            prior = np.array(target["cornersPixels"]) - origin
            box = np.array(meta["seedBoxPixels"]) - np.tile(origin, 2)
            candidates = fit_candidates(crop, prior, box)
            target["lunaCornersPixels"] = target["cornersPixels"]
            target["edgeCandidates"] = [
                {"score": float(c[0]), "cornersPixels": (c[1] + origin).tolist(), **c[2]}
                for c in candidates
            ]
            if candidates:
                target["cornersPixels"] = target["edgeCandidates"][0]["cornersPixels"]
            if preview_dir is not None:
                pts = np.array(target["cornersPixels"], np.int32)
                cv2.polylines(image, [pts], True, (30, 255, 30) if candidates else (0, 0, 255), 2)
                cv2.putText(image, str(target["sourceAnnotationIndex"]), tuple(pts[0]),
                            cv2.FONT_HERSHEY_SIMPLEX, .4, (255, 255, 0), 1)
        if preview_dir is not None:
            preview_dir.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(preview_dir / (p["recordId"] + ".png")), image)
    return proposals


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", type=Path, required=True)
    parser.add_argument("--proposal", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preview-dir", type=Path)
    args = parser.parse_args()
    result = refine(json.loads(args.packet.read_text()), json.loads(args.proposal.read_text()), args.preview_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"frames": len(result), "targets": sum(len(f["targets"]) for f in result),
                      "targetsWithEdgeCandidates": sum(bool(t["edgeCandidates"]) for f in result for t in f["targets"])}))


if __name__ == "__main__":
    main()
