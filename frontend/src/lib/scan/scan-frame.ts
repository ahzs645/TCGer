import {
  computeArtworkFingerprintFromCanvas,
  computeHSVHistogramFromCanvas,
  matchArtworkFingerprint,
  type ArtworkFingerprintEntry,
} from "./artwork-fingerprint";
import { computeFeatureHashesByTcg } from "./feature-hashes";
import {
  buildVideoWindowProposals,
  extractProposalCanvas,
  MAX_ACTIVE_PROPOSALS,
  offsetQuad,
  proposalToQuad,
  PROPOSAL_NMS_IOU,
  PROPOSAL_REFINEMENT_PADDING_RATIO,
  windowIou,
} from "./proposal-windows";
import { refineProposalCanvas } from "./quad-refinement";
import { computeRGBHashFromCanvas } from "./rgb-hash";
import { MAX_CANDIDATES, rankMatches } from "./rank-matches";
import type {
  BrowserVideoFrameScanResult,
  BrowserVideoProposalMatch,
  BrowserVideoScanCandidate,
  CardScanHashEntry,
  TcgCode,
  VideoWindowProposal,
} from "./scan-types";

export function scanVideoFrameCanvasInBrowser(params: {
  frameCanvas: HTMLCanvasElement;
  hashEntries: CardScanHashEntry[];
  artworkDb?: ArtworkFingerprintEntry[];
  tcgFilter?: TcgCode | "all";
  detectionOnly?: boolean;
}): BrowserVideoFrameScanResult {
  const { frameCanvas, hashEntries, artworkDb, tcgFilter, detectionOnly } =
    params;

  if (!detectionOnly && !hashEntries.length) {
    return {
      activeProposal: null,
      bestMatch: null,
      candidates: [],
      proposalMatches: [],
    };
  }

  const proposals = buildVideoWindowProposals(
    frameCanvas.width,
    frameCanvas.height,
  );
  const rawProposalMatches: BrowserVideoProposalMatch[] = [];
  let bestProposal: VideoWindowProposal | null = null;
  let bestProposalMatch: BrowserVideoScanCandidate | null = null;

  for (const proposal of proposals) {
    let overlayQuad = proposalToQuad(proposal);
    let refinementMethod: string | null = null;
    let isClipped = false;

    // Always try quad refinement (detection)
    const refinementExtraction = extractProposalCanvas(
      frameCanvas,
      proposal,
      PROPOSAL_REFINEMENT_PADDING_RATIO,
    );
    const refinement = refineProposalCanvas(refinementExtraction.canvas);
    if (refinement) {
      overlayQuad = offsetQuad(
        refinement.quad,
        refinementExtraction.sourceWindow.left,
        refinementExtraction.sourceWindow.top,
      );
      refinementMethod = refinement.method;
      isClipped = refinement.isClipped;
    }

    // Detection-only: skip hash matching, only report refined quads.
    if (detectionOnly) {
      if (refinement) {
        rawProposalMatches.push({
          proposal,
          overlayQuad,
          refinementMethod,
          isClipped,
          bestMatch: null,
          candidates: [],
        });
      }
      continue;
    }

    // Full matching path
    const rawExtraction = extractProposalCanvas(frameCanvas, proposal);
    const rawRanked = rankProposalCanvas(
      rawExtraction.canvas,
      hashEntries,
      proposal.label,
      tcgFilter,
      artworkDb,
    );
    let ranked = rawRanked.ranked;

    if (refinement) {
      const refinedRanked = rankProposalCanvas(
        refinement.warpedCanvas,
        hashEntries,
        proposal.label,
        tcgFilter,
        artworkDb,
      );

      if (
        shouldUseRefinedRanking(
          refinedRanked.ranked,
          rawRanked.ranked,
          refinement.isClipped,
        )
      ) {
        ranked = refinedRanked.ranked;
      }
    }

    const topCandidate = ranked[0] ?? null;
    rawProposalMatches.push({
      proposal,
      overlayQuad,
      refinementMethod,
      isClipped,
      bestMatch: topCandidate,
      candidates: ranked,
    });

    if (topCandidate) {
      if (
        !bestProposalMatch ||
        topCandidate.scoreDistance < bestProposalMatch.scoreDistance ||
        topCandidate.fullDistance < bestProposalMatch.fullDistance
      ) {
        bestProposal = proposal;
        bestProposalMatch = topCandidate;
      }
    }
  }

  // In detection-only mode, deduplicate overlapping refined quads via NMS.
  const proposalMatches = detectionOnly
    ? selectDistinctDetections(rawProposalMatches)
    : selectDistinctProposalMatches(rawProposalMatches);
  const mergedCandidates = new Map<string, BrowserVideoScanCandidate>();

  for (const proposalMatch of proposalMatches) {
    for (const candidate of proposalMatch.candidates) {
      const key = `${candidate.tcg}:${candidate.externalId}`;
      const existing = mergedCandidates.get(key);
      if (
        !existing ||
        candidate.scoreDistance < existing.scoreDistance ||
        candidate.fullDistance < existing.fullDistance
      ) {
        mergedCandidates.set(key, candidate);
      }
    }
  }

  const candidates = Array.from(mergedCandidates.values())
    .sort((left, right) => {
      return (
        left.scoreDistance - right.scoreDistance ||
        left.fullDistance - right.fullDistance ||
        left.name.localeCompare(right.name)
      );
    })
    .slice(0, MAX_CANDIDATES);

  return {
    activeProposal: bestProposal,
    bestMatch: bestProposalMatch,
    candidates,
    proposalMatches,
  };
}

/** Max detections shown in detection-only mode. */
const MAX_DETECTION_OVERLAYS = 2;
/** Stricter IOU threshold for detection-only NMS (same card = suppress). */
const DETECTION_NMS_IOU = 0.15;

/**
 * NMS for detection-only mode.
 * Keeps only the best non-overlapping refined quads, preferring
 * observed > inferred and non-clipped > clipped.
 * Uses a stricter IOU threshold than matching mode to suppress
 * duplicate quads from overlapping proposals on the same card.
 */
function selectDistinctDetections(
  proposalMatches: BrowserVideoProposalMatch[],
): BrowserVideoProposalMatch[] {
  const sorted = [...proposalMatches].sort((a, b) => {
    // Prefer observed over inferred
    const aObs = a.refinementMethod === "observed" ? 0 : 1;
    const bObs = b.refinementMethod === "observed" ? 0 : 1;
    if (aObs !== bObs) return aObs - bObs;
    // Prefer non-clipped
    if (a.isClipped !== b.isClipped) return a.isClipped ? 1 : -1;
    return 0;
  });

  const selected: BrowserVideoProposalMatch[] = [];
  for (const pm of sorted) {
    // Suppress if the quad's bounding box overlaps a previously selected one.
    const pmBox = quadBoundingBox(pm.overlayQuad);
    const overlaps = selected.some((existing) => {
      // Check both proposal IOU and quad bounding box IOU
      if (windowIou(existing.proposal, pm.proposal) >= DETECTION_NMS_IOU) {
        return true;
      }
      const existingBox = quadBoundingBox(existing.overlayQuad);
      return boxIou(pmBox, existingBox) >= DETECTION_NMS_IOU;
    });

    if (overlaps) {
      continue;
    }

    selected.push(pm);
    if (selected.length >= MAX_DETECTION_OVERLAYS) {
      break;
    }
  }

  return selected;
}

function quadBoundingBox(quad: import("./scan-types").VideoQuad): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of quad) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

function boxIou(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): number {
  const overlapW = Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  );
  const overlapH = Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
  );
  const intersection = overlapW * overlapH;
  if (intersection <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function selectDistinctProposalMatches(
  proposalMatches: BrowserVideoProposalMatch[],
): BrowserVideoProposalMatch[] {
  const selected: BrowserVideoProposalMatch[] = [];

  for (const proposalMatch of [...proposalMatches].sort(compareProposalMatches)) {
    if (!proposalMatch.bestMatch) {
      continue;
    }

    if (
      selected.some(
        (existing) =>
          windowIou(existing.proposal, proposalMatch.proposal) >= PROPOSAL_NMS_IOU,
      )
    ) {
      continue;
    }

    selected.push(proposalMatch);
    if (selected.length >= MAX_ACTIVE_PROPOSALS) {
      break;
    }
  }

  return selected;
}

function compareProposalMatches(
  left: BrowserVideoProposalMatch,
  right: BrowserVideoProposalMatch,
): number {
  if (left.bestMatch && right.bestMatch) {
    return (
      left.bestMatch.scoreDistance - right.bestMatch.scoreDistance ||
      Number(left.isClipped) - Number(right.isClipped) ||
      left.bestMatch.fullDistance - right.bestMatch.fullDistance ||
      left.bestMatch.name.localeCompare(right.bestMatch.name)
    );
  }

  if (left.bestMatch) {
    return -1;
  }

  if (right.bestMatch) {
    return 1;
  }

  return left.proposal.label.localeCompare(right.proposal.label);
}

/** Number of top artwork matches to use as pHash pre-filter. */
const ARTWORK_PREFILTER_TOP_N = 50;
/** Artwork similarity threshold below which we don't trust the match. */
const ARTWORK_MIN_SIMILARITY = 0.90;
/** Artwork similarity margin over #2 to inject without pHash confirmation. */
const ARTWORK_INJECT_MARGIN = 0.005;

function rankProposalCanvas(
  cropCanvas: HTMLCanvasElement,
  hashEntries: CardScanHashEntry[],
  proposalLabel: string,
  tcgFilter?: TcgCode | "all",
  artworkDb?: ArtworkFingerprintEntry[],
): { ranked: BrowserVideoScanCandidate[] } {
  const fullHash = computeRGBHashFromCanvas(cropCanvas);
  const featureHashesByTcg = computeFeatureHashesByTcg(
    cropCanvas,
    hashEntries,
    tcgFilter,
  );

  // When artwork DB is available, use artwork as primary signal
  if (artworkDb && artworkDb.length > 0) {
    const tcgForArtwork =
      tcgFilter && tcgFilter !== "all" ? tcgFilter : "pokemon";
    const tcgKey = tcgForArtwork as "pokemon" | "magic" | "yugioh";
    const artworkFp = computeArtworkFingerprintFromCanvas(cropCanvas, tcgKey);
    const hsvHist = computeHSVHistogramFromCanvas(cropCanvas, tcgKey);
    const artworkMatches = matchArtworkFingerprint(
      artworkFp,
      artworkDb,
      ARTWORK_PREFILTER_TOP_N,
      tcgFilter,
      hsvHist,
    );

    if (artworkMatches.length > 0) {
      // Pre-filter hash entries to artwork top-N for faster pHash
      const artworkIds = new Set(artworkMatches.map((m) => m.externalId));
      const filteredEntries = hashEntries.filter((e) =>
        artworkIds.has(e.externalId),
      );

      // Run pHash on pre-filtered set
      const pHashRanked =
        filteredEntries.length > 0
          ? rankMatches(
              filteredEntries,
              fullHash,
              featureHashesByTcg,
              proposalLabel,
            )
          : [];

      // Build artwork-based candidates and merge with pHash results
      const merged = mergeArtworkAndPHashCandidates(
        artworkMatches,
        pHashRanked,
        hashEntries,
        proposalLabel,
      );

      return { ranked: merged };
    }
  }

  // Fallback: pure pHash ranking (original path)
  return {
    ranked: rankMatches(
      hashEntries,
      fullHash,
      featureHashesByTcg,
      proposalLabel,
    ),
  };
}

/**
 * Merge artwork similarity matches with pHash candidates.
 * Artwork is the primary signal; pHash refines the ranking.
 */
function mergeArtworkAndPHashCandidates(
  artworkMatches: Array<{
    externalId: string;
    tcg: TcgCode;
    name: string;
    setCode: string | null;
    similarity: number;
  }>,
  pHashCandidates: BrowserVideoScanCandidate[],
  hashEntries: CardScanHashEntry[],
  proposalLabel: string,
): BrowserVideoScanCandidate[] {
  const candidateMap = new Map<string, BrowserVideoScanCandidate>();

  // Add pHash candidates first
  for (const candidate of pHashCandidates) {
    candidateMap.set(`${candidate.tcg}:${candidate.externalId}`, candidate);
  }

  // Inject top artwork matches that aren't already pHash candidates
  const topArtwork = artworkMatches.slice(0, MAX_CANDIDATES);
  const secondBest = artworkMatches[1]?.similarity ?? 0;

  for (const artwork of topArtwork) {
    const key = `${artwork.tcg}:${artwork.externalId}`;
    const existing = candidateMap.get(key);

    if (existing) {
      // Enrich existing pHash candidate with artwork similarity
      existing.artworkSimilarity = artwork.similarity;
      continue;
    }

    // Inject artwork match only if it's confident enough
    if (
      artwork.similarity >= ARTWORK_MIN_SIMILARITY &&
      (artwork === topArtwork[0] ||
        artwork.similarity - secondBest >= ARTWORK_INJECT_MARGIN)
    ) {
      const entry = hashEntries.find(
        (e) => e.externalId === artwork.externalId && e.tcg === artwork.tcg,
      );

      // Convert artwork similarity to a synthetic scoreDistance for ranking
      // Lower scoreDistance = better match. Map similarity [0.9, 1.0] → distance [240, 0]
      const syntheticDistance = Math.round((1 - artwork.similarity) * 240 * 1.5);

      candidateMap.set(key, {
        externalId: artwork.externalId,
        tcg: artwork.tcg,
        name: artwork.name,
        setCode: artwork.setCode,
        setName: entry?.setName ?? null,
        rarity: entry?.rarity ?? null,
        imageUrl: entry?.imageUrl ?? null,
        confidence: artwork.similarity,
        distance: syntheticDistance,
        scoreDistance: syntheticDistance,
        passedThreshold: artwork.similarity >= ARTWORK_MIN_SIMILARITY,
        fullDistance: syntheticDistance,
        titleDistance: null,
        footerDistance: null,
        proposalLabel,
        artworkSimilarity: artwork.similarity,
      });
    }
  }

  return Array.from(candidateMap.values())
    .sort((a, b) => {
      // Prefer candidates with artwork similarity, then by score
      const aArt = a.artworkSimilarity ?? 0;
      const bArt = b.artworkSimilarity ?? 0;
      if (aArt > ARTWORK_MIN_SIMILARITY && bArt <= ARTWORK_MIN_SIMILARITY)
        return -1;
      if (bArt > ARTWORK_MIN_SIMILARITY && aArt <= ARTWORK_MIN_SIMILARITY)
        return 1;
      if (aArt > 0 && bArt > 0) return bArt - aArt;
      return a.scoreDistance - b.scoreDistance;
    })
    .slice(0, MAX_CANDIDATES);
}

function shouldUseRefinedRanking(
  refined: BrowserVideoScanCandidate[],
  raw: BrowserVideoScanCandidate[],
  isClipped: boolean,
): boolean {
  const refinedTop = refined[0] ?? null;
  const rawTop = raw[0] ?? null;

  if (!refinedTop) {
    return false;
  }

  if (!rawTop) {
    return true;
  }

  if (refinedTop.passedThreshold && !rawTop.passedThreshold) {
    return true;
  }

  if (
    refinedTop.tcg === rawTop.tcg &&
    refinedTop.externalId === rawTop.externalId &&
    refinedTop.scoreDistance < rawTop.scoreDistance
  ) {
    return true;
  }

  return refinedTop.scoreDistance + (isClipped ? 18 : 8) < rawTop.scoreDistance;
}
