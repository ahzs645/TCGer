import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { ARTWORK_REGIONS } from './artwork-matcher';
import {
  FEATURE_REGION_SPECS,
  extractNormalizedCardRegionBuffer,
  type RegionName,
  type SupportedTcg,
} from './feature-hashes';
import { getCardHashStoreMode } from './hash-store';
import type { ScanResult } from './scan.service';
import { getCardScanDebugPublicPath, getCardScanDebugUploadDir } from '../../utils/upload';

const PHASH_PIPELINE_VERSION = 'rgb-dct-16x16-v1';
const ARTWORK_PIPELINE_VERSION = 'eq-rgb-grid-8x8-v1';
const FEATURE_HASH_PIPELINE_VERSION = 'title-footer-rgb-phash-v1';

interface DatasetRevision {
  path: string;
  version: number | null;
  total: number | null;
  sizeBytes: number;
  modifiedAt: string;
  revision: string;
}

export interface DebugDerivedImagePaths {
  correctedImagePath: string | null;
  artworkImagePath: string | null;
  titleImagePath: string | null;
  footerImagePath: string | null;
}

export interface DebugCapturePipelineSnapshot {
  build: {
    gitSha: string | null;
    imageTag: string | null;
    backendMode: string | null;
  };
  matcher: {
    phashVersion: string;
    artworkVersion: string;
    featureHashVersion: string;
    detectorModelVersion: string | null;
    ocrModelVersion: string | null;
  };
  hashDatabase: {
    storeMode: string;
    dataset: DatasetRevision | null;
  };
  artworkDatabase: {
    dataset: DatasetRevision | null;
  };
}

const datasetRevisionCache = new Map<
  string,
  { mtimeMs: number; size: number; revision: DatasetRevision }
>();

function trimOptionalString(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveCaptureTcg(result: ScanResult, requestedTcg?: string): SupportedTcg {
  const tcg = (result.bestMatch?.tcg ?? requestedTcg ?? 'pokemon').toLowerCase();
  if (tcg === 'magic' || tcg === 'pokemon' || tcg === 'yugioh') {
    return tcg;
  }
  return 'pokemon';
}

async function buildDatasetRevision(filePath: string): Promise<DatasetRevision | null> {
  try {
    const fileStats = await stat(filePath);
    const cached = datasetRevisionCache.get(filePath);
    if (
      cached &&
      cached.mtimeMs === fileStats.mtimeMs &&
      cached.size === fileStats.size
    ) {
      return cached.revision;
    }

    const hash = createHash('sha256');
    let header = '';

    for await (const chunk of createReadStream(filePath)) {
      hash.update(chunk);

      if (header.length >= 131072) {
        continue;
      }

      const headerChunk = Buffer.isBuffer(chunk)
        ? chunk.toString('utf8', 0, Math.min(chunk.length, 131072 - header.length))
        : String(chunk).slice(0, 131072 - header.length);
      header += headerChunk;
    }

    const versionMatch = header.match(/"version"\s*:\s*(\d+)/);
    const totalMatch = header.match(/"total"\s*:\s*(\d+)/);
    const version = versionMatch ? Number(versionMatch[1]) : null;
    const total = totalMatch ? Number(totalMatch[1]) : null;

    const revision: DatasetRevision = {
      path: filePath,
      version,
      total,
      sizeBytes: fileStats.size,
      modifiedAt: fileStats.mtime.toISOString(),
      revision: hash.digest('hex').slice(0, 16),
    };

    datasetRevisionCache.set(filePath, {
      mtimeMs: fileStats.mtimeMs,
      size: fileStats.size,
      revision,
    });

    return revision;
  } catch {
    return null;
  }
}

export async function getDebugCapturePipelineSnapshot(): Promise<DebugCapturePipelineSnapshot> {
  const dataDir = trimOptionalString(process.env.CARD_SCAN_DATA_DIR);
  const hashRevision = dataDir
    ? await buildDatasetRevision(path.join(dataDir, 'hashes.json'))
    : null;
  const artworkRevision = dataDir
    ? await buildDatasetRevision(path.join(dataDir, 'artwork-fingerprints.json'))
    : null;

  return {
    build: {
      gitSha: trimOptionalString(process.env.TCGER_BUILD_GIT_SHA),
      imageTag: trimOptionalString(process.env.TCGER_BUILD_IMAGE_TAG),
      backendMode: trimOptionalString(process.env.BACKEND_MODE),
    },
    matcher: {
      phashVersion: PHASH_PIPELINE_VERSION,
      artworkVersion: ARTWORK_PIPELINE_VERSION,
      featureHashVersion: FEATURE_HASH_PIPELINE_VERSION,
      detectorModelVersion: trimOptionalString(process.env.CARD_SCAN_DETECTOR_MODEL_VERSION),
      ocrModelVersion: trimOptionalString(process.env.CARD_SCAN_OCR_MODEL_VERSION),
    },
    hashDatabase: {
      storeMode: getCardHashStoreMode(),
      dataset: hashRevision,
    },
    artworkDatabase: {
      dataset: artworkRevision,
    },
  };
}

async function writePreviewImage(
  input: Buffer,
  kind: string,
  cleanupPaths: string[],
): Promise<string> {
  const uploadDir = getCardScanDebugUploadDir();
  await mkdir(uploadDir, { recursive: true });

  const filename = `${randomUUID()}-${kind}.jpg`;
  const destinationPath = path.join(uploadDir, filename);
  const output = await sharp(input)
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toBuffer();

  await writeFile(destinationPath, output);
  cleanupPaths.push(destinationPath);
  return getCardScanDebugPublicPath(filename);
}

function resolveArtworkSpec(tcg: SupportedTcg) {
  const region = ARTWORK_REGIONS[tcg] ?? ARTWORK_REGIONS.pokemon;
  return {
    left: region.left,
    top: region.top,
    width: region.right - region.left,
    height: region.bottom - region.top,
  };
}

function resolveFeatureSpec(tcg: SupportedTcg, regionName: RegionName) {
  return FEATURE_REGION_SPECS[tcg].find((region) => region.name === regionName) ?? null;
}

export async function saveDebugCaptureDerivedImages(
  result: ScanResult,
  requestedTcg: string | undefined,
  cleanupPaths: string[],
): Promise<DebugDerivedImagePaths> {
  if (!result.debug) {
    return {
      correctedImagePath: null,
      artworkImagePath: null,
      titleImagePath: null,
      footerImagePath: null,
    };
  }

  const tcg = resolveCaptureTcg(result, requestedTcg);
  const selectedVariantImage = result.debug.artifacts.selectedVariantImage;

  const correctedImagePath = result.debug.artifacts.correctedSourceImage
    ? await writePreviewImage(
        await sharp(result.debug.artifacts.correctedSourceImage)
          .resize({ width: 768, height: 1080, fit: 'inside', withoutEnlargement: true })
          .toBuffer(),
        'corrected',
        cleanupPaths,
      )
    : null;

  const artworkBuffer = await extractNormalizedCardRegionBuffer(
    selectedVariantImage,
    resolveArtworkSpec(tcg),
    { resizeTo: 512, fit: 'inside', background: { r: 255, g: 255, b: 255, alpha: 1 } },
  );
  const artworkImagePath = artworkBuffer
    ? await writePreviewImage(artworkBuffer, 'artwork', cleanupPaths)
    : null;

  const titleSpec = resolveFeatureSpec(tcg, 'title');
  const footerSpec = resolveFeatureSpec(tcg, 'footer');
  const titleBuffer = titleSpec
    ? await extractNormalizedCardRegionBuffer(selectedVariantImage, titleSpec, {
        resizeTo: 512,
        fit: 'inside',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
    : null;
  const footerBuffer = footerSpec
    ? await extractNormalizedCardRegionBuffer(selectedVariantImage, footerSpec, {
        resizeTo: 512,
        fit: 'inside',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
    : null;

  const titleImagePath = titleBuffer
    ? await writePreviewImage(titleBuffer, 'title', cleanupPaths)
    : null;
  const footerImagePath = footerBuffer
    ? await writePreviewImage(footerBuffer, 'footer', cleanupPaths)
    : null;

  return {
    correctedImagePath,
    artworkImagePath,
    titleImagePath,
    footerImagePath,
  };
}
