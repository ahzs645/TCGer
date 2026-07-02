/**
 * Build an auto-labeled card-crop dataset from an evaluation video.
 *
 * Samples frames, runs the YOLO card detector, saves each detection crop as a
 * JPEG, and labels crops using the video ground-truth windows:
 *   - timestamp inside a window (with margin trimmed)  -> "card-face"
 *   - timestamp outside every window (with buffer)     -> "negative"
 *   - timestamp within the buffer zone of any window   -> "uncertain" (excluded from training)
 *
 * Ground-truth windows are coarse reveal intervals, so labels are weak; the
 * buffer zone absorbs transition frames on window edges.
 *
 * Usage:
 *   npm run tsx src/scripts/build-video-crop-dataset.ts -- \
 *     --video <video.mp4> \
 *     --ground-truth fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.json \
 *     --out-dir /tmp/tcger-video-crops
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';
import * as tf from '@tensorflow/tfjs';

// The native backend makes YOLO ~10x faster for this offline pass; the
// runtime scanners never use it, so it only affects dataset build speed.
// tfjs-node still calls util.isNullOrUndefined, which Node >= 23 removed.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeUtil = require('node:util') as Record<string, unknown>;
  if (typeof nodeUtil.isNullOrUndefined !== 'function') {
    nodeUtil.isNullOrUndefined = (value: unknown) => value === null || value === undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@tensorflow/tfjs-node');
} catch {
  // fall back to the pure-JS CPU backend
}

type Box = {
  cx: number;
  cy: number;
  width: number;
  height: number;
  confidence: number;
  angle: number;
};

type GroundTruthWindow = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  name: string;
  expectedExternalIds?: string[];
  tags?: string[];
};

type CropRecord = {
  file: string;
  timestampSeconds: number;
  label: 'card-face' | 'negative' | 'uncertain';
  windowId: string | null;
  windowName: string | null;
  expectedExternalIds: string[];
  windowTags: string[];
  yoloConfidence: number;
  box: { cx: number; cy: number; width: number; height: number; angle: number };
  cropWidth: number;
  cropHeight: number;
  aspectRatio: number;
};

const MODEL_INPUT_SIZE = 640;
const YOLO_CONFIDENCE_THRESHOLD = 0.25;
const YOLO_NMS_IOU_THRESHOLD = 0.45;

function parseArgs() {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]!;
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, 'true');
    }
  }

  if (args.has('help') || args.has('h')) {
    printUsage();
    process.exit(0);
  }

  const video = args.get('video');
  const groundTruth = args.get('ground-truth') ?? args.get('gt');
  if (!video) throw new Error('Missing --video /path/to/video.mp4');
  if (!groundTruth) throw new Error('Missing --ground-truth /path/to/ground-truth.json');

  return {
    video,
    groundTruth,
    outDir: args.get('out-dir') ?? '/tmp/tcger-video-crop-dataset',
    sampleSeconds: Number(args.get('sample-seconds') ?? '2'),
    maxFrames: Number(args.get('max-frames') ?? '0'),
    windowMarginSeconds: Number(args.get('window-margin') ?? '1'),
    negativeBufferSeconds: Number(args.get('negative-buffer') ?? '4'),
    modelUrl: args.get('model-url') ?? 'http://localhost:3003/models/yolo-card-detector/model.json',
  };
}

function printUsage() {
  console.log(`Usage:
  tsx src/scripts/build-video-crop-dataset.ts --video <video.mp4> --ground-truth <gt.json> [options]

Options:
  --out-dir <path>          output directory (default: /tmp/tcger-video-crop-dataset)
  --sample-seconds <n>      seconds between sampled frames (default: 2)
  --max-frames <n>          stop after n frames, useful for smoke tests
  --window-margin <n>       trim n seconds inside each window edge for card-face labels (default: 1)
  --negative-buffer <n>     require n seconds distance from any window for negative labels (default: 4)
  --model-url <url>         YOLO TF.js model URL (default: frontend dev server)`);
}

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${cmd} failed:\n${result.stderr || result.stdout}`);
  }
}

function extractFrames(video: string, outDir: string, sampleSeconds: number) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    video,
    '-vf',
    `fps=1/${sampleSeconds},scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)'`,
    '-q:v',
    '2',
    path.join(outDir, 'frame-%05d.jpg'),
  ]);
}

async function readRgbImage(file: string) {
  const image = sharp(file).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const data = await image.removeAlpha().raw().toBuffer();
  return { data, width, height };
}

async function loadYolo(modelUrl: string) {
  await tf.ready();
  const backend = tf.getBackend() ?? 'unknown';
  const model = await tf.loadGraphModel(modelUrl);
  const dummy = tf.zeros([1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 3]);
  const warmup = model.predict(dummy);
  if (Array.isArray(warmup)) warmup.forEach((t) => t.dispose());
  else (warmup as tf.Tensor).dispose();
  dummy.dispose();
  return { model, backend };
}

function detectCards(
  model: tf.GraphModel,
  rgb: Uint8Array | Buffer,
  width: number,
  height: number,
) {
  const maxDim = Math.max(width, height);
  const scale = MODEL_INPUT_SIZE / maxDim;

  const input = tf.tidy(() => {
    const image = tf.tensor3d(rgb, [height, width, 3], 'int32');
    const padded = image.pad(
      [
        [0, maxDim - height],
        [0, maxDim - width],
        [0, 0],
      ],
      114,
    );
    return tf.image
      .resizeBilinear(padded as tf.Tensor3D, [MODEL_INPUT_SIZE, MODEL_INPUT_SIZE])
      .div(255)
      .expandDims(0);
  });

  const raw = model.predict(input);
  input.dispose();
  let output: tf.Tensor;
  if (Array.isArray(raw)) {
    output = raw[0]!;
    raw.slice(1).forEach((t) => t.dispose());
  } else {
    output = raw as tf.Tensor;
  }

  const data = output.dataSync() as Float32Array;
  const dims = output.shape;
  output.dispose();

  const detections: Box[] = [];
  if (dims.length === 3 && dims[1]! <= 20) {
    const n = dims[2]!;
    for (let i = 0; i < n; i++) {
      const confidence = data[4 * n + i]!;
      if (confidence < YOLO_CONFIDENCE_THRESHOLD) continue;
      const cx = data[i]! / scale;
      const cy = data[n + i]! / scale;
      const boxWidth = data[2 * n + i]! / scale;
      const boxHeight = data[3 * n + i]! / scale;
      const angle = data[5 * n + i] ?? 0;
      if (cx < 0 || cy < 0 || cx > width || cy > height) continue;
      if (boxWidth < 20 || boxHeight < 20) continue;
      detections.push({ cx, cy, width: boxWidth, height: boxHeight, confidence, angle });
    }
  }

  return nms(detections);
}

function nms(boxes: Box[]) {
  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const kept: Box[] = [];
  for (const box of sorted) {
    if (kept.every((existing) => bboxIou(box, existing) < YOLO_NMS_IOU_THRESHOLD)) {
      kept.push(box);
    }
  }
  return kept;
}

function bboxIou(a: Box, b: Box) {
  const ax1 = a.cx - a.width / 2;
  const ay1 = a.cy - a.height / 2;
  const ax2 = a.cx + a.width / 2;
  const ay2 = a.cy + a.height / 2;
  const bx1 = b.cx - b.width / 2;
  const by1 = b.cy - b.height / 2;
  const bx2 = b.cx + b.width / 2;
  const by2 = b.cy + b.height / 2;
  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function labelForTimestamp(
  seconds: number,
  windows: GroundTruthWindow[],
  windowMarginSeconds: number,
  negativeBufferSeconds: number,
): { label: CropRecord['label']; window: GroundTruthWindow | null } {
  for (const window of windows) {
    if (
      seconds >= window.startSeconds + windowMarginSeconds &&
      seconds <= window.endSeconds - windowMarginSeconds
    ) {
      return { label: 'card-face', window };
    }
  }
  for (const window of windows) {
    if (
      seconds >= window.startSeconds - negativeBufferSeconds &&
      seconds <= window.endSeconds + negativeBufferSeconds
    ) {
      return { label: 'uncertain', window };
    }
  }
  return { label: 'negative', window: null };
}

async function saveCrop(file: string, box: Box, outFile: string) {
  const left = Math.max(0, Math.round(box.cx - box.width / 2));
  const top = Math.max(0, Math.round(box.cy - box.height / 2));
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const image = sharp(file).rotate();
  const meta = await image.metadata();
  const safeWidth = Math.min(width, Math.max(1, (meta.width ?? left + width) - left));
  const safeHeight = Math.min(height, Math.max(1, (meta.height ?? top + height) - top));
  await image
    .extract({ left, top, width: safeWidth, height: safeHeight })
    .jpeg({ quality: 92 })
    .toFile(outFile);
  return { width: safeWidth, height: safeHeight };
}

async function main() {
  const options = parseArgs();
  const framesDir = path.join(options.outDir, 'frames');
  const cropsDir = path.join(options.outDir, 'crops');
  mkdirSync(options.outDir, { recursive: true });
  rmSync(cropsDir, { recursive: true, force: true });
  mkdirSync(cropsDir, { recursive: true });

  const manifest = JSON.parse(readFileSync(options.groundTruth, 'utf8')) as {
    windows: GroundTruthWindow[];
  };
  const windows = manifest.windows;

  extractFrames(options.video, framesDir, options.sampleSeconds);
  let frames = readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort();
  if (options.maxFrames > 0) frames = frames.slice(0, options.maxFrames);

  const { model: yolo, backend } = await loadYolo(options.modelUrl);
  console.log(`TF.js backend: ${backend}; frames: ${frames.length}`);

  const records: CropRecord[] = [];
  const counts = { 'card-face': 0, negative: 0, uncertain: 0 };

  for (const [i, frameName] of frames.entries()) {
    const file = path.join(framesDir, frameName);
    const timestampSeconds = i * options.sampleSeconds;
    const image = await readRgbImage(file);
    const detections = detectCards(yolo, image.data, image.width, image.height);

    const { label, window } = labelForTimestamp(
      timestampSeconds,
      windows,
      options.windowMarginSeconds,
      options.negativeBufferSeconds,
    );

    for (const [d, box] of detections.entries()) {
      const cropName = `crop-${String(i).padStart(5, '0')}-${d}-${label}.jpg`;
      const outFile = path.join(cropsDir, cropName);
      try {
        const size = await saveCrop(file, box, outFile);
        records.push({
          file: path.join('crops', cropName),
          timestampSeconds,
          label,
          windowId: window?.id ?? null,
          windowName: window?.name ?? null,
          expectedExternalIds: window?.expectedExternalIds ?? [],
          windowTags: window?.tags ?? [],
          yoloConfidence: box.confidence,
          box: { cx: box.cx, cy: box.cy, width: box.width, height: box.height, angle: box.angle },
          cropWidth: size.width,
          cropHeight: size.height,
          aspectRatio: size.height > 0 ? size.width / size.height : 0,
        });
        counts[label]++;
      } catch (error) {
        console.warn(`crop failed for ${frameName} box ${d}:`, error);
      }
    }

    if ((i + 1) % 50 === 0 || i + 1 === frames.length) {
      console.log(
        `processed ${i + 1}/${frames.length} frames; crops: face=${counts['card-face']} neg=${counts.negative} unc=${counts.uncertain}`,
      );
    }
  }

  const output = {
    kind: 'tcger-video-crop-dataset',
    video: options.video,
    groundTruth: options.groundTruth,
    sampleSeconds: options.sampleSeconds,
    windowMarginSeconds: options.windowMarginSeconds,
    negativeBufferSeconds: options.negativeBufferSeconds,
    counts,
    crops: records,
  };
  const labelsPath = path.join(options.outDir, 'labels.json');
  writeFileSync(labelsPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ labelsPath, counts, totalCrops: records.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
