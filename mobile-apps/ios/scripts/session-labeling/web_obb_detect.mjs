// Run the web scanner's YOLO11n-OBB card detector (TF.js weights in
// frontend/public/models/yolo-card-detector) on one image, printing top
// oriented-box detections as normalized quads. Node-side twin of
// frontend/src/lib/scan/yolo-detector.ts: bottom-right 114 letterbox to
// square, 640 bilinear, /255; output [1,6,8400] channel-major
// (cx,cy,w,h,conf,angle) in 640-space, /scale back to source pixels.
//
// Usage: node web_obb_detect.mjs <image> [confThreshold] [maxDets]
// Called by alt_detectors.py (webobb / webobb+sam detectors; binder page
// re-scan passes maxDets=12 to get every pocket).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../.."); // mobile-apps/ios/scripts/session-labeling -> repo root
const feRequire = createRequire(resolve(ROOT, "frontend/package.json"));
const beRequire = createRequire(resolve(ROOT, "backend/package.json"));
const tf = feRequire("@tensorflow/tfjs");
const sharp = beRequire("sharp");

const MODEL_DIR = resolve(ROOT, "frontend/public/models/yolo-card-detector");
const FRAME = process.argv[2];
const CONF = Number(process.argv[3] ?? 0.05);
const MAX_DETS = Number(process.argv[4] ?? 3);
const SIZE = 640;

function fsIOHandler(dir) {
  return {
    load: async () => {
      const modelJson = JSON.parse(readFileSync(resolve(dir, "model.json"), "utf8"));
      const manifest = modelJson.weightsManifest;
      const weightSpecs = manifest.flatMap((g) => g.weights);
      const weightData = Buffer.concat(
        manifest.flatMap((g) => g.paths.map((p) => readFileSync(resolve(dir, p)))),
      );
      return {
        modelTopology: modelJson.modelTopology,
        format: modelJson.format,
        generatedBy: modelJson.generatedBy,
        convertedBy: modelJson.convertedBy,
        weightSpecs,
        weightData: weightData.buffer.slice(
          weightData.byteOffset,
          weightData.byteOffset + weightData.byteLength,
        ),
      };
    },
  };
}

const { data, info } = await sharp(FRAME)
  .rotate() // honor EXIF orientation, like browser rendering does
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const srcW = info.width;
const srcH = info.height;
const maxDim = Math.max(srcW, srcH);
const scale = SIZE / maxDim;

await tf.setBackend("cpu");
const model = await tf.loadGraphModel(fsIOHandler(MODEL_DIR));

const input = tf.tidy(() => {
  const img = tf.tensor3d(new Uint8Array(data), [srcH, srcW, 3], "int32");
  const padded = img.pad([[0, maxDim - srcH], [0, maxDim - srcW], [0, 0]], 114);
  return tf.image.resizeBilinear(padded, [SIZE, SIZE]).div(255.0).expandDims(0);
});
let out = model.predict(input);
if (Array.isArray(out)) out = out[0];
const raw = await out.data();
const N = out.shape[2];

const dets = [];
for (let i = 0; i < N; i++) {
  const conf = raw[4 * N + i];
  if (conf < CONF) continue;
  const cx = raw[i] / scale;
  const cy = raw[N + i] / scale;
  const w = raw[2 * N + i] / scale;
  const h = raw[3 * N + i] / scale;
  const angle = raw[5 * N + i] ?? 0;
  if (cx < 0 || cy < 0 || cx > srcW || cy > srcH) continue;
  if (w < 20 || h < 20) continue;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const quad = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([dx, dy]) => [
      (cx + dx * cos - dy * sin) / srcW,
      (cy + dx * sin + dy * cos) / srcH,
    ]);
  dets.push({ confidence: conf, quad });
}
dets.sort((a, b) => b.confidence - a.confidence);
// Greedy axis-aligned NMS, mirroring nmsOBB's approximation.
const kept = [];
for (const d of dets) {
  const bb = (q) => {
    const xs = q.quad.map((p) => p[0]);
    const ys = q.quad.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const [ax0, ay0, ax1, ay1] = bb(d);
  const clash = kept.some((k) => {
    const [bx0, by0, bx1, by1] = bb(k);
    const ix = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
    const iy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
    const inter = ix * iy;
    const union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter;
    return inter / Math.max(union, 1e-9) > 0.45;
  });
  if (!clash) kept.push(d);
  if (kept.length >= MAX_DETS) break;
}
console.log(JSON.stringify(kept));
