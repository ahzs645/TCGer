import sharp from 'sharp';

import type { CardHashRecord } from './hash-store';
import { computeRGBHash, type RGBHash } from './phash';

const HASH_CANVAS_SIZE = 1024;
const CARD_ASPECT_RATIO = 0.714;

export type SupportedTcg = 'magic' | 'pokemon' | 'yugioh';
export type RegionName = 'title' | 'footer';

export interface RegionSpec {
  name: RegionName;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CardFeatureHashes {
  title: RGBHash | null;
  footer: RGBHash | null;
}

const REGION_SPECS: Record<SupportedTcg, RegionSpec[]> = {
  magic: [
    { name: 'title', left: 0.06, top: 0.03, width: 0.88, height: 0.09 },
    { name: 'footer', left: 0.06, top: 0.88, width: 0.88, height: 0.08 },
  ],
  pokemon: [
    { name: 'title', left: 0.06, top: 0.04, width: 0.88, height: 0.11 },
    { name: 'footer', left: 0.06, top: 0.79, width: 0.88, height: 0.16 },
  ],
  yugioh: [
    { name: 'title', left: 0.07, top: 0.04, width: 0.86, height: 0.09 },
    { name: 'footer', left: 0.05, top: 0.80, width: 0.90, height: 0.16 },
  ],
};

export const FEATURE_REGION_SPECS = REGION_SPECS;
export const NORMALIZED_CARD_CANVAS_SIZE = HASH_CANVAS_SIZE;
export const NORMALIZED_CARD_ASPECT_RATIO = CARD_ASPECT_RATIO;

export function resolveCardRect(size: number) {
  const width = Math.round(size * CARD_ASPECT_RATIO);
  const left = Math.round((size - width) / 2);

  return {
    left,
    top: 0,
    width,
    height: size,
  };
}

function clampRegionBounds(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function extractRegionBuffer(
  normalizedImage: Buffer,
  spec: RegionSpec
): Promise<Buffer | null> {
  return extractNormalizedCardRegionBuffer(normalizedImage, spec, {
    resizeTo: 256,
    fit: 'contain',
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  });
}

export async function extractNormalizedCardRegionBuffer(
  normalizedImage: Buffer,
  spec: Pick<RegionSpec, 'left' | 'top' | 'width' | 'height'>,
  options?: {
    resizeTo?: number | null;
    fit?: keyof sharp.FitEnum;
    background?: sharp.Color;
  }
): Promise<Buffer | null> {
  const cardRect = resolveCardRect(HASH_CANVAS_SIZE);
  const left = clampRegionBounds(
    Math.round(cardRect.left + cardRect.width * spec.left),
    0,
    HASH_CANVAS_SIZE - 1
  );
  const top = clampRegionBounds(
    Math.round(cardRect.top + cardRect.height * spec.top),
    0,
    HASH_CANVAS_SIZE - 1
  );
  const width = clampRegionBounds(Math.round(cardRect.width * spec.width), 32, HASH_CANVAS_SIZE - left);
  const height = clampRegionBounds(Math.round(cardRect.height * spec.height), 32, HASH_CANVAS_SIZE - top);

  if (width <= 0 || height <= 0) {
    return null;
  }

  let image = sharp(normalizedImage).extract({ left, top, width, height });
  if (options?.resizeTo) {
    image = image.resize(options.resizeTo, options.resizeTo, {
      fit: options.fit ?? 'contain',
      background: options.background ?? { r: 255, g: 255, b: 255, alpha: 1 },
    });
  }

  return image.removeAlpha().toBuffer();
}

export async function computeCardFeatureHashes(
  tcg: SupportedTcg,
  normalizedImage: Buffer
): Promise<CardFeatureHashes> {
  const regions = REGION_SPECS[tcg];
  const result: CardFeatureHashes = {
    title: null,
    footer: null,
  };

  for (const region of regions) {
    const buffer = await extractRegionBuffer(normalizedImage, region);
    if (!buffer) {
      continue;
    }

    result[region.name] = await computeRGBHash(buffer);
  }

  return result;
}

function readFeatureHash(
  rHash: string | null | undefined,
  gHash: string | null | undefined,
  bHash: string | null | undefined
): RGBHash | null {
  if (!rHash || !gHash || !bHash) {
    return null;
  }

  return { r: rHash, g: gHash, b: bHash };
}

export function getStoredCardFeatureHashes(record: CardHashRecord): CardFeatureHashes {
  return {
    title: readFeatureHash(record.titleRHash, record.titleGHash, record.titleBHash),
    footer: readFeatureHash(record.footerRHash, record.footerGHash, record.footerBHash),
  };
}

export function flattenCardFeatureHashes(
  hashes: CardFeatureHashes
): Pick<
  CardHashRecord,
  'titleRHash' | 'titleGHash' | 'titleBHash' | 'footerRHash' | 'footerGHash' | 'footerBHash'
> {
  return {
    titleRHash: hashes.title?.r ?? null,
    titleGHash: hashes.title?.g ?? null,
    titleBHash: hashes.title?.b ?? null,
    footerRHash: hashes.footer?.r ?? null,
    footerGHash: hashes.footer?.g ?? null,
    footerBHash: hashes.footer?.b ?? null,
  };
}

export function hasCompleteCardFeatureHashes(record: CardHashRecord): boolean {
  return Boolean(
    record.titleRHash &&
      record.titleGHash &&
      record.titleBHash &&
      record.footerRHash &&
      record.footerGHash &&
      record.footerBHash
  );
}
