import { promises as fs } from 'node:fs';
import { performance } from 'node:perf_hooks';

import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

import { env } from '../../config/env';
import { getAllCardHashes } from './hash-store';
import { computeRGBHash } from './phash';
import { prepareRuntimeScanImage } from './preprocess';
import type {
  ScanAttemptDiagnostic,
  ScanDebugData,
  ScanDiagnosticCandidate,
  ScanExecutionEngine,
  ScanMatch,
  ScanResult,
  ScanTimingMetrics,
} from './scan.service';

const MODEL_INPUT_SIZE = 224;
const MAX_CANDIDATES = 5;
const SUPPORTED_TCG = 'pokemon';

type CardHashEntry = Awaited<ReturnType<typeof getAllCardHashes>>[number];

interface EmbeddingIndexEntry {
  externalId: string;
  sourceKey?: string;
}

interface EmbeddingIndexMeta {
  dimension: number;
  normalized?: boolean;
  model?: string;
  entries: EmbeddingIndexEntry[];
}

interface LoadedEmbeddingIndex {
  meta: EmbeddingIndexMeta;
  vectors: Float32Array;
}

interface EmbeddingNearestMatch {
  externalId: string;
  similarity: number;
}

interface VariantMatchResult {
  variantName: string;
  matches: EmbeddingNearestMatch[];
  inferenceMs: number;
  searchMs: number;
}

interface RankedEmbeddingCandidate {
  match: ScanMatch;
  similarity: number;
}

class EmbeddingScanConfigurationError extends Error {
  readonly code = 'EMBEDDING_SCAN_NOT_CONFIGURED';

  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingScanConfigurationError';
  }
}

function resolveEmbeddingPaths() {
  const modelPath = env.CARD_SCAN_EMBEDDING_MODEL_PATH?.trim();
  const indexPath = env.CARD_SCAN_EMBEDDING_INDEX_PATH?.trim();
  const metaPath = env.CARD_SCAN_EMBEDDING_META_PATH?.trim();

  if (!modelPath || !indexPath || !metaPath) {
    throw new EmbeddingScanConfigurationError(
      'Embedding scan mode is not configured. Set CARD_SCAN_EMBEDDING_MODEL_PATH, CARD_SCAN_EMBEDDING_INDEX_PATH, and CARD_SCAN_EMBEDDING_META_PATH.',
    );
  }

  return { modelPath, indexPath, metaPath };
}

function normalizeExternalId(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\.png$/i, '');
  const [setCode, collectorNumber] = trimmed.split('-');

  if (!setCode || !collectorNumber) {
    return trimmed;
  }

  const normalizedSetCode = setCode.replace(/^([a-z]+)0+(\d)/i, '$1$2');
  const normalizedCollectorNumber = collectorNumber.replace(/^0+(\d)/, '$1');
  return `${normalizedSetCode}-${normalizedCollectorNumber}`;
}

function buildCardLookup(entries: CardHashEntry[]): Map<string, CardHashEntry> {
  const lookup = new Map<string, CardHashEntry>();

  for (const entry of entries) {
    lookup.set(entry.externalId, entry);
    lookup.set(normalizeExternalId(entry.externalId), entry);
  }

  return lookup;
}

function clampConfidence(similarity: number): number {
  return Math.max(0, Math.min(1, similarity));
}

function distanceFromSimilarity(similarity: number): number {
  return Math.round((1 - clampConfidence(similarity)) * 1000);
}

function buildDiagnosticCandidate(match: ScanMatch): ScanDiagnosticCandidate {
  return {
    ...match,
    scoreDistance: match.distance,
    passedThreshold: true,
  };
}

function normalizeVector(vector: Float32Array): Float32Array {
  let magnitude = 0;
  for (let index = 0; index < vector.length; index += 1) {
    magnitude += vector[index]! * vector[index]!;
  }

  const safeMagnitude = Math.sqrt(magnitude) || 1;
  const normalized = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    normalized[index] = vector[index]! / safeMagnitude;
  }

  return normalized;
}

function upsertTopMatches(
  matches: Array<{ index: number; similarity: number }>,
  candidate: { index: number; similarity: number },
  limit: number,
) {
  matches.push(candidate);
  matches.sort((left, right) => right.similarity - left.similarity);
  if (matches.length > limit) {
    matches.length = limit;
  }
}

class TradingCardEmbeddingRuntime {
  private sessionPromise: Promise<ort.InferenceSession> | null = null;
  private indexPromise: Promise<LoadedEmbeddingIndex> | null = null;
  private cardLookupPromise: Promise<Map<string, CardHashEntry>> | null = null;

  async nearestMatches(imageBuffer: Buffer, limit = MAX_CANDIDATES): Promise<VariantMatchResult> {
    const [session, index] = await Promise.all([this.loadSession(), this.loadIndex()]);

    const tensorData = await this.prepareInputTensor(imageBuffer);
    const inferenceStartedAt = performance.now();
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];

    if (!inputName || !outputName) {
      throw new Error('Embedding model is missing input or output bindings.');
    }

    const inputTensor = new ort.Tensor('float32', tensorData, [
      1,
      3,
      MODEL_INPUT_SIZE,
      MODEL_INPUT_SIZE,
    ]);
    const outputs = await session.run({ [inputName]: inputTensor });
    const inferenceMs = performance.now() - inferenceStartedAt;
    const outputTensor = outputs[outputName];

    if (!outputTensor) {
      throw new Error('Embedding model did not return an output tensor.');
    }

    const outputData = outputTensor.data;
    const queryVector = normalizeVector(
      outputData instanceof Float32Array
        ? outputData
        : Float32Array.from(Array.from(outputData as ArrayLike<number>)),
    );

    const topMatches: Array<{ index: number; similarity: number }> = [];
    const searchStartedAt = performance.now();

    for (let entryIndex = 0; entryIndex < index.meta.entries.length; entryIndex += 1) {
      let similarity = 0;
      const baseOffset = entryIndex * index.meta.dimension;

      for (let dimension = 0; dimension < index.meta.dimension; dimension += 1) {
        similarity += index.vectors[baseOffset + dimension]! * queryVector[dimension]!;
      }

      upsertTopMatches(topMatches, { index: entryIndex, similarity }, limit);
    }

    const searchMs = performance.now() - searchStartedAt;

    return {
      variantName: 'embedding',
      matches: topMatches.map(({ index: entryIndex, similarity }) => ({
        externalId: index.meta.entries[entryIndex]!.externalId,
        similarity,
      })),
      inferenceMs,
      searchMs,
    };
  }

  async getCardLookup(): Promise<Map<string, CardHashEntry>> {
    if (!this.cardLookupPromise) {
      this.cardLookupPromise = getAllCardHashes({ tcg: SUPPORTED_TCG }).then(buildCardLookup);
    }

    return this.cardLookupPromise;
  }

  private async loadSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      const { modelPath } = resolveEmbeddingPaths();
      this.sessionPromise = ort.InferenceSession.create(modelPath);
    }

    return this.sessionPromise;
  }

  private async loadIndex(): Promise<LoadedEmbeddingIndex> {
    if (!this.indexPromise) {
      const { indexPath, metaPath } = resolveEmbeddingPaths();
      this.indexPromise = (async () => {
        const [metaRaw, indexBuffer] = await Promise.all([
          fs.readFile(metaPath, 'utf8'),
          fs.readFile(indexPath),
        ]);

        const meta = JSON.parse(metaRaw) as EmbeddingIndexMeta;
        const vectors = new Float32Array(
          indexBuffer.buffer,
          indexBuffer.byteOffset,
          indexBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
        );
        const expectedValues = meta.entries.length * meta.dimension;

        if (vectors.length !== expectedValues) {
          throw new Error(
            `Embedding index shape mismatch: expected ${expectedValues} values, found ${vectors.length}.`,
          );
        }

        return {
          meta,
          vectors,
        };
      })();
    }

    return this.indexPromise;
  }

  private async prepareInputTensor(imageBuffer: Buffer): Promise<Float32Array> {
    const { data, info } = await sharp(imageBuffer)
      .rotate()
      .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels !== 3) {
      throw new Error(`Expected 3-channel RGB input for embedding model, received ${info.channels}.`);
    }

    const pixelCount = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
    const tensor = new Float32Array(pixelCount * 3);
    const mean = [0.485, 0.456, 0.406] as const;
    const std = [0.229, 0.224, 0.225] as const;

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const offset = pixelIndex * 3;
      tensor[pixelIndex] = data[offset]! / 255;
      tensor[pixelCount + pixelIndex] = data[offset + 1]! / 255;
      tensor[pixelCount * 2 + pixelIndex] = data[offset + 2]! / 255;
    }

    for (let channel = 0; channel < 3; channel += 1) {
      const channelOffset = channel * pixelCount;
      for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
        const index = channelOffset + pixelIndex;
        tensor[index] = (tensor[index]! - mean[channel]!) / std[channel]!;
      }
    }

    return tensor;
  }
}

const runtime = new TradingCardEmbeddingRuntime();

async function buildEmbeddingVariants(
  originalImage: Buffer,
  correctedImage: Buffer | null,
): Promise<Array<{ name: string; image: Buffer }>> {
  const variants: Array<{ name: string; image: Buffer }> = [];

  if (correctedImage) {
    variants.push({ name: 'corrected-upright', image: correctedImage });
  }

  variants.push({ name: 'base-upright', image: originalImage });

  if (correctedImage) {
    variants.push({
      name: 'corrected-180',
      image: await sharp(correctedImage).rotate(180).toBuffer(),
    });
  }

  variants.push({
    name: 'base-180',
    image: await sharp(originalImage).rotate(180).toBuffer(),
  });

  const deduped: Array<{ name: string; image: Buffer }> = [];
  for (const variant of variants) {
    if (!deduped.some((existing) => existing.image.equals(variant.image))) {
      deduped.push(variant);
    }
  }

  return deduped;
}

function toScanMatch(entry: CardHashEntry, similarity: number): ScanMatch {
  return {
    externalId: entry.externalId,
    tcg: entry.tcg,
    name: entry.name,
    setCode: entry.setCode,
    setName: entry.setName,
    rarity: entry.rarity,
    imageUrl: entry.imageUrl,
    confidence: clampConfidence(similarity),
    distance: distanceFromSimilarity(similarity),
  };
}

function buildTimingMetrics(
  runtimePreparationTimings: Awaited<ReturnType<typeof prepareRuntimeScanImage>>['timings'],
  inferenceMs: number,
  rankingMs: number,
  totalMs: number,
): ScanTimingMetrics {
  return {
    preprocessMs: runtimePreparationTimings.totalMs,
    perspectiveCorrectionMs: runtimePreparationTimings.perspectiveCorrectionMs,
    qualityMs: runtimePreparationTimings.qualityMs,
    hashMs: inferenceMs,
    featureHashMs: 0,
    rankingMs,
    artworkPrefilterMs: null,
    artworkRerankMs: null,
    ocrMs: null,
    totalMs,
  };
}

function emptyDebugArtifacts(
  selectedVariantImage: Buffer,
  correctedSourceImage: Buffer | null,
  timings: ScanTimingMetrics,
  attempts: ScanAttemptDiagnostic[],
): ScanDebugData {
  return {
    artifacts: {
      selectedVariantImage,
      correctedSourceImage,
    },
    timings,
    attempts,
    rejectedNearMisses: [],
    artwork: {
      prefilterApplied: false,
      prefilterTopMatches: [],
      rerankTopMatches: [],
    },
    ocr: {
      attempted: false,
      durationMs: null,
      candidates: [],
    },
  };
}

export function isEmbeddingScanConfigured(): boolean {
  return Boolean(
    env.CARD_SCAN_EMBEDDING_MODEL_PATH &&
      env.CARD_SCAN_EMBEDDING_INDEX_PATH &&
      env.CARD_SCAN_EMBEDDING_META_PATH,
  );
}

export async function scanCardImageWithEmbedding(
  imageBuffer: Buffer,
  tcgFilter?: string,
): Promise<ScanResult> {
  if (tcgFilter && tcgFilter !== SUPPORTED_TCG) {
    throw new Error(`Embedding scan mode currently supports only ${SUPPORTED_TCG}.`);
  }

  resolveEmbeddingPaths();

  const scanStartedAt = performance.now();
  const runtimeScan = await prepareRuntimeScanImage(imageBuffer);
  const rawVariants = await buildEmbeddingVariants(
    imageBuffer,
    runtimeScan.artifacts.correctedSourceImage,
  );
  const [cardLookup] = await Promise.all([runtime.getCardLookup()]);

  const aggregatedCandidates = new Map<string, RankedEmbeddingCandidate>();
  const attempts: ScanAttemptDiagnostic[] = [];
  let totalInferenceMs = 0;
  let totalRankingMs = 0;
  let bestVariantName = rawVariants[0]?.name ?? runtimeScan.primaryVariant.name;
  let bestVariantImage = runtimeScan.primaryVariant.image;
  let bestSimilarity = Number.NEGATIVE_INFINITY;

  for (const variant of rawVariants) {
    const variantResult = await runtime.nearestMatches(variant.image, MAX_CANDIDATES);
    totalInferenceMs += variantResult.inferenceMs;
    totalRankingMs += variantResult.searchMs;

    const diagnosticMatches: ScanDiagnosticCandidate[] = [];

    for (const nearestMatch of variantResult.matches) {
      const entry =
        cardLookup.get(nearestMatch.externalId) ??
        cardLookup.get(normalizeExternalId(nearestMatch.externalId));

      if (!entry) {
        continue;
      }

      const scanMatch = toScanMatch(entry, nearestMatch.similarity);
      diagnosticMatches.push(buildDiagnosticCandidate(scanMatch));

      const existing = aggregatedCandidates.get(entry.externalId);
      if (!existing || nearestMatch.similarity > existing.similarity) {
        aggregatedCandidates.set(entry.externalId, {
          match: scanMatch,
          similarity: nearestMatch.similarity,
        });
      }
    }

    if (variantResult.matches[0] && variantResult.matches[0]!.similarity > bestSimilarity) {
      bestSimilarity = variantResult.matches[0]!.similarity;
      bestVariantName = variant.name;
      bestVariantImage = variant.image;
    }

    attempts.push({
      variant: variant.name,
      threshold: 0,
      hashMs: variantResult.inferenceMs,
      featureHashMs: 0,
      rankingMs: variantResult.searchMs,
      rerankUsed: false,
      shortlistSize: diagnosticMatches.length,
      acceptedCandidates: diagnosticMatches,
      rejectedNearMisses: [],
    });
  }

  const candidates = Array.from(aggregatedCandidates.values())
    .sort((left, right) => {
      return right.similarity - left.similarity || left.match.name.localeCompare(right.match.name);
    })
    .slice(0, MAX_CANDIDATES)
    .map((candidate) => candidate.match);

  const totalMs = performance.now() - scanStartedAt;
  const timings = buildTimingMetrics(
    runtimeScan.timings,
    totalInferenceMs,
    totalRankingMs,
    totalMs,
  );
  const executionEngine: ScanExecutionEngine = 'embedding';

  return {
    bestMatch: candidates[0] ?? null,
    candidates,
    hashGenerated: await computeRGBHash(runtimeScan.primaryVariant.image),
    meta: {
      engine: executionEngine,
      quality: runtimeScan.quality,
      thresholdUsed: 0,
      variantUsed: bestVariantName,
      variantsTried: rawVariants.map((variant) => variant.name),
      perspectiveCorrected: runtimeScan.perspectiveCorrection.applied,
      contourAreaRatio: runtimeScan.perspectiveCorrection.contourAreaRatio,
      contourConfidence: runtimeScan.perspectiveCorrection.contourConfidence,
      rotationAngle: runtimeScan.perspectiveCorrection.rotationAngle,
      cropAspectRatio: runtimeScan.perspectiveCorrection.cropAspectRatio,
      cropWidth: runtimeScan.perspectiveCorrection.cropWidth,
      cropHeight: runtimeScan.perspectiveCorrection.cropHeight,
      cropCandidateScore: runtimeScan.perspectiveCorrection.candidateScore,
      contourPoints: runtimeScan.perspectiveCorrection.contourPoints,
      maskVariant: runtimeScan.perspectiveCorrection.maskVariant,
      rerankUsed: false,
      shortlistSize: candidates.length,
      timings,
    },
    debug: emptyDebugArtifacts(
      bestVariantImage,
      runtimeScan.artifacts.correctedSourceImage,
      timings,
      attempts,
    ),
  };
}
