/**
 * Card scan service — accepts an uploaded image, generates a pHash,
 * and matches it against the configured card hash store.
 */

import { computeRGBHash, hammingDistance, type RGBHash } from './phash';
import { countCardHashes, getAllCardHashes, getCardHashPage } from './hash-store';
import { prepareRuntimeScanImage, type ScanQualityMetrics, type ScanRuntimeVariant } from './preprocess';

// ---------- types ----------

export interface ScanMatch {
  externalId: string;
  tcg: string;
  name: string;
  setCode: string | null;
  setName: string | null;
  rarity: string | null;
  imageUrl: string | null;
  confidence: number;        // 0..1
  distance: number;          // raw combined Hamming distance
}

export interface ScanResult {
  bestMatch: ScanMatch | null;
  candidates: ScanMatch[];
  hashGenerated: RGBHash;
  meta: {
    quality: ScanQualityMetrics | null;
    thresholdUsed: number;
    variantUsed: string;
    variantsTried: string[];
    perspectiveCorrected: boolean;
    contourAreaRatio: number | null;
  };
}

// ---------- configuration ----------

/**
 * Maximum combined RGB Hamming distance to consider a match.
 * With 256 bits per channel × 3 channels = 768 total bits,
 * a threshold of 240 (~31% of bits) is a reasonable cutoff.
 * Moss Machine uses ~80 per channel with its 256-bit hashes.
 */
const MAX_COMBINED_DISTANCE = 240;
const STRICT_COMBINED_DISTANCE = 160;
const MEDIUM_COMBINED_DISTANCE = 200;

/** Maximum number of candidates to return. */
const MAX_CANDIDATES = 5;

// ---------- public API ----------

/**
 * Scan an uploaded card image and return matching cards.
 */
export async function scanCardImage(
  imageBuffer: Buffer,
  tcgFilter?: string
): Promise<ScanResult> {
  const runtimeScan = await prepareRuntimeScanImage(imageBuffer);
  const hashEntries = await getAllCardHashes(tcgFilter ? { tcg: tcgFilter } : {});
  const attemptedVariants: string[] = [];
  const allMatches = new Map<string, ScanMatch>();
  let bestAttempt: { hash: RGBHash; variant: ScanRuntimeVariant; threshold: number; match: ScanMatch | null } | null = null;

  const passes = buildScanPasses(runtimeScan.variants);

  for (const pass of passes) {
    for (const variant of pass.variants) {
      attemptedVariants.push(variant.name);
      const hash = await computeRGBHash(variant.image);
      const matches = rankMatches(hashEntries, hash, pass.maxDistance);

      for (const match of matches) {
        const key = `${match.tcg}:${match.externalId}`;
        const existing = allMatches.get(key);
        if (!existing || match.distance < existing.distance) {
          allMatches.set(key, match);
        }
      }

      const bestMatch = matches[0] ?? null;
      if (!bestAttempt || isBetterAttempt(bestMatch, bestAttempt.match)) {
        bestAttempt = {
          hash,
          variant,
          threshold: pass.maxDistance,
          match: bestMatch,
        };
      }

      if (bestMatch?.distance === 0) {
        break;
      }
    }

    if (bestAttempt?.match && isStrongEnough(bestAttempt.match, pass.maxDistance)) {
      break;
    }
  }

  const candidates = Array.from(allMatches.values())
    .sort((left, right) => left.distance - right.distance)
    .slice(0, MAX_CANDIDATES);

  return {
    bestMatch: candidates[0] ?? null,
    candidates,
    hashGenerated: bestAttempt?.hash ?? (await computeRGBHash(runtimeScan.primaryVariant.image)),
    meta: {
      quality: runtimeScan.quality,
      thresholdUsed: bestAttempt?.threshold ?? MAX_COMBINED_DISTANCE,
      variantUsed: bestAttempt?.variant.name ?? runtimeScan.primaryVariant.name,
      variantsTried: Array.from(new Set(attemptedVariants)),
      perspectiveCorrected: runtimeScan.perspectiveCorrection.applied,
      contourAreaRatio: runtimeScan.perspectiveCorrection.contourAreaRatio,
    },
  };
}

/**
 * Get card hash database entries for client-side matching (iOS, etc.).
 */
export async function getCardHashes(tcg?: string, page = 1, pageSize = 500) {
  const skip = (page - 1) * pageSize;

  const [entries, total] = await Promise.all([
    getCardHashPage({
      ...(tcg ? { tcg } : {}),
      skip,
      take: pageSize,
    }),
    countCardHashes(tcg ? { tcg } : {}),
  ]);

  return {
    entries,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

function buildScanPasses(variants: ScanRuntimeVariant[]) {
  const uprightVariants = variants.filter((variant) => !variant.rotated180);
  const correctedVariants = variants.filter((variant) => variant.perspectiveCorrected);
  const fallbackVariants = Array.from(new Set([
    ...uprightVariants,
    ...correctedVariants.filter((variant) => variant.rotated180),
    ...variants.filter((variant) => variant.rotated180),
  ]));

  return [
    { maxDistance: STRICT_COMBINED_DISTANCE, variants: variants.slice(0, 1) },
    { maxDistance: MEDIUM_COMBINED_DISTANCE, variants: fallbackVariants.slice(0, Math.max(2, fallbackVariants.length)) },
    { maxDistance: MAX_COMBINED_DISTANCE, variants },
  ];
}

function rankMatches(
  hashEntries: Awaited<ReturnType<typeof getAllCardHashes>>,
  hashGenerated: RGBHash,
  maxDistance: number
): ScanMatch[] {
  const matches: ScanMatch[] = [];
  const singleChannelReject = Math.max(64, Math.floor(maxDistance * 0.6));

  for (const entry of hashEntries) {
    const entryHash: RGBHash = {
      r: entry.rHash,
      g: entry.gHash,
      b: entry.bHash,
    };

    const rDist = hammingDistance(hashGenerated.r, entryHash.r);
    if (rDist > singleChannelReject) {
      continue;
    }

    const gDist = hammingDistance(hashGenerated.g, entryHash.g);
    if (rDist + gDist > maxDistance) {
      continue;
    }

    const bDist = hammingDistance(hashGenerated.b, entryHash.b);
    const totalDist = rDist + gDist + bDist;

    if (totalDist > maxDistance) {
      continue;
    }

    matches.push({
      externalId: entry.externalId,
      tcg: entry.tcg,
      name: entry.name,
      setCode: entry.setCode,
      setName: entry.setName,
      rarity: entry.rarity,
      imageUrl: entry.imageUrl,
      confidence: Math.max(0, 1 - totalDist / MAX_COMBINED_DISTANCE),
      distance: totalDist,
    });
  }

  return matches.sort((left, right) => left.distance - right.distance);
}

function isBetterAttempt(candidate: ScanMatch | null, current: ScanMatch | null): boolean {
  if (!candidate) {
    return false;
  }

  if (!current) {
    return true;
  }

  return candidate.distance < current.distance;
}

function isStrongEnough(match: ScanMatch, maxDistance: number): boolean {
  return match.distance === 0 || match.confidence >= 0.72 || match.distance <= Math.floor(maxDistance * 0.45);
}
