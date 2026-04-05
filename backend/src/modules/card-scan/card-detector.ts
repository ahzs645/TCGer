/**
 * ONNX-based card detector for OBB (Oriented Bounding Box) detection.
 *
 * Wraps a YOLO OBB model to detect trading cards in video frames.
 * Supports both raw anchor output [1, 6, N] and post-NMS output [1, N, 7].
 * Auto-detects format from model output shape.
 */

import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';

export interface OBBDetection {
  cx: number;
  cy: number;
  width: number;
  height: number;
  confidence: number;
  angle: number;
}

interface DetectorState {
  session: ort.InferenceSession;
  inputName: string;
  inputSize: number;
  inputLayout: 'nchw' | 'nhwc';
  outputFormat: 'raw' | 'post-nms';
}

let state: DetectorState | null = null;

const NMS_IOU_THRESHOLD = 0.45;

export async function initCardDetector(
  modelPath: string,
  inputSize: number
): Promise<void> {
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
  });

  const inputNames = session.inputNames;
  const inputName = inputNames[0] ?? 'images';

  // Detect input layout: try NCHW first, fall back to NHWC
  let inputLayout: 'nchw' | 'nhwc' = 'nchw';
  let warmup: ort.InferenceSession.ReturnType;
  const dummy = new Float32Array(3 * inputSize * inputSize).fill(0.5);
  try {
    const tensor = new ort.Tensor('float32', dummy, [1, 3, inputSize, inputSize]);
    warmup = await session.run({ [inputName]: tensor });
  } catch {
    inputLayout = 'nhwc';
    const tensor = new ort.Tensor('float32', dummy, [1, inputSize, inputSize, 3]);
    warmup = await session.run({ [inputName]: tensor });
  }
  const outputKey = Object.keys(warmup)[0]!;
  const dims = warmup[outputKey]!.dims;

  // [1, 6, 8400] = raw anchors (channels-first), [1, 300, 7] = post-NMS
  const outputFormat: 'raw' | 'post-nms' =
    dims.length === 3 && dims[1]! <= 20 ? 'raw' : 'post-nms';

  console.error(
    `[detector] loaded ${modelPath} | input=${inputName} ${inputSize}x${inputSize} (${inputLayout}) | output=${outputKey} [${dims.join(',')}] (${outputFormat})`
  );

  state = { session, inputName, inputSize, inputLayout, outputFormat };
}

export async function detectCards(
  frameBuffer: Buffer,
  confidenceThreshold = 0.25,
  expandRatio = 0.08
): Promise<OBBDetection[]> {
  if (!state) throw new Error('Card detector not initialised — call initCardDetector first');

  const { session, inputName, inputSize, inputLayout, outputFormat } = state;

  const meta = await sharp(frameBuffer).metadata();
  const srcW = meta.width!;
  const srcH = meta.height!;

  // Letterbox: scale to fit inputSize, pad with gray (114)
  const scale = Math.min(inputSize / srcW, inputSize / srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);
  const padLeft = Math.round((inputSize - newW) / 2);
  const padTop = Math.round((inputSize - newH) / 2);

  const rgb = await sharp(frameBuffer)
    .resize(newW, newH, { fit: 'fill' })
    .extend({
      top: padTop,
      bottom: inputSize - newH - padTop,
      left: padLeft,
      right: inputSize - newW - padLeft,
      background: { r: 114, g: 114, b: 114 },
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  const pixels = inputSize * inputSize;
  const inputData = new Float32Array(3 * pixels);

  if (inputLayout === 'nchw') {
    for (let i = 0; i < pixels; i++) {
      inputData[i] = rgb[i * 3]! / 255;
      inputData[pixels + i] = rgb[i * 3 + 1]! / 255;
      inputData[2 * pixels + i] = rgb[i * 3 + 2]! / 255;
    }
  } else {
    // NHWC: interleaved RGB
    for (let i = 0; i < pixels; i++) {
      inputData[i * 3] = rgb[i * 3]! / 255;
      inputData[i * 3 + 1] = rgb[i * 3 + 1]! / 255;
      inputData[i * 3 + 2] = rgb[i * 3 + 2]! / 255;
    }
  }

  const shape: number[] = inputLayout === 'nchw'
    ? [1, 3, inputSize, inputSize]
    : [1, inputSize, inputSize, 3];
  const tensor = new ort.Tensor('float32', inputData, shape);
  const results = await session.run({ [inputName]: tensor });
  const output = results[Object.keys(results)[0]!]!;
  const data = output.data as Float32Array;
  const dims = output.dims as number[];

  let detections: OBBDetection[];

  if (outputFormat === 'post-nms') {
    // [1, N, 7]: cx, cy, w, h, conf, class_id, angle
    const N = dims[1]!;
    detections = [];
    for (let i = 0; i < N; i++) {
      const off = i * 7;
      const conf = data[off + 4]!;
      if (conf < confidenceThreshold) continue;
      detections.push({
        cx: (data[off]! - padLeft) / scale,
        cy: (data[off + 1]! - padTop) / scale,
        width: data[off + 2]! / scale,
        height: data[off + 3]! / scale,
        confidence: conf,
        angle: data[off + 6]!,
      });
    }
  } else {
    // [1, 6, N]: transposed — channel-major
    const N = dims[2]!;
    const raw: OBBDetection[] = [];
    for (let i = 0; i < N; i++) {
      const conf = data[4 * N + i]!;
      if (conf < confidenceThreshold) continue;
      raw.push({
        cx: (data[i]! - padLeft) / scale,
        cy: (data[N + i]! - padTop) / scale,
        width: data[2 * N + i]! / scale,
        height: data[3 * N + i]! / scale,
        confidence: conf,
        angle: data[5 * N + i]!,
      });
    }
    detections = nms(raw);
  }

  // Optionally expand boxes to capture full card borders
  if (expandRatio > 0) {
    for (const d of detections) {
      d.width *= 1 + expandRatio;
      d.height *= 1 + expandRatio;
    }
  }

  return detections.sort((a, b) => b.confidence - a.confidence);
}

function nms(detections: OBBDetection[]): OBBDetection[] {
  detections.sort((a, b) => b.confidence - a.confidence);
  const kept: OBBDetection[] = [];
  for (const det of detections) {
    if (kept.some((k) => iou(det, k) > NMS_IOU_THRESHOLD)) continue;
    kept.push(det);
  }
  return kept;
}

function iou(a: OBBDetection, b: OBBDetection): number {
  const x1 = Math.max(a.cx - a.width / 2, b.cx - b.width / 2);
  const y1 = Math.max(a.cy - a.height / 2, b.cy - b.height / 2);
  const x2 = Math.min(a.cx + a.width / 2, b.cx + b.width / 2);
  const y2 = Math.min(a.cy + a.height / 2, b.cy + b.height / 2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export function detectionToExtractRegion(
  det: OBBDetection,
  frameWidth: number,
  frameHeight: number
): { left: number; top: number; width: number; height: number } {
  // Axis-aligned bounding box (ignores small angle for now)
  const left = Math.max(0, Math.round(det.cx - det.width / 2));
  const top = Math.max(0, Math.round(det.cy - det.height / 2));
  const right = Math.min(frameWidth, Math.round(det.cx + det.width / 2));
  const bottom = Math.min(frameHeight, Math.round(det.cy + det.height / 2));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/**
 * Extract a de-rotated card crop from a frame using OBB parameters.
 *
 * 1. Extract a generous square around the detection center
 * 2. Rotate that square by -angle so the card becomes upright
 * 3. Extract the card-sized rectangle from the centre of the rotated image
 */
export async function extractRotatedCrop(
  frameBuffer: Buffer,
  det: OBBDetection,
  frameWidth: number,
  frameHeight: number
): Promise<Buffer> {
  const angleDeg = (det.angle * 180) / Math.PI;

  // For very small angles, skip rotation entirely
  if (Math.abs(angleDeg) < 2) {
    const region = detectionToExtractRegion(det, frameWidth, frameHeight);
    return sharp(frameBuffer).extract(region).toBuffer();
  }

  // Extract a generous region around the detection centre.
  // The region must be large enough to contain the full rotated card.
  const diag = Math.ceil(Math.hypot(det.width, det.height));
  const margin = Math.round(diag * 0.15);
  const regionSize = diag + margin * 2;

  const regionLeft = Math.max(0, Math.round(det.cx - regionSize / 2));
  const regionTop = Math.max(0, Math.round(det.cy - regionSize / 2));
  const regionRight = Math.min(frameWidth, Math.round(det.cx + regionSize / 2));
  const regionBottom = Math.min(frameHeight, Math.round(det.cy + regionSize / 2));
  const rw = regionRight - regionLeft;
  const rh = regionBottom - regionTop;

  if (rw <= 0 || rh <= 0) {
    const region = detectionToExtractRegion(det, frameWidth, frameHeight);
    return sharp(frameBuffer).extract(region).toBuffer();
  }

  // Extract the generous region, rotate, then crop the card centre
  const rotated = await sharp(frameBuffer)
    .extract({ left: regionLeft, top: regionTop, width: rw, height: rh })
    .rotate(-angleDeg, { background: { r: 114, g: 114, b: 114, alpha: 1 } })
    .png()
    .toBuffer({ resolveWithObject: true });

  const rotW = rotated.info.width;
  const rotH = rotated.info.height;

  // The card should now be centred and upright — extract it
  const cardW = Math.round(det.width);
  const cardH = Math.round(det.height);
  const cropLeft = Math.max(0, Math.round((rotW - cardW) / 2));
  const cropTop = Math.max(0, Math.round((rotH - cardH) / 2));
  const cropW = Math.min(cardW, rotW - cropLeft);
  const cropH = Math.min(cardH, rotH - cropTop);

  return sharp(rotated.data)
    .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
    .jpeg()
    .toBuffer();
}

/**
 * Extract the card title text via OCR from a cropped card image.
 * Tries multiple preprocessing variants and picks the best result.
 */
export async function ocrCardTitle(cardCropBuffer: Buffer): Promise<string | null> {
  const meta = await sharp(cardCropBuffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= 0 || h <= 0) return null;

  // Extract upper 15% where the title lives
  const titleRegion = await sharp(cardCropBuffer)
    .extract({ left: 0, top: 0, width: w, height: Math.round(h * 0.15) })
    .toBuffer();

  const targetWidth = Math.max(800, Math.round(w * 2.5));

  // Multiple preprocessing variants (inspired by MTG-Card-Scanner-Sorter)
  const variants = await Promise.all([
    // A: normalize + sharpen (baseline)
    sharp(titleRegion).resize({ width: targetWidth, kernel: 'cubic' })
      .normalize().sharpen({ sigma: 1.5 }).png().toBuffer(),
    // B: median filter (edge-preserving) + strong sharpen
    sharp(titleRegion).resize({ width: targetWidth, kernel: 'cubic' })
      .median(3).sharpen({ sigma: 2 }).normalize().png().toBuffer(),
    // C: grayscale + threshold (dark text on light)
    sharp(titleRegion).resize({ width: targetWidth, kernel: 'cubic' })
      .grayscale().normalize().sharpen({ sigma: 1.5 }).threshold(140).png().toBuffer(),
    // D: inverted (light text on dark backgrounds)
    sharp(titleRegion).resize({ width: targetWidth, kernel: 'cubic' })
      .grayscale().negate().normalize().sharpen({ sigma: 1.5 }).threshold(140).png().toBuffer(),
  ]);

  // Run OCR on all variants in parallel for speed
  const ocrResults = await Promise.all(
    variants.map((v) => Tesseract.recognize(v, 'eng', { logger: () => {} }))
  );

  let bestWord: string | null = null;
  let bestScore = 0;

  for (const result of ocrResults) {
    const words = result.data.text
      .split(/[\s|:,.\n]+/)
      .map((w: string) => w.replace(/[^a-zA-Z'-]/g, ''))
      .filter((w: string) => w.length >= 3);

    for (const word of words) {
      const uniqueChars = new Set(word.toLowerCase()).size;
      if (uniqueChars / word.length < 0.4) continue;
      const score = result.data.confidence * 100 + Math.min(word.length, 12);
      if (score > bestScore) {
        bestScore = score;
        bestWord = word;
      }
    }
  }

  return bestWord;
}

/**
 * Read the collector number from the bottom of a card crop.
 * Looks for patterns like "53/132", "96/130", etc.
 */
export async function ocrCollectorNumber(cardCropBuffer: Buffer): Promise<string | null> {
  const meta = await sharp(cardCropBuffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= 0 || h <= 0) return null;

  const bottomRegion = await sharp(cardCropBuffer)
    .extract({
      left: 0,
      top: Math.round(h * 0.90),
      width: w,
      height: Math.round(h * 0.10),
    })
    .resize({ width: 800 })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .png()
    .toBuffer();

  const result = await Tesseract.recognize(bottomRegion, 'eng', { logger: () => {} });
  const match = result.data.text.match(/(\d{1,4})\s*[/\\]\s*(\d{1,4})/);
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] !== b[j - 1] ? 1 : 0)
      );
    }
  }
  return dp[m]![n]!;
}
