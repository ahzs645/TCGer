/**
 * Cheap pre-embedding quality gate (<2 ms on a small crop).
 *
 * The single biggest accuracy lever per docs/client-side-scanner-options.md:
 * today every frame is embedded with no sharpness check. Blurry / moving frames
 * are exactly where the embedding backbone degrades worst (the benchmark's
 * stacked "handheld" case dropped DINOv2 to 69%), so we skip embedding them and
 * keep accumulating until a sharp, still frame arrives.
 *
 *   - Focus  : variance of the Laplacian on a downscaled grayscale crop.
 *              Higher = sharper. Below `minFocusVariance` ⇒ too blurry.
 *   - Motion : mean absolute grayscale difference vs the previous frame.
 *              Above `maxFrameDiff` ⇒ camera/card still moving.
 *
 * Default thresholds were calibrated on catalog images (sharp vs progressively
 * blurred): typical clean cards score ~3000–3700, blur3 ~1400–1830, blur4
 * ~900–1240. `minFocusVariance` sits at 1200 to reject only catastrophic blur.
 * These are content-dependent — RECALIBRATE on labeled real frames (task 8).
 */

import { createCanvas, getContext2d } from "./canvas-utils";

const GATE_SIZE = 96;

export interface QualityGateConfig {
  /** Reject crops whose Laplacian variance is below this (too blurry). */
  minFocusVariance: number;
  /** Reject frames whose mean grayscale delta exceeds this (too much motion). */
  maxFrameDiff: number;
}

export const DEFAULT_QUALITY_GATE: QualityGateConfig = {
  minFocusVariance: 1200,
  maxFrameDiff: 12,
};

/** Downscale a canvas to a GATE_SIZE×GATE_SIZE grayscale buffer (luma). */
export function computeGrayDownsample(
  canvas: HTMLCanvasElement,
  size = GATE_SIZE,
): Float32Array {
  const small = createCanvas(size, size);
  const ctx = getContext2d(small);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const gray = new Float32Array(size * size);
  for (let i = 0; i < gray.length; i++) {
    // Rec. 601 luma
    gray[i] =
      0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  }
  return gray;
}

/**
 * Variance of the 4-neighbour Laplacian over a grayscale buffer.
 * Higher = sharper (more high-frequency detail).
 */
export function computeFocusVariance(
  gray: Float32Array,
  size = GATE_SIZE,
): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const lap =
        4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - size]! - gray[i + size]!;
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Mean absolute grayscale difference between two equal-length buffers. */
export function computeFrameDiff(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let acc = 0;
  for (let i = 0; i < len; i++) acc += Math.abs(a[i]! - b[i]!);
  return acc / len;
}

export interface CropQuality {
  focusVariance: number;
  sharp: boolean;
}

/** Assess whether a card crop is sharp enough to embed. */
export function assessCropSharpness(
  cropCanvas: HTMLCanvasElement,
  config: QualityGateConfig = DEFAULT_QUALITY_GATE,
): CropQuality {
  const gray = computeGrayDownsample(cropCanvas);
  const focusVariance = computeFocusVariance(gray);
  return { focusVariance, sharp: focusVariance >= config.minFocusVariance };
}

export interface FrameMotion {
  frameDiff: number;
  still: boolean;
  /** Grayscale of this frame — pass back in as `prevGray` next frame. */
  gray: Float32Array;
}

/**
 * Assess frame stillness against the previous frame's grayscale. The first
 * frame (no `prevGray`) is treated as still so scanning can start.
 */
export function assessFrameMotion(
  frameCanvas: HTMLCanvasElement,
  prevGray: Float32Array | null,
  config: QualityGateConfig = DEFAULT_QUALITY_GATE,
): FrameMotion {
  const gray = computeGrayDownsample(frameCanvas);
  if (!prevGray) return { frameDiff: 0, still: true, gray };
  const frameDiff = computeFrameDiff(gray, prevGray);
  return { frameDiff, still: frameDiff <= config.maxFrameDiff, gray };
}
