/**
 * Artwork-first card matching using color grid fingerprints.
 *
 * Inspired by RiftBound Scanner's cardMatcher.js:
 *   1. Crop the artwork region (excludes card border, name, text)
 *   2. Histogram-equalise per RGB channel for lighting invariance
 *   3. Resize to 8×8 grid → 192-dimensional fingerprint
 *   4. Cosine similarity against pre-built database
 *
 * This is robust to video noise, compression, and hand occlusion at card edges
 * because the artwork region is the most stable and discriminative part of a card.
 */

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// ---------- types ----------

export type ArtworkFingerprint = Float32Array; // 192 elements (8×8×3)
export type HsvHistogram = Float32Array; // H_BINS * S_BINS elements

export interface ArtworkFingerprintEntry {
  externalId: string;
  name: string;
  setCode: string | null;
  fingerprint: ArtworkFingerprint;
  norm: number; // pre-computed L2 norm for fast cosine similarity
  hsvHist: HsvHistogram | null; // HSV histogram for color distribution matching
}

export interface ArtworkMatch {
  externalId: string;
  name: string;
  setCode: string | null;
  similarity: number;
}

interface ArtworkDatabaseJson {
  version: number;
  tcg: string;
  gridSize: number;
  dimensions: number;
  total: number;
  entries: Array<{
    externalId: string;
    name: string;
    setCode: string | null;
    fingerprint: string; // base64-encoded Float32Array
    hsvHist?: string; // base64-encoded Float32Array (HSV histogram)
  }>;
}

// ---------- constants ----------

const GRID_SIZE = 8;
const FINGERPRINT_DIM = GRID_SIZE * GRID_SIZE * 3; // 192
const HSV_H_BINS = 30;
const HSV_S_BINS = 32;
const HSV_HIST_DIM = HSV_H_BINS * HSV_S_BINS; // 960

/** TCG-specific artwork crop regions (fraction of card dimensions). */
export const ARTWORK_REGIONS: Record<string, { top: number; bottom: number; left: number; right: number }> = {
  pokemon: { top: 0.08, bottom: 0.55, left: 0.05, right: 0.95 },
  magic: { top: 0.12, bottom: 0.55, left: 0.07, right: 0.93 },
  yugioh: { top: 0.20, bottom: 0.60, left: 0.10, right: 0.90 },
};

// ---------- in-memory database ----------

let artworkDb: ArtworkFingerprintEntry[] | null = null;

// ---------- public API ----------

/**
 * Compute the artwork fingerprint for a card image.
 */
export async function computeArtworkFingerprint(
  imageBuffer: Buffer,
  tcg = 'pokemon'
): Promise<ArtworkFingerprint> {
  const region = ARTWORK_REGIONS[tcg] ?? ARTWORK_REGIONS.pokemon!;
  const meta = await sharp(imageBuffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  // Crop to artwork region
  const cropLeft = Math.round(w * region.left);
  const cropTop = Math.round(h * region.top);
  const cropWidth = Math.round(w * (region.right - region.left));
  const cropHeight = Math.round(h * (region.bottom - region.top));

  if (cropWidth <= 0 || cropHeight <= 0) {
    return new Float32Array(FINGERPRINT_DIM);
  }

  // Read artwork at intermediate resolution for histogram equalisation
  const eqSize = 64;
  const raw = await sharp(imageBuffer)
    .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
    .resize(eqSize, eqSize, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  // Per-channel histogram equalisation
  const pixels = eqSize * eqSize;
  const equalized = Buffer.from(raw);
  for (let ch = 0; ch < 3; ch++) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < pixels; i++) hist[equalized[i * 3 + ch]!]++;

    const cdf = new Uint32Array(256);
    cdf[0] = hist[0]!;
    for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1]! + hist[i]!;

    let cdfMin = 0;
    for (let i = 0; i < 256; i++) {
      if (cdf[i]! > 0) { cdfMin = cdf[i]!; break; }
    }

    const denom = pixels - cdfMin;
    if (denom > 0) {
      for (let i = 0; i < pixels; i++) {
        const idx = i * 3 + ch;
        equalized[idx] = Math.round(((cdf[equalized[idx]!]! - cdfMin) * 255) / denom);
      }
    }
  }

  // Resize equalised artwork to grid size
  const grid = await sharp(equalized, { raw: { width: eqSize, height: eqSize, channels: 3 } })
    .resize(GRID_SIZE, GRID_SIZE, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer();

  // Pack into Float32Array normalised to [0,1]
  const fp = new Float32Array(FINGERPRINT_DIM);
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    fp[i] = grid[i * 3]! / 255;                                // R
    fp[GRID_SIZE * GRID_SIZE + i] = grid[i * 3 + 1]! / 255;    // G
    fp[2 * GRID_SIZE * GRID_SIZE + i] = grid[i * 3 + 2]! / 255; // B
  }

  return fp;
}

/**
 * Compute HSV histogram from a card image (full card, not just artwork).
 * HSV captures color distribution independently of spatial layout,
 * which helps distinguish cards with similar artwork but different color tones.
 */
export async function computeHsvHistogram(imageBuffer: Buffer): Promise<HsvHistogram> {
  const size = 128;
  const raw = await sharp(imageBuffer)
    .resize(size, size, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  const hist = new Float32Array(HSV_HIST_DIM);
  const pixels = size * size;

  for (let i = 0; i < pixels; i++) {
    const r = raw[i * 3]! / 255;
    const g = raw[i * 3 + 1]! / 255;
    const b = raw[i * 3 + 2]! / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn;

    let h = 0;
    if (d > 0) {
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    const s = mx > 0 ? d / mx : 0;

    const hBin = Math.min(HSV_H_BINS - 1, Math.floor((h / 360) * HSV_H_BINS));
    const sBin = Math.min(HSV_S_BINS - 1, Math.floor(s * HSV_S_BINS));
    hist[hBin * HSV_S_BINS + sBin]++;
  }

  // Normalise to sum=1
  let sum = 0;
  for (let i = 0; i < hist.length; i++) sum += hist[i]!;
  if (sum > 0) for (let i = 0; i < hist.length; i++) hist[i] /= sum;
  return hist;
}

/**
 * Pearson correlation between two HSV histograms. Returns [-1, 1].
 */
export function hsvCorrelation(a: HsvHistogram, b: HsvHistogram): number {
  const n = a.length;
  let s1 = 0, s2 = 0, s12 = 0, s11 = 0, s22 = 0;
  for (let i = 0; i < n; i++) {
    s1 += a[i]!; s2 += b[i]!;
    s12 += a[i]! * b[i]!;
    s11 += a[i]! * a[i]!;
    s22 += b[i]! * b[i]!;
  }
  const denom = Math.sqrt((n * s11 - s1 * s1) * (n * s22 - s2 * s2));
  return denom > 0 ? (n * s12 - s1 * s2) / denom : 0;
}

/**
 * Cosine similarity between two fingerprints.
 */
export function cosineSimilarity(a: ArtworkFingerprint, b: ArtworkFingerprint): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Load the artwork fingerprint database from disk.
 */
export async function loadArtworkDatabase(dataDir: string): Promise<ArtworkFingerprintEntry[]> {
  if (artworkDb) return artworkDb;

  const filePath = path.join(dataDir, 'artwork-fingerprints.json');
  const raw = await readFile(filePath, 'utf-8');
  const data: ArtworkDatabaseJson = JSON.parse(raw);

  artworkDb = data.entries.map((entry) => {
    const fp = base64ToFingerprint(entry.fingerprint);
    let normSq = 0;
    for (let i = 0; i < fp.length; i++) normSq += fp[i]! * fp[i]!;

    return {
      externalId: entry.externalId,
      name: entry.name,
      setCode: entry.setCode,
      fingerprint: fp,
      norm: Math.sqrt(normSq),
      hsvHist: entry.hsvHist ? base64ToFingerprint(entry.hsvHist) : null,
    };
  });

  console.error(`[artwork-matcher] loaded ${artworkDb.length} fingerprints from ${filePath}`);
  return artworkDb;
}

/**
 * Match a query fingerprint against the loaded database.
 */
export function matchArtwork(
  query: ArtworkFingerprint,
  topK = 5,
  tcgFilter?: string,
  queryHsv?: HsvHistogram | null
): ArtworkMatch[] {
  if (!artworkDb) return [];

  let queryNorm = 0;
  for (let i = 0; i < query.length; i++) queryNorm += query[i]! * query[i]!;
  queryNorm = Math.sqrt(queryNorm);
  if (queryNorm === 0) return [];

  const hasHsv = queryHsv && artworkDb[0]?.hsvHist;

  const results: ArtworkMatch[] = [];

  for (const entry of artworkDb) {
    let dot = 0;
    for (let i = 0; i < query.length; i++) dot += query[i]! * entry.fingerprint[i]!;
    const artSim = dot / (queryNorm * entry.norm);

    let similarity = artSim;
    if (hasHsv && entry.hsvHist && queryHsv) {
      const corr = hsvCorrelation(queryHsv, entry.hsvHist);
      // Blend: 90% artwork grid, 10% HSV correlation (mapped to 0-1)
      // HSV is a tiebreaker, not a primary signal — video crops have noisy HSV
      similarity = artSim * 0.90 + ((corr + 1) / 2) * 0.10;
    }

    results.push({
      externalId: entry.externalId,
      name: entry.name,
      setCode: entry.setCode,
      similarity,
    });
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}

/**
 * Check whether the artwork database is loaded.
 */
export function isArtworkDatabaseLoaded(): boolean {
  return artworkDb !== null && artworkDb.length > 0;
}

// ---------- serialisation ----------

export function fingerprintToBase64(fp: ArtworkFingerprint): string {
  return Buffer.from(fp.buffer, fp.byteOffset, fp.byteLength).toString('base64');
}

export function base64ToFingerprint(b64: string): ArtworkFingerprint {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// ---------- database builder ----------

export interface ArtworkBuildEntry {
  externalId: string;
  name: string;
  setCode: string | null;
  imagePath: string;
}

/**
 * Build artwork fingerprints for a batch of card images and save to disk.
 */
export async function buildArtworkDatabase(
  entries: ArtworkBuildEntry[],
  tcg: string,
  outputDir: string
): Promise<number> {
  const results: ArtworkDatabaseJson['entries'] = [];

  for (const entry of entries) {
    try {
      const imageBuffer = await readFile(entry.imagePath);
      const [fp, hsv] = await Promise.all([
        computeArtworkFingerprint(imageBuffer, tcg),
        computeHsvHistogram(imageBuffer),
      ]);
      results.push({
        externalId: entry.externalId,
        name: entry.name,
        setCode: entry.setCode,
        fingerprint: fingerprintToBase64(fp),
        hsvHist: fingerprintToBase64(hsv),
      });
    } catch {
      // Skip cards with missing or unreadable images
    }
  }

  const output: ArtworkDatabaseJson = {
    version: 1,
    tcg,
    gridSize: GRID_SIZE,
    dimensions: FINGERPRINT_DIM,
    total: results.length,
    entries: results,
  };

  const outputPath = path.join(outputDir, 'artwork-fingerprints.json');
  await writeFile(outputPath, JSON.stringify(output));
  console.error(`[artwork-matcher] built ${results.length} fingerprints → ${outputPath}`);
  return results.length;
}
