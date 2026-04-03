import sharp from 'sharp';

/**
 * Normalize card images into a stable input for perceptual hashing.
 * The builder and runtime scan path must share the exact same preprocessing.
 */
export async function preprocessCardImage(imageBuffer: Buffer): Promise<Buffer> {
  return normalizeCardImage(imageBuffer);
}

const HASH_TARGET_SIZE = 1024;
const PERSPECTIVE_MAX_SIZE = 1200;
const MIN_CARD_AREA_RATIO = 0.08;
const TARGET_CARD_ASPECT_RATIO = 0.714;
const MAX_ASPECT_ERROR_RATIO = 0.3;
const cvBundlePath = require.resolve('@techstark/opencv-js/dist/opencv.js');
const cvModule = require(cvBundlePath) as typeof import('@techstark/opencv-js');
let cvWarmupPromise: Promise<void> | null = null;

export interface ScanRuntimeVariant {
  name: string;
  image: Buffer;
  perspectiveCorrected: boolean;
  rotated180: boolean;
}

export interface ScanQualityMetrics {
  score: number;
  focusVariance: number;
  edgeDensity: number;
  contrast: number;
}

export interface RuntimeScanPreparation {
  primaryVariant: ScanRuntimeVariant;
  variants: ScanRuntimeVariant[];
  quality: ScanQualityMetrics | null;
  perspectiveCorrection: {
    applied: boolean;
    contourAreaRatio: number | null;
  };
}

function debugScan(message: string, payload?: unknown): void {
  if (process.env.CARD_SCAN_DEBUG !== '1') {
    return;
  }

  if (payload === undefined) {
    console.log(`[card-scan] ${message}`);
    return;
  }

  console.log(`[card-scan] ${message}`, payload);
}

async function warmCvRuntime(): Promise<void> {
  if (!cvWarmupPromise) {
    cvWarmupPromise = new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await cvWarmupPromise;
}

async function normalizeCardImage(imageBuffer: Buffer): Promise<Buffer> {
  const image = sharp(imageBuffer).rotate();
  const metadata = await image.metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const isLandscape = width > height;

  let processed = isLandscape ? image.rotate(90) : image;

  // Remove camera-shot padding/background before hashing so slight framing
  // differences do not dominate the low-frequency signal.
  processed = processed.trim({ threshold: 10 });

  processed = processed.resize(HASH_TARGET_SIZE, HASH_TARGET_SIZE, {
    fit: 'contain',
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  });

  processed = processed.normalize();

  return processed.removeAlpha().toBuffer();
}

export async function prepareRuntimeScanImage(imageBuffer: Buffer): Promise<RuntimeScanPreparation> {
  debugScan('prepare:start');
  const corrected = await tryPerspectiveCorrectCard(imageBuffer);
  debugScan('prepare:corrected', corrected ? { contourAreaRatio: corrected.contourAreaRatio } : null);
  const baseImage = await preprocessCardImage(imageBuffer);
  debugScan('prepare:base-ready');
  const correctedImage = corrected ? await preprocessCardImage(corrected.buffer) : null;
  debugScan('prepare:corrected-ready', Boolean(correctedImage));
  const quality = await computeScanQuality(corrected?.buffer ?? imageBuffer);
  debugScan('prepare:quality', quality);

  const variants: ScanRuntimeVariant[] = [];

  if (correctedImage) {
    variants.push({
      name: 'corrected-upright',
      image: correctedImage,
      perspectiveCorrected: true,
      rotated180: false,
    });
  }

  variants.push({
    name: 'base-upright',
    image: baseImage,
    perspectiveCorrected: false,
    rotated180: false,
  });

  if (correctedImage) {
    variants.push({
      name: 'corrected-180',
      image: await rotateImage180(correctedImage),
      perspectiveCorrected: true,
      rotated180: true,
    });
  }

  variants.push({
    name: 'base-180',
    image: await rotateImage180(baseImage),
    perspectiveCorrected: false,
    rotated180: true,
  });

  const dedupedVariants = dedupeVariants(variants);

  return {
    primaryVariant: dedupedVariants[0],
    variants: dedupedVariants,
    quality,
    perspectiveCorrection: {
      applied: corrected !== null,
      contourAreaRatio: corrected?.contourAreaRatio ?? null,
    },
  };
}

async function rotateImage180(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer).rotate(180).toBuffer();
}

function dedupeVariants(variants: ScanRuntimeVariant[]): ScanRuntimeVariant[] {
  const deduped: ScanRuntimeVariant[] = [];

  for (const variant of variants) {
    if (!deduped.some((existing) => existing.image.equals(variant.image))) {
      deduped.push(variant);
    }
  }

  return deduped;
}

function normalizeScore(value: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }

  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

async function computeScanQuality(imageBuffer: Buffer): Promise<ScanQualityMetrics | null> {
  debugScan('quality:start');
  const { data, info } = await sharp(imageBuffer)
    .rotate()
    .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  await warmCvRuntime();

  const cv = cvModule;
  let src: InstanceType<typeof cv.Mat> | null = null;
  let gray: InstanceType<typeof cv.Mat> | null = null;
  let blurred: InstanceType<typeof cv.Mat> | null = null;
  let edges: InstanceType<typeof cv.Mat> | null = null;
  let laplacian: InstanceType<typeof cv.Mat> | null = null;
  let mean: InstanceType<typeof cv.Mat> | null = null;
  let stddev: InstanceType<typeof cv.Mat> | null = null;
  let laplacianMean: InstanceType<typeof cv.Mat> | null = null;
  let laplacianStd: InstanceType<typeof cv.Mat> | null = null;

  try {
    src = cv.matFromImageData({
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
    });
    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    laplacian = new cv.Mat();
    mean = new cv.Mat();
    stddev = new cv.Mat();
    laplacianMean = new cv.Mat();
    laplacianStd = new cv.Mat();
  } catch {
    debugScan('quality:no-cv');
    return null;
  }

  try {
    debugScan('quality:mats-ready');
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);
    cv.Canny(blurred, edges, 60, 180);
    cv.Laplacian(gray, laplacian, cv.CV_64F);

    cv.meanStdDev(gray, mean, stddev);
    cv.meanStdDev(laplacian, laplacianMean, laplacianStd);

    const totalPixels = Math.max(1, gray.rows * gray.cols);
    const edgeDensity = cv.countNonZero(edges) / totalPixels;
    const focusVariance = Math.pow(laplacianStd.data64F[0] ?? 0, 2);
    const contrast = stddev.data64F[0] ?? 0;

    const focusScore = normalizeScore(Math.log10(focusVariance + 1), 1.8, 3.8);
    const edgeScore = normalizeScore(edgeDensity, 0.01, 0.14);
    const contrastScore = normalizeScore(contrast, 25, 90);
    const score = 0.45 * focusScore + 0.35 * edgeScore + 0.2 * contrastScore;

    return {
      score,
      focusVariance,
      edgeDensity,
      contrast,
    };
  } finally {
    src?.delete();
    gray?.delete();
    blurred?.delete();
    edges?.delete();
    laplacian?.delete();
    mean?.delete();
    stddev?.delete();
    laplacianMean?.delete();
    laplacianStd?.delete();
  }
}

interface PerspectiveCorrectionResult {
  buffer: Buffer;
  contourAreaRatio: number;
}

async function tryPerspectiveCorrectCard(
  imageBuffer: Buffer
): Promise<PerspectiveCorrectionResult | null> {
  debugScan('perspective:start');
  const { data, info } = await sharp(imageBuffer)
    .rotate()
    .resize({
      width: PERSPECTIVE_MAX_SIZE,
      height: PERSPECTIVE_MAX_SIZE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  debugScan('perspective:buffer-ready', { width: info.width, height: info.height });
  await warmCvRuntime();

  const cv = cvModule;
  let src: InstanceType<typeof cv.Mat> | null = null;
  let gray: InstanceType<typeof cv.Mat> | null = null;
  let blurred: InstanceType<typeof cv.Mat> | null = null;
  let edges: InstanceType<typeof cv.Mat> | null = null;
  let contours: InstanceType<typeof cv.MatVector> | null = null;
  let hierarchy: InstanceType<typeof cv.Mat> | null = null;
  let kernel: InstanceType<typeof cv.Mat> | null = null;

  try {
    src = cv.matFromImageData({
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
    });
    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  } catch {
    debugScan('perspective:no-cv');
    return null;
  }

  try {
    debugScan('perspective:mats-ready');
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 60, 180);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const bestCandidate = findBestCardQuadrilateral(cv, contours, info.width * info.height);
    debugScan('perspective:candidate', bestCandidate);
    if (!bestCandidate) {
      return null;
    }

    const srcPoints = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      bestCandidate.points.flatMap((point) => [point.x, point.y])
    );
    const dstPoints = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      [
        0,
        0,
        bestCandidate.width - 1,
        0,
        bestCandidate.width - 1,
        bestCandidate.height - 1,
        0,
        bestCandidate.height - 1,
      ]
    );
    const transform = cv.getPerspectiveTransform(srcPoints, dstPoints);
    const warped = new cv.Mat();
    const rgb = new cv.Mat();

    try {
      debugScan('perspective:warp-start');
      cv.warpPerspective(
        src,
        warped,
        transform,
        new cv.Size(bestCandidate.width, bestCandidate.height),
        cv.INTER_LINEAR,
        cv.BORDER_REPLICATE,
        new cv.Scalar()
      );

      cv.cvtColor(warped, rgb, cv.COLOR_RGBA2RGB);

      const buffer = await sharp(Buffer.from(rgb.data), {
        raw: {
          width: rgb.cols,
          height: rgb.rows,
          channels: 3,
        },
      }).png().toBuffer();

      return {
        buffer,
        contourAreaRatio: bestCandidate.areaRatio,
      };
    } finally {
      srcPoints.delete();
      dstPoints.delete();
      transform.delete();
      warped.delete();
      rgb.delete();
    }
  } finally {
    src?.delete();
    gray?.delete();
    blurred?.delete();
    edges?.delete();
    contours?.delete();
    hierarchy?.delete();
    kernel?.delete();
  }
}

interface CardPoint {
  x: number;
  y: number;
}

interface CardQuadrilateral {
  points: CardPoint[];
  width: number;
  height: number;
  areaRatio: number;
  score: number;
}

function findBestCardQuadrilateral(
  cv: typeof import('@techstark/opencv-js'),
  contours: InstanceType<typeof import('@techstark/opencv-js')['MatVector']>,
  imageArea: number
): CardQuadrilateral | null {
  let bestCandidate: CardQuadrilateral | null = null;

  for (let index = 0; index < contours.size(); index++) {
    const contour = contours.get(index);
    const perimeter = cv.arcLength(contour, true);
    const approx = new cv.Mat();

    try {
      cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
      if (approx.rows !== 4) {
        continue;
      }

      const ordered = orderQuadrilateralPoints(Array.from(approx.data32S));
      const width = Math.round(
        Math.max(distanceBetween(ordered[0], ordered[1]), distanceBetween(ordered[2], ordered[3]))
      );
      const height = Math.round(
        Math.max(distanceBetween(ordered[0], ordered[3]), distanceBetween(ordered[1], ordered[2]))
      );

      if (width < 120 || height < 160) {
        continue;
      }

      const aspectRatio = width / Math.max(1, height);
      const aspectError = Math.abs(aspectRatio - TARGET_CARD_ASPECT_RATIO) / TARGET_CARD_ASPECT_RATIO;
      if (aspectError > MAX_ASPECT_ERROR_RATIO) {
        continue;
      }

      const area = cv.contourArea(approx);
      const areaRatio = area / Math.max(1, imageArea);
      if (areaRatio < MIN_CARD_AREA_RATIO) {
        continue;
      }

      const score = areaRatio * 2 + (1 - Math.min(1, aspectError));
      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = {
          points: ordered,
          width,
          height,
          areaRatio,
          score,
        };
      }
    } finally {
      approx.delete();
      contour.delete();
    }
  }

  return bestCandidate;
}

function orderQuadrilateralPoints(points: number[]): CardPoint[] {
  const cardPoints: CardPoint[] = [];
  for (let index = 0; index < points.length; index += 2) {
    cardPoints.push({ x: points[index] ?? 0, y: points[index + 1] ?? 0 });
  }

  const sums = cardPoints.map((point) => point.x + point.y);
  const diffs = cardPoints.map((point) => point.x - point.y);

  const topLeft = cardPoints[sums.indexOf(Math.min(...sums))];
  const bottomRight = cardPoints[sums.indexOf(Math.max(...sums))];
  const topRight = cardPoints[diffs.indexOf(Math.max(...diffs))];
  const bottomLeft = cardPoints[diffs.indexOf(Math.min(...diffs))];

  return [topLeft, topRight, bottomRight, bottomLeft];
}

function distanceBetween(a: CardPoint, b: CardPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
