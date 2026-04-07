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
  tcgFilter?: TcgCode | "all";
}): BrowserVideoFrameScanResult {
  const { frameCanvas, hashEntries, tcgFilter } = params;

  if (!hashEntries.length) {
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
    const rawExtraction = extractProposalCanvas(frameCanvas, proposal);
    const rawRanked = rankProposalCanvas(
      rawExtraction.canvas,
      hashEntries,
      proposal.label,
      tcgFilter,
    );
    let ranked = rawRanked.ranked;
    let overlayQuad = proposalToQuad(proposal);
    let refinementMethod: string | null = null;
    let isClipped = false;

    const refinementExtraction = extractProposalCanvas(
      frameCanvas,
      proposal,
      PROPOSAL_REFINEMENT_PADDING_RATIO,
    );
    const refinement = refineProposalCanvas(refinementExtraction.canvas);
    if (refinement) {
      const refinedRanked = rankProposalCanvas(
        refinement.warpedCanvas,
        hashEntries,
        proposal.label,
        tcgFilter,
      );
      overlayQuad = offsetQuad(
        refinement.quad,
        refinementExtraction.sourceWindow.left,
        refinementExtraction.sourceWindow.top,
      );
      refinementMethod = refinement.method;
      isClipped = refinement.isClipped;

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

  const proposalMatches = selectDistinctProposalMatches(rawProposalMatches);
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

function rankProposalCanvas(
  cropCanvas: HTMLCanvasElement,
  hashEntries: CardScanHashEntry[],
  proposalLabel: string,
  tcgFilter?: TcgCode | "all",
): { ranked: BrowserVideoScanCandidate[] } {
  const fullHash = computeRGBHashFromCanvas(cropCanvas);
  const featureHashesByTcg = computeFeatureHashesByTcg(
    cropCanvas,
    hashEntries,
    tcgFilter,
  );

  return {
    ranked: rankMatches(
      hashEntries,
      fullHash,
      featureHashesByTcg,
      proposalLabel,
    ),
  };
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
