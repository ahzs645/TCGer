/**
 * Evaluate full-card DINOv2 preprocessing and late fusion on labeled iOS
 * recognition crops.
 *
 * This is deliberately an offline challenger. It uses ground-truth COCO card
 * boxes so recognition is measured independently of localization, downloads
 * canonical references into an explicit cache, and evaluates both:
 *   1. retrieval over a frozen union of hard candidates; and
 *   2. reranking inside the production top-five shortlist.
 *
 * The default `shortlist-union` reference scope is bounded and quick enough
 * for iteration. `all` builds the same experiment over every physical row in
 * the current index, which can require many hours and substantial storage.
 *
 * Usage:
 *   npx tsx src/scripts/evaluate-full-card-embeddings.ts \
 *     --evaluation /path/to/tcger-recognition-gate-final.json \
 *     --index ../frontend/public/scan-index/pokemon-embeddings.json \
 *     --output-dir /path/to/output \
 *     --reference-cache /path/to/reference-cache
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

import sharp from "sharp";

type ReferenceScope = "shortlist-union" | "all";

interface IndexEntry {
  externalId: string;
  name: string;
  imageUrl?: string | null;
}

interface StoredCandidate {
  cardID: string;
  name: string;
  similarity: number;
}

interface RecognitionSample {
  dataset: string;
  expectedCardID?: string;
  expectedName?: string;
  imagePath: string;
  result?: {
    diagnostic?: { candidates?: StoredCandidate[] };
  } | null;
}

interface EvaluationFile {
  recognitionSamples: RecognitionSample[];
}

type LabeledRecognitionSample = RecognitionSample & {
  expectedCardID: string;
  expectedName: string;
};

interface CocoImage {
  id: number;
  file_name: string;
  width: number;
  height: number;
}

interface CocoAnnotation {
  image_id: number;
  bbox: [number, number, number, number];
}

interface CocoFile {
  images: CocoImage[];
  annotations: CocoAnnotation[];
}

interface EvalCase {
  id: string;
  dataset: string;
  expectedId: string;
  expectedName: string;
  sourceImagePath: string;
  queryPath: string;
  split: "calibration" | "holdout";
  productionCandidates: StoredCandidate[];
}

interface EmbeddingPair {
  center: number[];
  letterbox: number[];
}

interface Encoder {
  center(buffer: Buffer): Promise<number[]>;
  exact224(buffer: Buffer): Promise<number[]>;
}

interface ReferenceRecord {
  id: string;
  name: string;
  imageUrl: string;
  path: string;
}

interface RankedCandidate {
  id: string;
  score: number;
}

const FUSION_WEIGHTS = [0, 0.25, 0.5, 0.75, 1] as const;

function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
  };
  const evaluation = get("--evaluation");
  const index = get("--index");
  const outputDir = get("--output-dir");
  const referenceCache = get("--reference-cache");
  const referenceScope = (get("--reference-scope") ?? "shortlist-union") as ReferenceScope;
  const sampleLimit = Number.parseInt(get("--sample-limit") ?? "0", 10);
  const topK = Number.parseInt(get("--topk") ?? "5", 10);
  if (!evaluation || !index || !outputDir || !referenceCache) {
    throw new Error("--evaluation, --index, --output-dir and --reference-cache are required");
  }
  if (referenceScope !== "shortlist-union" && referenceScope !== "all") {
    throw new Error("--reference-scope must be shortlist-union or all");
  }
  return {
    evaluation: resolve(evaluation),
    index: resolve(index),
    outputDir: resolve(outputDir),
    referenceCache: resolve(referenceCache),
    referenceScope,
    sampleLimit,
    topK,
  };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assignIdentityDisjointSplits(cases: EvalCase[]): void {
  const groupMap = new Map<string, { id: string; size: number; datasets: Map<string, number> }>();
  const datasetTotals = new Map<string, number>();
  for (const item of cases) {
    const group = groupMap.get(item.expectedId) ?? { id: item.expectedId, size: 0, datasets: new Map() };
    group.size += 1;
    group.datasets.set(item.dataset, (group.datasets.get(item.dataset) ?? 0) + 1);
    groupMap.set(item.expectedId, group);
    datasetTotals.set(item.dataset, (datasetTotals.get(item.dataset) ?? 0) + 1);
  }
  const groups = [...groupMap.values()].sort((left, right) =>
    sha256Text(`tcger-recognition-v1\0${left.id}`).localeCompare(
      sha256Text(`tcger-recognition-v1\0${right.id}`),
    ));
  if (groups.length > 24) throw new Error("Identity split optimizer supports at most 24 printing groups");
  const target = Math.ceil(cases.length / 2);
  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 2 ** groups.length; mask += 1) {
    let count = 0;
    const byDataset = new Map<string, number>();
    for (let index = 0; index < groups.length; index += 1) {
      if ((mask & (2 ** index)) === 0) continue;
      const group = groups[index]!;
      count += group.size;
      for (const [dataset, amount] of group.datasets) {
        byDataset.set(dataset, (byDataset.get(dataset) ?? 0) + amount);
      }
    }
    const imbalance = [...datasetTotals].reduce(
      (sum, [dataset, total]) => sum + Math.abs(2 * (byDataset.get(dataset) ?? 0) - total),
      0,
    );
    const score = Math.abs(count - target) * 1_000_000 + imbalance;
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
  }
  const calibrationIds = new Set(
    groups.filter((_, index) => (bestMask & (2 ** index)) !== 0).map((group) => group.id),
  );
  for (const item of cases) item.split = calibrationIds.has(item.expectedId) ? "calibration" : "holdout";
}

function isLabeledSample(sample: RecognitionSample): sample is LabeledRecognitionSample {
  return typeof sample.expectedCardID === "string"
    && sample.expectedCardID.length > 0
    && typeof sample.expectedName === "string"
    && sample.expectedName.length > 0;
}

function isPhysical(entry: IndexEntry): boolean {
  return !entry.imageUrl?.toLowerCase().includes("/tcgp/");
}

function l2(values: Float32Array): Float32Array {
  let sum = 0;
  for (const value of values) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm > 1e-8) {
    for (let index = 0; index < values.length; index += 1) values[index]! /= norm;
  }
  return values;
}

function cosine(left: number[], right: number[]): number {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index]! * right[index]!;
  return score;
}

function rank(
  query: EmbeddingPair,
  references: Map<string, EmbeddingPair>,
  ids: string[],
  centerWeight: number,
): RankedCandidate[] {
  return ids
    .flatMap((id) => {
      const reference = references.get(id);
      if (!reference) return [];
      const center = cosine(query.center, reference.center);
      const letterbox = cosine(query.letterbox, reference.letterbox);
      return [{ id, score: centerWeight * center + (1 - centerWeight) * letterbox }];
    })
    .sort((left, right) => right.score - left.score);
}

function topKHit(ranking: RankedCandidate[], expectedId: string, k: number): boolean {
  return ranking.slice(0, k).some((candidate) => candidate.id === expectedId);
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      output[index] = await operation(values[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

function findCocoBox(imagePath: string): [number, number, number, number] | null {
  const annotationPath = join(dirname(imagePath), "_annotations.coco.json");
  if (!existsSync(annotationPath)) return null;
  const coco = JSON.parse(readFileSync(annotationPath, "utf8")) as CocoFile;
  const image = coco.images.find((item) => item.file_name === basename(imagePath));
  if (!image) return null;
  const annotation = coco.annotations.find((item) => item.image_id === image.id);
  return annotation?.bbox ?? null;
}

async function materializeQuery(
  imagePath: string,
  queryPath: string,
): Promise<void> {
  const metadata = await sharp(imagePath).metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const box = findCocoBox(imagePath) ?? [0, 0, width, height];
  const left = Math.max(0, Math.floor(box[0]));
  const top = Math.max(0, Math.floor(box[1]));
  const cropWidth = Math.max(1, Math.min(width - left, Math.ceil(box[2])));
  const cropHeight = Math.max(1, Math.min(height - top, Math.ceil(box[3])));
  await sharp(imagePath)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .rotate()
    .png()
    .toFile(queryPath);
}

async function downloadReference(record: ReferenceRecord): Promise<boolean> {
  if (existsSync(record.path)) return true;
  try {
    const response = await fetch(record.imageUrl);
    if (!response.ok) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    await sharp(bytes).metadata();
    writeFileSync(record.path, bytes);
    return true;
  } catch {
    return false;
  }
}

async function toRawImage(transformers: any, buffer: Buffer): Promise<unknown> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new transformers.RawImage(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
    4,
  );
}

async function createEncoder(transformers: any, model: string, dtype: string) {
  const processor = await transformers.AutoImageProcessor.from_pretrained(model);
  const exact224Processor = new processor.constructor({
    ...processor.config,
    do_resize: false,
    do_center_crop: false,
  });
  const network = await transformers.AutoModel.from_pretrained(model, { dtype });
  const encode = async (buffer: Buffer, imageProcessor: any): Promise<number[]> => {
    const image = await toRawImage(transformers, buffer);
    const inputs = await imageProcessor(image);
    const output = await network(inputs);
    const hiddenState = output.last_hidden_state;
    const hidden = hiddenState.dims[hiddenState.dims.length - 1] as number;
    return Array.from(l2(new Float32Array((hiddenState.data as Float32Array).slice(0, hidden))));
  };
  return {
    center: (buffer: Buffer) => encode(buffer, processor),
    exact224: (buffer: Buffer) => encode(buffer, exact224Processor),
  } satisfies Encoder;
}

async function embeddingPair(
  path: string,
  encoder: Encoder,
): Promise<EmbeddingPair> {
  const source = readFileSync(path);
  const letterboxed = await sharp(source)
    .resize(224, 224, {
      fit: "contain",
      withoutEnlargement: false,
      background: { r: 124, g: 116, b: 104, alpha: 1 },
    })
    .png()
    .toBuffer();
  return {
    center: await encoder.center(source),
    letterbox: await encoder.exact224(letterboxed),
  };
}

function summarizeRows(rows: any[], topK: number) {
  const bySplit: Record<string, any> = {};
  for (const split of ["all", "calibration", "holdout"] as const) {
    const selected = split === "all" ? rows : rows.filter((row) => row.split === split);
    const denominator = selected.length;
    const summary: Record<string, unknown> = {
      cases: denominator,
      productionTop1: selected.filter((row) => row.productionTop1 === row.expectedId).length,
      productionTopKCoverage: selected.filter((row) => row.productionTopKCoverage).length,
    };
    for (const weight of FUSION_WEIGHTS) {
      const key = `fusion_${weight.toFixed(2)}`;
      summary[`${key}_unionTop1`] = selected.filter(
        (row) => row.unionRankings[key]?.[0]?.id === row.expectedId,
      ).length;
      summary[`${key}_unionTopK`] = selected.filter((row) =>
        topKHit(row.unionRankings[key] ?? [], row.expectedId, topK),
      ).length;
      summary[`${key}_shortlistTop1`] = selected.filter(
        (row) => row.shortlistRankings[key]?.[0]?.id === row.expectedId,
      ).length;
    }
    bySplit[split] = summary;
  }
  return bySplit;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.outputDir, { recursive: true });
  mkdirSync(options.referenceCache, { recursive: true });
  const queryDirectory = join(options.outputDir, "query-crops");
  mkdirSync(queryDirectory, { recursive: true });

  const evaluation = JSON.parse(readFileSync(options.evaluation, "utf8")) as EvaluationFile;
  const indexFile = JSON.parse(readFileSync(options.index, "utf8")) as {
    model: string;
    dtype: string;
    entries: IndexEntry[];
  };
  const entriesById = new Map(indexFile.entries.map((entry) => [entry.externalId, entry]));

  const allLabeledSamples = evaluation.recognitionSamples.filter(isLabeledSample);
  const samples = options.sampleLimit > 0
    ? allLabeledSamples.slice(0, options.sampleLimit)
    : allLabeledSamples;
  const cases: EvalCase[] = [];
  for (const [index, sample] of samples.entries()) {
    const sourceImagePath = resolve(dirname(options.evaluation), sample.imagePath);
    if (!existsSync(sourceImagePath)) continue;
    const expectedEntry = entriesById.get(sample.expectedCardID);
    if (!expectedEntry || !isPhysical(expectedEntry)) continue;
    const id = `${sample.dataset}-${index.toString().padStart(3, "0")}-${safeName(sample.expectedCardID)}`;
    const queryPath = join(queryDirectory, `${id}.png`);
    await materializeQuery(sourceImagePath, queryPath);
    const productionCandidates = (sample.result?.diagnostic?.candidates ?? []).filter((candidate) => {
      const entry = entriesById.get(candidate.cardID);
      return entry ? isPhysical(entry) : false;
    });
    cases.push({
      id,
      dataset: sample.dataset,
      expectedId: sample.expectedCardID,
      expectedName: sample.expectedName,
      sourceImagePath,
      queryPath,
      split: "calibration",
      productionCandidates,
    });
  }
  if (cases.length === 0) throw new Error("No evaluation cases were materialized");
  assignIdentityDisjointSplits(cases);
  const calibrationIds = new Set(cases.filter((item) => item.split === "calibration").map((item) => item.expectedId));
  const holdoutIds = new Set(cases.filter((item) => item.split === "holdout").map((item) => item.expectedId));
  if ([...calibrationIds].some((id) => holdoutIds.has(id))) throw new Error("Identity leakage across split");

  const referenceIds = new Set<string>();
  if (options.referenceScope === "all") {
    for (const entry of indexFile.entries) if (isPhysical(entry)) referenceIds.add(entry.externalId);
  } else {
    for (const item of cases) {
      referenceIds.add(item.expectedId);
      for (const candidate of item.productionCandidates.slice(0, 10)) referenceIds.add(candidate.cardID);
    }
  }

  const referenceRecords: ReferenceRecord[] = [];
  for (const id of [...referenceIds].sort()) {
    const entry = entriesById.get(id);
    if (!entry?.imageUrl || !isPhysical(entry)) continue;
    referenceRecords.push({
      id,
      name: entry.name,
      imageUrl: entry.imageUrl,
      path: join(options.referenceCache, `${safeName(id)}-${sha256Text(entry.imageUrl).slice(0, 12)}.image`),
    });
  }
  console.log(`[references] downloading/checking ${referenceRecords.length}`);
  const availability = await mapLimit(referenceRecords, 8, downloadReference);
  const availableReferences = referenceRecords.filter((_, index) => availability[index]);
  const missingReferences = referenceRecords.filter((_, index) => !availability[index]);
  const referenceCorpusSha256 = sha256Text(
    availableReferences
      .map((record) => `${record.id}\0${record.imageUrl}\0${sha256File(record.path)}`)
      .sort()
      .join("\n"),
  );
  console.log(`[references] ${availableReferences.length} available; ${missingReferences.length} missing`);

  const transformers = (await import("@huggingface/transformers")) as any;
  const encoder = await createEncoder(transformers, indexFile.model, indexFile.dtype ?? "q8");
  const preprocessingVersion = "center-default__letterbox-exact-224-v2";
  const indexSha256 = sha256File(options.index);
  const embeddingCachePath = join(
    options.outputDir,
    `reference-embeddings-${options.referenceScope}-full-card-v2.json`,
  );
  const cached = existsSync(embeddingCachePath)
    ? JSON.parse(readFileSync(embeddingCachePath, "utf8")) as {
      model: string;
      dtype: string;
      preprocessingVersion: string;
      indexSha256: string;
      referenceCorpusSha256: string;
      embeddings: Record<string, EmbeddingPair>;
      }
    : null;
  const referenceEmbeddings = new Map<string, EmbeddingPair>();
  if (
    cached?.model === indexFile.model
    && cached.dtype === (indexFile.dtype ?? "q8")
    && cached.preprocessingVersion === preprocessingVersion
    && cached.indexSha256 === indexSha256
    && cached.referenceCorpusSha256 === referenceCorpusSha256
  ) {
    const currentIds = new Set(availableReferences.map((item) => item.id));
    for (const [id, pair] of Object.entries(cached.embeddings)) {
      const valid = pair.center.length === 384
        && pair.letterbox.length === 384
        && [...pair.center, ...pair.letterbox].every(Number.isFinite);
      if (currentIds.has(id) && valid) referenceEmbeddings.set(id, pair);
    }
  }

  for (const [index, reference] of availableReferences.entries()) {
    if (referenceEmbeddings.has(reference.id)) continue;
    const started = performance.now();
    referenceEmbeddings.set(reference.id, await embeddingPair(reference.path, encoder));
    if ((index + 1) % 10 === 0 || index + 1 === availableReferences.length) {
      console.log(
        `[embed references] ${index + 1}/${availableReferences.length} (${Math.round(performance.now() - started)} ms latest)`,
      );
      writeFileSync(
        embeddingCachePath,
        JSON.stringify({
          model: indexFile.model,
          dtype: indexFile.dtype ?? "q8",
          preprocessingVersion,
          indexSha256,
          referenceCorpusSha256,
          embeddings: Object.fromEntries(referenceEmbeddings),
        }),
      );
    }
  }
  writeFileSync(
    embeddingCachePath,
    JSON.stringify({
      model: indexFile.model,
      dtype: indexFile.dtype ?? "q8",
      preprocessingVersion,
      indexSha256,
      referenceCorpusSha256,
      embeddings: Object.fromEntries(referenceEmbeddings),
    }),
  );

  const unionIds = [...referenceEmbeddings.keys()].sort();
  const referencePathById = new Map(availableReferences.map((record) => [record.id, record.path]));
  const rows: any[] = [];
  for (const [caseIndex, item] of cases.entries()) {
    const started = performance.now();
    const query = await embeddingPair(item.queryPath, encoder);
    const shortlistIds = item.productionCandidates
      .slice(0, options.topK)
      .map((candidate) => candidate.cardID)
      .filter((id) => referenceEmbeddings.has(id));
    const unionRankings: Record<string, RankedCandidate[]> = {};
    const shortlistRankings: Record<string, RankedCandidate[]> = {};
    for (const weight of FUSION_WEIGHTS) {
      const key = `fusion_${weight.toFixed(2)}`;
      unionRankings[key] = rank(query, referenceEmbeddings, unionIds, weight).slice(0, options.topK);
      shortlistRankings[key] = rank(query, referenceEmbeddings, shortlistIds, weight);
    }
    rows.push({
      id: item.id,
      dataset: item.dataset,
      split: item.split,
      expectedId: item.expectedId,
      expectedName: item.expectedName,
      sourceImagePath: item.sourceImagePath,
      queryPath: item.queryPath,
      querySha256: sha256File(item.queryPath),
      productionTop1: item.productionCandidates[0]?.cardID ?? null,
      productionTopKCoverage: item.productionCandidates
        .slice(0, options.topK)
        .some((candidate) => candidate.cardID === item.expectedId),
      candidateReferences: item.productionCandidates.slice(0, options.topK).map((candidate) => ({
        id: candidate.cardID,
        name: candidate.name,
        baselineSimilarity: candidate.similarity,
        referencePath: referencePathById.get(candidate.cardID) ?? null,
        referenceSha256: referencePathById.has(candidate.cardID)
          ? sha256File(referencePathById.get(candidate.cardID)!)
          : null,
      })),
      unionRankings,
      shortlistRankings,
      elapsedMs: performance.now() - started,
    });
    console.log(`[embed queries] ${caseIndex + 1}/${cases.length}`);
  }

  const summary = summarizeRows(rows, options.topK);
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    experiment: "full-card-dinov2-letterbox-and-late-fusion",
    scope: {
      evaluation: options.evaluation,
      evaluationSha256: sha256File(options.evaluation),
      scriptSha256: sha256File(resolve(process.argv[1]!)),
      index: options.index,
      indexSha256,
      referenceScope: options.referenceScope,
      cases: cases.length,
      referencesRequested: referenceRecords.length,
      referencesAvailable: availableReferences.length,
      referencesMissing: missingReferences.map((record) => record.id),
      referenceCorpusSha256,
      topK: options.topK,
      model: indexFile.model,
      dtype: indexFile.dtype,
      fusionWeightMeaning: "1.0=center-crop only; 0.0=letterbox only",
      preprocessingVersion,
      splitPolicy: "Identity-disjoint deterministic SHA-256-ordered group split, balanced by case count and source dataset without model outcomes.",
      limitation: options.referenceScope === "all"
        ? "Full physical reference index."
        : "Oracle candidate universe includes every expected card plus production top-10 candidates; ranking evidence only, not recall.",
    },
    summary,
    cases: rows,
  };
  const resultPath = join(options.outputDir, `full-card-results-${options.referenceScope}.json`);
  writeFileSync(resultPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ resultPath, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
