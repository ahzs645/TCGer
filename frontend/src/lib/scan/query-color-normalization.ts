/**
 * Query-side colour normalization applied to a card crop before the embedding
 * encoder's resize contract — the browser twin of iOS
 * `QueryColorNormalization.swift`, Android `QueryColorNormalization.kt` and
 * the trainer's `normalize_query_colors`.
 *
 * The gallery is embedded from clean, full-range catalog renders; phone and
 * webcam crops arrive low-contrast under a room colour cast. A grey-world
 * white balance followed by a 1 % per-channel autocontrast pulls the crop
 * toward render statistics. The arithmetic mirrors Pillow
 * (`ImageOps.autocontrast(cutoff=1)` after a float grey-world gain with
 * truncating conversion) so every runtime agrees on the pixels it is given.
 * Canvas resampling still differs from the native resize, as it already does
 * for the encoder input.
 *
 * This module is pure (no DOM) so the arithmetic is unit-tested under Node.
 */

export type QueryNormalization =
  | "none"
  | "grey-world-autocontrast"
  | "grey-world-autocontrast-blend";

export const QUERY_NORMALIZATIONS: readonly QueryNormalization[] = [
  "none",
  "grey-world-autocontrast",
  "grey-world-autocontrast-blend",
];

export const AUTOCONTRAST_CUTOFF_PERCENT = 1;

/** A declared value this build knows; anything else (or nothing) is `null`. */
export function parseQueryNormalization(
  value: unknown,
): QueryNormalization | null {
  return typeof value === "string" &&
    (QUERY_NORMALIZATIONS as readonly string[]).includes(value)
    ? (value as QueryNormalization)
    : null;
}

/**
 * Built-in per-game default, mirroring `tools/scanner-acceptance-policies.json`
 * and the native built-in profiles: the catalog-only Magic encoder gains from
 * normalization, the Pokémon and Yu-Gi-Oh! encoders run raw. It only applies
 * to the ArcFace encoders those policies were measured on.
 */
export function builtinQueryNormalization(
  tcg: string,
  encoder: string,
): QueryNormalization {
  return encoder === "arcface" && tcg === "magic"
    ? "grey-world-autocontrast"
    : "none";
}

/**
 * The query renderings a normalization embeds, in order: `false` is the raw
 * crop, `true` the normalized one. One rendering is searched as is; two are
 * combined by `blendEmbeddings`.
 */
export function queryRenderings(mode: QueryNormalization): boolean[] {
  switch (mode) {
    case "none":
      return [false];
    case "grey-world-autocontrast":
      return [true];
    case "grey-world-autocontrast-blend":
      return [false, true];
  }
}

/**
 * Per-channel multipliers that move the channel means onto their common mean.
 * A channel with zero mean is left alone.
 */
export function greyWorldGains(means: readonly number[]): number[] {
  const overall = means.reduce((sum, value) => sum + value, 0) / means.length;
  return means.map((mean) => (mean > 0 ? overall / mean : 1));
}

/**
 * Pillow's `ImageOps.autocontrast` lookup table for one channel: drop
 * `cutoffPercent` of the pixels from each end of the histogram, then stretch
 * what remains to the full range.
 */
export function autocontrastTable(
  histogramInput: readonly number[],
  cutoffPercent: number,
): Uint8Array {
  const histogram = Array.from(histogramInput);
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (cutoffPercent > 0 && total > 0) {
    let cut = Math.floor((total * cutoffPercent) / 100);
    for (let low = 0; low < 256; low++) {
      if (cut > histogram[low]!) {
        cut -= histogram[low]!;
        histogram[low] = 0;
      } else {
        histogram[low] = histogram[low]! - cut;
        cut = 0;
      }
      if (cut <= 0) break;
    }
    cut = Math.floor((total * cutoffPercent) / 100);
    for (let high = 255; high >= 0; high--) {
      if (cut > histogram[high]!) {
        cut -= histogram[high]!;
        histogram[high] = 0;
      } else {
        histogram[high] = histogram[high]! - cut;
        cut = 0;
      }
      if (cut <= 0) break;
    }
  }
  const table = new Uint8Array(256);
  let low = histogram.findIndex((count) => count > 0);
  if (low < 0) low = 0;
  let high = 255;
  while (high > 0 && !(histogram[high]! > 0)) high--;
  if (high <= low) {
    for (let value = 0; value < 256; value++) table[value] = value;
    return table;
  }
  const scale = 255 / (high - low);
  const offset = -low * scale;
  for (let value = 0; value < 256; value++) {
    // Pillow truncates toward zero before clamping.
    const mapped = Math.trunc(value * scale + offset);
    table[value] = Math.min(255, Math.max(0, mapped));
  }
  return table;
}

/**
 * In-place grey-world white balance followed by per-channel autocontrast on
 * interleaved RGBA8 pixels (alpha untouched).
 */
export function normalizeRgba(pixels: Uint8ClampedArray | Uint8Array): void {
  const pixelCount = Math.floor(pixels.length / 4);
  if (pixelCount <= 0) return;
  const sums = [0, 0, 0];
  for (let index = 0; index < pixelCount; index++) {
    const base = index * 4;
    sums[0]! += pixels[base]!;
    sums[1]! += pixels[base + 1]!;
    sums[2]! += pixels[base + 2]!;
  }
  const gains = greyWorldGains(sums.map((sum) => sum / pixelCount));
  const histograms = [0, 1, 2].map(() => new Array<number>(256).fill(0));
  for (let index = 0; index < pixelCount; index++) {
    const base = index * 4;
    for (let channel = 0; channel < 3; channel++) {
      // Pillow: clip to [0, 255] then truncate to uint8.
      const value = Math.trunc(
        Math.min(255, pixels[base + channel]! * gains[channel]!),
      );
      pixels[base + channel] = value;
      histograms[channel]![value]! += 1;
    }
  }
  const tables = histograms.map((histogram) =>
    autocontrastTable(histogram, AUTOCONTRAST_CUTOFF_PERCENT),
  );
  for (let index = 0; index < pixelCount; index++) {
    const base = index * 4;
    for (let channel = 0; channel < 3; channel++) {
      pixels[base + channel] = tables[channel]![pixels[base + channel]!]!;
    }
  }
}

/**
 * Combines the embeddings of one crop's renderings into the vector that is
 * searched. Each is L2-normalized, they are averaged, and the mean is
 * L2-normalized again: the mean direction of the raw and the
 * colour-normalized view. Returns `null` when an embedding is empty, zero,
 * non-finite or of a different dimension, which callers treat as a failed
 * embedding.
 */
export function blendEmbeddings(
  embeddings: readonly Float32Array[],
): Float32Array | null {
  const first = embeddings[0];
  if (!first || first.length === 0) return null;
  const dimension = first.length;
  const sum = new Float64Array(dimension);
  for (const embedding of embeddings) {
    if (embedding.length !== dimension) return null;
    let squares = 0;
    for (let index = 0; index < dimension; index++) {
      squares += embedding[index]! * embedding[index]!;
    }
    const norm = Math.sqrt(squares);
    if (!(norm > 0) || !Number.isFinite(norm)) return null;
    for (let index = 0; index < dimension; index++) {
      sum[index]! += embedding[index]! / norm;
    }
  }
  let squares = 0;
  for (let index = 0; index < dimension; index++) {
    squares += sum[index]! * sum[index]!;
  }
  const norm = Math.sqrt(squares);
  if (!(norm > 0) || !Number.isFinite(norm)) return null;
  const blended = new Float32Array(dimension);
  for (let index = 0; index < dimension; index++) {
    blended[index] = sum[index]! / norm;
  }
  return blended;
}
