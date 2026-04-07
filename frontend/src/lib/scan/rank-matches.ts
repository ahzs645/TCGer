import type { CardScanHashEntry } from "@/lib/api/scan";
import { hammingDistance } from "./rgb-hash";
import type {
  BrowserVideoScanCandidate,
  CardFeatureHashes,
  RGBHash,
  SupportedTcg,
  TcgCode,
} from "./scan-types";

const MAX_DISTANCE = 320;
const SHORTLIST_MARGIN = 96;
const SHORTLIST_LIMIT = 24;
export const MAX_CANDIDATES = 5;

export function rankMatches(
  hashEntries: CardScanHashEntry[],
  queryHash: RGBHash,
  featureHashesByTcg: Partial<Record<SupportedTcg, CardFeatureHashes>>,
  proposalLabel: string,
): BrowserVideoScanCandidate[] {
  const shortlist: Array<{
    entry: CardScanHashEntry;
    fullDistance: number;
    titleDistance: number | null;
    footerDistance: number | null;
    scoreDistance: number;
  }> = [];

  const shortlistMaxDistance = MAX_DISTANCE + SHORTLIST_MARGIN;
  const singleChannelReject = Math.max(
    64,
    Math.floor(shortlistMaxDistance * 0.6),
  );

  for (const entry of hashEntries) {
    const rDist = hammingDistance(queryHash.r, entry.rHash);
    if (rDist > singleChannelReject) {
      continue;
    }

    const gDist = hammingDistance(queryHash.g, entry.gHash);
    if (rDist + gDist > shortlistMaxDistance) {
      continue;
    }

    const bDist = hammingDistance(queryHash.b, entry.bHash);
    const fullDistance = rDist + gDist + bDist;

    if (fullDistance > shortlistMaxDistance) {
      continue;
    }

    const storedFeatureHashes = getStoredCardFeatureHashes(entry);
    const scanFeatureHashes = readFeatureHashesForEntry(
      entry.tcg,
      featureHashesByTcg,
    );
    const titleDistance =
      scanFeatureHashes.title && storedFeatureHashes.title
        ? rgbDistance(scanFeatureHashes.title, storedFeatureHashes.title)
        : null;
    const footerDistance =
      scanFeatureHashes.footer && storedFeatureHashes.footer
        ? rgbDistance(scanFeatureHashes.footer, storedFeatureHashes.footer)
        : null;
    const scoreDistance = computeFeatureScore(
      fullDistance,
      titleDistance,
      footerDistance,
    );

    shortlist.push({
      entry,
      fullDistance,
      titleDistance,
      footerDistance,
      scoreDistance,
    });
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

  return shortlist
    .sort((left, right) => {
      return (
        left.scoreDistance - right.scoreDistance ||
        left.fullDistance - right.fullDistance ||
        left.entry.name.localeCompare(right.entry.name)
      );
    })
    .slice(0, MAX_CANDIDATES)
    .map((candidate) => buildCandidate(candidate, proposalLabel));
}

function buildCandidate(
  candidate: {
    entry: CardScanHashEntry;
    fullDistance: number;
    titleDistance: number | null;
    footerDistance: number | null;
    scoreDistance: number;
  },
  proposalLabel: string,
): BrowserVideoScanCandidate {
  const passedThreshold = candidate.scoreDistance <= MAX_DISTANCE;
  const confidence = computePublicConfidence(
    candidate.scoreDistance,
    candidate.entry.hashSize,
  );

  return {
    externalId: candidate.entry.externalId,
    tcg: candidate.entry.tcg,
    name: candidate.entry.name,
    setCode: candidate.entry.setCode,
    setName: candidate.entry.setName,
    rarity: candidate.entry.rarity,
    imageUrl: candidate.entry.imageUrl,
    confidence,
    distance: Math.round(candidate.scoreDistance),
    scoreDistance: candidate.scoreDistance,
    passedThreshold,
    fullDistance: candidate.fullDistance,
    titleDistance: candidate.titleDistance,
    footerDistance: candidate.footerDistance,
    proposalLabel,
  };
}

function getStoredCardFeatureHashes(entry: CardScanHashEntry): CardFeatureHashes {
  return {
    title: readFeatureHash(entry.titleRHash, entry.titleGHash, entry.titleBHash),
    footer: readFeatureHash(
      entry.footerRHash,
      entry.footerGHash,
      entry.footerBHash,
    ),
  };
}

function readFeatureHash(
  rHash?: string | null,
  gHash?: string | null,
  bHash?: string | null,
): RGBHash | null {
  if (!rHash || !gHash || !bHash) {
    return null;
  }

  return {
    r: rHash,
    g: gHash,
    b: bHash,
  };
}

function readFeatureHashesForEntry(
  tcg: TcgCode,
  featureHashesByTcg: Partial<Record<SupportedTcg, CardFeatureHashes>>,
): CardFeatureHashes {
  if (tcg === "magic" || tcg === "pokemon" || tcg === "yugioh") {
    return featureHashesByTcg[tcg] ?? { title: null, footer: null };
  }

  return { title: null, footer: null };
}

function computePublicConfidence(
  scoreDistance: number,
  hashSize: number,
): number {
  const totalBits = Math.max(1, hashSize * hashSize * 3);
  return Math.max(0, Math.min(1, 1 - scoreDistance / totalBits));
}

function computeFeatureScore(
  fullDistance: number,
  titleDistance: number | null,
  footerDistance: number | null,
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

function rgbDistance(left: RGBHash, right: RGBHash): number {
  return (
    hammingDistance(left.r, right.r) +
    hammingDistance(left.g, right.g) +
    hammingDistance(left.b, right.b)
  );
}
