/**
 * Browser-side YOLO11n-OBB card detector using TensorFlow.js.
 *
 * Ported from Pokemon-TCGP-Card-Scanner and Riftbound Scanner.
 * Loads a TF.js graph model and runs inference on video frames
 * to detect card locations with oriented bounding boxes.
 */

import type { VideoQuad } from "./scan-types";

// Lazy-load TensorFlow.js to avoid SSR issues
let tf: typeof import("@tensorflow/tfjs") | null = null;

const MODEL_INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.25;
const NMS_IOU_THRESHOLD = 0.45;
const MODEL_URL = "/models/yolo-card-detector/model.json";
const WASM_BACKEND_PATH =
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/";
const PREFERRED_BACKENDS = ["webgpu", "webgl", "wasm", "cpu"] as const;

// ---------- types ----------

type TfBackendName = (typeof PREFERRED_BACKENDS)[number];
type BackendAttemptStatus = "selected" | "failed" | "skipped";

export interface OBBDetection {
  cx: number;
  cy: number;
  width: number;
  height: number;
  confidence: number;
  angle: number;
  quad: VideoQuad;
}

export interface YoloBackendAttempt {
  backend: TfBackendName;
  status: BackendAttemptStatus;
  message?: string;
}

export interface YoloRuntimeStatus {
  tfjsLoaded: boolean;
  modelLoaded: boolean;
  warmedUp: boolean;
  backendReady: boolean;
  backendSelectionPending: boolean;
  selectedBackend: string | null;
  preferredBackends: TfBackendName[];
  attempts: YoloBackendAttempt[];
}

interface YoloSession {
  model: Awaited<
    ReturnType<(typeof import("@tensorflow/tfjs"))["loadGraphModel"]>
  >;
  warmedUp: boolean;
}

// ---------- singleton session ----------

let session: YoloSession | null = null;
let loadingPromise: Promise<YoloSession> | null = null;
let backendSelectionPromise: Promise<void> | null = null;
let backendReady = false;
let selectedBackend: string | null = null;
let backendAttempts: YoloBackendAttempt[] = [];

// ---------- backend selection / diagnostics ----------

async function ensureTfBackend(
  tfjs: typeof import("@tensorflow/tfjs"),
  onProgress?: (message: string) => void,
): Promise<void> {
  if (backendReady) return;

  backendSelectionPromise ??= selectTfBackend(tfjs, onProgress);
  try {
    await backendSelectionPromise;
  } catch (error) {
    backendSelectionPromise = null;
    throw error;
  }
}

async function selectTfBackend(
  tfjs: typeof import("@tensorflow/tfjs"),
  onProgress?: (message: string) => void,
): Promise<void> {
  backendAttempts = [];
  backendReady = false;
  selectedBackend = null;

  for (const backend of PREFERRED_BACKENDS) {
    try {
      const skipReason = await prepareTfBackend(backend);
      if (skipReason) {
        backendAttempts.push({
          backend,
          status: "skipped",
          message: skipReason,
        });
        continue;
      }

      onProgress?.(`Selecting TensorFlow.js ${backend} backend...`);
      const ok = await tfjs.setBackend(backend);
      await tfjs.ready();
      const activeBackend = tfjs.getBackend();
      if (!ok || activeBackend !== backend) {
        throw new Error(
          `tf.setBackend("${backend}") returned ${String(ok)}; active backend is "${activeBackend}".`,
        );
      }

      selectedBackend = activeBackend;
      backendReady = true;
      backendAttempts.push({
        backend,
        status: "selected",
        message: "Ready",
      });
      onProgress?.(`TensorFlow.js backend ready: ${activeBackend}.`);
      return;
    } catch (error) {
      backendAttempts.push({
        backend,
        status: "failed",
        message: getErrorMessage(error),
      });
    }
  }

  throw new Error(
    `No usable TensorFlow.js backend found. Attempts: ${backendAttempts
      .map((attempt) => `${attempt.backend}:${attempt.status}`)
      .join(", ")}`,
  );
}

async function prepareTfBackend(
  backend: TfBackendName,
): Promise<string | null> {
  if (backend === "webgpu") {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) {
      return "navigator.gpu is not available.";
    }

    await import("@tensorflow/tfjs-backend-webgpu");
    return null;
  }

  if (backend === "webgl") {
    if (typeof document === "undefined") {
      return "document is not available.";
    }

    return null;
  }

  if (backend === "wasm") {
    const wasm = await import("@tensorflow/tfjs-backend-wasm");
    wasm.setWasmPaths(WASM_BACKEND_PATH, true);
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getActiveTfBackend(): string | null {
  if (!tf) return selectedBackend;

  try {
    return tf.getBackend() ?? selectedBackend;
  } catch {
    return selectedBackend;
  }
}

/**
 * Inspect the current TensorFlow.js / YOLO runtime state for diagnostics.
 */
export function getYoloRuntimeStatus(): YoloRuntimeStatus {
  return {
    tfjsLoaded: tf !== null,
    modelLoaded: session !== null,
    warmedUp: session?.warmedUp === true,
    backendReady,
    backendSelectionPending: backendSelectionPromise !== null && !backendReady,
    selectedBackend: getActiveTfBackend(),
    preferredBackends: [...PREFERRED_BACKENDS],
    attempts: backendAttempts.map((attempt) => ({ ...attempt })),
  };
}

/**
 * Log the selected backend and backend-attempt history for diagnostics.
 */
export function logYoloRuntimeStatus(
  logger: {
    info: (message?: unknown, ...optionalParams: unknown[]) => void;
  } = console,
): void {
  logger.info("[YOLO] TensorFlow.js runtime", getYoloRuntimeStatus());
}

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
    }

    await ensureTfBackend(tf, onProgress);

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

  try {
    await loadingPromise;
  } catch (error) {
    loadingPromise = null;
    throw error;
  }
}

/**
 * Check if the YOLO model is loaded and ready.
 */
export function isYoloModelReady(): boolean {
  return session?.warmedUp === true;
}

/**
 * Extract a de-rotated card crop from the frame canvas using an OBB detection.
 * Returns a new canvas containing just the card, axis-aligned.
 *
 * `sourceScale` maps detection coordinates (in `frameCanvas`'s space) into the
 * source canvas's space: pass a higher-resolution capture of the same frame
 * plus its size ratio to crop at source resolution. Crop resolution is the
 * dominant recognition-accuracy lever (offline: 640px-frame crops caused every
 * misidentification; full-res crops fixed all of them).
 */
export function extractCardCrop(
  frameCanvas: HTMLCanvasElement,
  det: OBBDetection,
  sourceScale = 1,
): HTMLCanvasElement {
  const cx = det.cx * sourceScale;
  const cy = det.cy * sourceScale;
  const cardW = Math.round(det.width * sourceScale);
  const cardH = Math.round(det.height * sourceScale);
  if (cardW < 10 || cardH < 10) {
    // Too small — return a tiny canvas
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    return c;
  }

  // Canvas large enough to hold the rotated card
  const diag = Math.ceil(Math.hypot(cardW, cardH));
  const bufferSize = diag + 20;
  const buffer = document.createElement("canvas");
  buffer.width = bufferSize;
  buffer.height = bufferSize;
  const bCtx = buffer.getContext("2d")!;

  // Translate to center, rotate to undo card angle, draw source
  const bcx = bufferSize / 2;
  const bcy = bufferSize / 2;
  bCtx.translate(bcx, bcy);
  bCtx.rotate(-det.angle);
  bCtx.drawImage(frameCanvas, -cx, -cy);
  bCtx.setTransform(1, 0, 0, 1, 0, 0);

  // Extract the card rectangle from the center of the rotated buffer
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cardW;
  cropCanvas.height = cardH;
  const cropCtx = cropCanvas.getContext("2d")!;
  cropCtx.drawImage(
    buffer,
    bcx - cardW / 2,
    bcy - cardH / 2,
    cardW,
    cardH,
    0,
    0,
    cardW,
    cardH,
  );

  return cropCanvas;
}

/**
 * Run YOLO detection on a canvas frame.
 * Returns oriented bounding box detections with corner quads.
 */
export async function detectCards(
  frameCanvas: HTMLCanvasElement,
): Promise<OBBDetection[]> {
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
  let rawOutput:
    | import("@tensorflow/tfjs").Tensor
    | import("@tensorflow/tfjs").Tensor[];
  try {
    rawOutput = session.model.predict(inputTensor) as
      | import("@tensorflow/tfjs").Tensor
      | import("@tensorflow/tfjs").Tensor[];
  } finally {
    inputTensor.dispose();
  }

  // Extract output data
  let outputTensor: import("@tensorflow/tfjs").Tensor;
  if (Array.isArray(rawOutput)) {
    outputTensor = rawOutput[0]!;
    rawOutput.slice(1).forEach((t) => t.dispose());
  } else {
    outputTensor = rawOutput as import("@tensorflow/tfjs").Tensor;
  }

  const dims = outputTensor.shape;
  let outputData: Float32Array;
  try {
    outputData = (await outputTensor.data()) as Float32Array;
  } finally {
    outputTensor.dispose();
  }

  // Parse detections from [1, 6, 8400] channel-major format
  const detections = parseRawDetections(outputData, dims, srcW, srcH, scale);

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
