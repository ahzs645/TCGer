#!/usr/bin/env python3
"""Bake-off of card localizers: where does each one put the card, and does
its crop help the released encoder recognise it?

Two measurements:

  localization  against ground-truth polygons/boxes (COCO): per GT card, best
                IoU among predicted quads; recall@0.5/0.75, mean IoU, extra
                predictions per image, ms per image.
  recognition   on labeled Dev Mode frames: warp each localizer's best quad to
                720x1000 (both orientations), embed with the game's released
                encoder, and report the correct family's rank and similarity —
                i.e. whether a better crop moves the card into the acceptable
                band, which is the only reason to change the crop at all.

Localizers (all optional, skipped when weights/tools are missing):
  device          the quad the phone recorded (evidence.json)         [sessions only]
  vision-app      Apple Vision as CardCropper does it: document seg, else rectangles,
                  else the YOLO11s detector box (via vision-quads.swift)
  vision-doc / vision-rect / app-detector-box   the individual Vision stages
  yolo-seg        Ultralytics segmentation weights -> mask -> 4-corner polygon
  yolo-obb        Ultralytics OBB weights -> rotated box corners
  yolo-det        Ultralytics detection weights -> axis-aligned box
  detr            HF transformers DETR detection -> axis-aligned box
  contour         tmikonen/magic_card_detector OpenCV contour pipeline -> quad

Usage:
  bench_localizers.py --out DIR [--coco NAME=ANN:IMGDIR ...] [--sessions FRAMES.json]
      [--runtime GAME=DIR --onnx GAME=PATH ...]
      [--yolo-seg NAME=weights.pt ...] [--yolo-obb NAME=weights.pt ...] [--yolo-det NAME=weights.pt ...]
      [--detr NAME=dir] [--contour-repo DIR] [--vision-swift PATH --detector-mlmodelc DIR]
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_camera_corpus import Runtime, dedupe_roboflow, normalized_name  # noqa: E402

CARD_W, CARD_H = 720, 1000


# ---------- geometry ----------

def order_quad(points: np.ndarray) -> np.ndarray:
    pts = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    centre = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - centre[1], pts[:, 0] - centre[0])
    pts = pts[np.argsort(angles)]
    # Start at the top-left-most corner (smallest x+y).
    start = int(np.argmin(pts.sum(axis=1)))
    return np.roll(pts, -start, axis=0)


def box_to_quad(x, y, w, h):
    return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float64)


def vision_quad_to_pixels(quad, width, height):
    # Vision: normalized, origin bottom-left.
    return order_quad([[p[0] * width, (1 - p[1]) * height] for p in quad])


def polygon_iou(a: np.ndarray, b: np.ndarray) -> float:
    from shapely.geometry import Polygon

    try:
        pa, pb = Polygon(a).buffer(0), Polygon(b).buffer(0)
        if pa.is_empty or pb.is_empty:
            return 0.0
        inter = pa.intersection(pb).area
        union = pa.union(pb).area
        return float(inter / union) if union > 0 else 0.0
    except Exception:
        return 0.0


def mask_to_quad(mask: np.ndarray) -> np.ndarray | None:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < 64:
        return None
    hull = cv2.convexHull(contour)
    perimeter = cv2.arcLength(hull, True)
    for factor in (0.02, 0.03, 0.05, 0.08):
        approx = cv2.approxPolyDP(hull, factor * perimeter, True)
        if len(approx) == 4:
            return order_quad(approx.reshape(4, 2))
    box = cv2.boxPoints(cv2.minAreaRect(hull))
    return order_quad(box)


def warp(image: np.ndarray, quad: np.ndarray) -> np.ndarray:
    q = order_quad(quad).astype(np.float32)
    # Portrait card: if the quad is wider than tall, rotate the corner order.
    top = np.linalg.norm(q[1] - q[0]); side = np.linalg.norm(q[3] - q[0])
    if top > side:
        q = np.roll(q, -1, axis=0)
    dst = np.array([[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(q, dst)
    return cv2.warpPerspective(image, matrix, (CARD_W, CARD_H), flags=cv2.INTER_CUBIC)


# ---------- localizers ----------

class Localizer:
    name = "base"

    def quads(self, image_bgr: np.ndarray, path: str) -> list[np.ndarray]:
        raise NotImplementedError


class UltralyticsLocalizer(Localizer):
    def __init__(self, name: str, weights: str, kind: str, conf: float = 0.25):
        from ultralytics import YOLO

        self.name = name
        self.kind = kind
        self.model = YOLO(weights)
        self.conf = conf

    def quads(self, image_bgr, path):
        result = self.model.predict(image_bgr, conf=self.conf, verbose=False, imgsz=640)[0]
        out = []
        if self.kind == "seg" and result.masks is not None:
            h, w = image_bgr.shape[:2]
            for polygon in result.masks.xy:
                if len(polygon) < 3:
                    continue
                mask = np.zeros((h, w), dtype=np.uint8)
                cv2.fillPoly(mask, [polygon.astype(np.int32)], 1)
                quad = mask_to_quad(mask)
                if quad is not None:
                    out.append(quad)
        elif self.kind == "obb" and result.obb is not None:
            for corners in result.obb.xyxyxyxy.cpu().numpy():
                out.append(order_quad(corners))
        elif result.boxes is not None:
            for x1, y1, x2, y2 in result.boxes.xyxy.cpu().numpy():
                out.append(box_to_quad(x1, y1, x2 - x1, y2 - y1))
        return out


class DetrLocalizer(Localizer):
    def __init__(self, name: str, model_dir: str, threshold: float = 0.5):
        import torch
        from transformers import AutoImageProcessor, AutoModelForObjectDetection

        self.name = name
        self.processor = AutoImageProcessor.from_pretrained(model_dir)
        self.model = AutoModelForObjectDetection.from_pretrained(model_dir).eval()
        self.threshold = threshold
        self.torch = torch

    def quads(self, image_bgr, path):
        image = Image.fromarray(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB))
        inputs = self.processor(images=image, return_tensors="pt")
        with self.torch.no_grad():
            outputs = self.model(**inputs)
        target = self.torch.tensor([[image.height, image.width]])
        results = self.processor.post_process_object_detection(outputs, threshold=self.threshold, target_sizes=target)[0]
        return [box_to_quad(x1, y1, x2 - x1, y2 - y1) for x1, y1, x2, y2 in results["boxes"].numpy()]


class ContourLocalizer(Localizer):
    """tmikonen/magic_card_detector: CLAHE -> adaptive-threshold contours -> convex hull -> bounding quad."""

    def __init__(self, repo: str):
        sys.path.insert(0, repo)
        import magic_card_detector as mcd  # type: ignore

        self.mcd = mcd
        self.name = "contour-tmikonen"
        self.detector = mcd.MagicCardDetector()
        self.clahe = getattr(self.detector, "clahe", None) or cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

    def quads(self, image_bgr, path):
        try:
            test_image = self.mcd.TestImage(path, image_bgr, self.clahe)
            self.detector.segment_image(test_image)
        except Exception:
            return []
        out = []
        for candidate in test_image.candidate_list:
            coords = np.asarray(candidate.bounding_quad.exterior.coords)[:-1]
            if len(coords) == 4:
                out.append(order_quad(coords))
        return out


class VisionLocalizer(Localizer):
    """Apple Vision stages from vision-quads.swift, cached per image path."""

    def __init__(self, stage: str, cache: dict):
        self.name = stage
        self.stage = stage
        self.cache = cache

    def quads(self, image_bgr, path):
        record = self.cache.get(path)
        if not record:
            return []
        h, w = image_bgr.shape[:2]
        doc = record.get("document")
        rects = record.get("rectangles") or []
        box = record.get("detector")
        box_quad = None
        if box:
            x, y, bw, bh = box
            box_quad = order_quad([[x * w, (1 - y - bh) * h], [(x + bw) * w, (1 - y - bh) * h], [(x + bw) * w, (1 - y) * h], [x * w, (1 - y) * h]])
        if self.stage == "vision-doc":
            return [vision_quad_to_pixels(doc, w, h)] if doc else []
        if self.stage == "vision-rect":
            return [vision_quad_to_pixels(q, w, h) for q in rects]
        if self.stage == "app-detector-box":
            return [box_quad] if box_quad is not None else []
        # vision-app: CardCropper's order — plausible document, else rectangles
        # agreeing with the detector box, else the box itself.
        if doc and (record.get("documentConfidence") or 0) >= 0.5:
            q = vision_quad_to_pixels(doc, w, h)
            if box_quad is None or polygon_iou(q, box_quad) >= 0.45:
                return [q]
        candidates = [vision_quad_to_pixels(q, w, h) for q in rects]
        if box_quad is not None:
            agreeing = [q for q in candidates if polygon_iou(q, box_quad) >= 0.35]
            return agreeing or [box_quad]
        return candidates


class DeviceLocalizer(Localizer):
    name = "device"

    def __init__(self, frames):
        self.by_path = {f["path"]: f.get("deviceQuad") for f in frames}

    def quads(self, image_bgr, path):
        q = self.by_path.get(path)
        if not q:
            return []
        h, w = image_bgr.shape[:2]
        return [vision_quad_to_pixels(q, w, h)]


def run_vision(swift: str, detector: str | None, paths: list[str]) -> dict:
    command = ["swift", swift] + (["--detector", detector] if detector else [])
    process = subprocess.run(command, input="\n".join(paths), capture_output=True, text=True)
    if process.returncode != 0:
        sys.stderr.write(process.stderr)
        raise SystemExit("vision-quads.swift failed")
    cache = {}
    for line in process.stdout.splitlines():
        if line.strip():
            record = json.loads(line)
            cache[record["path"]] = record
    return cache


# ---------- evaluation ----------

def load_coco(annotations: Path, image_dir: Path):
    data = json.loads(annotations.read_text())
    annotated = {a["category_id"] for a in data["annotations"]}
    keep = set(dedupe_roboflow([i["file_name"] for i in data["images"]]).values())
    truths = collections.defaultdict(list)
    for a in data["annotations"]:
        if a["category_id"] not in annotated:
            continue
        seg = a.get("segmentation")
        if seg and isinstance(seg, list) and seg and len(seg[0]) >= 8:
            truths[a["image_id"]].append(order_quad(np.asarray(seg[0]).reshape(-1, 2)) if len(seg[0]) == 8 else np.asarray(seg[0]).reshape(-1, 2))
        else:
            x, y, w, h = a["bbox"]
            truths[a["image_id"]].append(box_to_quad(x, y, w, h))
    items = []
    for image in data["images"]:
        if image["file_name"] in keep and (image_dir / image["file_name"]).exists():
            items.append((str(image_dir / image["file_name"]), truths.get(image["id"], [])))
    return items


def evaluate_localization(localizers, items):
    stats = {}
    for loc in localizers:
        ious, extras, times = [], [], []
        for path, truths in items:
            image = cv2.imread(path)
            if image is None:
                continue
            started = time.perf_counter()
            preds = loc.quads(image, path)
            times.append((time.perf_counter() - started) * 1000)
            matched = 0
            for truth in truths:
                best = max((polygon_iou(truth, p) for p in preds), default=0.0)
                ious.append(best)
                matched += best >= 0.5
            extras.append(max(0, len(preds) - matched))
        ious = np.asarray(ious) if ious else np.zeros(1)
        stats[loc.name] = {
            "gt_cards": int(len(ious)), "mean_iou": float(ious.mean()),
            "recall@0.5": float((ious >= 0.5).mean()), "recall@0.75": float((ious >= 0.75).mean()),
            "recall@0.9": float((ious >= 0.9).mean()),
            "extra_preds_per_image": float(np.mean(extras)) if extras else 0.0,
            "ms_per_image": float(np.median(times)) if times else None,
        }
        print(f"  {loc.name:<22} IoU {stats[loc.name]['mean_iou']:.3f}  R@.5 {stats[loc.name]['recall@0.5']:.2f}  R@.75 {stats[loc.name]['recall@0.75']:.2f}  R@.9 {stats[loc.name]['recall@0.9']:.2f}  extra/img {stats[loc.name]['extra_preds_per_image']:.2f}  {stats[loc.name]['ms_per_image']:.0f} ms", file=sys.stderr)
    return stats


def external_id_indices(runtime, external_ids):
    allowed = {str(value).strip().lower() for value in external_ids if str(value).strip()}
    indices = []
    for index, row in enumerate(runtime.rows):
        identities = {str(row.get("cardId") or "").strip().lower(), str(row.get("exactPrintingId") or "").strip().lower()}
        for printing in row.get("printings") or []:
            identities.add(str(printing.get("cardId") or "").strip().lower())
            identities.add(str(printing.get("exactPrintingId") or "").strip().lower())
        if identities & allowed:
            indices.append(index)
    return np.asarray(indices, dtype=np.int64)


def recognition_summary(per_loc, strong_thresholds):
    summaries = {}
    for localizer, rows in per_loc.items():
        localizer_summary = {}
        games = sorted({row["game"] for row in rows})
        for game in games:
            game_rows = [row for row in rows if row["game"] == game]
            threshold = strong_thresholds.get(game, 0.65)
            for row in game_rows:
                margin = row.get("margin")
                row["accepted"] = bool(
                    row.get("found")
                    and row.get("top1") is not None
                    and row["top1"] >= threshold
                    and (margin is None or margin >= 0.05)
                )
                expected = row.get("expected", "identify")
                row["outcome"] = (
                    "correct_reject" if expected == "reject" and not row["accepted"]
                    else "wrong_accept" if expected == "reject"
                    else "correct_accept" if row["accepted"] and row.get("rank") == 0
                    else "wrong_accept" if row["accepted"]
                    else "abstain"
                )
            counts = collections.Counter(row["outcome"] for row in game_rows)
            found = [row for row in game_rows if row.get("found")]
            identify = [row for row in game_rows if row.get("expected", "identify") == "identify"]
            summary = {
                "frames": len(game_rows),
                "localized": len(found),
                "identifyFrames": len(identify),
                "rejectFrames": len(game_rows) - len(identify),
                "top1": sum(row.get("rank") == 0 for row in identify),
                "top5": sum(row.get("rank") is not None and row["rank"] < 5 for row in identify),
                "correctAccept": counts["correct_accept"],
                "wrongAccept": counts["wrong_accept"],
                "abstain": counts["abstain"],
                "correctReject": counts["correct_reject"],
                "strongThreshold": threshold,
            }
            slices = sorted({row.get("slice") for row in game_rows if row.get("slice")})
            if slices:
                summary["bySlice"] = {
                    slice_name: dict(collections.Counter(
                        row["outcome"] for row in game_rows if row.get("slice") == slice_name
                    ))
                    for slice_name in slices
                }
            localizer_summary[game] = summary
            print(
                f"  {localizer:<22} {game:<8} frames {len(game_rows):>3} localized {len(found):>3}  "
                f"correct-accept {counts['correct_accept']:>3}  wrong-accept {counts['wrong_accept']:>3}  "
                f"abstain {counts['abstain']:>3}  correct-reject {counts['correct_reject']:>3}",
                file=sys.stderr,
            )
        summaries[localizer] = localizer_summary
    return summaries


def evaluate_recognition(localizers, frames, runtimes, strong_thresholds, deck_scoped=False):
    per_loc = {}
    for loc in localizers:
        rows = []
        quad_cache = {}
        for frame in frames:
            if deck_scoped and not frame.get("deckExternalIds"):
                continue
            game = "magic" if frame["mode"] == "mtg" else frame["mode"]
            runtime = runtimes.get(game)
            if runtime is None:
                continue
            image = cv2.imread(frame["path"])
            if image is None:
                continue
            path = frame["path"]
            if path not in quad_cache:
                quad_cache[path] = loc.quads(image, path)
            preds = quad_cache[path]
            if not preds:
                rows.append({
                    "key": frame["key"], "game": game, "found": False,
                    "expected": frame.get("expected", "identify"), "slice": frame.get("slice"),
                    "scope": "deck" if deck_scoped else "full_catalog",
                })
                continue
            target_quad = frame.get("targetQuad")
            if target_quad:
                target_quad = order_quad(np.asarray(target_quad, dtype=np.float64))
                quad = max(preds, key=lambda q: polygon_iou(target_quad, q))
                localization_iou = polygon_iou(target_quad, quad)
            else:
                # Legacy/single-card frames: the largest plausible quad is the card.
                quad = max(preds, key=lambda q: cv2.contourArea(q.astype(np.float32)))
                localization_iou = None
            crop = warp(image, quad)
            best = None
            for oriented in (crop, cv2.rotate(crop, cv2.ROTATE_180)):
                pil = Image.fromarray(cv2.cvtColor(oriented, cv2.COLOR_BGR2RGB))
                embedding = runtime.embed(pil)
                scores = runtime.vectors @ embedding
                gallery_indices = (
                    external_id_indices(runtime, frame.get("deckExternalIds") or [])
                    if deck_scoped else np.arange(len(scores), dtype=np.int64)
                )
                if len(gallery_indices) == 0:
                    candidate = {"rank": None, "sim": None, "top1": None, "margin": None, "galleryRows": 0}
                    if best is None:
                        best = candidate
                    continue
                order = gallery_indices[np.argsort(-scores[gallery_indices])]
                target_key = runtime.label_index.get(frame["label"])
                rank, sim = None, None
                if target_key is not None:
                    for r, i in enumerate(order[:2000]):
                        if runtime.family_of(int(i)) == target_key:
                            rank, sim = int(r), float(scores[i]); break
                top1 = float(scores[order[0]])
                rival = next((float(scores[i]) for i in order[1:10] if runtime.family_of(int(i)) != runtime.family_of(int(order[0]))), None)
                candidate = {"rank": rank, "sim": sim, "top1": top1, "margin": (top1 - rival) if rival is not None else None, "galleryRows": int(len(gallery_indices))}
                if best is None or ((candidate["sim"] or -1) > (best["sim"] or -1)):
                    best = candidate
            rows.append({
                "key": frame["key"], "game": game, "found": True,
                "expected": frame.get("expected", "identify"), "slice": frame.get("slice"),
                "scope": "deck" if deck_scoped else "full_catalog",
                "localizationIoU": localization_iou, **best,
            })
        per_loc[loc.name] = rows
    return per_loc, recognition_summary(per_loc, strong_thresholds)


class LabeledRuntime(Runtime):
    def __init__(self, runtime_dir: Path, onnx_path: Path):
        super().__init__(runtime_dir, onnx_path)
        # exact printing id / card id -> family id
        self.label_index = {}
        for index, row in enumerate(self.rows):
            fam = self.family_of(index)
            self.label_index[row["cardId"]] = fam
            for p in row.get("printings") or []:
                self.label_index[p.get("exactPrintingId") or p["cardId"]] = fam


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--coco", action="append", default=[])
    parser.add_argument("--sessions", type=Path)
    parser.add_argument("--runtime", action="append", default=[], help="GAME=DIR")
    parser.add_argument("--onnx", action="append", default=[], help="GAME=PATH")
    parser.add_argument("--yolo-seg", action="append", default=[])
    parser.add_argument("--yolo-obb", action="append", default=[])
    parser.add_argument("--yolo-det", action="append", default=[])
    parser.add_argument("--detr", action="append", default=[])
    parser.add_argument("--contour-repo")
    parser.add_argument("--vision-swift")
    parser.add_argument("--detector-mlmodelc")
    parser.add_argument("--strong-threshold", action="append", default=[], help="GAME=COSINE acceptance threshold")
    parser.add_argument("--deck-scoped", action="store_true", help="also evaluate frames with deckExternalIds against only those identities")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    localizers: list[Localizer] = []
    for spec in args.yolo_seg:
        n, w = spec.split("=", 1); localizers.append(UltralyticsLocalizer(n, w, "seg"))
    for spec in args.yolo_obb:
        n, w = spec.split("=", 1); localizers.append(UltralyticsLocalizer(n, w, "obb"))
    for spec in args.yolo_det:
        n, w = spec.split("=", 1); localizers.append(UltralyticsLocalizer(n, w, "det"))
    for spec in args.detr:
        n, d = spec.split("=", 1); localizers.append(DetrLocalizer(n, d))
    if args.contour_repo:
        try:
            localizers.append(ContourLocalizer(args.contour_repo))
        except Exception as error:
            print(f"contour localizer unavailable: {error}", file=sys.stderr)

    coco_items = []
    for spec in args.coco:
        name, rest = spec.split("=", 1)
        ann, imgdir = rest.split(":", 1)
        items = load_coco(Path(ann), Path(imgdir))
        if args.limit:
            items = items[: args.limit]
        coco_items.append((name, items))
    frames = json.loads(args.sessions.read_text()) if args.sessions else []
    if args.limit:
        frames = frames[: args.limit]

    all_paths = sorted({p for _, items in coco_items for p, _ in items} | {f["path"] for f in frames})
    vision_cache = {}
    if args.vision_swift:
        vision_cache = run_vision(args.vision_swift, args.detector_mlmodelc, all_paths)
        for stage in ("vision-app", "vision-doc", "vision-rect", "app-detector-box"):
            localizers.append(VisionLocalizer(stage, vision_cache))

    report = {"localization": {}, "recognition": {}, "recognitionSummary": {}}
    for name, items in coco_items:
        print(f"== localization: {name} ({len(items)} images)", file=sys.stderr)
        report["localization"][name] = evaluate_localization(localizers, items)

    if frames:
        runtimes = {}
        onnx = dict(s.split("=", 1) for s in args.onnx)
        for spec in args.runtime:
            game, d = spec.split("=", 1)
            runtimes[game] = LabeledRuntime(Path(d), Path(onnx[game]))
        session_localizers = [DeviceLocalizer(frames)] + localizers
        strong_thresholds = {"magic": 0.70, "pokemon": 0.65, "yugioh": 0.65}
        for spec in args.strong_threshold:
            game, value = spec.split("=", 1)
            strong_thresholds[game] = float(value)
        print(f"== recognition: {len(frames)} labeled frames", file=sys.stderr)
        report["recognition"], report["recognitionSummary"] = evaluate_recognition(
            session_localizers, frames, runtimes, strong_thresholds
        )
        if args.deck_scoped:
            scoped_frames = sum(bool(frame.get("deckExternalIds")) for frame in frames)
            print(f"== deck-scoped recognition: {scoped_frames} labeled frames", file=sys.stderr)
            report["recognitionDeckScoped"], report["recognitionDeckScopedSummary"] = evaluate_recognition(
                session_localizers, frames, runtimes, strong_thresholds, deck_scoped=True
            )

    (args.out / "bench-localizers.json").write_text(json.dumps(report, indent=1, default=float))
    print(f"wrote {args.out / 'bench-localizers.json'}", file=sys.stderr)


if __name__ == "__main__":
    main()
