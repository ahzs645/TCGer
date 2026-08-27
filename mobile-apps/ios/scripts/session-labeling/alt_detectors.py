#!/usr/bin/env python3
"""Alternative card/document boundary detectors for the labeling tool.

When the pipeline's own quad looks wrong (the margin-edit cases), these run
other public models on the same frame so we can see whether a different
detector's boundary would fix the crop:

  - webobb+sam: the repo's OWN YOLO11n-OBB card detector (web scanner's
    TF.js weights, run via node) prompting MobileSAM, quad-fit on the mask.
    The proven manual-quad replicator on tilted/perspective cards.
  - webobb: the OBB detector alone (rotated rectangles).
  - tcgscanner: Adrihp06/TCGscanner-detector — YOLO single-class trading-card
    detector (riftbound_regions.onnx). Axis-aligned boxes.
  - pagescan-yolo: 7rplus/pagescan-weights yolo_doc_v1.onnx — YOLO11 document
    detector. Axis-aligned boxes.
  - pagescan-seg: 7rplus/pagescan-weights deeplabv3_mbv3_docseg.onnx —
    document segmentation; we fit a quadrilateral to the largest mask contour
    (the repo's own pipeline does mask -> quad fitting; its HQ-SAM stage is
    362MB and is deliberately skipped here).

All results are returned as normalized top-left-origin quads (4 points,
clockwise) so they drop straight onto FiftyOne overlays and into the same
perspective-warp used by derive_crops.py.

CLI:  alt_detectors.py <image.jpg> [--save-crops DIR]
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

MODELS_DIR = (
    Path.home() / "Downloads/Reference/TCGer-Session-Reference/labeling/alt-models"
)
WEIGHTS = {
    "tcgscanner": ("Adrihp06/TCGscanner-detector", "riftbound_regions.onnx"),
    "pagescan-yolo": ("7rplus/pagescan-weights", "yolo_doc_v1.onnx"),
    "pagescan-seg": ("7rplus/pagescan-weights", "deeplabv3_mbv3_docseg.onnx"),
    "mobilesam-enc": ("Acly/MobileSAM", "mobile_sam_image_encoder.onnx"),
    "mobilesam-dec": ("Acly/MobileSAM", "sam_mask_decoder_single.onnx"),
}
_SESSIONS = {}


def _weight_path(name):
    repo, fname = WEIGHTS[name]
    path = MODELS_DIR / fname
    if not path.exists():
        from huggingface_hub import hf_hub_download

        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        path = Path(hf_hub_download(repo_id=repo, filename=fname, local_dir=MODELS_DIR))
    return path


def _session(name):
    if name not in _SESSIONS:
        import onnxruntime as ort

        _SESSIONS[name] = ort.InferenceSession(
            str(_weight_path(name)), providers=["CPUExecutionProvider"]
        )
    return _SESSIONS[name]


def _letterbox(image, size):
    h, w = image.shape[:2]
    scale = min(size / w, size / h)
    nw, nh = round(w * scale), round(h * scale)
    resized = cv2.resize(image, (nw, nh))
    canvas = np.full((size, size, 3), 114, np.uint8)
    dx, dy = (size - nw) // 2, (size - nh) // 2
    canvas[dy:dy + nh, dx:dx + nw] = resized
    return canvas, scale, dx, dy


def _yolo_boxes(name, image_bgr, conf_threshold):
    """Run an ultralytics-exported single-class YOLO ONNX and return
    normalized axis-aligned quads with confidences."""
    session = _session(name)
    inp = session.get_inputs()[0]
    size = inp.shape[-1] if isinstance(inp.shape[-1], int) else 640
    boxed, scale, dx, dy = _letterbox(image_bgr, size)
    blob = boxed[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    out = session.run(None, {inp.name: blob})[0]
    preds = out[0]
    if preds.shape[0] < preds.shape[1]:  # (4+nc, N) -> (N, 4+nc)
        preds = preds.T
    boxes, scores = [], []
    for row in preds:
        conf = float(row[4:].max()) if row.shape[0] > 5 else float(row[4])
        if conf < conf_threshold:
            continue
        cx, cy, bw, bh = row[:4]
        boxes.append([float(cx - bw / 2), float(cy - bh / 2), float(bw), float(bh)])
        scores.append(conf)
    keep = cv2.dnn.NMSBoxes(boxes, scores, conf_threshold, 0.45) if boxes else []
    h, w = image_bgr.shape[:2]
    results = []
    for i in np.array(keep).flatten():
        x, y, bw, bh = boxes[i]
        x0 = max((x - dx) / scale, 0) / w
        y0 = max((y - dy) / scale, 0) / h
        x1 = min((x + bw - dx) / scale, w) / w
        y1 = min((y + bh - dy) / scale, h) / h
        results.append({
            "quad": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
            "confidence": scores[i],
        })
    return sorted(results, key=lambda r: -r["confidence"])


def _seg_quads(image_bgr, conf_threshold=0.5):
    """Document segmentation -> largest-contour quadrilateral fit."""
    session = _session("pagescan-seg")
    inp = session.get_inputs()[0]
    size = inp.shape[-1] if isinstance(inp.shape[-1], int) else 256
    resized = cv2.resize(image_bgr, (size, size))[:, :, ::-1].astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], np.float32)
    std = np.array([0.229, 0.224, 0.225], np.float32)
    blob = ((resized - mean) / std).transpose(2, 0, 1)[None]
    out = session.run(None, {inp.name: blob})[0][0]
    mask = (out.argmax(0) if out.ndim == 3 and out.shape[0] > 1 else out.squeeze() > 0)
    mask = (np.asarray(mask) > 0).astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    contour = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(contour) / (size * size)
    if area < 0.02:
        return []
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
    if len(approx) != 4:  # fall back to the minimum-area rotated rectangle
        approx = cv2.boxPoints(cv2.minAreaRect(contour))
    quad = [[float(x) / size, float(y) / size] for x, y in np.array(approx).reshape(4, 2)]
    return [{"quad": quad, "confidence": round(float(area), 3)}]


def _mask_to_quad(mask, min_area_frac=0.02):
    """Largest-contour quadrilateral of a binary mask; None if too small."""
    contours, _ = cv2.findContours(
        mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < min_area_frac * mask.shape[0] * mask.shape[1]:
        return None
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
    if len(approx) != 4:
        approx = cv2.boxPoints(cv2.minAreaRect(contour))
    return np.array(approx, np.float32).reshape(4, 2)


def _mobilesam_quads(image_bgr, conf_threshold=0.35):
    """MobileSAM segmentation prompted by the strongest YOLO box, then a quad
    fit on the mask. This is the rescue path for cluttered/tilted frames where
    the YOLO detectors fire but only as loose axis-aligned boxes."""
    h, w = image_bgr.shape[:2]
    boxes = _yolo_boxes("tcgscanner", image_bgr, conf_threshold) \
        or _yolo_boxes("pagescan-yolo", image_bgr, conf_threshold)
    if boxes:
        q = np.array(boxes[0]["quad"])
        x0, y0 = q.min(0)
        x1, y1 = q.max(0)
    else:  # no prompt available: assume the card dominates the frame
        x0, y0, x1, y1 = 0.05, 0.05, 0.95, 0.95

    scale = 1024.0 / max(h, w)
    resized = cv2.resize(image_bgr, (round(w * scale), round(h * scale)))
    rgb = resized[:, :, ::-1].astype(np.float32)
    embeddings = _session("mobilesam-enc").run(None, {"input_image": rgb})[0]

    coords = np.array(
        [[[x0 * w * scale, y0 * h * scale], [x1 * w * scale, y1 * h * scale]]],
        np.float32,
    )
    out = _session("mobilesam-dec").run(None, {
        "image_embeddings": embeddings,
        "point_coords": coords,
        "point_labels": np.array([[2.0, 3.0]], np.float32),
        "mask_input": np.zeros((1, 1, 256, 256), np.float32),
        "has_mask_input": np.zeros(1, np.float32),
        "orig_im_size": np.array([h, w], np.float32),
    })
    mask = (out[0][0, 0] > 0).astype(np.uint8)
    iou = float(out[1].reshape(-1)[0])
    quad_px = _mask_to_quad(mask)
    if quad_px is None:
        return []
    return [{
        "quad": [[float(x) / w, float(y) / h] for x, y in quad_px],
        "confidence": round(iou, 3),
    }]


def _web_obb_quads(image_path, conf_threshold=0.05, max_dets=3):
    """The web scanner's own YOLO11n-OBB card detector (TF.js weights), run
    via node (web_obb_detect.mjs). The only detector here trained on Pokémon
    cards, and the only one producing ROTATED boxes — its region prompt is
    what makes the sam combo replicate manual quads on tilted cards. The low
    default threshold is deliberate: on the hardest tilted frame it fires at
    0.107, and even that box is a good prompt."""
    import shutil
    import subprocess

    node = shutil.which("node")
    if not node:
        raise RuntimeError("node not on PATH (webobb needs the TF.js runtime)")
    script = Path(__file__).resolve().parent / "web_obb_detect.mjs"
    proc = subprocess.run(
        [node, str(script), str(image_path), str(conf_threshold), str(max_dets)],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip()[-200:] or "web_obb_detect failed")
    return [
        {"quad": d["quad"], "confidence": round(float(d["confidence"]), 3)}
        for d in json.loads(proc.stdout)
    ]


def _sam_embed(image_bgr):
    """MobileSAM image embedding (the expensive half) — compute once per
    frame, decode any number of box prompts against it."""
    h, w = image_bgr.shape[:2]
    scale = 1024.0 / max(h, w)
    resized = cv2.resize(image_bgr, (round(w * scale), round(h * scale)))
    embeddings = _session("mobilesam-enc").run(
        None, {"input_image": resized[:, :, ::-1].astype(np.float32)}
    )[0]
    return embeddings, scale


def _sam_decode_bbox(image_bgr, embeddings, scale, x0, y0, x1, y1,
                     min_area_frac=0.02):
    """Decode one normalized-bbox prompt against a precomputed embedding ->
    fitted quad (or None)."""
    h, w = image_bgr.shape[:2]
    coords = np.array(
        [[[x0 * w * scale, y0 * h * scale], [x1 * w * scale, y1 * h * scale]]],
        np.float32,
    )
    out = _session("mobilesam-dec").run(None, {
        "image_embeddings": embeddings,
        "point_coords": coords,
        "point_labels": np.array([[2.0, 3.0]], np.float32),
        "mask_input": np.zeros((1, 1, 256, 256), np.float32),
        "has_mask_input": np.zeros(1, np.float32),
        "orig_im_size": np.array([h, w], np.float32),
    })
    mask = (out[0][0, 0] > 0).astype(np.uint8)
    iou = float(out[1].reshape(-1)[0])
    quad_px = _mask_to_quad(mask, min_area_frac)
    if quad_px is None:
        return None
    return {
        "quad": [[float(x) / w, float(y) / h] for x, y in quad_px],
        "confidence": round(iou, 3),
    }


def _sam_quad_for_bbox(image_bgr, x0, y0, x1, y1):
    """MobileSAM mask for a normalized bbox prompt -> fitted quad (or None)."""
    embeddings, scale = _sam_embed(image_bgr)
    return _sam_decode_bbox(image_bgr, embeddings, scale, x0, y0, x1, y1)


def webobb_sam_page(image_path, image_bgr=None, conf_threshold=0.15,
                    max_dets=12):
    """Multi-card page scan: every webobb detection, SAM-refined against one
    shared image embedding. For binder pages — returns
    [{quad, confidence (SAM iou), obb_confidence}] ordered by obb conf.
    Pocket masks are small relative to the page, so the quad fit uses a
    looser area floor (0.5% of frame vs 2% for single cards)."""
    if image_bgr is None:
        image_bgr = cv2.imread(str(image_path))
    dets = [d for d in _web_obb_quads(image_path, conf_threshold, max_dets)
            if "quad" in d]
    if not dets:
        return []
    embeddings, scale = _sam_embed(image_bgr)
    results = []
    for det in dets:
        q = np.array(det["quad"])
        x0, y0 = q.min(0)
        x1, y1 = q.max(0)
        refined = _sam_decode_bbox(
            image_bgr, embeddings, scale, x0, y0, x1, y1, min_area_frac=0.005
        )
        quad = refined["quad"] if refined else det["quad"]
        results.append({
            "quad": quad,
            "confidence": (refined or det)["confidence"],
            "obb_confidence": det["confidence"],
        })
    return results


def _webobb_sam_quads(image_path, image_bgr, obb_dets):
    """webobb box prompt -> MobileSAM mask -> quad. On the three hand-fixed
    frames this replicates the manual quads (IoU 0.87/0.87/0.96) where every
    single-model detector stays under 0.62 — measured 2026-08-24."""
    if not obb_dets or "quad" not in obb_dets[0]:
        return []
    q = np.array(obb_dets[0]["quad"])
    x0, y0 = q.min(0)
    x1, y1 = q.max(0)
    result = _sam_quad_for_bbox(image_bgr, x0, y0, x1, y1)
    return [result] if result else []


_DOCALIGNER = None


def _docaligner_quads(image_bgr):
    """DocsaidLab DocAligner: heatmap regression of the four document corners
    — true perspective quads, the only detector here purpose-built for it."""
    global _DOCALIGNER
    if _DOCALIGNER is None:
        from docaligner import DocAligner

        _DOCALIGNER = DocAligner()
    corners = _DOCALIGNER(image_bgr)
    corners = np.asarray(corners, np.float32).reshape(-1, 2) if corners is not None else None
    if corners is None or len(corners) != 4:
        return []
    h, w = image_bgr.shape[:2]
    area = cv2.contourArea(corners) / (w * h)
    if area < 0.02:
        return []
    return [{
        "quad": [[float(x) / w, float(y) / h] for x, y in corners],
        "confidence": round(float(area), 3),
    }]


def run_all(image_path, conf_threshold=0.35):
    """All detectors on one frame -> {model_name: [{quad, confidence}, ...]}.

    Failures are reported per-model rather than raised, so one broken model
    never hides the others' boundaries."""
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"unreadable image: {image_path}")
    results = {}
    # webobb runs first so its box can prompt the sam combo without a second
    # node round-trip; the combo leads because it is the proven manual-quad
    # replicator (see _webobb_sam_quads).
    try:
        obb = _web_obb_quads(image_path)
    except Exception as e:
        obb = [{"error": f"{type(e).__name__}: {e}"}]
    try:
        results["webobb+sam"] = _webobb_sam_quads(
            image_path, image, [d for d in obb if "quad" in d]
        )
    except Exception as e:
        results["webobb+sam"] = [{"error": f"{type(e).__name__}: {e}"}]
    results["webobb"] = obb
    for name, runner in (
        ("tcgscanner", lambda: _yolo_boxes("tcgscanner", image, conf_threshold)),
        ("pagescan-yolo", lambda: _yolo_boxes("pagescan-yolo", image, conf_threshold)),
        ("pagescan-seg", lambda: _seg_quads(image)),
        ("docaligner", lambda: _docaligner_quads(image)),
        ("mobilesam", lambda: _mobilesam_quads(image, conf_threshold)),
    ):
        try:
            results[name] = runner()
        except Exception as e:
            results[name] = [{"error": f"{type(e).__name__}: {e}"}]
    return results


def order_quad(quad):
    """Geometric TL, TR, BR, BL ordering of a normalized quad (best-effort;
    ambiguous for strongly rotated cards — that's what manual rotation is for)."""
    pts = sorted(quad, key=lambda p: p[1])
    top = sorted(pts[:2], key=lambda p: p[0])
    bottom = sorted(pts[2:], key=lambda p: p[0])
    return [list(top[0]), list(top[1]), list(bottom[1]), list(bottom[0])]


def warp_quad_crop(image_bgr, quad, out_w=720, out_h=1000, ordered=False):
    """Perspective-warp a normalized quad (top-left origin) to a card crop.

    ordered=True trusts the given corner order (TL, TR, BR, BL of the CARD —
    used for hand-picked/normalized corners, where re-sorting would rotate
    tilted cards); otherwise corners are sorted geometrically."""
    h, w = image_bgr.shape[:2]
    if not ordered:
        quad = order_quad(quad)
    src = np.array([[x * w, y * h] for x, y in quad], np.float32)
    dst = np.array([[0, 0], [out_w, 0], [out_w, out_h], [0, out_h]], np.float32)
    return cv2.warpPerspective(image_bgr, cv2.getPerspectiveTransform(src, dst), (out_w, out_h))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--save-crops", metavar="DIR")
    args = ap.parse_args()
    results = run_all(args.image, args.conf)
    print(json.dumps(results, indent=1))
    if args.save_crops:
        out = Path(args.save_crops)
        out.mkdir(parents=True, exist_ok=True)
        image = cv2.imread(args.image)
        for model, dets in results.items():
            for i, d in enumerate(dets):
                if "quad" in d:
                    crop = warp_quad_crop(image, d["quad"])
                    cv2.imwrite(str(out / f"{model}-{i}.jpg"), crop)
        print(f"crops -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
