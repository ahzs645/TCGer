/**
 * Browser-side YOLO11n-OBB card detector using TensorFlow.js.
 *
 * Ported from Pokemon-TCGP-Card-Scanner and Riftbound Scanner.
 * Loads a TF.js graph model and runs inference on video frames
 * to detect card locations with oriented bounding boxes.
 */

import type { VideoQuad, VideoQuadPoint } from "./scan-types";

// Lazy-load TensorFlow.js to avoid SSR issues
let tf: typeof import("@tensorflow/tfjs") | null = null;

const MODEL_INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.25;
const NMS_IOU_THRESHOLD = 0.45;
const MODEL_URL = "/models/yolo-card-detector/model.json";

// ---------- types ----------

export interface OBBDetection {
  cx: number;
  cy: number;
  width: number;
  height: number;
  confidence: number;
  angle: number;
  quad: VideoQuad;
}

interface YoloSession {
  model: Awaited<ReturnType<typeof import("@tensorflow/tfjs")["loadGraphModel"]>>;
  warmedUp: boolean;
}

// ---------- singleton session ----------

let session: YoloSession | null = null;
let loadingPromise: Promise<YoloSession> | null = null;

/**
 * Load and warm up the YOLO model. Returns immediately if already loaded.
 */
export async function ensureYoloModel(
  onProgress?: (message: string) => void,
): Promise<void> {
  if (session?.warmedUp) return;
  if (loadingPromise) {
    await loadingPromise;
    return;
  }

  loadingPromise = (async () => {
    if (!tf) {
      onProgress?.("Loading TensorFlow.js...");
      tf = await import("@tensorflow/tfjs");
      await tf.ready();
    }

    onProgress?.("Loading YOLO model (~10 MB)...");
    const model = await tf.loadGraphModel(MODEL_URL);

    // Warmup with a dummy tensor
    onProgress?.("Warming up detector...");
    const dummy = tf.zeros([1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 3]);
    const warmupResult = model.predict(dummy);
    if (Array.isArray(warmupResult)) {
      warmupResult.forEach((t) => t.dispose());
    } else {
      (warmupResult as import("@tensorflow/tfjs").Tensor).dispose();
    }
    dummy.dispose();

    const s: YoloSession = { model, warmedUp: true };
    session = s;
    onProgress?.("Detector ready.");
    return s;
  })();

  await loadingPromise;
}

/**
 * Check if the YOLO model is loaded and ready.
 */
export function isYoloModelReady(): boolean {
  return session?.warmedUp === true;
}

/**
 * Run YOLO detection on a canvas frame.
 * Returns oriented bounding box detections with corner quads.
 */
export function detectCards(
  frameCanvas: HTMLCanvasElement,
): OBBDetection[] {
  if (!tf || !session) return [];
  const tfjs = tf; // local binding for closure narrowing

  const srcW = frameCanvas.width;
  const srcH = frameCanvas.height;

  // Letterbox: pad to square (bottom-right), then resize to 640x640.
  // Padding is top-left aligned so offset in model space is 0.
  const maxDim = Math.max(srcW, srcH);
  const scale = MODEL_INPUT_SIZE / maxDim;

  const inputTensor = tfjs.tidy(() => {
    const img = tfjs.browser.fromPixels(frameCanvas); // [H, W, 3] uint8

    // Pad to square with gray (114) then resize to 640x640
    const padded = img.pad(
      [
        [0, maxDim - srcH],
        [0, maxDim - srcW],
        [0, 0],
      ],
      114, // gray padding in 0-255 space
    );

    return tfjs.image
      .resizeBilinear(padded as import("@tensorflow/tfjs").Tensor3D, [
        MODEL_INPUT_SIZE,
        MODEL_INPUT_SIZE,
      ])
      .div(255.0)
      .expandDims(0); // [1, 640, 640, 3]
  });

  // Inference
  const rawOutput = session.model.predict(inputTensor);
  inputTensor.dispose();

  // Extract output data
  let outputTensor: import("@tensorflow/tfjs").Tensor;
  if (Array.isArray(rawOutput)) {
    outputTensor = rawOutput[0]!;
    rawOutput.slice(1).forEach((t) => t.dispose());
  } else {
    outputTensor = rawOutput as import("@tensorflow/tfjs").Tensor;
  }

  const outputData = outputTensor.dataSync() as Float32Array;
  const dims = outputTensor.shape;
  outputTensor.dispose();

  // Parse detections from [1, 6, 8400] channel-major format
  const detections = parseRawDetections(
    outputData,
    dims,
    srcW,
    srcH,
    scale,
  );

  // NMS
  return nmsOBB(detections);
}

// ---------- output parsing ----------

function parseRawDetections(
  data: Float32Array,
  dims: number[],
  srcW: number,
  srcH: number,
  scale: number,
): OBBDetection[] {
  const detections: OBBDetection[] = [];

  // Output: [1, 6, N] — channel-major (cx, cy, w, h, conf, angle) × N anchors
  if (dims.length === 3 && dims[1]! <= 20) {
    const N = dims[2]!;
    for (let i = 0; i < N; i++) {
      const conf = data[4 * N + i]!;
      if (conf < CONFIDENCE_THRESHOLD) continue;

      // Model outputs pixel coords in 640x640 space.
      // Divide by scale to map back to original frame coords.
      // (Padding is bottom-right so no offset to subtract.)
      const cx = data[i]! / scale;
      const cy = data[N + i]! / scale;
      const w = data[2 * N + i]! / scale;
      const h = data[3 * N + i]! / scale;
      const angle = data[5 * N + i] ?? 0;

      if (cx < 0 || cy < 0 || cx > srcW || cy > srcH) continue;
      if (w < 20 || h < 20) continue;

      detections.push({
        cx,
        cy,
        width: w,
        height: h,
        confidence: conf,
        angle,
        quad: obbToQuad(cx, cy, w, h, angle),
      });
    }
  }

  return detections;
}

// ---------- OBB to quad ----------

function obbToQuad(
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
): VideoQuad {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = w / 2;
  const hh = h / 2;

  // Corners relative to center, rotated by angle
  const corners: [number, number][] = [
    [-hw, -hh], // top-left
    [hw, -hh], // top-right
    [hw, hh], // bottom-right
    [-hw, hh], // bottom-left
  ];

  return corners.map(([dx, dy]) => ({
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  })) as VideoQuad;
}

// ---------- NMS ----------

function nmsOBB(detections: OBBDetection[]): OBBDetection[] {
  detections.sort((a, b) => b.confidence - a.confidence);
  const kept: OBBDetection[] = [];

  for (const det of detections) {
    const dominated = kept.some(
      (k) => axisAlignedIou(det, k) > NMS_IOU_THRESHOLD,
    );
    if (!dominated) {
      kept.push(det);
    }
  }

  return kept;
}

function axisAlignedIou(a: OBBDetection, b: OBBDetection): number {
  const x1 = Math.max(a.cx - a.width / 2, b.cx - b.width / 2);
  const y1 = Math.max(a.cy - a.height / 2, b.cy - b.height / 2);
  const x2 = Math.min(a.cx + a.width / 2, b.cx + b.width / 2);
  const y2 = Math.min(a.cy + a.height / 2, b.cy + b.height / 2);

  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
