/**
 * Card scan service — accepts an uploaded image, generates a pHash,
 * and matches it against the configured card hash store.
 */

import { computeRGBHash, hammingDistance, type RGBHash } from './phash';
import { computeCardFeatureHashes, getStoredCardFeatureHashes, type CardFeatureHashes } from './feature-hashes';
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
  fullDistance?: number;
  titleDistance?: number | null;
  footerDistance?: number | null;
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
    rerankUsed: boolean;
    shortlistSize: number;
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
const SHORTLIST_MARGIN = 96;
const SHORTLIST_LIMIT = 24;
type SupportedTcg = 'magic' | 'pokemon' | 'yugioh';

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
  let bestAttempt: {
    hash: RGBHash;
    variant: ScanRuntimeVariant;
    threshold: number;
    shortlistSize: number;
    rerankUsed: boolean;
    match: ScanMatch | null;
  } | null = null;

  const passes = buildScanPasses(runtimeScan.variants);

  for (const pass of passes) {
    for (const variant of pass.variants) {
      attemptedVariants.push(variant.name);
      const [hash, featureHashesByTcg] = await Promise.all([
        computeRGBHash(variant.image),
        computeFeatureHashesByTcg(variant.image, hashEntries, tcgFilter),
      ]);
      const rankedCandidates = rankMatches(hashEntries, hash, featureHashesByTcg, pass.maxDistance);
      const matches = rankedCandidates.slice(0, MAX_CANDIDATES).map(({ match }) => match);

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
          shortlistSize: rankedCandidates.length,
          rerankUsed: rankedCandidates.some(({ reranked }) => reranked),
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
      rerankUsed: bestAttempt?.rerankUsed ?? false,
      shortlistSize: bestAttempt?.shortlistSize ?? 0,
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

interface RankedCandidate {
  match: ScanMatch;
  reranked: boolean;
}

function rankMatches(
  hashEntries: Awaited<ReturnType<typeof getAllCardHashes>>,
  hashGenerated: RGBHash,
  featureHashesByTcg: Partial<Record<SupportedTcg, CardFeatureHashes>>,
  maxDistance: number
): RankedCandidate[] {
  const shortlist: Array<{
    entry: Awaited<ReturnType<typeof getAllCardHashes>>[number];
    fullDistance: number;
    titleDistance: number | null;
    footerDistance: number | null;
    scoreDistance: number;
    reranked: boolean;
  }> = [];
  const singleChannelReject = Math.max(64, Math.floor((maxDistance + SHORTLIST_MARGIN) * 0.6));
  const shortlistMaxDistance = Math.min(320, maxDistance + SHORTLIST_MARGIN);

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
    if (rDist + gDist > shortlistMaxDistance) {
      continue;
    }

    const bDist = hammingDistance(hashGenerated.b, entryHash.b);
    const totalDist = rDist + gDist + bDist;

    if (totalDist > shortlistMaxDistance) {
      continue;
    }

    const storedFeatureHashes = getStoredCardFeatureHashes(entry);
    const scanFeatureHashes = readFeatureHashesForEntry(entry.tcg, featureHashesByTcg);
    const titleDistance =
      scanFeatureHashes.title && storedFeatureHashes.title
        ? rgbDistance(scanFeatureHashes.title, storedFeatureHashes.title)
        : null;
    const footerDistance =
      scanFeatureHashes.footer && storedFeatureHashes.footer
        ? rgbDistance(scanFeatureHashes.footer, storedFeatureHashes.footer)
        : null;
    const featureScore = computeFeatureScore(totalDist, titleDistance, footerDistance);

    pushShortlist(shortlist, {
      entry,
      fullDistance: totalDist,
      titleDistance,
      footerDistance,
      scoreDistance: featureScore,
      reranked: titleDistance !== null || footerDistance !== null,
    });
  }

  return shortlist
    .filter((candidate) => candidate.scoreDistance <= maxDistance)
    .sort((left, right) => {
      return (
        left.scoreDistance - right.scoreDistance ||
        left.fullDistance - right.fullDistance ||
        left.entry.name.localeCompare(right.entry.name)
      );
    })
    .slice(0, SHORTLIST_LIMIT)
    .map((candidate) => ({
      reranked: candidate.reranked,
      match: {
        externalId: candidate.entry.externalId,
        tcg: candidate.entry.tcg,
        name: candidate.entry.name,
        setCode: candidate.entry.setCode,
        setName: candidate.entry.setName,
        rarity: candidate.entry.rarity,
        imageUrl: candidate.entry.imageUrl,
        confidence: Math.max(0, 1 - candidate.scoreDistance / MAX_COMBINED_DISTANCE),
        distance: Math.round(candidate.scoreDistance),
        fullDistance: candidate.fullDistance,
        titleDistance: candidate.titleDistance,
        footerDistance: candidate.footerDistance,
      },
    }));
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

async function computeFeatureHashesByTcg(
  imageBuffer: Buffer,
  hashEntries: Awaited<ReturnType<typeof getAllCardHashes>>,
  tcgFilter?: string
): Promise<Partial<Record<SupportedTcg, CardFeatureHashes>>> {
  const tcgs = new Set<SupportedTcg>();

  if (tcgFilter === 'magic' || tcgFilter === 'pokemon' || tcgFilter === 'yugioh') {
    tcgs.add(tcgFilter);
  } else {
    for (const entry of hashEntries) {
      if (entry.tcg === 'magic' || entry.tcg === 'pokemon' || entry.tcg === 'yugioh') {
        tcgs.add(entry.tcg);
      }
      if (tcgs.size === 3) {
        break;
      }
    }
  }

  const entries = await Promise.all(
    Array.from(tcgs).map(async (tcg) => [tcg, await computeCardFeatureHashes(tcg, imageBuffer)] as const)
  );

  return Object.fromEntries(entries) as Partial<Record<SupportedTcg, CardFeatureHashes>>;
}

function rgbDistance(left: RGBHash, right: RGBHash): number {
  return (
    hammingDistance(left.r, right.r) +
    hammingDistance(left.g, right.g) +
    hammingDistance(left.b, right.b)
  );
}

function computeFeatureScore(
  fullDistance: number,
  titleDistance: number | null,
  footerDistance: number | null
): number {
  let score = fullDistance * 0.72;
  let weights = 0.72;

  if (footerDistance !== null) {
    score += footerDistance * 0.2;
    weights += 0.2;
  }

  if (titleDistance !== null) {
    score += titleDistance * 0.08;
    weights += 0.08;
  }

  return score / weights;
}

function pushShortlist(
  shortlist: Array<{
    entry: Awaited<ReturnType<typeof getAllCardHashes>>[number];
    fullDistance: number;
    titleDistance: number | null;
    footerDistance: number | null;
    scoreDistance: number;
    reranked: boolean;
  }>,
  candidate: {
    entry: Awaited<ReturnType<typeof getAllCardHashes>>[number];
    fullDistance: number;
    titleDistance: number | null;
    footerDistance: number | null;
    scoreDistance: number;
    reranked: boolean;
  }
): void {
  shortlist.push(candidate);
  shortlist.sort((left, right) => {
    return (
      left.scoreDistance - right.scoreDistance ||
      left.fullDistance - right.fullDistance ||
      left.entry.externalId.localeCompare(right.entry.externalId)
    );
  });

  if (shortlist.length > SHORTLIST_LIMIT) {
    shortlist.length = SHORTLIST_LIMIT;
  }
}

function readFeatureHashesForEntry(
  tcg: string,
  featureHashesByTcg: Partial<Record<SupportedTcg, CardFeatureHashes>>
): CardFeatureHashes {
  if (tcg === 'magic' || tcg === 'pokemon' || tcg === 'yugioh') {
    return featureHashesByTcg[tcg] ?? { title: null, footer: null };
  }

  return { title: null, footer: null };
}
