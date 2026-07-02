/**
 * Propose ground-truth reveal windows for an evaluation video.
 *
 * Runs the full recognition pipeline (YOLO detect on full-res frames, optional
 * rejection gate, DINOv2 embed, top-1 match) at a dense sample rate, keeps only
 * high-confidence identifications, and groups consecutive same-card frames into
 * draft ground-truth windows.
 *
 * The output is a DRAFT: a human (or agent with frame images) must verify each
 * window before promoting it to a fixture. Every window carries its evidence
 * frames so verification is one image view per window.
 *
 * Uses @tensorflow/tfjs-node when available; this is an offline labeling tool,
 * not a runtime benchmark, so native speed is fine.
 *
 * Usage:
 *   tsx src/scripts/propose-video-ground-truth.ts \
 *     --video <video.mp4> \
 *     --gate /path/to/rejection-gate.json \
 *     --out /tmp/proposed-ground-truth.json
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';
import * as tf from '@tensorflow/tfjs';
import { AutoImageProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';

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

type EmbeddingIndex = {
  model: string;
  dtype: string;
  encoder: string;
  dimension: number;
  entries: Array<{
    externalId: string;
    name: string;
    setCode: string | null;
  }>;
  vectors: Int8Array;
  invNorms: Float32Array;
};

type FrameHit = {
  timestampSeconds: number;
  frameFile: string;
  externalId: string;
  name: string;
  similarity: number;
  gateScore: number | null;
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
    console.log(`Usage:
  tsx src/scripts/propose-video-ground-truth.ts --video <video.mp4> [options]

Options:
  --out <path>            output draft manifest (default: <out-dir>/proposed-ground-truth.json)
  --out-dir <path>        working directory for frames (default: /tmp/tcger-gt-proposals)
  --sample-seconds <n>    seconds between sampled frames (default: 2)
  --max-frames <n>        stop after n frames
  --model-url <url>       YOLO TF.js model URL (default: frontend dev server)
  --index <path>          embedding index JSON path
  --gate <path>           rejection gate artifact; crops below threshold are skipped
  --min-similarity <x>    keep identifications at/above this similarity (default: 0.75)
  --merge-gap <n>         merge same-card hits up to n seconds apart (default: 6)
  --min-hits <n>          require n hits for a window (default: 1)`);
    process.exit(0);
  }

  const video = args.get('video');
  if (!video) throw new Error('Missing --video /path/to/video.mp4');

  const outDir = args.get('out-dir') ?? '/tmp/tcger-gt-proposals';
  return {
    video,
    outDir,
    out: args.get('out') ?? path.join(outDir, 'proposed-ground-truth.json'),
    sampleSeconds: Number(args.get('sample-seconds') ?? '2'),
    maxFrames: Number(args.get('max-frames') ?? '0'),
    modelUrl: args.get('model-url') ?? 'http://localhost:3003/models/yolo-card-detector/model.json',
    indexPath:
      args.get('index') ??
      path.resolve('..', 'frontend', 'public', 'scan-index', 'pokemon-embeddings.json'),
    gatePath: args.get('gate') ?? null,
    minSimilarity: Number(args.get('min-similarity') ?? '0.75'),
    mergeGapSeconds: Number(args.get('merge-gap') ?? '6'),
    minHits: Number(args.get('min-hits') ?? '1'),
  };
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
    `fps=1/${sampleSeconds}`,
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

  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
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

function base64ToInt8Array(base64: string) {
  const bytes = Buffer.from(base64, 'base64');
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function loadEmbeddingIndex(file: string): EmbeddingIndex {
  const artifact = JSON.parse(readFileSync(file, 'utf8'));
  const vectors = base64ToInt8Array(artifact.vectors);
  const invNorms = new Float32Array(artifact.entries.length);
  for (let i = 0; i < artifact.entries.length; i++) {
    const base = i * artifact.dimension;
    let sq = 0;
    for (let k = 0; k < artifact.dimension; k++) {
      const x = vectors[base + k]!;
      sq += x * x;
    }
    invNorms[i] = sq > 0 ? 1 / Math.sqrt(sq) : 0;
  }
  return {
    model: artifact.model,
    dtype: artifact.dtype,
    encoder: artifact.encoder ?? 'dinov2',
    dimension: artifact.dimension,
    entries: artifact.entries,
    vectors,
    invNorms,
  };
}

async function loadEmbedder(index: EmbeddingIndex) {
  env.allowRemoteModels = true;
  const processor = await AutoImageProcessor.from_pretrained(index.model);
  const modelOptions = { dtype: index.dtype } as Parameters<typeof AutoModel.from_pretrained>[1];
  const net = await AutoModel.from_pretrained(index.model, modelOptions);
  return async (rgba: Uint8ClampedArray, width: number, height: number) => {
    const image = new RawImage(rgba, width, height, 4);
    const inputs = await processor(image);
    const out = await net(inputs);
    const lhs = out.last_hidden_state;
    const hidden = lhs.dims[lhs.dims.length - 1];
    const vec = new Float32Array(lhs.data.slice(0, hidden));
    let sq = 0;
    for (let i = 0; i < vec.length; i++) sq += vec[i]! * vec[i]!;
    const norm = Math.sqrt(sq);
    if (norm > 1e-8) for (let i = 0; i < vec.length; i++) vec[i]! /= norm;
    return vec;
  };
}

function matchTop1(query: Float32Array, index: EmbeddingIndex) {
  let bestIdx = -1;
  let bestSim = -Infinity;
  for (let i = 0; i < index.entries.length; i++) {
    const inv = index.invNorms[i]!;
    if (inv === 0) continue;
    const base = i * index.dimension;
    let dot = 0;
    for (let k = 0; k < index.dimension; k++) dot += query[k]! * index.vectors[base + k]!;
    const sim = dot * inv;
    if (sim > bestSim) {
      bestSim = sim;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  const entry = index.entries[bestIdx]!;
  return { externalId: entry.externalId, name: entry.name, similarity: bestSim };
}

type Gate = { weights: number[]; bias: number; threshold: number };

function loadGate(file: string): Gate {
  const artifact = JSON.parse(readFileSync(file, 'utf8'));
  return {
    weights: artifact.weights,
    bias: artifact.bias,
    threshold: artifact.recommendedThreshold ?? 0.5,
  };
}

function gateScore(gate: Gate, embedding: Float32Array) {
  let z = gate.bias;
  for (let k = 0; k < gate.weights.length; k++) z += gate.weights[k]! * embedding[k]!;
  return 1 / (1 + Math.exp(-z));
}

async function cropDetection(file: string, box: Box) {
  const left = Math.max(0, Math.round(box.cx - box.width / 2));
  const top = Math.max(0, Math.round(box.cy - box.height / 2));
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const image = sharp(file).rotate();
  const meta = await image.metadata();
  const safeWidth = Math.min(width, Math.max(1, (meta.width ?? left + width) - left));
  const safeHeight = Math.min(height, Math.max(1, (meta.height ?? top + height) - top));
  const { data, info } = await image
    .extract({ left, top, width: safeWidth, height: safeHeight })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

type ProposedWindow = {
  externalId: string;
  name: string;
  startSeconds: number;
  endSeconds: number;
  hits: number;
  maxSimilarity: number;
  evidenceFrames: Array<{ seconds: number; file: string; similarity: number }>;
};

function groupHits(hits: FrameHit[], mergeGapSeconds: number, minHits: number) {
  const byCard = new Map<string, FrameHit[]>();
  for (const hit of hits) {
    const list = byCard.get(hit.externalId) ?? [];
    list.push(hit);
    byCard.set(hit.externalId, list);
  }

  const windows: ProposedWindow[] = [];
  for (const [externalId, cardHits] of byCard) {
    cardHits.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
    let current: FrameHit[] = [];
    const flush = () => {
      if (current.length >= minHits) {
        windows.push({
          externalId,
          name: current[0]!.name,
          startSeconds: current[0]!.timestampSeconds,
          endSeconds: current[current.length - 1]!.timestampSeconds,
          hits: current.length,
          maxSimilarity: Math.max(...current.map((h) => h.similarity)),
          evidenceFrames: current.map((h) => ({
            seconds: h.timestampSeconds,
            file: h.frameFile,
            similarity: Number(h.similarity.toFixed(3)),
          })),
        });
      }
      current = [];
    };
    for (const hit of cardHits) {
      if (
        current.length &&
        hit.timestampSeconds - current[current.length - 1]!.timestampSeconds > mergeGapSeconds
      ) {
        flush();
      }
      current.push(hit);
    }
    flush();
  }

  windows.sort((a, b) => a.startSeconds - b.startSeconds);
  return windows;
}

async function main() {
  const options = parseArgs();
  const framesDir = path.join(options.outDir, 'frames');
  mkdirSync(options.outDir, { recursive: true });

  extractFrames(options.video, framesDir, options.sampleSeconds);
  let frames = readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort();
  if (options.maxFrames > 0) frames = frames.slice(0, options.maxFrames);

  const { model: yolo, backend } = await loadYolo(options.modelUrl);
  console.log(`TF.js backend: ${backend}; frames: ${frames.length}`);
  const index = loadEmbeddingIndex(options.indexPath);
  const embed = await loadEmbedder(index);
  const gate = options.gatePath ? loadGate(options.gatePath) : null;

  const hits: FrameHit[] = [];
  for (const [i, frameName] of frames.entries()) {
    const file = path.join(framesDir, frameName);
    const timestampSeconds = i * options.sampleSeconds;
    const image = await readRgbImage(file);
    const detections = detectCards(yolo, image.data, image.width, image.height);

    for (const box of detections.slice(0, 2)) {
      try {
        const crop = await cropDetection(file, box);
        const query = await embed(crop.rgba, crop.width, crop.height);
        const score = gate ? gateScore(gate, query) : null;
        if (gate && score !== null && score < gate.threshold) continue;
        const top = matchTop1(query, index);
        if (top && top.similarity >= options.minSimilarity) {
          hits.push({
            timestampSeconds,
            frameFile: path.join('frames', frameName),
            externalId: top.externalId,
            name: top.name,
            similarity: top.similarity,
            gateScore: score,
          });
        }
      } catch {
        // skip failed crops
      }
    }

    if ((i + 1) % 50 === 0 || i + 1 === frames.length) {
      console.log(`processed ${i + 1}/${frames.length} frames; confident hits=${hits.length}`);
    }
  }

  const windows = groupHits(hits, options.mergeGapSeconds, options.minHits);
  const draft = {
    kind: 'video-recognition-ground-truth-draft',
    generatedBy: 'propose-video-ground-truth.ts',
    video: options.video,
    settings: {
      sampleSeconds: options.sampleSeconds,
      minSimilarity: options.minSimilarity,
      mergeGapSeconds: options.mergeGapSeconds,
      minHits: options.minHits,
      gate: options.gatePath,
      index: options.indexPath,
    },
    framesDir,
    totalConfidentHits: hits.length,
    windows,
  };
  writeFileSync(options.out, JSON.stringify(draft, null, 2));
  console.log(
    JSON.stringify({ out: options.out, windows: windows.length, hits: hits.length }, null, 2),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
