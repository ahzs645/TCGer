/**
 * Card scan service — accepts an uploaded image, generates a pHash,
 * and matches it against the card_hashes table.
 */

import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

import { computeRGBHash, hammingDistance, type RGBHash } from './phash';

const prisma = new PrismaClient();

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
}

// ---------- configuration ----------

/**
 * Maximum combined RGB Hamming distance to consider a match.
 * With 256 bits per channel × 3 channels = 768 total bits,
 * a threshold of 240 (~31% of bits) is a reasonable cutoff.
 * Moss Machine uses ~80 per channel with its 256-bit hashes.
 */
const MAX_COMBINED_DISTANCE = 240;

/** Maximum number of candidates to return. */
const MAX_CANDIDATES = 5;

/** Quick rejection: skip full comparison if any single channel exceeds this. */
const SINGLE_CHANNEL_REJECT = 100;

// ---------- public API ----------

/**
 * Scan an uploaded card image and return matching cards.
 */
export async function scanCardImage(
  imageBuffer: Buffer,
  tcgFilter?: string
): Promise<ScanResult> {
  // 1. Preprocess the image (crop card area, normalize)
  const processed = await preprocessCardImage(imageBuffer);

  // 2. Generate pHash
  const hashGenerated = await computeRGBHash(processed);

  // 3. Fetch hash database (filtered by TCG if specified)
  const where = tcgFilter ? { tcg: tcgFilter } : {};
  const hashEntries = await prisma.cardHash.findMany({ where });

  // 4. Compare and rank matches
  const matches: ScanMatch[] = [];

  for (const entry of hashEntries) {
    const entryHash: RGBHash = {
      r: entry.rHash,
      g: entry.gHash,
      b: entry.bHash,
    };

    // Quick rejection on red channel
    const rDist = hammingDistance(hashGenerated.r, entryHash.r);
    if (rDist > SINGLE_CHANNEL_REJECT) continue;

    // Full comparison
    const gDist = hammingDistance(hashGenerated.g, entryHash.g);
    if (rDist + gDist > MAX_COMBINED_DISTANCE) continue;

    const bDist = hammingDistance(hashGenerated.b, entryHash.b);
    const totalDist = rDist + gDist + bDist;

    if (totalDist <= MAX_COMBINED_DISTANCE) {
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
  }

  // Sort by distance (ascending = best first)
  matches.sort((a, b) => a.distance - b.distance);
  const candidates = matches.slice(0, MAX_CANDIDATES);

  return {
    bestMatch: candidates[0] ?? null,
    candidates,
    hashGenerated,
  };
}

/**
 * Get card hash database entries for client-side matching (iOS, etc.).
 */
export async function getCardHashes(tcg?: string, page = 1, pageSize = 500) {
  const where = tcg ? { tcg } : {};
  const skip = (page - 1) * pageSize;

  const [entries, total] = await Promise.all([
    prisma.cardHash.findMany({
      where,
      skip,
      take: pageSize,
      select: {
        externalId: true,
        tcg: true,
        name: true,
        setCode: true,
        setName: true,
        rarity: true,
        imageUrl: true,
        rHash: true,
        gHash: true,
        bHash: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.cardHash.count({ where }),
  ]);

  return {
    entries,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ---------- image preprocessing ----------

/**
 * Preprocess uploaded card image:
 * - Auto-orient (EXIF)
 * - Resize to 1024px on longest side (preserve aspect, letterbox on white)
 * - Normalize exposure
 *
 * This mirrors the Moss Machine's preprocessing: letterbox to 1024×1024,
 * portrait orientation, white background.
 */
async function preprocessCardImage(imageBuffer: Buffer): Promise<Buffer> {
  const TARGET = 1024;

  const img = sharp(imageBuffer).rotate(); // auto-orient EXIF
  const meta = await img.metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;

  // Ensure portrait orientation
  const isLandscape = w > h;

  let processed = isLandscape ? img.rotate(90) : img;

  // Resize to fit within TARGET × TARGET (maintain aspect)
  processed = processed.resize(TARGET, TARGET, {
    fit: 'contain',
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  });

  // Normalize (auto-level) to handle varying lighting
  processed = processed.normalize();

  return processed.removeAlpha().toBuffer();
}
