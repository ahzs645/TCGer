/**
 * Card scan service — accepts an uploaded image, generates a pHash,
 * and matches it against the configured card hash store.
 */

import { performance } from 'node:perf_hooks';

import { computeRGBHash, hammingDistance, type RGBHash } from './phash';
import { computeCardFeatureHashes, getStoredCardFeatureHashes, type CardFeatureHashes } from './feature-hashes';
import { countCardHashes, getAllCardHashes, getCardHashPage } from './hash-store';
import { scanCardImageWithEmbedding } from './embedding-scan.service';
import {
  prepareRuntimeScanImage,
  type CardPoint,
  type ScanQualityMetrics,
  type ScanRuntimeVariant,
} from './preprocess';
import {
  computeArtworkFingerprint,
  type ArtworkMatch,
  matchArtwork,
  loadArtworkDatabase,
  isArtworkDatabaseLoaded,
} from './artwork-matcher';

// ---------- types ----------

export interface ScanMatch {
  externalId: string;
  tcg: string;
  name: string;
  setCode: string | null;
  setName: string | null;
  rarity: string | null;
  imageUrl: string | null;
  confidence: number;        // 0..1 overall similarity score
  distance: number;          // raw combined Hamming distance
  fullDistance?: number;
  titleDistance?: number | null;
  footerDistance?: number | null;
}

export interface ScanDiagnosticCandidate extends ScanMatch {
  scoreDistance: number;
  passedThreshold: boolean;
}

export interface ScanTimingMetrics {
  preprocessMs: number;
  perspectiveCorrectionMs: number;
  qualityMs: number;
  hashMs: number;
  featureHashMs: number;
  rankingMs: number;
  artworkPrefilterMs: number | null;
  artworkRerankMs: number | null;
  ocrMs: number | null;
  totalMs: number;
}

export type ScanEngine = 'automatic' | 'phash' | 'embedding';
export type ScanExecutionEngine = 'phash' | 'embedding';

export interface ScanAttemptDiagnostic {
  variant: string;
  threshold: number;
  hashMs: number;
  featureHashMs: number;
  rankingMs: number;
  rerankUsed: boolean;
  shortlistSize: number;
  acceptedCandidates: ScanDiagnosticCandidate[];
  rejectedNearMisses: ScanDiagnosticCandidate[];
}

export interface ScanDebugData {
  artifacts: {
    selectedVariantImage: Buffer;
    correctedSourceImage: Buffer | null;
  };
  timings: ScanTimingMetrics;
  attempts: ScanAttemptDiagnostic[];
  rejectedNearMisses: ScanDiagnosticCandidate[];
  artwork: {
    prefilterApplied: boolean;
    prefilterTopMatches: ArtworkMatch[];
    rerankTopMatches: ArtworkMatch[];
  };
  ocr: {
    attempted: boolean;
    durationMs: number | null;
    candidates: Array<{ text: string; confidence: number }>;
  };
}

export interface ScanResult {
  bestMatch: ScanMatch | null;
  candidates: ScanMatch[];
  hashGenerated: RGBHash;
  meta: {
    engine: ScanExecutionEngine;
    quality: ScanQualityMetrics | null;
    thresholdUsed: number;
    variantUsed: string;
    variantsTried: string[];
    perspectiveCorrected: boolean;
    contourAreaRatio: number | null;
    contourConfidence?: number | null;
    rotationAngle?: number | null;
    cropAspectRatio?: number | null;
    cropWidth?: number | null;
    cropHeight?: number | null;
    cropCandidateScore?: number | null;
    contourPoints?: CardPoint[] | null;
    maskVariant?: string | null;
    rerankUsed: boolean;
    shortlistSize: number;
    timings?: ScanTimingMetrics;
  };
  debug?: ScanDebugData;
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
const LEGACY_CONFIDENCE_STRONG_MATCH = 0.72;
type SupportedTcg = 'magic' | 'pokemon' | 'yugioh';

/** Maximum number of candidates to return. */
const MAX_CANDIDATES = 5;

// ---------- public API ----------

/**
 * Scan an uploaded card image and return matching cards.
 */
export async function scanCardImage(
  imageBuffer: Buffer,
  tcgFilter?: string,
  options?: { maxDistanceOverride?: number; ocrNameHint?: string; engine?: ScanEngine }
): Promise<ScanResult> {
  if (options?.engine === 'embedding') {
    return scanCardImageWithEmbedding(imageBuffer, tcgFilter);
  }

  const scanStartedAt = performance.now();
  const runtimeScan = await prepareRuntimeScanImage(imageBuffer);
  const timings: ScanTimingMetrics = {
    preprocessMs: runtimeScan.timings.totalMs,
    perspectiveCorrectionMs: runtimeScan.timings.perspectiveCorrectionMs,
    qualityMs: runtimeScan.timings.qualityMs,
    hashMs: 0,
    featureHashMs: 0,
    rankingMs: 0,
    artworkPrefilterMs: null,
    artworkRerankMs: null,
    ocrMs: null,
    totalMs: 0,
  };
  let hashEntries = await getAllCardHashes(tcgFilter ? { tcg: tcgFilter } : {});
  let artworkFingerprint: Awaited<ReturnType<typeof computeArtworkFingerprint>> | null = null;
  let artworkPrefilterApplied = false;
  let artworkPrefilterTopMatches: ArtworkMatch[] = [];
  let artworkRerankTopMatches: ArtworkMatch[] = [];

  // OCR name hint: fuzzy-filter hash entries to matching card names
  if (options?.ocrNameHint) {
    const hint = options.ocrNameHint.toLowerCase();
    const { levenshtein } = await import('./card-detector');
    hashEntries = hashEntries.filter((entry) => {
      const firstName = entry.name.toLowerCase().split(/\s+/)[0] ?? '';
      if (firstName.length < 3) return false;
      const trimmedHint = hint.slice(0, firstName.length + 2);
      return levenshtein(trimmedHint, firstName) <= 3;
    });
  }

  // Artwork pre-filter: narrow pHash candidates to artwork top-N for speed.
  // Artwork cosine similarity against 21,900 entries takes ~3ms vs pHash ~1500ms.
  if (isArtworkDatabaseLoaded() && !options?.ocrNameHint && hashEntries.length > 100) {
    const artworkPrefilterStartedAt = performance.now();
    try {
      artworkFingerprint = await computeArtworkFingerprint(imageBuffer, tcgFilter ?? 'pokemon');
      const artTop = matchArtwork(artworkFingerprint, 50, tcgFilter);
      artworkPrefilterTopMatches = artTop.slice(0, MAX_CANDIDATES);
      const artIds = new Set(artTop.map((m) => m.externalId));
      hashEntries = hashEntries.filter((entry) => artIds.has(entry.externalId));
      artworkPrefilterApplied = true;
    } catch { /* fall through to full scan */ }
    timings.artworkPrefilterMs = performance.now() - artworkPrefilterStartedAt;
  }

  const attemptedVariants: string[] = [];
  const attemptDiagnostics: ScanAttemptDiagnostic[] = [];
  const allMatches = new Map<string, ScanMatch>();
  let bestAttempt: {
    hash: RGBHash;
    variant: ScanRuntimeVariant;
    threshold: number;
    shortlistSize: number;
    rerankUsed: boolean;
    match: ScanMatch | null;
    diagnostics: RankMatchesDiagnostics;
    hashMs: number;
    featureHashMs: number;
    rankingMs: number;
  } | null = null;

  const passes = buildScanPasses(runtimeScan.variants, options?.maxDistanceOverride);

  for (const pass of passes) {
    for (const variant of pass.variants) {
      attemptedVariants.push(variant.name);
      const hashStartedAt = performance.now();
      const [hash, featureHashesByTcg] = await Promise.all([
        computeRGBHash(variant.image).then((value) => {
          const duration = performance.now() - hashStartedAt;
          timings.hashMs += duration;
          return { value, duration };
        }),
        (() => {
          const featureHashStartedAt = performance.now();
          return computeFeatureHashesByTcg(variant.image, hashEntries, tcgFilter).then((value) => {
            const duration = performance.now() - featureHashStartedAt;
            timings.featureHashMs += duration;
            return { value, duration };
          });
        })(),
      ]);
      const rankingStartedAt = performance.now();
      const rankedCandidates = rankMatches(
        hashEntries,
        hash.value,
        featureHashesByTcg.value,
        pass.maxDistance,
      );
      const rankingMs = performance.now() - rankingStartedAt;
      timings.rankingMs += rankingMs;
      const matches = rankedCandidates.accepted.slice(0, MAX_CANDIDATES).map(({ match }) => match);

      attemptDiagnostics.push({
        variant: variant.name,
        threshold: pass.maxDistance,
        hashMs: hash.duration,
        featureHashMs: featureHashesByTcg.duration,
        rankingMs,
        rerankUsed: rankedCandidates.accepted.some(({ reranked }) => reranked),
        shortlistSize: rankedCandidates.diagnostics.shortlistedCandidates.length,
        acceptedCandidates: rankedCandidates.diagnostics.acceptedCandidates.slice(0, MAX_CANDIDATES),
        rejectedNearMisses: rankedCandidates.diagnostics.rejectedNearMisses.slice(0, MAX_CANDIDATES),
      });

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
          hash: hash.value,
          variant,
          threshold: pass.maxDistance,
          shortlistSize: rankedCandidates.accepted.length,
          rerankUsed: rankedCandidates.accepted.some(({ reranked }) => reranked),
          match: bestMatch,
          diagnostics: rankedCandidates.diagnostics,
          hashMs: hash.duration,
          featureHashMs: featureHashesByTcg.duration,
          rankingMs,
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

  // Artwork fingerprint matching: boost candidates that also match visually
  // Skip when OCR name hint is active — the hash entries are already filtered by name
  if (isArtworkDatabaseLoaded() && !options?.ocrNameHint) {
    const artworkRerankStartedAt = performance.now();
    try {
      const artFp = artworkFingerprint ?? await computeArtworkFingerprint(imageBuffer, tcgFilter ?? 'pokemon');
      // HSV disabled: adds noise on video crops even at low weight.
      // Artwork color grid alone produces better results (79% vs 71% with HSV).
      const artMatches = matchArtwork(artFp, 5, tcgFilter);
      artworkRerankTopMatches = artMatches.slice(0, MAX_CANDIDATES);

      if (artMatches.length > 0) {
        const topArt = artMatches[0]!;
        const secondArt = artMatches[1];
        const margin = secondArt ? topArt.similarity - secondArt.similarity : 0.1;

        // Only inject the artwork top-1 as a candidate when:
        // - pHash found no match, OR
        // - artwork has a meaningful similarity margin over #2
        const pHashBest = Array.from(allMatches.values()).sort((a, b) => a.distance - b.distance)[0];
        const shouldInject = !pHashBest || margin >= 0.005;

        if (shouldInject) {
          const key = `${tcgFilter ?? 'pokemon'}:${topArt.externalId}`;
          if (!allMatches.has(key)) {
            const entry = hashEntries.find((h) => h.externalId === topArt.externalId);
            if (entry) {
              // Use a moderate distance so artwork doesn't dominate pHash
              const artDistance = Math.round((1 - topArt.similarity) * MAX_COMBINED_DISTANCE * 1.5);
              allMatches.set(key, {
                externalId: entry.externalId,
                tcg: entry.tcg,
                name: entry.name,
                setCode: entry.setCode,
                setName: entry.setName,
                rarity: entry.rarity,
                imageUrl: entry.imageUrl,
                confidence: topArt.similarity,
                distance: artDistance,
                fullDistance: artDistance,
                titleDistance: null,
                footerDistance: null,
              });
            }
          }
        }
      }
    } catch { /* artwork matching unavailable, continue without */ }
    timings.artworkRerankMs = performance.now() - artworkRerankStartedAt;
  }

  // Try loading artwork database lazily on first scan
  if (!isArtworkDatabaseLoaded()) {
    const dataDir = process.env.CARD_SCAN_DATA_DIR;
    if (dataDir) {
      loadArtworkDatabase(dataDir).catch(() => { /* not available */ });
    }
  }

  const candidates = Array.from(allMatches.values())
    .sort((left, right) => left.distance - right.distance)
    .slice(0, MAX_CANDIDATES);
  timings.totalMs = performance.now() - scanStartedAt;

  return {
    bestMatch: candidates[0] ?? null,
    candidates,
    hashGenerated: bestAttempt?.hash ?? (await computeRGBHash(runtimeScan.primaryVariant.image)),
    meta: {
      engine: 'phash',
      quality: runtimeScan.quality,
      thresholdUsed: bestAttempt?.threshold ?? MAX_COMBINED_DISTANCE,
      variantUsed: bestAttempt?.variant.name ?? runtimeScan.primaryVariant.name,
      variantsTried: Array.from(new Set(attemptedVariants)),
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
      rerankUsed: bestAttempt?.rerankUsed ?? false,
      shortlistSize: bestAttempt?.shortlistSize ?? 0,
      timings,
    },
    debug: {
      artifacts: {
        selectedVariantImage: bestAttempt?.variant.image ?? runtimeScan.primaryVariant.image,
        correctedSourceImage: runtimeScan.artifacts.correctedSourceImage,
      },
      timings,
      attempts: attemptDiagnostics,
      rejectedNearMisses: bestAttempt?.diagnostics.rejectedNearMisses.slice(0, MAX_CANDIDATES) ?? [],
      artwork: {
        prefilterApplied: artworkPrefilterApplied,
        prefilterTopMatches: artworkPrefilterTopMatches,
        rerankTopMatches: artworkRerankTopMatches,
      },
      ocr: {
        attempted: false,
        durationMs: null,
        candidates: [],
      },
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

function buildScanPasses(variants: ScanRuntimeVariant[], maxDistanceOverride?: number) {
  const uprightVariants = variants.filter((variant) => !variant.rotated180);
  const correctedVariants = variants.filter((variant) => variant.perspectiveCorrected);
  const fallbackVariants = Array.from(new Set([
    ...uprightVariants,
    ...correctedVariants.filter((variant) => variant.rotated180),
    ...variants.filter((variant) => variant.rotated180),
  ]));

  const maxDist = maxDistanceOverride ?? MAX_COMBINED_DISTANCE;
  const medDist = maxDistanceOverride ? Math.round(maxDistanceOverride * 0.83) : MEDIUM_COMBINED_DISTANCE;
  const strictDist = maxDistanceOverride ? Math.round(maxDistanceOverride * 0.67) : STRICT_COMBINED_DISTANCE;

  return [
    { maxDistance: strictDist, variants: variants.slice(0, 1) },
    { maxDistance: medDist, variants: fallbackVariants.slice(0, Math.max(2, fallbackVariants.length)) },
    { maxDistance: maxDist, variants },
  ];
}

interface RankedCandidate {
  match: ScanMatch;
  reranked: boolean;
}

interface RankMatchesDiagnostics {
  shortlistedCandidates: ScanDiagnosticCandidate[];
  acceptedCandidates: ScanDiagnosticCandidate[];
  rejectedNearMisses: ScanDiagnosticCandidate[];
}

interface RankMatchesResult {
  accepted: RankedCandidate[];
  diagnostics: RankMatchesDiagnostics;
}

function rankMatches(
  hashEntries: Awaited<ReturnType<typeof getAllCardHashes>>,
  hashGenerated: RGBHash,
  featureHashesByTcg: Partial<Record<SupportedTcg, CardFeatureHashes>>,
  maxDistance: number
): RankMatchesResult {
  const shortlist: Array<{
    entry: Awaited<ReturnType<typeof getAllCardHashes>>[number];
    fullDistance: number;
    titleDistance: number | null;
    footerDistance: number | null;
    scoreDistance: number;
    reranked: boolean;
  }> = [];
  const singleChannelReject = Math.max(64, Math.floor((maxDistance + SHORTLIST_MARGIN) * 0.6));
  const shortlistMaxDistance = maxDistance + SHORTLIST_MARGIN;

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

  const sortedShortlist = shortlist
    .sort((left, right) => {
      return (
        left.scoreDistance - right.scoreDistance ||
        left.fullDistance - right.fullDistance ||
        left.entry.name.localeCompare(right.entry.name)
      );
    })
    .slice(0, SHORTLIST_LIMIT);

  const shortlistedCandidates = sortedShortlist.map((candidate) =>
    buildDiagnosticCandidate(candidate, candidate.scoreDistance <= maxDistance),
  );
  const acceptedCandidates = shortlistedCandidates.filter((candidate) => candidate.passedThreshold);
  const rejectedNearMisses = shortlistedCandidates
    .filter((candidate) => !candidate.passedThreshold)
    .slice(0, MAX_CANDIDATES);

  return {
    accepted: sortedShortlist
      .filter((candidate) => candidate.scoreDistance <= maxDistance)
      .map((candidate) => ({
        reranked: candidate.reranked,
        match: buildScanMatch(candidate),
      })),
    diagnostics: {
      shortlistedCandidates,
      acceptedCandidates,
      rejectedNearMisses,
    },
  };
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
  return (
    match.distance === 0 ||
    computeLegacyThresholdConfidence(match.distance) >= LEGACY_CONFIDENCE_STRONG_MATCH ||
    match.distance <= Math.floor(maxDistance * 0.45)
  );
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

function computePublicConfidence(scoreDistance: number, hashSize: number): number {
  const totalBits = Math.max(1, hashSize * hashSize * 3);
  return Math.max(0, Math.min(1, 1 - scoreDistance / totalBits));
}

function computeLegacyThresholdConfidence(scoreDistance: number): number {
  return Math.max(0, 1 - scoreDistance / MAX_COMBINED_DISTANCE);
}

function buildScanMatch(candidate: {
  entry: Awaited<ReturnType<typeof getAllCardHashes>>[number];
  fullDistance: number;
  titleDistance: number | null;
  footerDistance: number | null;
  scoreDistance: number;
}): ScanMatch {
  return {
    externalId: candidate.entry.externalId,
    tcg: candidate.entry.tcg,
    name: candidate.entry.name,
    setCode: candidate.entry.setCode,
    setName: candidate.entry.setName,
    rarity: candidate.entry.rarity,
    imageUrl: candidate.entry.imageUrl,
    confidence: computePublicConfidence(candidate.scoreDistance, candidate.entry.hashSize),
    distance: Math.round(candidate.scoreDistance),
    fullDistance: candidate.fullDistance,
    titleDistance: candidate.titleDistance,
    footerDistance: candidate.footerDistance,
  };
}

function buildDiagnosticCandidate(
  candidate: {
    entry: Awaited<ReturnType<typeof getAllCardHashes>>[number];
    fullDistance: number;
    titleDistance: number | null;
    footerDistance: number | null;
    scoreDistance: number;
  },
  passedThreshold: boolean,
): ScanDiagnosticCandidate {
  return {
    ...buildScanMatch(candidate),
    scoreDistance: candidate.scoreDistance,
    passedThreshold,
  };
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
