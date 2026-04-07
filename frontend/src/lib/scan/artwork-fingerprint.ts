/**
 * Browser-side artwork fingerprint matching.
 *
 * Ported from backend artwork-matcher.ts (which was inspired by RiftBound
 * Scanner's cardMatcher.js). The algorithm:
 *
 *   1. Crop the artwork region (excludes card border, name, text)
 *   2. Histogram-equalise per RGB channel for lighting invariance
 *   3. Resize to 8×8 grid → 192-dimensional fingerprint
 *   4. Cosine similarity against pre-built database
 *
 * Uses Canvas API instead of sharp. All operations are synchronous.
 */

import { clamp, createCanvas, getContext2d } from "./canvas-utils";
import type { SupportedTcg, TcgCode } from "./scan-types";

// ---------- constants ----------

const GRID_SIZE = 8;
const FINGERPRINT_DIM = GRID_SIZE * GRID_SIZE * 3; // 192
const EQUALIZE_SIZE = 64;

/** TCG-specific artwork crop regions (fraction of card dimensions). */
const ARTWORK_REGIONS: Record<
  SupportedTcg,
  { top: number; bottom: number; left: number; right: number }
> = {
  pokemon: { top: 0.08, bottom: 0.55, left: 0.05, right: 0.95 },
  magic: { top: 0.12, bottom: 0.55, left: 0.07, right: 0.93 },
  yugioh: { top: 0.20, bottom: 0.60, left: 0.10, right: 0.90 },
};

// ---------- types ----------

export interface ArtworkFingerprintEntry {
  externalId: string;
  tcg: TcgCode;
  name: string;
  setCode: string | null;
  fingerprint: Float32Array; // 192 elements
  norm: number; // pre-computed L2 norm
}

export interface ArtworkMatch {
  externalId: string;
  tcg: TcgCode;
  name: string;
  setCode: string | null;
  similarity: number;
}

// ---------- fingerprint computation ----------

/**
 * Compute artwork fingerprint from a card canvas.
 * The canvas should contain a rectified (de-warped) card image.
 */
export function computeArtworkFingerprintFromCanvas(
  cardCanvas: HTMLCanvasElement,
  tcg: SupportedTcg = "pokemon",
): Float32Array {
  const region = ARTWORK_REGIONS[tcg];
  const w = cardCanvas.width;
  const h = cardCanvas.height;

  // Crop to artwork region
  const cropLeft = clamp(Math.round(w * region.left), 0, w - 1);
  const cropTop = clamp(Math.round(h * region.top), 0, h - 1);
  const cropWidth = clamp(
    Math.round(w * (region.right - region.left)),
    1,
    w - cropLeft,
  );
  const cropHeight = clamp(
    Math.round(h * (region.bottom - region.top)),
    1,
    h - cropTop,
  );

  // Draw artwork region at equalization resolution
  const eqCanvas = createCanvas(EQUALIZE_SIZE, EQUALIZE_SIZE);
  const eqCtx = getContext2d(eqCanvas);
  eqCtx.drawImage(
    cardCanvas,
    cropLeft,
    cropTop,
    cropWidth,
    cropHeight,
    0,
    0,
    EQUALIZE_SIZE,
    EQUALIZE_SIZE,
  );

  // Get pixel data and equalise per channel
  const imageData = eqCtx.getImageData(0, 0, EQUALIZE_SIZE, EQUALIZE_SIZE);
  equalizeChannelInPlace(imageData.data, 0); // R
  equalizeChannelInPlace(imageData.data, 1); // G
  equalizeChannelInPlace(imageData.data, 2); // B
  eqCtx.putImageData(imageData, 0, 0);

  // Resize equalised artwork to grid size
  const gridCanvas = createCanvas(GRID_SIZE, GRID_SIZE);
  const gridCtx = getContext2d(gridCanvas);
  gridCtx.imageSmoothingEnabled = true;
  gridCtx.imageSmoothingQuality = "high";
  gridCtx.drawImage(eqCanvas, 0, 0, GRID_SIZE, GRID_SIZE);
  const gridData = gridCtx.getImageData(0, 0, GRID_SIZE, GRID_SIZE);

  // Pack into Float32Array normalised to [0,1]
  const fp = new Float32Array(FINGERPRINT_DIM);
  const cells = GRID_SIZE * GRID_SIZE;
  for (let i = 0; i < cells; i++) {
    fp[i] = (gridData.data[i * 4] ?? 0) / 255; // R
    fp[cells + i] = (gridData.data[i * 4 + 1] ?? 0) / 255; // G
    fp[2 * cells + i] = (gridData.data[i * 4 + 2] ?? 0) / 255; // B
  }

  return fp;
}

// ---------- histogram equalisation ----------

/**
 * Per-channel histogram equalisation on RGBA ImageData in-place.
 * Matches the backend artwork-matcher.ts algorithm exactly.
 */
function equalizeChannelInPlace(
  data: Uint8ClampedArray,
  channelOffset: number,
): void {
  const pixels = data.length / 4;

  // Build histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < pixels; i++) {
    hist[data[i * 4 + channelOffset]!]!++;
  }

  // Compute CDF
  const cdf = new Uint32Array(256);
  cdf[0] = hist[0]!;
  for (let i = 1; i < 256; i++) {
    cdf[i] = cdf[i - 1]! + hist[i]!;
  }

  // Find minimum non-zero CDF value
  let cdfMin = 0;
  for (let i = 0; i < 256; i++) {
    if (cdf[i]! > 0) {
      cdfMin = cdf[i]!;
      break;
    }
  }

  // Remap pixel values
  const denom = pixels - cdfMin;
  if (denom > 0) {
    for (let i = 0; i < pixels; i++) {
      const idx = i * 4 + channelOffset;
      data[idx] = Math.round(((cdf[data[idx]!]! - cdfMin) * 255) / denom);
    }
  }
}

// ---------- matching ----------

/**
 * Match an artwork fingerprint against a database of pre-computed fingerprints.
 * Returns top-N matches sorted by cosine similarity (descending).
 */
export function matchArtworkFingerprint(
  queryFp: Float32Array,
  database: ArtworkFingerprintEntry[],
  topN: number,
  tcgFilter?: TcgCode | "all",
): ArtworkMatch[] {
  const queryNorm = l2Norm(queryFp);
  if (queryNorm < 1e-8) {
    return [];
  }

  const results: ArtworkMatch[] = [];

  for (const entry of database) {
    if (tcgFilter && tcgFilter !== "all" && entry.tcg !== tcgFilter) {
      continue;
    }

    if (entry.norm < 1e-8) {
      continue;
    }

    const dot = dotProduct(queryFp, entry.fingerprint);
    const similarity = dot / (queryNorm * entry.norm);

    if (results.length < topN) {
      results.push({
        externalId: entry.externalId,
        tcg: entry.tcg,
        name: entry.name,
        setCode: entry.setCode,
        similarity,
      });
      if (results.length === topN) {
        results.sort((a, b) => b.similarity - a.similarity);
      }
    } else if (similarity > results[results.length - 1]!.similarity) {
      results[results.length - 1] = {
        externalId: entry.externalId,
        tcg: entry.tcg,
        name: entry.name,
        setCode: entry.setCode,
        similarity,
      };
      results.sort((a, b) => b.similarity - a.similarity);
    }
  }

  if (results.length < topN) {
    results.sort((a, b) => b.similarity - a.similarity);
  }

  return results;
}

// ---------- database helpers ----------

/**
 * Parse artwork fingerprint entries from a JSON payload.
 * Expected format matches the backend artwork-fingerprints.json.
 */
export function parseArtworkDatabase(
  json: {
    entries: Array<{
      externalId: string;
      name: string;
      setCode: string | null;
      fingerprint: string; // base64-encoded Float32Array
    }>;
    tcg?: string;
  },
  tcg: TcgCode = "pokemon",
): ArtworkFingerprintEntry[] {
  return json.entries.map((entry) => {
    const fp = base64ToFloat32Array(entry.fingerprint);
    return {
      externalId: entry.externalId,
      tcg,
      name: entry.name,
      setCode: entry.setCode,
      fingerprint: fp,
      norm: l2Norm(fp),
    };
  });
}

// ---------- math helpers ----------

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

export function l2Norm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i]! * v[i]!;
  }
  return Math.sqrt(sum);
}

function base64ToFloat32Array(base64: string): Float32Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}
