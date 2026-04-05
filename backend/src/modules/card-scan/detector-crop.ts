import sharp from 'sharp';
import { createHash } from 'node:crypto';

import { computeScanQuality } from './preprocess';
import { createRequire } from 'node:module';

export interface CardPoint {
  x: number;
  y: number;
}

export interface DetectorCropVariant {
  name: string;
  image: Buffer;
}

export interface DetectorCropResult {
  variants: DetectorCropVariant[];
  quality: Awaited<ReturnType<typeof computeScanQuality>> | null;
}

const localRequire = createRequire(__filename);
let cvModule: typeof import('@techstark/opencv-js') | null | undefined;
let cvWarmupPromise: Promise<void> | null = null;

function getCvModule(): typeof import('@techstark/opencv-js') | null {
  if (cvModule !== undefined) {
    return cvModule;
  }

  try {
    cvModule = localRequire('@techstark/opencv-js') as typeof import('@techstark/opencv-js');
  } catch {
    cvModule = null;
  }

  return cvModule;
}

async function warmCvRuntime(): Promise<boolean> {
  if (!getCvModule()) {
    return false;
  }

  if (!cvWarmupPromise) {
    cvWarmupPromise = new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await cvWarmupPromise;
  return true;
}

export function orderQuadrilateralPoints(points: CardPoint[]): CardPoint[] {
  const sums = points.map((point) => point.x + point.y);
  const diffs = points.map((point) => point.x - point.y);

  const topLeft = points[sums.indexOf(Math.min(...sums))] ?? points[0]!;
  const bottomRight = points[sums.indexOf(Math.max(...sums))] ?? points[2]!;
  const topRight = points[diffs.indexOf(Math.max(...diffs))] ?? points[1]!;
  const bottomLeft = points[diffs.indexOf(Math.min(...diffs))] ?? points[3]!;

  return [topLeft, topRight, bottomRight, bottomLeft];
}

export function polygonToPoints(polygon: number[][]): CardPoint[] {
  return polygon.slice(0, 4).map(([x = 0, y = 0]) => ({ x, y }));
}

function distanceBetween(left: CardPoint, right: CardPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function averagePoint(points: CardPoint[]): CardPoint {
  const total = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );

  return {
    x: total.x / Math.max(1, points.length),
    y: total.y / Math.max(1, points.length),
  };
}

function expandQuadrilateral(points: CardPoint[], fraction: number): CardPoint[] {
  if (fraction <= 0) {
    return points.map((point) => ({ ...point }));
  }

  const center = averagePoint(points);
  const scale = 1 + fraction;
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale,
  }));
}

async function rotateSource(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer).rotate().png().toBuffer();
}

async function createRgbaSource(
  imageBuffer: Buffer
): Promise<{
  buffer: Buffer;
  data: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  const rotated = await rotateSource(imageBuffer);
  const { data, info } = await sharp(rotated)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: rotated,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function cropAxisAligned(
  imageBuffer: Buffer,
  points: CardPoint[],
  paddingFraction = 0.08
): Promise<Buffer | null> {
  const ordered = orderQuadrilateralPoints(points);
  const xs = ordered.map((point) => point.x);
  const ys = ordered.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const width = right - left;
  const height = bottom - top;
  const padX = Math.round(width * paddingFraction);
  const padY = Math.round(height * paddingFraction);

  const metadata = await sharp(imageBuffer).rotate().metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;

  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const extractLeft = clamp(Math.floor(left - padX), 0, sourceWidth - 1);
  const extractTop = clamp(Math.floor(top - padY), 0, sourceHeight - 1);
  const extractRight = clamp(Math.ceil(right + padX), extractLeft + 1, sourceWidth);
  const extractBottom = clamp(Math.ceil(bottom + padY), extractTop + 1, sourceHeight);

  return sharp(await rotateSource(imageBuffer))
    .extract({
      left: extractLeft,
      top: extractTop,
      width: extractRight - extractLeft,
      height: extractBottom - extractTop,
    })
    .jpeg({ quality: 95 })
    .toBuffer();
}

export async function cropRotatedDetectorCard(
  imageBuffer: Buffer,
  points: CardPoint[],
  paddingFraction = 0.08
): Promise<Buffer | null> {
  if (!(await warmCvRuntime())) {
    return null;
  }

  const cv = getCvModule();
  if (!cv) {
    return null;
  }

  const source = await createRgbaSource(imageBuffer);
  const ordered = orderQuadrilateralPoints(points);
  const width =
    Math.max(distanceBetween(ordered[0], ordered[1]), distanceBetween(ordered[2], ordered[3])) *
    (1 + paddingFraction);
  const height =
    Math.max(distanceBetween(ordered[0], ordered[3]), distanceBetween(ordered[1], ordered[2])) *
    (1 + paddingFraction);
  const center = averagePoint(ordered);
  const angleRadians = Math.atan2(ordered[1].y - ordered[0].y, ordered[1].x - ordered[0].x);
  const angleDegrees = (-angleRadians * 180) / Math.PI;

  let src: InstanceType<typeof cv.Mat> | null = null;
  let rotated: InstanceType<typeof cv.Mat> | null = null;
  let rgb: InstanceType<typeof cv.Mat> | null = null;
  let matrix: InstanceType<typeof cv.Mat> | null = null;

  try {
    src = cv.matFromArray(source.height, source.width, cv.CV_8UC4, source.data);
    rotated = new cv.Mat();
    matrix = cv.getRotationMatrix2D(new cv.Point(center.x, center.y), angleDegrees, 1);

    cv.warpAffine(
      src,
      rotated,
      matrix,
      new cv.Size(source.width, source.height),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
      new cv.Scalar()
    );

    const left = clamp(Math.round(center.x - width / 2), 0, source.width - 1);
    const top = clamp(Math.round(center.y - height / 2), 0, source.height - 1);
    const cropWidth = clamp(Math.round(width), 1, source.width - left);
    const cropHeight = clamp(Math.round(height), 1, source.height - top);
    const roi = rotated.roi(new cv.Rect(left, top, cropWidth, cropHeight));
    rgb = new cv.Mat();

    try {
      cv.cvtColor(roi, rgb, cv.COLOR_RGBA2RGB);
      return sharp(Buffer.from(rgb.data), {
        raw: {
          width: rgb.cols,
          height: rgb.rows,
          channels: 3,
        },
      })
        .png()
        .toBuffer();
    } finally {
      roi.delete();
    }
  } finally {
    src?.delete();
    rotated?.delete();
    rgb?.delete();
    matrix?.delete();
  }
}

export async function warpDetectorQuadrilateral(
  imageBuffer: Buffer,
  points: CardPoint[],
  paddingFraction = 0.08
): Promise<Buffer | null> {
  if (!(await warmCvRuntime())) {
    return null;
  }

  const cv = getCvModule();
  if (!cv) {
    return null;
  }

  const source = await createRgbaSource(imageBuffer);
  const expanded = expandQuadrilateral(orderQuadrilateralPoints(points), paddingFraction);
  const width = Math.max(
    distanceBetween(expanded[0], expanded[1]),
    distanceBetween(expanded[2], expanded[3])
  );
  const height = Math.max(
    distanceBetween(expanded[0], expanded[3]),
    distanceBetween(expanded[1], expanded[2])
  );

  if (width < 32 || height < 32) {
    return null;
  }

  let src: InstanceType<typeof cv.Mat> | null = null;
  let warped: InstanceType<typeof cv.Mat> | null = null;
  let rgb: InstanceType<typeof cv.Mat> | null = null;
  let srcPoints: InstanceType<typeof cv.Mat> | null = null;
  let dstPoints: InstanceType<typeof cv.Mat> | null = null;
  let transform: InstanceType<typeof cv.Mat> | null = null;

  try {
    src = cv.matFromArray(source.height, source.width, cv.CV_8UC4, source.data);
    srcPoints = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      expanded.flatMap((point) => [point.x, point.y])
    );
    dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
    transform = cv.getPerspectiveTransform(srcPoints, dstPoints);
    warped = new cv.Mat();
    rgb = new cv.Mat();

    cv.warpPerspective(
      src,
      warped,
      transform,
      new cv.Size(Math.round(width), Math.round(height)),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
      new cv.Scalar()
    );
    cv.cvtColor(warped, rgb, cv.COLOR_RGBA2RGB);

    return sharp(Buffer.from(rgb.data), {
      raw: {
        width: rgb.cols,
        height: rgb.rows,
        channels: 3,
      },
    })
      .png()
      .toBuffer();
  } finally {
    src?.delete();
    warped?.delete();
    rgb?.delete();
    srcPoints?.delete();
    dstPoints?.delete();
    transform?.delete();
  }
}

export async function buildDetectorCropVariants(
  imageBuffer: Buffer,
  polygon: number[][]
): Promise<DetectorCropResult> {
  const points = polygonToPoints(polygon);
  const variants: DetectorCropVariant[] = [];
  const seen = new Set<string>();

  const pushVariant = (name: string, image: Buffer | null) => {
    if (!image) {
      return;
    }

    const signature = createHash('sha1').update(image).digest('hex');
    if (seen.has(signature)) {
      return;
    }

    seen.add(signature);
    variants.push({ name, image });
  };

  pushVariant('bbox-pad-8', await cropAxisAligned(imageBuffer, points, 0.08));
  pushVariant('rotate-pad-8', await cropRotatedDetectorCard(imageBuffer, points, 0.08));
  pushVariant('rotate-pad-14', await cropRotatedDetectorCard(imageBuffer, points, 0.14));
  pushVariant('warp-pad-8', await warpDetectorQuadrilateral(imageBuffer, points, 0.08));
  pushVariant('warp-pad-14', await warpDetectorQuadrilateral(imageBuffer, points, 0.14));

  let bestQuality: Awaited<ReturnType<typeof computeScanQuality>> | null = null;
  for (const variant of variants) {
    const quality = await computeScanQuality(variant.image);
    if (!quality) {
      continue;
    }

    if (!bestQuality || quality.score > bestQuality.score) {
      bestQuality = quality;
    }
  }

  return {
    variants,
    quality: bestQuality,
  };
}
