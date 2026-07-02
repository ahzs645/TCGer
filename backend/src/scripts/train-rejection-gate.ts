/**
 * Train a card-face rejection gate: logistic regression on DINOv2 embeddings.
 *
 * The gate reuses the exact embedding the recognition pipeline already
 * computes per crop, so it adds one 384-d dot product at runtime and the
 * weights JSON is portable to web (embedding-matcher) and iOS (Accelerate).
 *
 * Input: a crop dataset from build-video-crop-dataset.ts (labels.json).
 *   card-face  -> positive
 *   negative   -> negative
 *   uncertain  -> excluded
 *
 * Split is time-based (--val-after seconds) so near-duplicate consecutive
 * frames cannot leak between train and val.
 *
 * Usage:
 *   tsx src/scripts/train-rejection-gate.ts \
 *     --dataset /tmp/tcger-video-crop-dataset \
 *     --index ../frontend/public/scan-index/pokemon-embeddings.json \
 *     --out /tmp/tcger-rejection-gate.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';
import { AutoImageProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';

type CropRecord = {
  file: string;
  timestampSeconds: number;
  label: 'card-face' | 'negative' | 'uncertain';
  windowId: string | null;
  yoloConfidence: number;
};

type Sample = {
  file: string;
  timestampSeconds: number;
  y: number;
  embedding: Float32Array;
};

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
  tsx src/scripts/train-rejection-gate.ts --dataset <dir> [options]

Options:
  --dataset <dir>       crop dataset directory containing labels.json (required)
  --index <path>        embedding index JSON, used for model/encoder identity
                        (default: ../frontend/public/scan-index/pokemon-embeddings.json)
  --out <path>          output gate artifact path (default: <dataset>/rejection-gate.json)
  --val-after <seconds> samples at/after this timestamp form the validation split (default: 580)
  --epochs <n>          training epochs (default: 800)
  --lr <x>              learning rate (default: 0.5)
  --l2 <x>              L2 regularization strength (default: 0.001)
  --min-recall <x>      pick recommended threshold with at least this card-face recall on val (default: 0.98)`);
    process.exit(0);
  }

  const dataset = args.get('dataset');
  if (!dataset) throw new Error('Missing --dataset <dir>');

  return {
    dataset,
    indexPath:
      args.get('index') ??
      path.resolve('..', 'frontend', 'public', 'scan-index', 'pokemon-embeddings.json'),
    out: args.get('out') ?? path.join(dataset, 'rejection-gate.json'),
    valAfter: Number(args.get('val-after') ?? '580'),
    epochs: Number(args.get('epochs') ?? '800'),
    lr: Number(args.get('lr') ?? '0.5'),
    l2: Number(args.get('l2') ?? '0.001'),
    minRecall: Number(args.get('min-recall') ?? '0.98'),
  };
}

async function loadEmbedder(model: string, dtype: string) {
  env.allowRemoteModels = true;
  const processor = await AutoImageProcessor.from_pretrained(model);
  const modelOptions = { dtype } as Parameters<typeof AutoModel.from_pretrained>[1];
  const net = await AutoModel.from_pretrained(model, modelOptions);
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

async function readRgba(file: string) {
  const { data, info } = await sharp(file)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

function sigmoid(z: number) {
  return 1 / (1 + Math.exp(-z));
}

function trainLogistic(
  samples: Sample[],
  dimension: number,
  epochs: number,
  lr: number,
  l2: number,
) {
  const weights = new Float64Array(dimension);
  let bias = 0;

  const positives = samples.filter((s) => s.y === 1).length;
  const negatives = samples.length - positives;
  // Balance classes so the frequent class cannot dominate the loss.
  const positiveWeight = samples.length / (2 * Math.max(1, positives));
  const negativeWeight = samples.length / (2 * Math.max(1, negatives));

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Float64Array(dimension);
    let gradB = 0;
    let loss = 0;

    for (const sample of samples) {
      let z = bias;
      for (let k = 0; k < dimension; k++) z += weights[k]! * sample.embedding[k]!;
      const p = sigmoid(z);
      const sampleWeight = sample.y === 1 ? positiveWeight : negativeWeight;
      const err = (p - sample.y) * sampleWeight;
      for (let k = 0; k < dimension; k++) gradW[k] += err * sample.embedding[k]!;
      gradB += err;
      loss -=
        sampleWeight *
        (sample.y * Math.log(Math.max(p, 1e-12)) +
          (1 - sample.y) * Math.log(Math.max(1 - p, 1e-12)));
    }

    const scale = lr / samples.length;
    for (let k = 0; k < dimension; k++) {
      weights[k] -= scale * (gradW[k]! + l2 * samples.length * weights[k]!);
    }
    bias -= scale * gradB;

    if ((epoch + 1) % 200 === 0) {
      console.log(`epoch ${epoch + 1}/${epochs} loss=${(loss / samples.length).toFixed(4)}`);
    }
  }

  return { weights: Array.from(weights), bias };
}

function score(weights: number[], bias: number, embedding: Float32Array) {
  let z = bias;
  for (let k = 0; k < weights.length; k++) z += weights[k]! * embedding[k]!;
  return sigmoid(z);
}

function evaluate(samples: Sample[], weights: number[], bias: number, threshold: number) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const sample of samples) {
    const accepted = score(weights, bias, sample.embedding) >= threshold;
    if (sample.y === 1 && accepted) tp++;
    else if (sample.y === 1) fn++;
    else if (accepted) fp++;
    else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const rejectionRate = fp + tn > 0 ? tn / (fp + tn) : 0;
  return {
    threshold,
    tp,
    fp,
    tn,
    fn,
    accuracy: samples.length > 0 ? (tp + tn) / samples.length : 0,
    precision,
    recall,
    negativeRejectionRate: rejectionRate,
  };
}

async function main() {
  const options = parseArgs();
  const labels = JSON.parse(readFileSync(path.join(options.dataset, 'labels.json'), 'utf8')) as {
    crops: CropRecord[];
  };
  const indexArtifact = JSON.parse(readFileSync(options.indexPath, 'utf8')) as {
    model: string;
    dtype: string;
    encoder?: string;
    dimension: number;
  };

  const usable = labels.crops.filter((crop) => crop.label !== 'uncertain');
  console.log(
    `crops: total=${labels.crops.length} usable=${usable.length} ` +
      `(face=${usable.filter((c) => c.label === 'card-face').length}, ` +
      `negative=${usable.filter((c) => c.label === 'negative').length})`,
  );

  console.log(`embedding with ${indexArtifact.model} (${indexArtifact.dtype})...`);
  const embed = await loadEmbedder(indexArtifact.model, indexArtifact.dtype);

  const samples: Sample[] = [];
  for (const [i, crop] of usable.entries()) {
    const file = path.join(options.dataset, crop.file);
    try {
      const { rgba, width, height } = await readRgba(file);
      samples.push({
        file: crop.file,
        timestampSeconds: crop.timestampSeconds,
        y: crop.label === 'card-face' ? 1 : 0,
        embedding: await embed(rgba, width, height),
      });
    } catch (error) {
      console.warn(`embed failed for ${crop.file}:`, error);
    }
    if ((i + 1) % 100 === 0 || i + 1 === usable.length) {
      console.log(`embedded ${i + 1}/${usable.length}`);
    }
  }

  const train = samples.filter((s) => s.timestampSeconds < options.valAfter);
  const val = samples.filter((s) => s.timestampSeconds >= options.valAfter);
  console.log(
    `split: train=${train.length} (pos=${train.filter((s) => s.y === 1).length}) ` +
      `val=${val.length} (pos=${val.filter((s) => s.y === 1).length})`,
  );
  if (!train.length || !val.length) {
    throw new Error('Empty train or val split; adjust --val-after.');
  }

  const dimension = samples[0]!.embedding.length;
  const { weights, bias } = trainLogistic(train, dimension, options.epochs, options.lr, options.l2);

  const thresholds = [];
  for (let t = 0.05; t <= 0.951; t += 0.05) thresholds.push(Number(t.toFixed(2)));
  const valTable = thresholds.map((t) => evaluate(val, weights, bias, t));
  const trainTable = thresholds.map((t) => evaluate(train, weights, bias, t));

  // Recommended threshold: the strictest one that keeps card-face recall on
  // val above --min-recall (the gate must not eat real cards).
  let recommended = valTable[0]!;
  for (const row of valTable) {
    if (row.recall >= options.minRecall) recommended = row;
  }

  const artifact = {
    kind: 'tcger-card-face-rejection-gate',
    version: 1,
    model: indexArtifact.model,
    encoder: indexArtifact.encoder ?? 'dinov2',
    dtype: indexArtifact.dtype,
    dimension,
    inputs: 'l2-normalized embedding, same preprocessing as the recognition index',
    weights,
    bias,
    recommendedThreshold: recommended.threshold,
    trainedOn: {
      dataset: options.dataset,
      trainSamples: train.length,
      valSamples: val.length,
      valAfterSeconds: options.valAfter,
      epochs: options.epochs,
      lr: options.lr,
      l2: options.l2,
    },
    metrics: {
      valAtRecommended: recommended,
      valTable,
      trainTable,
    },
  };

  writeFileSync(options.out, JSON.stringify(artifact, null, 2));
  console.log(
    JSON.stringify(
      { out: options.out, recommendedThreshold: recommended.threshold, val: recommended },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
