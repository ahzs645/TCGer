/**
 * Card quad refinement + perspective rectification (pure TS, no OpenCV).
 *
 * KEEP IN SYNC with backend/src/scripts/card-rectify.ts (same file, used by
 * the offline benchmark harness — parity is what makes benchmark numbers
 * transfer to the browser).
 *
 * The standard card-scanner practice (see docs/scanner-model-ai-handoff.md,
 * "what people do online"): find the card's four corners inside the detector
 * box and warpPerspective to a flat bird's-eye card before matching, because
 * the reference index is built from flat scans. A YOLO OBB is only a rotated
 * rectangle — it cannot express foreshortening, and the axis-aligned crop the
 * harness used before this module also included background (measured cost on
 * the Sinnoh video: Chinchou 0.715 from the box crop vs 0.784 from a tight
 * crop — the difference between missed and identified).
 *
 * Pipeline per detection:
 *   1. Take a padded crop around the detector box (source resolution).
 *   2. Sobel gradient magnitude on grayscale.
 *   3. Scan inward from each side; the first strong edge per scanline is a
 *      border-point candidate. Robust-fit a line per side (two rounds of
 *      median-residual outlier rejection).
 *   4. Intersect the four lines -> corners; sanity-check convexity/area.
 *   5. Homography (DLT via Gaussian elimination) quad -> card rectangle,
 *      bilinear sampling.
 *
 * Falls back to null when the quad looks wrong — callers keep the plain crop.
 */

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/** Pokémon/Magic/Yu-Gi-Oh cards are ~63x88mm. */
const CARD_ASPECT = 88 / 63;
const TARGET_WIDTH = 480;

// ---------- grayscale + gradient ----------

function toGray(image: RgbaImage): Float32Array {
  const { data, width, height } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] =
      0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  }
  return gray;
}

function sobelMagnitude(gray: Float32Array, width: number, height: number): Float32Array {
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -gray[i - width - 1]! - 2 * gray[i - 1]! - gray[i + width - 1]! +
        gray[i - width + 1]! + 2 * gray[i + 1]! + gray[i + width + 1]!;
      const gy =
        -gray[i - width - 1]! - 2 * gray[i - width]! - gray[i - width + 1]! +
        gray[i + width - 1]! + 2 * gray[i + width]! + gray[i + width + 1]!;
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

// ---------- border-point collection ----------

type Side = 'left' | 'right' | 'top' | 'bottom';

function collectEdgePoints(
  mag: Float32Array,
  width: number,
  height: number,
  side: Side,
): Point[] {
  const points: Point[] = [];
  const horizontal = side === 'left' || side === 'right';
  const lanes = horizontal ? height : width;
  const depth = horizontal ? width : height;
  const maxDepth = Math.floor(depth * 0.5);

  for (let lane = Math.floor(lanes * 0.12); lane < lanes * 0.88; lane += 2) {
    // Per-lane adaptive threshold from the scan range.
    let laneMax = 0;
    for (let d = 1; d < maxDepth; d++) {
      const [x, y] = coord(side, lane, d, width, height);
      laneMax = Math.max(laneMax, mag[y * width + x]!);
    }
    if (laneMax < 40) continue; // featureless lane
    const threshold = laneMax * 0.35;
    for (let d = 2; d < maxDepth; d++) {
      const [x, y] = coord(side, lane, d, width, height);
      if (mag[y * width + x]! >= threshold) {
        points.push({ x, y });
        break;
      }
    }
  }
  return points;
}

function coord(
  side: Side,
  lane: number,
  depth: number,
  width: number,
  height: number,
): [number, number] {
  switch (side) {
    case 'left':
      return [depth, lane];
    case 'right':
      return [width - 1 - depth, lane];
    case 'top':
      return [lane, depth];
    case 'bottom':
      return [lane, height - 1 - depth];
  }
}

// ---------- robust line fit ----------

/** Line as ax + by = c with (a, b) unit-norm. */
interface Line {
  a: number;
  b: number;
  c: number;
}

/**
 * RANSAC line fit. Median-residual rejection is not enough here: fingers
 * holding the card produce a CONTIGUOUS block of wrong edge points that can
 * dominate a least-squares fit (observed: the right edge fit slanting onto a
 * finger, clipping the warp). RANSAC finds the card edge as the line with the
 * most inliers; an angle constraint keeps it near the expected orientation.
 */
function fitLine(points: Point[], vertical: boolean): Line | null {
  if (points.length < 10) return null;

  const MAX_SKEW = Math.tan((30 * Math.PI) / 180);
  const INLIER_DISTANCE = 4;
  let bestInliers: Point[] = [];

  for (let iter = 0; iter < 300; iter++) {
    const p = points[Math.floor(Math.random() * points.length)]!;
    const q = points[Math.floor(Math.random() * points.length)]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
    // Orientation constraint: a card edge is near-vertical / near-horizontal.
    if (vertical) {
      if (Math.abs(dy) < 1e-6 || Math.abs(dx / dy) > MAX_SKEW) continue;
    } else if (Math.abs(dx) < 1e-6 || Math.abs(dy / dx) > MAX_SKEW) {
      continue;
    }
    const norm = Math.hypot(dy, dx);
    const a = dy / norm;
    const b = -dx / norm;
    const c = a * p.x + b * p.y;
    const inliers = points.filter(
      (r) => Math.abs(a * r.x + b * r.y - c) <= INLIER_DISTANCE,
    );
    if (inliers.length > bestInliers.length) bestInliers = inliers;
  }

  if (bestInliers.length < Math.max(10, points.length * 0.3)) return null;
  return leastSquares(bestInliers, vertical);
}

function leastSquares(points: Point[], vertical: boolean): Line {
  // Fit the coordinate that varies little as a function of the other.
  const n = points.length;
  let su = 0;
  let sv = 0;
  let suu = 0;
  let suv = 0;
  for (const p of points) {
    const u = vertical ? p.y : p.x;
    const v = vertical ? p.x : p.y;
    su += u;
    sv += v;
    suu += u * u;
    suv += u * v;
  }
  const denom = n * suu - su * su;
  const slope = Math.abs(denom) < 1e-9 ? 0 : (n * suv - su * sv) / denom;
  const intercept = (sv - slope * su) / n;
  // v = slope*u + intercept  ->  for vertical: x - slope*y = intercept
  if (vertical) {
    const norm = Math.hypot(1, slope);
    return { a: 1 / norm, b: -slope / norm, c: intercept / norm };
  }
  const norm = Math.hypot(slope, 1);
  return { a: -slope / norm, b: 1 / norm, c: intercept / norm };
}

function intersect(l1: Line, l2: Line): Point | null {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (l1.c * l2.b - l2.c * l1.b) / det,
    y: (l1.a * l2.c - l2.a * l1.c) / det,
  };
}

// ---------- quad detection ----------

/** Detector box in padded-crop coordinates, used as per-side fallback. */
export interface FallbackRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Refine the card's quad inside a padded crop. Returns null when unsure.
 *
 * A side that cannot be fit (typically occluded by the holder's fingers)
 * falls back to the detector-box edge for that side when `fallbackRect` is
 * given — three fitted edges still correct most of the geometry. At most one
 * side may fall back; two or more unknown sides means the quad is guesswork.
 */
export function detectCardQuad(
  image: RgbaImage,
  fallbackRect?: FallbackRect,
  debug = false,
): Point[] | null {
  const { width, height } = image;
  const gray = toGray(image);
  const mag = sobelMagnitude(gray, width, height);

  const sides: Array<[Side, boolean]> = [
    ['left', true],
    ['right', true],
    ['top', false],
    ['bottom', false],
  ];
  const lines: Record<string, Line | null> = {};
  let fallbacks = 0;
  for (const [side, vertical] of sides) {
    const pts = collectEdgePoints(mag, width, height, side);
    let line = fitLine(pts, vertical);
    if (!line && fallbackRect) {
      fallbacks += 1;
      line = vertical
        ? { a: 1, b: 0, c: side === 'left' ? fallbackRect.left : fallbackRect.right }
        : { a: 0, b: 1, c: side === 'top' ? fallbackRect.top : fallbackRect.bottom };
    }
    lines[side] = line;
    if (debug) {
      console.log(`  [rectify] ${side}: points=${pts.length} fit=${line ? 'ok' : 'FAIL'}`);
    }
  }
  if (fallbacks > 1) return null;
  const left = lines.left;
  const right = lines.right;
  const top = lines.top;
  const bottom = lines.bottom;
  if (!left || !right || !top || !bottom) return null;

  const tl = intersect(left, top);
  const tr = intersect(right, top);
  const br = intersect(right, bottom);
  const bl = intersect(left, bottom);
  if (!tl || !tr || !br || !bl) return null;

  const quad = [tl, tr, br, bl];
  // Sanity: all corners inside (slightly padded) bounds.
  for (const p of quad) {
    if (p.x < -width * 0.05 || p.x > width * 1.05) return null;
    if (p.y < -height * 0.05 || p.y > height * 1.05) return null;
  }
  // Sanity: convex and card-like area vs the crop.
  const area = polygonArea(quad);
  if (area < width * height * 0.35 || area > width * height * 1.02) return null;
  if (!isConvex(quad)) return null;

  return quad;
}

function polygonArea(quad: Point[]): number {
  let area = 0;
  for (let i = 0; i < quad.length; i++) {
    const p = quad[i]!;
    const q = quad[(i + 1) % quad.length]!;
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

function isConvex(quad: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i]!;
    const q = quad[(i + 1) % 4]!;
    const r = quad[(i + 2) % 4]!;
    const cross = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// ---------- homography + warp ----------

/** Solve the 8-DOF homography mapping the unit target rect to the quad (DLT). */
function homographyToQuad(quad: Point[], targetW: number, targetH: number): number[] | null {
  const src: Point[] = [
    { x: 0, y: 0 },
    { x: targetW, y: 0 },
    { x: targetW, y: targetH },
    { x: 0, y: targetH },
  ];
  // 8 unknowns h11..h32 with h33 = 1.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const s = src[i]!;
    const d = quad[i]!;
    A.push([s.x, s.y, 1, 0, 0, 0, -s.x * d.x, -s.y * d.x]);
    b.push(d.x);
    A.push([0, 0, 0, s.x, s.y, 1, -s.x * d.y, -s.y * d.y]);
    b.push(d.y);
  }
  return solve8(A, b);
}

function solve8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const m = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-9) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = m[row]![col]! / m[col]![col]!;
      for (let k = col; k <= n; k++) m[row]![k]! -= f * m[col]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / m[i]![i]!);
}

/**
 * Warp the quad region of `image` into a flat card rectangle
 * (TARGET_WIDTH x card aspect) with bilinear sampling.
 */
export function warpQuadToCard(image: RgbaImage, quad: Point[]): RgbaImage | null {
  const targetW = TARGET_WIDTH;
  const targetH = Math.round(TARGET_WIDTH * CARD_ASPECT);
  const h = homographyToQuad(quad, targetW, targetH);
  if (!h) return null;

  const { data, width, height } = image;
  const out = new Uint8ClampedArray(targetW * targetH * 4);

  for (let ty = 0; ty < targetH; ty++) {
    for (let tx = 0; tx < targetW; tx++) {
      const w = h[6]! * tx + h[7]! * ty + 1;
      const sx = (h[0]! * tx + h[1]! * ty + h[2]!) / w;
      const sy = (h[3]! * tx + h[4]! * ty + h[5]!) / w;
      const o = (ty * targetW + tx) * 4;
      if (sx < 0 || sy < 0 || sx > width - 2 || sy > height - 2) {
        out[o + 3] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * width + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + width * 4;
      const i11 = i01 + 4;
      for (let ch = 0; ch < 3; ch++) {
        out[o + ch] =
          data[i00 + ch]! * (1 - fx) * (1 - fy) +
          data[i10 + ch]! * fx * (1 - fy) +
          data[i01 + ch]! * (1 - fx) * fy +
          data[i11 + ch]! * fx * fy;
      }
      out[o + 3] = 255;
    }
  }

  return { data: out, width: targetW, height: targetH };
}

export interface RectifyResult {
  image: RgbaImage;
  method: 'quad' | 'none';
}

/**
 * Full rectification: detect the card quad in a padded crop and warp it flat.
 * Returns the original image with method 'none' when detection fails — the
 * caller's behavior is then identical to the pre-rectification pipeline.
 */
export function rectifyCardCrop(image: RgbaImage, fallbackRect?: FallbackRect): RectifyResult {
  const quad = detectCardQuad(image, fallbackRect);
  if (!quad) return { image, method: 'none' };
  const warped = warpQuadToCard(image, quad);
  if (!warped) return { image, method: 'none' };
  return { image: warped, method: 'quad' };
}
