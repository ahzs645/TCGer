import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import sharp from 'sharp';
import * as tf from '@tensorflow/tfjs';
import { AutoImageProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';

import { rectifyCardCrop, type RgbaImage } from './card-rectify';
import {
  buildTitleNameIndex,
  matchTitleText,
  readTitleBand,
  terminateTitleWorker,
} from './title-ocr';

type Box = {
  cx: number;
  cy: number;
  width: number;
  height: number;
  confidence: number;
  angle: number;
};

type Candidate = {
  externalId: string;
  tcg: 'pokemon';
  name: string;
  setCode: string | null;
  setName: string | null;
  rarity: string | null;
  imageUrl: string | null;
  confidence: number;
  distance: number;
  scoreDistance: number;
  passedThreshold: boolean;
  fullDistance: number;
  titleDistance: null;
  footerDistance: null;
  proposalLabel: string;
  artworkSimilarity?: number;
  embeddingMargin?: number;
};

type ProposalMatch = {
  cardFaceScore?: number | null;
  proposal: {
    label: string;
    left: number;
    top: number;
    width: number;
    height: number;
  };
  overlayQuad: null;
  refinementMethod: 'yolo-obb';
  isClipped: false;
  bestMatch: Candidate | null;
  candidates: Candidate[];
};

type RejectionGate = {
  weights: number[];
  bias: number;
  threshold: number;
  source: string;
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
    setName?: string | null;
    rarity?: string | null;
    imageUrl?: string | null;
  }>;
  vectors: Int8Array;
  invNorms: Float32Array;
};

const MODEL_INPUT_SIZE = 640;
const YOLO_CONFIDENCE_THRESHOLD = 0.25;
const YOLO_NMS_IOU_THRESHOLD = 0.45;
const EMBEDDING_MIN_SIMILARITY = 0.72;

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
  if (!video) throw new Error('Missing --video /path/to/video.mp4');

  return {
    video,
    outDir: args.get('out-dir') ?? '/tmp/tcger-live-video-stream',
    sampleSeconds: Number(args.get('sample-seconds') ?? '5'),
    maxFrames: Number(args.get('max-frames') ?? '0'),
    modelUrl: args.get('model-url') ?? 'http://localhost:3003/models/yolo-card-detector/model.json',
    indexPath:
      args.get('index') ??
      path.resolve('..', 'frontend', 'public', 'scan-index', 'pokemon-embeddings.json'),
    gatePath: args.get('gate') ?? null,
    gateThreshold: args.has('gate-threshold') ? Number(args.get('gate-threshold')) : null,
    fullResCrops: args.has('full-res-crops'),
    nativeBackend: args.has('native-backend'),
    startSeconds: Number(args.get('start-seconds') ?? '0'),
    endSeconds: args.has('end-seconds') ? Number(args.get('end-seconds')) : null,
    rectify: args.has('rectify'),
    titleOcr: args.has('title-ocr'),
  };
}

function printUsage() {
  console.log(`Usage:
  npm run scan:video-live-stream -- --video <video.mp4> [options]

Options:
  --sample-seconds <n>  seconds between sampled live frames (default: 5)
  --max-frames <n>      stop after n frames, useful for smoke tests
  --out-dir <path>      output directory (default: /tmp/tcger-live-video-stream)
  --model-url <url>     YOLO TF.js model URL (default: frontend dev server)
  --index <path>        embedding index JSON path
  --gate <path>         card-face rejection gate artifact (train-rejection-gate.ts output)
  --gate-threshold <x>  override the gate's recommended acceptance threshold
  --full-res-crops      detect on 640px frames but embed crops from the full-resolution frame
  --native-backend      use @tensorflow/tfjs-node for ~10x faster detection. Accuracy
                        runs only — timings no longer approximate any browser backend
  --start-seconds <n>   start sampling at this video timestamp (default: 0)
  --end-seconds <n>     stop sampling at this video timestamp (default: video end)
  --rectify             refine the card quad inside each box and warpPerspective the
                        crop flat before embedding/OCR (falls back to the plain crop)
  --title-ocr           embedding-independent fallback: when the cascade still fails
                        on a card-face crop, OCR the title band and match card names,
                        letting the embedding pick the print within the matched name`);
}

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${cmd} failed:\n${result.stderr || result.stdout}`);
  }
}

function extractFrames(
  video: string,
  outDir: string,
  sampleSeconds: number,
  fullResolution: boolean,
  startSeconds: number,
  endSeconds: number | null,
) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const filters = [`fps=1/${sampleSeconds}`];
  if (!fullResolution) {
    filters.push(`scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)'`);
  }
  const seek = startSeconds > 0 ? ['-ss', String(startSeconds)] : [];
  const stop = endSeconds !== null ? ['-to', String(endSeconds)] : [];
  run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    ...seek,
    ...stop,
    '-i',
    video,
    '-vf',
    filters.join(','),
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

// tfjs-node still calls util.isNullOrUndefined, which Node >= 23 removed.
function enableNativeBackend() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeUtil = require('node:util') as Record<string, unknown>;
  if (typeof nodeUtil.isNullOrUndefined !== 'function') {
    nodeUtil.isNullOrUndefined = (value: unknown) => value === null || value === undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@tensorflow/tfjs-node');
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

function loadRejectionGate(file: string, thresholdOverride: number | null): RejectionGate {
  const artifact = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(artifact.weights) || typeof artifact.bias !== 'number') {
    throw new Error(`Invalid rejection gate artifact: ${file}`);
  }
  return {
    weights: artifact.weights,
    bias: artifact.bias,
    threshold: thresholdOverride ?? artifact.recommendedThreshold ?? 0.5,
    source: file,
  };
}

function gateScore(gate: RejectionGate, embedding: Float32Array) {
  let z = gate.bias;
  for (let k = 0; k < gate.weights.length; k++) z += gate.weights[k]! * embedding[k]!;
  return 1 / (1 + Math.exp(-z));
}

async function loadEmbedder(index: EmbeddingIndex) {
  env.allowRemoteModels = true;
  const processor = await AutoImageProcessor.from_pretrained(index.model);
  const modelOptions = {
    dtype: index.dtype,
  } as Parameters<typeof AutoModel.from_pretrained>[1];
  const net = await AutoModel.from_pretrained(index.model, modelOptions);
  const warm = new RawImage(new Uint8ClampedArray(224 * 224 * 4), 224, 224, 4);
  const warmInputs = await processor(warm);
  await net(warmInputs);
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

function matchEmbedding(query: Float32Array, index: EmbeddingIndex, topK = 5): Candidate[] {
  const bestIdx: number[] = [];
  const bestSim: number[] = [];
  let worst = -Infinity;

  for (let i = 0; i < index.entries.length; i++) {
    const inv = index.invNorms[i]!;
    if (inv === 0) continue;
    const base = i * index.dimension;
    let dot = 0;
    for (let k = 0; k < index.dimension; k++) dot += query[k]! * index.vectors[base + k]!;
    const sim = dot * inv;
    if (bestIdx.length < topK) {
      bestIdx.push(i);
      bestSim.push(sim);
      if (bestIdx.length === topK) worst = Math.min(...bestSim);
    } else if (sim > worst) {
      let wi = 0;
      for (let j = 1; j < bestSim.length; j++) if (bestSim[j]! < bestSim[wi]!) wi = j;
      bestIdx[wi] = i;
      bestSim[wi] = sim;
      worst = Math.min(...bestSim);
    }
  }

  const ordered = bestIdx
    .map((idx, j) => ({ idx, sim: bestSim[j]! }))
    .sort((a, b) => b.sim - a.sim);
  const top1 = ordered[0]?.sim ?? 0;
  const top2 = ordered[1]?.sim ?? 0;
  const margin = ordered.length >= 2 ? top1 - top2 : 0;
  return ordered.map(({ idx, sim }, rank) => {
    const entry = index.entries[idx]!;
    const distance = Math.round((1 - Math.max(0, Math.min(1, sim))) * 1000);
    const passedThreshold = rank === 0 && sim >= EMBEDDING_MIN_SIMILARITY;
    return {
      externalId: entry.externalId,
      tcg: 'pokemon',
      name: entry.name,
      setCode: entry.setCode,
      setName: entry.setName ?? null,
      rarity: entry.rarity ?? null,
      imageUrl: entry.imageUrl ?? null,
      confidence: Math.max(0, Math.min(1, sim)),
      distance,
      scoreDistance: distance,
      passedThreshold,
      fullDistance: distance,
      titleDistance: null,
      footerDistance: null,
      proposalLabel: 'yolo+embedding',
      artworkSimilarity: sim,
      embeddingMargin: rank === 0 ? margin : undefined,
    };
  });
}

function chooseFrameBestMatch(proposalMatches: ProposalMatch[]): Candidate | null {
  const accepted = proposalMatches
    .flatMap((proposalMatch) => proposalMatch.candidates)
    .filter((candidate) => candidate.passedThreshold)
    .sort((left, right) => {
      return (
        right.confidence - left.confidence ||
        left.scoreDistance - right.scoreDistance ||
        left.fullDistance - right.fullDistance ||
        left.name.localeCompare(right.name)
      );
    });

  return accepted[0] ?? null;
}

async function cropDetection(file: string, box: Box, paddingRatio = 0) {
  const padX = box.width * paddingRatio;
  const padY = box.height * paddingRatio;
  const left = Math.max(0, Math.round(box.cx - box.width / 2 - padX));
  const top = Math.max(0, Math.round(box.cy - box.height / 2 - padY));
  const width = Math.max(1, Math.round(box.width + 2 * padX));
  const height = Math.max(1, Math.round(box.height + 2 * padY));
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
    originLeft: left,
    originTop: top,
  };
}

function yoloCandidate(box: Box): Candidate {
  const spatialKey = `${Math.round(box.cx / 50)}-${Math.round(box.cy / 50)}`;
  return {
    externalId: `yolo-${spatialKey}`,
    tcg: 'pokemon',
    name: 'Detected card',
    setCode: null,
    setName: null,
    rarity: null,
    imageUrl: null,
    confidence: box.confidence,
    distance: 0,
    scoreDistance: 0,
    passedThreshold: box.confidence >= 0.5,
    fullDistance: 0,
    titleDistance: null,
    footerDistance: null,
    proposalLabel: 'yolo',
  };
}

async function main() {
  const options = parseArgs();
  const framesDir = path.join(options.outDir, 'frames');
  mkdirSync(options.outDir, { recursive: true });

  if (options.nativeBackend) {
    enableNativeBackend();
    console.warn(
      'Native tfjs-node backend enabled: use for accuracy runs only, timings are not browser-representative.',
    );
  }

  const startedAt = performance.now();
  extractFrames(
    options.video,
    framesDir,
    options.sampleSeconds,
    options.fullResCrops,
    options.startSeconds,
    options.endSeconds,
  );
  let frames = readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort();
  if (options.maxFrames > 0) frames = frames.slice(0, options.maxFrames);

  const { model: yolo, backend: tfjsBackend } = await loadYolo(options.modelUrl);
  const warnings: string[] = [];
  if (tfjsBackend.toLowerCase().includes('cpu')) {
    const warning =
      'TF.js is using the CPU backend; scan timings will not represent GPU/WebGL performance.';
    warnings.push(warning);
    console.warn(warning);
  }
  const index = loadEmbeddingIndex(options.indexPath);
  const embed = await loadEmbedder(index);
  const gate = options.gatePath
    ? loadRejectionGate(options.gatePath, options.gateThreshold)
    : null;
  if (gate) {
    console.log(`rejection gate: ${gate.source} (threshold ${gate.threshold})`);
  }

  const observations = [];
  const timings = [];
  let detectedFrames = 0;
  let detectedBoxes = 0;
  let embeddedBoxes = 0;
  let gateRejectedBoxes = 0;
  let rectifiedBoxes = 0;
  let rectifyFallbacks = 0;
  let titleOcrHits = 0;
  const titleNameIndex = options.titleOcr ? buildTitleNameIndex(index.entries) : null;

  for (const [i, frameName] of frames.entries()) {
    const file = path.join(framesDir, frameName);
    const timestampSeconds = options.startSeconds + i * options.sampleSeconds;
    const image = await readRgbImage(file);

    const detectStart = performance.now();
    const detections = detectCards(yolo, image.data, image.width, image.height);
    const detectMs = performance.now() - detectStart;
    detectedBoxes += detections.length;
    if (detections.length) detectedFrames++;

    const proposalMatches: ProposalMatch[] = [];
    const embedStart = performance.now();
    for (const box of detections.slice(0, 2)) {
      let candidates: Candidate[] = [];
      let cardFaceScore: number | null = null;
      try {
        const crop = await cropDetection(file, box);
        const query = await embed(crop.rgba, crop.width, crop.height);
        if (gate) {
          cardFaceScore = gateScore(gate, query);
          if (cardFaceScore < gate.threshold) {
            gateRejectedBoxes++;
          } else {
            candidates = matchEmbedding(query, index, 5);
          }
        } else {
          candidates = matchEmbedding(query, index, 5);
        }
        embeddedBoxes++;

        // Rescue cascade: blanket rectification measurably degrades crops
        // that already match well, so warp only when the plain crop failed to
        // clear the threshold — strictly additive for coverage.
        const gated = cardFaceScore !== null && gate && cardFaceScore < gate.threshold;
        let bestQuery = query;
        let rectifiedImage: RgbaImage | null = null;
        if (options.rectify && !gated && candidates[0]?.passedThreshold !== true) {
          const padded = await cropDetection(file, box, 0.1);
          const rectified = rectifyCardCrop(
            { data: padded.rgba, width: padded.width, height: padded.height },
            {
              left: box.cx - box.width / 2 - padded.originLeft,
              top: box.cy - box.height / 2 - padded.originTop,
              right: box.cx + box.width / 2 - padded.originLeft,
              bottom: box.cy + box.height / 2 - padded.originTop,
            },
          );
          if (rectified.method === 'quad') {
            rectifiedImage = rectified.image;
            const rescueQuery = await embed(
              rectified.image.data,
              rectified.image.width,
              rectified.image.height,
            );
            const rescueGateScore = gate ? gateScore(gate, rescueQuery) : null;
            if (!gate || (rescueGateScore !== null && rescueGateScore >= gate.threshold)) {
              const rescue = matchEmbedding(rescueQuery, index, 5);
              if ((rescue[0]?.confidence ?? 0) > (candidates[0]?.confidence ?? 0)) {
                rectifiedBoxes++;
                candidates = rescue;
                bestQuery = rescueQuery;
                if (rescueGateScore !== null) cardFaceScore = rescueGateScore;
              }
            }
          } else {
            rectifyFallbacks++;
          }
        }

        // Title-band OCR fallback: the embedding-independent path for crops
        // the embedding cannot place (dark art + glare). Name comes from the
        // printed title; the embedding only picks the print within that name.
        if (
          options.titleOcr &&
          titleNameIndex &&
          !gated &&
          candidates[0]?.passedThreshold !== true &&
          (cardFaceScore === null || cardFaceScore >= 0.55)
        ) {
          const source = rectifiedImage ?? { data: crop.rgba, width: crop.width, height: crop.height };
          const text = await readTitleBand(source.data, source.width, source.height);
          const matched = text ? matchTitleText(text, titleNameIndex) : null;
          if (matched) {
            let bestIdx = -1;
            let bestSim = -Infinity;
            for (const idx of matched.entryIndices) {
              const inv = index.invNorms[idx]!;
              if (inv === 0) continue;
              const base = idx * index.dimension;
              let dot = 0;
              for (let k = 0; k < index.dimension; k++) {
                dot += bestQuery[k]! * index.vectors[base + k]!;
              }
              const sim = dot * inv;
              if (sim > bestSim) {
                bestSim = sim;
                bestIdx = idx;
              }
            }
            if (bestIdx >= 0 && bestSim >= 0.45) {
              titleOcrHits++;
              const entry = index.entries[bestIdx]!;
              const distance = Math.round((1 - Math.max(0, Math.min(1, bestSim))) * 1000);
              candidates = [
                {
                  externalId: entry.externalId,
                  tcg: 'pokemon',
                  name: entry.name,
                  setCode: entry.setCode,
                  setName: entry.setName ?? null,
                  rarity: entry.rarity ?? null,
                  imageUrl: entry.imageUrl ?? null,
                  confidence: Math.max(0, Math.min(1, bestSim)),
                  distance,
                  scoreDistance: distance,
                  passedThreshold: true,
                  fullDistance: distance,
                  titleDistance: null,
                  footerDistance: null,
                  proposalLabel: 'yolo+title-ocr',
                  artworkSimilarity: bestSim,
                },
                ...candidates,
              ];
            }
          }
        }
      } catch {
        candidates = [];
      }
      const bestMatch =
        candidates[0]?.passedThreshold === true ? candidates[0] : yoloCandidate(box);
      proposalMatches.push({
        cardFaceScore,
        proposal: {
          label: bestMatch.proposalLabel,
          left: box.cx - box.width / 2,
          top: box.cy - box.height / 2,
          width: box.width,
          height: box.height,
        },
        overlayQuad: null,
        refinementMethod: 'yolo-obb',
        isClipped: false,
        bestMatch,
        candidates,
      });
    }
    const embedMs = performance.now() - embedStart;
    const best = chooseFrameBestMatch(proposalMatches);
    const frameCandidates = best ? [best] : [];
    observations.push({
      timestampSeconds,
      seconds: timestampSeconds,
      activeProposal:
        proposalMatches.find((proposalMatch) => proposalMatch.bestMatch === best)?.proposal ?? null,
      bestMatch: best,
      candidates: frameCandidates,
      proposalMatches,
      yoloDetections: detections.map((box) => ({
        confidence: box.confidence,
        cx: box.cx,
        cy: box.cy,
        width: box.width,
        height: box.height,
        angle: box.angle,
      })),
    });
    timings.push({ timestampSeconds, detectMs, embedMs, detections: detections.length });

    if ((i + 1) % 10 === 0 || i + 1 === frames.length) {
      console.log(
        `processed ${i + 1}/${frames.length} frames; detections=${detectedBoxes}; last=${best?.name ?? 'none'}`,
      );
    }
  }

  const elapsedMs = performance.now() - startedAt;
  const summary = {
    video: options.video,
    sampleSeconds: options.sampleSeconds,
    frames: frames.length,
    tfjsBackend,
    warnings,
    embeddingThresholds: {
      minSimilarity: EMBEDDING_MIN_SIMILARITY,
      rawEmbeddingPassesOnMarginOnly: false,
    },
    rejectionGate: gate
      ? { source: gate.source, threshold: gate.threshold, rejectedBoxes: gateRejectedBoxes }
      : null,
    fullResCrops: options.fullResCrops,
    rectify: options.rectify
      ? { rectifiedBoxes, fallbacks: rectifyFallbacks }
      : null,
    titleOcr: options.titleOcr ? { hits: titleOcrHits } : null,
    elapsedMs,
    effectiveFps: frames.length / (elapsedMs / 1000),
    detectedFrames,
    detectedBoxes,
    embeddedBoxes,
    detectionFrameRate: detectedFrames / frames.length,
    avgDetectMs: average(timings.map((t) => t.detectMs)),
    avgEmbedMs: average(timings.map((t) => t.embedMs)),
    p95DetectMs: percentile(
      timings.map((t) => t.detectMs),
      0.95,
    ),
    p95EmbedMs: percentile(
      timings.map((t) => t.embedMs),
      0.95,
    ),
  };

  const result = { kind: 'tcger-live-video-stream-scan', summary, frames: observations, timings };
  const out = path.join(options.outDir, 'live-stream-results.json');
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ out, summary }, null, 2));
  await terminateTitleWorker();
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index]!;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
