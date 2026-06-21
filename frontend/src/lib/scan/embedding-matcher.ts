/**
 * Browser-side embedding matcher (client-side, no server in the recognition path).
 *
 * Runs the SAME encoder the reference index was built with — CLIP ViT-B/32 via
 * Transformers.js (ONNX Runtime Web: WebGPU when available, WASM single-thread
 * fallback) — so preprocessing is byte-identical to the index builder
 * (backend/src/scripts/build-embedding-index.ts). The embedding is used only as
 * a top-K shortlist; near-identical cards are disambiguated downstream by the
 * collector-number OCR stage (see docs/client-side-scanner-options.md).
 *
 * The reference index is int8-quantised (value*scale, scale=127). Cosine is
 * computed directly over the packed bytes: because the query vector is
 * L2-normalised, cosine = dot(query, int8Entry) / ||int8Entry||, and the int8
 * scale cancels — so we only precompute each entry's inverse norm once.
 */

import { getContext2d } from "./canvas-utils";
import type { BrowserVideoScanCandidate } from "./scan-types";
import type { TcgCode } from "@/types/card";

// ---------- types ----------

/** Encoder family — determines model class + how the vector is read. */
export type EncoderKind = "clip" | "dinov2";

export interface EmbeddingIndexEntry {
  externalId: string;
  name: string;
  setCode: string | null;
  setName: string | null;
  rarity: string | null;
  imageUrl: string | null;
}

export interface EmbeddingIndex {
  model: string;
  dtype: string;
  encoder: EncoderKind;
  dimension: number;
  tcg: TcgCode;
  scale: number;
  total: number;
  entries: EmbeddingIndexEntry[];
  /** Packed int8 vectors, row-major [total * dimension]. */
  vectors: Int8Array;
  /** Per-entry 1/||vector|| precomputed from the int8 rows (length = total). */
  invNorms: Float32Array;
}

/** Raw artifact shape emitted by build-embedding-index.ts. */
interface EmbeddingIndexArtifact {
  version: number;
  kind: string;
  model: string;
  dtype: string;
  encoder?: string;
  dimension: number;
  tcg?: string;
  scale: number;
  total: number;
  entries: Array<{
    externalId: string;
    name: string;
    setCode: string | null;
    setName?: string | null;
    rarity?: string | null;
    imageUrl?: string | null;
  }>;
  vectors: string; // base64 Int8Array
}

function inferEncoder(model: string): EncoderKind {
  return /dinov2/i.test(model) ? "dinov2" : "clip";
}

// ---------- index parsing ----------

function base64ToInt8Array(base64: string): Int8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int8Array(bytes.buffer);
}

export function parseEmbeddingIndex(
  artifact: EmbeddingIndexArtifact,
  tcg: TcgCode = "pokemon",
): EmbeddingIndex {
  const dimension = artifact.dimension;
  const vectors = base64ToInt8Array(artifact.vectors);
  const total = artifact.entries.length;

  // Precompute inverse L2 norm per entry (over the int8 rows). The int8 scale
  // cancels in cosine, so we can work on the raw bytes directly.
  const invNorms = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const base = i * dimension;
    let sq = 0;
    for (let k = 0; k < dimension; k++) {
      const x = vectors[base + k]!;
      sq += x * x;
    }
    invNorms[i] = sq > 0 ? 1 / Math.sqrt(sq) : 0;
  }

  const entries: EmbeddingIndexEntry[] = artifact.entries.map((e) => ({
    externalId: e.externalId,
    name: e.name,
    setCode: e.setCode ?? null,
    setName: e.setName ?? null,
    rarity: e.rarity ?? null,
    imageUrl: e.imageUrl ?? null,
  }));

  return {
    model: artifact.model,
    dtype: artifact.dtype,
    encoder: (artifact.encoder as EncoderKind) ?? inferEncoder(artifact.model),
    dimension,
    tcg,
    scale: artifact.scale,
    total,
    entries,
    vectors,
    invNorms,
  };
}

// ---------- encoder (lazy-loaded Transformers.js) ----------

type TransformersModule = {
  AutoProcessor: { from_pretrained: (id: string) => Promise<unknown> };
  AutoImageProcessor: { from_pretrained: (id: string) => Promise<unknown> };
  AutoModel: {
    from_pretrained: (
      id: string,
      opts: { dtype: string; device?: string },
    ) => Promise<unknown>;
  };
  CLIPVisionModelWithProjection: {
    from_pretrained: (id: string, opts: { dtype: string; device?: string }) => Promise<unknown>;
  };
  RawImage: new (
    data: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    channels: number,
  ) => unknown;
  env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
  };
};

let modelPromise: Promise<void> | null = null;
/** Encoder closure: RawImage → raw (un-normalised) embedding vector. */
let embedFn: ((image: unknown) => Promise<Float32Array>) | null = null;
let RawImageCtor: TransformersModule["RawImage"] | null = null;

export interface EmbeddingModelConfig {
  /** HF model id; must match the index's `model`. */
  model?: string;
  /** Quantization dtype; must match the index's `dtype`. */
  dtype?: string;
  /** Encoder family; must match the index's `encoder`. */
  encoder?: EncoderKind;
  /** "webgpu" | "wasm"; undefined lets Transformers.js pick (WASM default). */
  device?: string;
  onStatus?: (message: string) => void;
}

export function isEmbeddingModelReady(): boolean {
  return embedFn !== null;
}

/** Idempotently load the embedding model + processor. Safe to call repeatedly. */
export async function ensureEmbeddingModel(
  config: EmbeddingModelConfig = {},
): Promise<void> {
  if (isEmbeddingModelReady()) return;
  if (modelPromise) return modelPromise;

  const model = config.model ?? "Xenova/clip-vit-base-patch32";
  const dtype = config.dtype ?? "q8";
  const encoder = config.encoder ?? inferEncoder(model);
  const device = config.device ? { device: config.device } : {};

  modelPromise = (async () => {
    config.onStatus?.("Loading scanner model…");
    const transformers = (await import(
      "@huggingface/transformers"
    )) as unknown as TransformersModule;

    // Allow remote (HF CDN) model download by default; self-hosting under
    // /models is handled by the static-delivery task.
    transformers.env.allowRemoteModels = true;
    RawImageCtor = transformers.RawImage;

    if (encoder === "dinov2") {
      const proc = (await transformers.AutoImageProcessor.from_pretrained(
        model,
      )) as (image: unknown) => Promise<Record<string, unknown>>;
      const net = (await transformers.AutoModel.from_pretrained(model, {
        dtype,
        ...device,
      })) as (
        inputs: Record<string, unknown>,
      ) => Promise<{ last_hidden_state: { data: Float32Array; dims: number[] } }>;
      embedFn = async (image: unknown) => {
        const inputs = await proc(image);
        const out = await net(inputs);
        // DINOv2 has no projection head: use the CLS token (position 0).
        const lhs = out.last_hidden_state;
        const hidden = lhs.dims[lhs.dims.length - 1]!;
        return new Float32Array(lhs.data.slice(0, hidden));
      };
    } else {
      const proc = (await transformers.AutoProcessor.from_pretrained(
        model,
      )) as (image: unknown) => Promise<Record<string, unknown>>;
      const net = (await transformers.CLIPVisionModelWithProjection.from_pretrained(
        model,
        { dtype, ...device },
      )) as (
        inputs: Record<string, unknown>,
      ) => Promise<{ image_embeds: { data: Float32Array } }>;
      embedFn = async (image: unknown) => {
        const inputs = await proc(image);
        const { image_embeds } = await net(inputs);
        return new Float32Array(image_embeds.data);
      };
    }
    config.onStatus?.("Scanner model ready");
  })();

  try {
    await modelPromise;
  } catch (err) {
    modelPromise = null; // allow retry on failure
    throw err;
  }
}

/**
 * Embed a rectified card crop into an L2-normalised vector.
 * Returns null if the model is not loaded.
 */
export async function computeEmbeddingFromCanvas(
  cardCanvas: HTMLCanvasElement,
): Promise<Float32Array | null> {
  if (!embedFn || !RawImageCtor) return null;

  const ctx = getContext2d(cardCanvas);
  const imageData = ctx.getImageData(0, 0, cardCanvas.width, cardCanvas.height);
  const image = new RawImageCtor(
    imageData.data,
    cardCanvas.width,
    cardCanvas.height,
    4,
  );

  const out = await embedFn(image); // raw embedding (copied out of tensor)

  // L2 normalise (query side; entry side handled via precomputed invNorms).
  let sq = 0;
  for (let i = 0; i < out.length; i++) sq += out[i]! * out[i]!;
  const norm = Math.sqrt(sq);
  if (norm > 1e-8) for (let i = 0; i < out.length; i++) out[i]! /= norm;
  return out;
}

// ---------- matching ----------

/** Map cosine similarity → integer distance (mirrors backend convention). */
function distanceFromSimilarity(similarity: number): number {
  return Math.round((1 - Math.max(0, Math.min(1, similarity))) * 1000);
}

export interface EmbeddingMatchOptions {
  topK?: number;
  tcgFilter?: TcgCode | "all";
  proposalLabel?: string;
  /** Min top-1 similarity to mark a candidate as confident. */
  minSimilarity?: number;
  /** Min top1−top2 margin to mark the top candidate as confident. */
  minMargin?: number;
}

/**
 * Brute-force int8 cosine top-K over the reference index.
 * The query must be L2-normalised (computeEmbeddingFromCanvas does this).
 */
export function matchEmbeddingTopK(
  query: Float32Array,
  index: EmbeddingIndex,
  options: EmbeddingMatchOptions = {},
): BrowserVideoScanCandidate[] {
  const {
    topK = 20,
    tcgFilter,
    proposalLabel = "embedding",
    minSimilarity = 0.9,
    minMargin = 0.02,
  } = options;

  const { dimension, vectors, invNorms, entries, tcg } = index;
  if (query.length !== dimension) return [];
  if (tcgFilter && tcgFilter !== "all" && tcgFilter !== tcg) return [];

  // Top-K by similarity (small K → linear insertion is fine).
  const bestIdx: number[] = [];
  const bestSim: number[] = [];
  let worst = -Infinity;

  for (let i = 0; i < entries.length; i++) {
    const inv = invNorms[i]!;
    if (inv === 0) continue;
    const base = i * dimension;
    let dot = 0;
    for (let k = 0; k < dimension; k++) dot += query[k]! * vectors[base + k]!;
    const sim = dot * inv;

    if (bestIdx.length < topK) {
      bestIdx.push(i);
      bestSim.push(sim);
      if (bestIdx.length === topK) worst = Math.min(...bestSim);
    } else if (sim > worst) {
      // replace current worst
      let wi = 0;
      for (let j = 1; j < bestSim.length; j++) if (bestSim[j]! < bestSim[wi]!) wi = j;
      bestIdx[wi] = i;
      bestSim[wi] = sim;
      worst = Math.min(...bestSim);
    }
  }

  // sort descending by similarity
  const order = bestIdx
    .map((idx, j) => ({ idx, sim: bestSim[j]! }))
    .sort((a, b) => b.sim - a.sim);

  const top1 = order[0]?.sim ?? 0;
  const top2 = order[1]?.sim ?? 0;
  const margin = top1 - top2;

  return order.map(({ idx, sim }, rank) => {
    const entry = entries[idx]!;
    const confident =
      rank === 0 && (sim >= minSimilarity || margin >= minMargin);
    const distance = distanceFromSimilarity(sim);
    const candidate: BrowserVideoScanCandidate = {
      externalId: entry.externalId,
      tcg,
      name: entry.name,
      setCode: entry.setCode,
      setName: entry.setName,
      rarity: entry.rarity,
      imageUrl: entry.imageUrl,
      confidence: Math.max(0, Math.min(1, sim)),
      distance,
      scoreDistance: distance,
      passedThreshold: confident,
      fullDistance: distance,
      titleDistance: null,
      footerDistance: null,
      proposalLabel,
      artworkSimilarity: sim,
    };
    return candidate;
  });
}
