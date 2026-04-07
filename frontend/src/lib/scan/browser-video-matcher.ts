"use client";

import type {
  CardScanHashEntry,
  CardScanMatch,
} from "@/lib/api/scan";
import type { TcgCode } from "@/types/card";

type SupportedTcg = Extract<TcgCode, "magic" | "pokemon" | "yugioh">;

interface RGBHash {
  r: string;
  g: string;
  b: string;
}

interface CardFeatureHashes {
  title: RGBHash | null;
  footer: RGBHash | null;
}

export interface VideoWindowProposal {
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BrowserVideoScanCandidate extends CardScanMatch {
  scoreDistance: number;
  passedThreshold: boolean;
  fullDistance: number;
  titleDistance: number | null;
  footerDistance: number | null;
  proposalLabel: string;
}

export interface BrowserVideoFrameScanResult {
  activeProposal: VideoWindowProposal | null;
  bestMatch: BrowserVideoScanCandidate | null;
  candidates: BrowserVideoScanCandidate[];
}

const DEFAULT_HASH_SIZE = 16;
const HIGHFREQ_FACTOR = 4;
const CARD_ASPECT_RATIO = 0.714;
const MAX_DISTANCE = 320;
const SHORTLIST_MARGIN = 96;
const SHORTLIST_LIMIT = 24;
const MAX_CANDIDATES = 5;

const PORTRAIT_WINDOW_PRESETS = [
  { label: "portrait-center-90", scale: 0.9, anchorX: 0.5, anchorY: 0.55 },
  { label: "portrait-center-75", scale: 0.75, anchorX: 0.5, anchorY: 0.55 },
  { label: "portrait-right-75", scale: 0.75, anchorX: 0.65, anchorY: 0.55 },
  { label: "portrait-right-60", scale: 0.6, anchorX: 0.74, anchorY: 0.55 },
  { label: "portrait-left-75", scale: 0.75, anchorX: 0.35, anchorY: 0.55 },
] as const;

const FEATURE_REGION_SPECS: Record<
  SupportedTcg,
  Array<{
    name: "title" | "footer";
    left: number;
    top: number;
    width: number;
    height: number;
  }>
> = {
  magic: [
    { name: "title", left: 0.06, top: 0.03, width: 0.88, height: 0.09 },
    { name: "footer", left: 0.06, top: 0.88, width: 0.88, height: 0.08 },
  ],
  pokemon: [
    { name: "title", left: 0.06, top: 0.04, width: 0.88, height: 0.11 },
    { name: "footer", left: 0.06, top: 0.79, width: 0.88, height: 0.16 },
  ],
  yugioh: [
    { name: "title", left: 0.07, top: 0.04, width: 0.86, height: 0.09 },
    { name: "footer", left: 0.05, top: 0.8, width: 0.9, height: 0.16 },
  ],
};

const cosineTableCache = new Map<number, Float64Array>();

export function buildVideoWindowProposals(
  frameWidth: number,
  frameHeight: number,
): VideoWindowProposal[] {
  const proposals: VideoWindowProposal[] = [];

  for (const preset of PORTRAIT_WINDOW_PRESETS) {
    const height = Math.round(frameHeight * preset.scale);
    const width = Math.round(height * CARD_ASPECT_RATIO);

    if (width >= frameWidth - 8 || height >= frameHeight - 8) {
      continue;
    }

    const left = clamp(
      Math.round(frameWidth * preset.anchorX - width / 2),
      0,
      frameWidth - width,
    );
    const top = clamp(
      Math.round(frameHeight * preset.anchorY - height / 2),
      0,
      frameHeight - height,
    );

    proposals.push({
      label: preset.label,
      left,
      top,
      width,
      height,
    });
  }

  if (proposals.length > 0) {
    return proposals;
  }

  const fallbackWidth = Math.max(
    1,
    Math.min(frameWidth - 4, Math.round((frameHeight - 4) * CARD_ASPECT_RATIO)),
  );
  const fallbackHeight = Math.max(1, Math.round(fallbackWidth / CARD_ASPECT_RATIO));

  return [
    {
      label: "portrait-fallback",
      left: Math.max(0, Math.round((frameWidth - fallbackWidth) / 2)),
      top: Math.max(0, Math.round((frameHeight - fallbackHeight) / 2)),
      width: fallbackWidth,
      height: Math.min(frameHeight, fallbackHeight),
    },
  ];
}

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
    };
  }

  const proposals = buildVideoWindowProposals(
    frameCanvas.width,
    frameCanvas.height,
  );
  const mergedCandidates = new Map<string, BrowserVideoScanCandidate>();
  let bestProposal: VideoWindowProposal | null = null;
  let bestProposalMatch: BrowserVideoScanCandidate | null = null;

  for (const proposal of proposals) {
    const cropCanvas = extractProposalCanvas(frameCanvas, proposal);
    const fullHash = computeRGBHashFromCanvas(cropCanvas);
    const featureHashesByTcg = computeFeatureHashesByTcg(
      cropCanvas,
      hashEntries,
      tcgFilter,
    );
    const ranked = rankMatches(hashEntries, fullHash, featureHashesByTcg, proposal);

    for (const candidate of ranked) {
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

    const topCandidate = ranked[0] ?? null;
    if (!topCandidate) {
      continue;
    }

    if (
      !bestProposalMatch ||
      topCandidate.scoreDistance < bestProposalMatch.scoreDistance ||
      topCandidate.fullDistance < bestProposalMatch.fullDistance
    ) {
      bestProposal = proposal;
      bestProposalMatch = topCandidate;
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
  };
}

function extractProposalCanvas(
  frameCanvas: HTMLCanvasElement,
  proposal: VideoWindowProposal,
): HTMLCanvasElement {
  const canvas = createCanvas(proposal.width, proposal.height);
  const context = getContext2d(canvas);

  context.drawImage(
    frameCanvas,
    proposal.left,
    proposal.top,
    proposal.width,
    proposal.height,
    0,
    0,
    proposal.width,
    proposal.height,
  );

  return canvas;
}

function computeFeatureHashesByTcg(
  canvas: HTMLCanvasElement,
  hashEntries: CardScanHashEntry[],
  tcgFilter?: TcgCode | "all",
): Partial<Record<SupportedTcg, CardFeatureHashes>> {
  const tcgs = new Set<SupportedTcg>();

  if (tcgFilter === "magic" || tcgFilter === "pokemon" || tcgFilter === "yugioh") {
    tcgs.add(tcgFilter);
  } else {
    for (const entry of hashEntries) {
      if (entry.tcg === "magic" || entry.tcg === "pokemon" || entry.tcg === "yugioh") {
        tcgs.add(entry.tcg);
      }
    }
  }

  const output: Partial<Record<SupportedTcg, CardFeatureHashes>> = {};

  for (const tcg of tcgs) {
    output[tcg] = computeCardFeatureHashes(tcg, canvas);
  }

  return output;
}

function computeCardFeatureHashes(
  tcg: SupportedTcg,
  canvas: HTMLCanvasElement,
): CardFeatureHashes {
  const hashes: CardFeatureHashes = {
    title: null,
    footer: null,
  };

  for (const region of FEATURE_REGION_SPECS[tcg]) {
    const regionCanvas = extractRegionCanvas(canvas, region);
    hashes[region.name] = computeRGBHashFromCanvas(regionCanvas);
  }

  return hashes;
}

function extractRegionCanvas(
  sourceCanvas: HTMLCanvasElement,
  region: {
    left: number;
    top: number;
    width: number;
    height: number;
  },
): HTMLCanvasElement {
  const left = clamp(
    Math.round(sourceCanvas.width * region.left),
    0,
    sourceCanvas.width - 1,
  );
  const top = clamp(
    Math.round(sourceCanvas.height * region.top),
    0,
    sourceCanvas.height - 1,
  );
  const width = clamp(
    Math.round(sourceCanvas.width * region.width),
    32,
    sourceCanvas.width - left,
  );
  const height = clamp(
    Math.round(sourceCanvas.height * region.height),
    32,
    sourceCanvas.height - top,
  );

  const canvas = createCanvas(width, height);
  const context = getContext2d(canvas);
  context.drawImage(sourceCanvas, left, top, width, height, 0, 0, width, height);
  return canvas;
}

function rankMatches(
  hashEntries: CardScanHashEntry[],
  queryHash: RGBHash,
  featureHashesByTcg: Partial<Record<SupportedTcg, CardFeatureHashes>>,
  proposal: VideoWindowProposal,
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
    .map((candidate) => buildCandidate(candidate, proposal));
}

function buildCandidate(
  candidate: {
    entry: CardScanHashEntry;
    fullDistance: number;
    titleDistance: number | null;
    footerDistance: number | null;
    scoreDistance: number;
  },
  proposal: VideoWindowProposal,
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
    proposalLabel: proposal.label,
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

function computeRGBHashFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  hashSize = DEFAULT_HASH_SIZE,
): RGBHash {
  const dctSize = hashSize * HIGHFREQ_FACTOR;
  const canvas = createCanvas(dctSize, dctSize);
  const context = getContext2d(canvas);

  context.drawImage(sourceCanvas, 0, 0, dctSize, dctSize);

  const imageData = context.getImageData(0, 0, dctSize, dctSize);
  const pixelCount = dctSize * dctSize;
  const rChannel = new Float64Array(pixelCount);
  const gChannel = new Float64Array(pixelCount);
  const bChannel = new Float64Array(pixelCount);

  for (let index = 0; index < pixelCount; index += 1) {
    rChannel[index] = imageData.data[index * 4] ?? 0;
    gChannel[index] = imageData.data[index * 4 + 1] ?? 0;
    bChannel[index] = imageData.data[index * 4 + 2] ?? 0;
  }

  return {
    r: channelPHash(rChannel, dctSize, hashSize),
    g: channelPHash(gChannel, dctSize, hashSize),
    b: channelPHash(bChannel, dctSize, hashSize),
  };
}

function channelPHash(
  channel: Float64Array,
  dctSize: number,
  hashSize: number,
): string {
  const dctResult = dct2d(channel, dctSize);
  const lowFrequency: number[] = [];

  for (let y = 0; y < hashSize; y += 1) {
    for (let x = 0; x < hashSize; x += 1) {
      if (x === 0 && y === 0) {
        continue;
      }

      lowFrequency.push(dctResult[y * dctSize + x] ?? 0);
    }
  }

  const sorted = [...lowFrequency].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);

  const bits = new Uint8Array(hashSize * hashSize);
  let index = 0;

  for (let y = 0; y < hashSize; y += 1) {
    for (let x = 0; x < hashSize; x += 1) {
      if (x === 0 && y === 0) {
        bits[0] = 0;
        continue;
      }

      bits[y * hashSize + x] = (lowFrequency[index] ?? 0) > median ? 1 : 0;
      index += 1;
    }
  }

  return bitsToHex(bits);
}

function dct2d(data: Float64Array, size: number): Float64Array {
  const result = new Float64Array(size * size);

  for (let y = 0; y < size; y += 1) {
    const row = data.subarray(y * size, (y + 1) * size);
    result.set(dct1d(row, size), y * size);
  }

  const column = new Float64Array(size);
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      column[y] = result[y * size + x] ?? 0;
    }

    const transformed = dct1d(column, size);
    for (let y = 0; y < size; y += 1) {
      result[y * size + x] = transformed[y] ?? 0;
    }
  }

  return result;
}

function dct1d(input: Float64Array, size: number): Float64Array {
  const output = new Float64Array(size);
  const table = getCosineTable(size);

  for (let k = 0; k < size; k += 1) {
    let sum = 0;
    for (let n = 0; n < size; n += 1) {
      sum += (input[n] ?? 0) * (table[k * size + n] ?? 0);
    }
    output[k] = sum;
  }

  return output;
}

function getCosineTable(size: number): Float64Array {
  const existing = cosineTableCache.get(size);
  if (existing) {
    return existing;
  }

  const table = new Float64Array(size * size);
  const factor = Math.PI / size;

  for (let k = 0; k < size; k += 1) {
    for (let n = 0; n < size; n += 1) {
      table[k * size + n] = Math.cos(factor * (n + 0.5) * k);
    }
  }

  cosineTableCache.set(size, table);
  return table;
}

function bitsToHex(bits: Uint8Array): string {
  let hex = "";

  for (let index = 0; index < bits.length; index += 4) {
    const nibble =
      ((bits[index] ?? 0) << 3) |
      ((bits[index + 1] ?? 0) << 2) |
      ((bits[index + 2] ?? 0) << 1) |
      (bits[index + 3] ?? 0);
    hex += nibble.toString(16);
  }

  return hex;
}

function hammingDistance(hash1: string, hash2: string): number {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) {
    return Number.POSITIVE_INFINITY;
  }

  let distance = 0;

  for (let index = 0; index < hash1.length; index += 8) {
    const chunk1 = Number.parseInt(hash1.substring(index, index + 8), 16);
    const chunk2 = Number.parseInt(hash2.substring(index, index + 8), 16);
    let xor = (chunk1 ^ chunk2) >>> 0;

    while (xor) {
      distance += 1;
      xor &= xor - 1;
    }
  }

  return distance;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getContext2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Unable to create a 2D canvas context.");
  }

  return context;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
