import { createHash } from 'node:crypto';

import sharp from 'sharp';

import type { ScanMatch, ScanResult } from './scan.service';
import { scanCardImage } from './scan.service';

const WHITE_TRIM_THRESHOLDS = [12, 24];
const CARD_ASPECT_RATIO = 0.714;
const PORTRAIT_WINDOW_PRESETS = [
  { name: 'portrait-center-90', scale: 0.9, anchorX: 0.5, anchorY: 0.55 },
  { name: 'portrait-center-75', scale: 0.75, anchorX: 0.5, anchorY: 0.55 },
  { name: 'portrait-right-75', scale: 0.75, anchorX: 0.65, anchorY: 0.55 },
  { name: 'portrait-right-60', scale: 0.6, anchorX: 0.74, anchorY: 0.55 },
  { name: 'portrait-left-75', scale: 0.75, anchorX: 0.35, anchorY: 0.55 },
] as const;
const STRONG_MATCH_CONFIDENCE = 0.82;
const MIN_TRIM_REDUCTION_PX = 24;
const MIN_CONTENT_AREA_RATIO = 0.2;
const MAX_CANDIDATES = 5;

interface VideoSourceVariant {
  name: string;
  image: Buffer;
  width: number;
  height: number;
}

export interface VideoFrameScanResult extends ScanResult {
  sourceVariant: string;
  sourceVariantsTried: Array<{
    name: string;
    width: number;
    height: number;
  }>;
}

export async function scanVideoFrameImage(
  frameBuffer: Buffer,
  tcgFilter?: string
): Promise<VideoFrameScanResult> {
  const sourceVariants = await buildVideoSourceVariants(frameBuffer);
  const combinedCandidates = new Map<string, ScanMatch>();
  let bestVariant: VideoSourceVariant | null = null;
  let bestResult: ScanResult | null = null;

  for (const sourceVariant of sourceVariants) {
    const result = await scanCardImage(sourceVariant.image, tcgFilter);

    for (const candidate of result.candidates) {
      const key = `${candidate.tcg}:${candidate.externalId}`;
      const existing = combinedCandidates.get(key);
      if (!existing || candidate.distance < existing.distance) {
        combinedCandidates.set(key, candidate);
      }
    }

    if (!bestResult || compareVideoResults(result, bestResult) > 0) {
      bestResult = result;
      bestVariant = sourceVariant;
    }

    if (isStrongVideoMatch(result.bestMatch)) {
      break;
    }
  }

  const candidates = Array.from(combinedCandidates.values())
    .sort((left, right) => left.distance - right.distance || right.confidence - left.confidence)
    .slice(0, MAX_CANDIDATES);
  const resolvedResult = bestResult ?? (await scanCardImage(frameBuffer, tcgFilter));
  const resolvedVariant = bestVariant ?? sourceVariants[0]!;

  return {
    ...resolvedResult,
    bestMatch: candidates[0] ?? resolvedResult.bestMatch,
    candidates,
    sourceVariant: resolvedVariant.name,
    sourceVariantsTried: sourceVariants.map((variant) => ({
      name: variant.name,
      width: variant.width,
      height: variant.height,
    })),
  };
}

async function buildVideoSourceVariants(frameBuffer: Buffer): Promise<VideoSourceVariant[]> {
  const variants: VideoSourceVariant[] = [];
  const seen = new Set<string>();
  const original = await createVariant('frame-original', frameBuffer);
  pushVariant(variants, seen, original);

  for (const threshold of WHITE_TRIM_THRESHOLDS) {
    const trimmed = await trimWhitePadding(frameBuffer, threshold);
    if (trimmed) {
      pushVariant(variants, seen, await createVariant(`trim-white-${threshold}`, trimmed));
    }
  }

  const focusCrop = await extractNonWhiteBoundsCrop(frameBuffer);
  if (focusCrop) {
    pushVariant(variants, seen, await createVariant('content-bounds', focusCrop));
  }

  const portraitBases = variants.slice(0, 3);
  for (const base of portraitBases) {
    for (const preset of PORTRAIT_WINDOW_PRESETS) {
      const crop = await extractPortraitWindowCrop(
        base.image,
        preset.scale,
        preset.anchorX,
        preset.anchorY
      );
      if (!crop) {
        continue;
      }

      pushVariant(
        variants,
        seen,
        await createVariant(`${base.name}-${preset.name}`, crop)
      );
    }
  }

  return variants;
}

async function createVariant(name: string, image: Buffer): Promise<VideoSourceVariant> {
  const metadata = await sharp(image).metadata();

  return {
    name,
    image,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}

function pushVariant(
  variants: VideoSourceVariant[],
  seen: Set<string>,
  variant: VideoSourceVariant
): void {
  const signature = `${variant.width}x${variant.height}:${createHash('sha1').update(variant.image).digest('hex')}`;
  if (seen.has(signature)) {
    return;
  }

  seen.add(signature);
  variants.push(variant);
}

async function trimWhitePadding(imageBuffer: Buffer, threshold: number): Promise<Buffer | null> {
  const inputMetadata = await sharp(imageBuffer).metadata();
  const trimmed = await sharp(imageBuffer).trim({ threshold }).toBuffer();
  const trimmedMetadata = await sharp(trimmed).metadata();
  const widthDelta = (inputMetadata.width ?? 0) - (trimmedMetadata.width ?? 0);
  const heightDelta = (inputMetadata.height ?? 0) - (trimmedMetadata.height ?? 0);

  if (widthDelta < MIN_TRIM_REDUCTION_PX && heightDelta < MIN_TRIM_REDUCTION_PX) {
    return null;
  }

  return trimmed;
}

async function extractPortraitWindowCrop(
  imageBuffer: Buffer,
  scale: number,
  anchorX: number,
  anchorY: number
): Promise<Buffer | null> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (!width || !height) {
    return null;
  }

  const cropHeight = Math.round(height * scale);
  const cropWidth = Math.round(cropHeight * CARD_ASPECT_RATIO);
  if (cropWidth >= width - 8 || cropHeight >= height - 8) {
    return null;
  }

  const left = clamp(Math.round(width * anchorX - cropWidth / 2), 0, width - cropWidth);
  const top = clamp(Math.round(height * anchorY - cropHeight / 2), 0, height - cropHeight);

  return sharp(imageBuffer)
    .extract({
      left,
      top,
      width: cropWidth,
      height: cropHeight,
    })
    .toBuffer();
}

async function extractNonWhiteBoundsCrop(imageBuffer: Buffer): Promise<Buffer | null> {
  const metadata = await sharp(imageBuffer).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;

  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const { data, info } = await sharp(imageBuffer)
    .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * 4;
      const r = data[offset] ?? 255;
      const g = data[offset + 1] ?? 255;
      const b = data[offset + 2] ?? 255;
      const alpha = data[offset + 3] ?? 255;
      const isForeground = alpha > 16 && (r < 240 || g < 240 || b < 240);

      if (!isForeground) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const contentAreaRatio = (cropWidth * cropHeight) / Math.max(1, info.width * info.height);
  if (contentAreaRatio < MIN_CONTENT_AREA_RATIO) {
    return null;
  }

  const scaleX = sourceWidth / info.width;
  const scaleY = sourceHeight / info.height;
  const paddingX = Math.round(cropWidth * scaleX * 0.05);
  const paddingY = Math.round(cropHeight * scaleY * 0.05);
  const left = Math.max(0, Math.round(minX * scaleX) - paddingX);
  const top = Math.max(0, Math.round(minY * scaleY) - paddingY);
  const right = Math.min(sourceWidth, Math.round((maxX + 1) * scaleX) + paddingX);
  const bottom = Math.min(sourceHeight, Math.round((maxY + 1) * scaleY) + paddingY);

  if (right - left < 64 || bottom - top < 64) {
    return null;
  }

  return sharp(imageBuffer)
    .extract({
      left,
      top,
      width: right - left,
      height: bottom - top,
    })
    .toBuffer();
}

function compareVideoResults(left: ScanResult, right: ScanResult): number {
  const leftScore = scoreVideoResult(left);
  const rightScore = scoreVideoResult(right);
  return leftScore - rightScore;
}

function scoreVideoResult(result: ScanResult): number {
  const match = result.bestMatch;
  const qualityBonus = (result.meta.quality?.score ?? 0) * 100;
  const perspectiveBonus = result.meta.perspectiveCorrected ? 20 : 0;
  const rerankBonus = result.meta.rerankUsed ? 10 : 0;

  if (!match) {
    return qualityBonus + perspectiveBonus + rerankBonus - result.meta.shortlistSize;
  }

  return (
    match.confidence * 1000 -
    match.distance * 2 +
    qualityBonus +
    perspectiveBonus +
    rerankBonus
  );
}

function isStrongVideoMatch(match: ScanMatch | null): boolean {
  if (!match) {
    return false;
  }

  return match.confidence >= STRONG_MATCH_CONFIDENCE || match.distance <= 24;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
