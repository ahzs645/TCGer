#!/usr/bin/env python3
"""Regenerate per-attempt crop images for a dev-mode scan session.

The dev-mode recorder (`ScannerDevModeStore`) stops writing
`frame-NNNN-attempt-K.jpg` files by default: every attempt's image is a pure
function of the saved frame image plus the geometry already recorded in
`evidence.json`. This script replays that function so labeling / debugging
tools can still get the exact crops the pipeline evaluated.

Implementation choice — Python (numpy + OpenCV/Pillow), not a Swift CLI:
the recorder's warp is CoreImage's `CIPerspectiveCorrection` (quad -> upright
rect) followed by an affine resize to the 720x1000 recognition size. The
composition of those two maps is the unique homography taking the four quad
corners to the corners of the 720x1000 rect — the intermediate CoreImage
extent only affects resampling, not geometry — so `cv2.getPerspectiveTransform`
+ `warpPerspective` reproduces it to within resampling/JPEG noise (measured
mean-abs-diff ~2-4/255 against device-recorded attempt JPEGs, dominated by the
JPEG re-encode of the source frame; a Swift CLI could not do better because
the original uncompressed CGImage no longer exists). Exact CoreImage fidelity
is therefore not materially better, and Python keeps this usable in the
existing labeling venv without an Xcode toolchain.

Source image and coordinate conventions (mirrors the Swift code):
  * Attempts crop from the PIPELINE INPUT image, `frame-NNNN.jpg` (the
    coordinator scans exactly the image the recorder saves as `imageFile`).
    `frame-NNNN-original.jpg` is the pre-guide-crop sensor photo and is never
    the crop source, so it is not used here.
  * All quads are normalized Vision coordinates: origin bottom-left, y up.
    Pixel conversion: px = x * W, py = (1 - y) * H.
  * `CardCropper.makeNormalizedCrop`: perspective-correct the quad, rotate
    90 degrees if the corrected extent is landscape, resize to 720x1000.
  * `BinderPageScanner.makeNormalizedCrop` (pocket crops): same but with NO
    landscape rotation; output is `sourceCropPixelWidth/Height` (~720x1000,
    off-by-one from CoreImage extent rounding).

Attempt kinds and their derivation rules:
  * detectedCrop  — perspective crop of the frame at `quad`
                    (`CardCropper.makeNormalizedCrop`), resized to 720x1000.
  * wholeFrame    — the full frame "normalized like a crop": identity quad,
                    rotate-if-landscape, resize to 720x1000
                    (`CardCropper.normalizedWholeImage`). `quad` is null.
  * rawImage      — the frame embedded as-is, no warp and no resize (the
                    `bestCrop ?? image` fallback when nothing was detected).
                    `quad` is null.
  * manualCrop    — the recorder registers the SCAN INPUT itself for this
                    attempt (the manual quad is only metadata), so the attempt
                    image is a byte-level re-encode of `frame-NNNN.jpg`.
  * binder pocket attempts (`pocketIndex` != null) — two-stage:
      1. pocket crop: `quad` is the pocket quad; when `binderPageFitRect`
         ([minX, minY, w, h], Vision space) is present the quad is RELATIVE
         to that sub-rect (`BinderNormalizedQuad.remapped(into:)`) and must be
         mapped back: p = rect.origin + p_rel * rect.size. Warp the frame at
         that quad to `sourceCropPixelWidth x sourceCropPixelHeight`
         (no rotation).
      2. inner attempt on the pocket crop: `coordinatorQuad` (normalized wrt
         the pocket crop) replays the strategy's own detectedCrop; a binder
         `wholeFrame` resizes the pocket crop; a binder `rawImage` (and the
         no-diagnostics fallback, which has coordinatorQuad == null with kind
         detectedCrop) is the pocket crop itself.
  * semanticOrientation == "upsideDown" — the attempt evaluated the
    180-degree rotation of the crop; rotate the derived image by 180.
    Recordings made while binder merges forced "unverified" (pre 2026-08-23),
    and pre-orientation-schema sessions (no field at all), cannot say which
    of an identical-geometry pair was the rotated one; for those the second
    attempt of a consecutive identical-geometry pair is treated as the 180
    (the serial recorder appended upright first). `--try-both-orientations`
    reports both during validation.

Each attempt's image is written as `frame-NNNN-attempt-K.jpg` where K is the
attempt's `imageIndex` — the same numbering the recorder used.

Usage:
  derive_crops.py SESSION_DIR [-o OUT_DIR] [--validate]
  --validate compares each derived crop against a recorded
  frame-NNNN-attempt-K.jpg in SESSION_DIR (size + mean abs pixel diff after
  resizing to the recorded size) and prints a summary.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover
    sys.exit("derive_crops.py requires opencv-python (pip install opencv-python)")

TARGET_W, TARGET_H = 720, 1000  # CardCropper/BinderPageScanner targetSize
JPEG_QUALITY = 85  # ScannerDevModeStore Limits.jpegQuality


# ---------------------------------------------------------------------------
# geometry


def vision_quad_to_pixels(quad, width, height):
    """Normalized Vision points (origin bottom-left) -> pixel points (origin
    top-left), preserving the recorder's corner order TL,TR,BR,BL."""
    return np.array(
        [[x * width, (1.0 - y) * height] for x, y in quad], dtype=np.float64
    )


def warp_quad(image, quad_px, out_w, out_h):
    """The unique homography taking the quad's TL,TR,BR,BL to the out rect's
    corners == CIPerspectiveCorrection followed by the affine resize."""
    dst = np.array(
        [[0, 0], [out_w, 0], [out_w, out_h], [0, out_h]], dtype=np.float64
    )
    matrix = cv2.getPerspectiveTransform(
        quad_px.astype(np.float32), dst.astype(np.float32)
    )
    return cv2.warpPerspective(
        image, matrix, (out_w, out_h), flags=cv2.INTER_LINEAR
    )


def edge_lengths(quad_px):
    tl, tr, br, bl = quad_px
    horizontal = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    vertical = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    return horizontal, vertical


def card_cropper_crop(image, quad):
    """CardCropper.makeNormalizedCrop: perspective-correct, rotate a landscape
    result to portrait, resize to 720x1000."""
    height, width = image.shape[:2]
    quad_px = vision_quad_to_pixels(quad, width, height)
    horizontal, vertical = edge_lengths(quad_px)
    if horizontal > vertical:
        # CoreImage `.oriented(.right)` on the corrected extent. Validated
        # against device-recorded landscape attempt crops: the card's left
        # edge becomes the top (a 90-degree clockwise rotation of the
        # corrected image). Equivalent single warp: send the quad's BL corner
        # to the output's top-left.
        rotated = np.roll(quad_px, 1, axis=0)  # BL,TL,TR,BR -> new TL,TR,BR,BL
        return warp_quad(image, rotated, TARGET_W, TARGET_H)
    return warp_quad(image, quad_px, TARGET_W, TARGET_H)


def whole_frame_crop(image):
    """CardCropper.normalizedWholeImage: identity quad through the same path."""
    height, width = image.shape[:2]
    if width > height:
        image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    return cv2.resize(image, (TARGET_W, TARGET_H), interpolation=cv2.INTER_LINEAR)


def binder_pocket_crop(image, attempt):
    """BinderPageScanner.makeNormalizedCrop for the pocket this attempt sits
    in: undo the page-fit remap, warp, no rotation."""
    quad = attempt.get("quad")
    if quad is None:
        return None
    fit = attempt.get("binderPageFitRect")
    if fit:
        min_x, min_y, fit_w, fit_h = fit
        quad = [[min_x + x * fit_w, min_y + y * fit_h] for x, y in quad]
    height, width = image.shape[:2]
    quad_px = vision_quad_to_pixels(quad, width, height)
    out_w = attempt.get("sourceCropPixelWidth") or TARGET_W
    out_h = attempt.get("sourceCropPixelHeight") or TARGET_H
    return warp_quad(image, quad_px, out_w, out_h)


# ---------------------------------------------------------------------------
# per-attempt derivation


def derive_attempt(frame_image, attempt, rotate180):
    kind = attempt.get("kind")
    if attempt.get("pocketIndex") is not None:
        pocket = binder_pocket_crop(frame_image, attempt)
        if pocket is None:
            return None
        coordinator_quad = attempt.get("coordinatorQuad")
        if kind == "detectedCrop" and coordinator_quad is not None:
            derived = card_cropper_crop(pocket, coordinator_quad)
        elif kind == "wholeFrame":
            derived = whole_frame_crop(pocket)
        else:
            # rawImage, or the no-diagnostics fallback (kind detectedCrop,
            # coordinatorQuad null): the attempt image is the pocket crop.
            derived = pocket
    elif kind == "detectedCrop":
        quad = attempt.get("quad")
        if quad is None:
            return None
        derived = card_cropper_crop(frame_image, quad)
    elif kind == "wholeFrame":
        derived = whole_frame_crop(frame_image)
    elif kind in ("rawImage", "manualCrop"):
        derived = frame_image.copy()
    else:
        return None
    if rotate180:
        derived = cv2.rotate(derived, cv2.ROTATE_180)
    return derived


def orientation_flags(attempts):
    """Whether each attempt (evidence order) evaluated the 180-degree crop.

    Prefer the recorded `semanticOrientation`; for legacy records without a
    usable value ("unverified"/absent), fall back to the serial recorder's
    ordering: the second of a consecutive identical-geometry pair is the 180.
    """
    flags = []
    for index, attempt in enumerate(attempts):
        orientation = attempt.get("semanticOrientation")
        if orientation == "upsideDown":
            flags.append(True)
        elif orientation == "upright":
            flags.append(False)
        else:
            previous = attempts[index - 1] if index > 0 else None
            same_geometry = (
                previous is not None
                and previous.get("kind") == attempt.get("kind")
                and previous.get("quad") == attempt.get("quad")
                and previous.get("coordinatorQuad") == attempt.get("coordinatorQuad")
                and previous.get("pocketIndex") == attempt.get("pocketIndex")
                and not flags[index - 1]
            )
            flags.append(bool(same_geometry))
    return flags


# ---------------------------------------------------------------------------
# session driver


@dataclass
class Comparison:
    name: str
    kind: str
    derived_size: tuple
    recorded_size: tuple
    mean_abs_diff: float
    flipped_mean_abs_diff: float | None = None


@dataclass
class SessionResult:
    written: int = 0
    skipped: list = field(default_factory=list)
    comparisons: list = field(default_factory=list)


def load_bgr(path):
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(path)
    return image


def mean_abs_diff(derived, recorded):
    """Mean absolute pixel difference (0-255) after resizing the derived crop
    to the recorded crop's size."""
    if derived.shape[:2] != recorded.shape[:2]:
        derived = cv2.resize(
            derived,
            (recorded.shape[1], recorded.shape[0]),
            interpolation=cv2.INTER_AREA,
        )
    return float(
        np.mean(np.abs(derived.astype(np.int16) - recorded.astype(np.int16)))
    )


def process_session(session_dir, out_dir, validate, try_both):
    evidence_path = session_dir / "evidence.json"
    evidence = json.loads(evidence_path.read_text())
    out_dir.mkdir(parents=True, exist_ok=True)
    result = SessionResult()

    for record in evidence:
        image_file = record["imageFile"]
        frame_stem = Path(image_file).stem  # frame-NNNN
        attempts = record.get("attempts") or []
        if not attempts:
            continue
        try:
            frame_image = load_bgr(session_dir / image_file)
        except FileNotFoundError:
            result.skipped.append(f"{image_file}: frame image missing")
            continue

        flags = orientation_flags(attempts)
        for attempt, rotate180 in zip(attempts, flags):
            image_index = attempt.get("imageIndex")
            if image_index is None or image_index < 0:
                continue
            name = f"{frame_stem}-attempt-{image_index}.jpg"
            derived = derive_attempt(frame_image, attempt, rotate180)
            if derived is None:
                result.skipped.append(f"{name}: no geometry for kind {attempt.get('kind')}")
                continue
            cv2.imwrite(
                str(out_dir / name),
                derived,
                [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY],
            )
            result.written += 1

            if validate:
                recorded_path = session_dir / name
                if not recorded_path.exists():
                    result.skipped.append(f"{name}: no recorded attempt file to compare")
                    continue
                recorded = load_bgr(recorded_path)
                comparison = Comparison(
                    name=name,
                    kind=attempt.get("kind", "?"),
                    derived_size=(derived.shape[1], derived.shape[0]),
                    recorded_size=(recorded.shape[1], recorded.shape[0]),
                    mean_abs_diff=mean_abs_diff(derived, recorded),
                )
                if try_both:
                    comparison.flipped_mean_abs_diff = mean_abs_diff(
                        cv2.rotate(derived, cv2.ROTATE_180), recorded
                    )
                result.comparisons.append(comparison)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("session", type=Path, help="scan-session-* directory")
    parser.add_argument(
        "-o",
        "--out",
        type=Path,
        default=None,
        help="output directory (default: SESSION/derived-attempts)",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="compare derived crops against recorded frame-*-attempt-*.jpg",
    )
    parser.add_argument(
        "--try-both-orientations",
        action="store_true",
        help="with --validate, also report the 180-flipped diff per attempt",
    )
    args = parser.parse_args()

    session_dir = args.session
    if not (session_dir / "evidence.json").exists():
        sys.exit(f"{session_dir} has no evidence.json")
    out_dir = args.out or (session_dir / "derived-attempts")

    result = process_session(
        session_dir, out_dir, args.validate, args.try_both_orientations
    )
    print(f"{session_dir.name}: wrote {result.written} derived attempt crops -> {out_dir}")
    for line in result.skipped:
        print(f"  skipped {line}")

    if args.validate and result.comparisons:
        diffs = [c.mean_abs_diff for c in result.comparisons]
        print(
            f"  compared {len(diffs)} attempts: mean abs pixel diff "
            f"min={min(diffs):.2f} median={float(np.median(diffs)):.2f} "
            f"mean={float(np.mean(diffs)):.2f} max={max(diffs):.2f} (0-255)"
        )
        size_mismatches = [
            c for c in result.comparisons if c.derived_size != c.recorded_size
        ]
        if size_mismatches:
            print(f"  size mismatches ({len(size_mismatches)}):")
            for c in size_mismatches[:10]:
                print(f"    {c.name} derived {c.derived_size} vs recorded {c.recorded_size}")
        worst = sorted(result.comparisons, key=lambda c: -c.mean_abs_diff)[:5]
        print("  worst attempts:")
        for c in worst:
            extra = (
                f" (180-flipped: {c.flipped_mean_abs_diff:.2f})"
                if c.flipped_mean_abs_diff is not None
                else ""
            )
            print(f"    {c.name} [{c.kind}] diff={c.mean_abs_diff:.2f}{extra}")


if __name__ == "__main__":
    main()
