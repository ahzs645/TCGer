import { getContext2d } from "./canvas-utils";
import { CARD_ASPECT_RATIO } from "./proposal-windows";
import { warpCanvasFromQuad } from "./quad-warp";
import type {
  CanvasBoundaryRefinement,
  ImageDataLike,
  ProposalBoundaryRefinement,
  VideoQuad,
  VideoQuadPoint,
} from "./scan-types";

const BORDER_SCAN_BAND_RATIO = 0.38;
const BORDER_SCAN_STEP = 2;
const MIN_BORDER_POINTS = 8;
const MIN_BORDER_SCORE = 12;
const MAX_QUAD_ASPECT_ERROR = 0.24;
const MIN_QUAD_AREA_RATIO = 0.14;
const MAX_QUAD_AREA_RATIO = 1.15;
const QUAD_BOUNDARY_MARGIN_RATIO = 0.32;
const EDGE_TOUCH_TOLERANCE = 5;
const EDGE_ANCHORED_RATIO = 0.58;
const MAX_VERTICAL_LINE_SLOPE = 0.68;
const MAX_HORIZONTAL_LINE_SLOPE = 0.55;

interface BorderSamplePoint extends VideoQuadPoint {
  score: number;
}

interface FittedBorderLine {
  side: "left" | "right" | "top" | "bottom";
  points: [VideoQuadPoint, VideoQuadPoint];
  support: number;
  edgeTouchRatio: number;
  isEdgeAnchored: boolean;
}

interface QuadBoundaryStats {
  outsidePoints: number;
  edgeTouchPoints: number;
}

interface ScoredBoundaryCandidate extends ProposalBoundaryRefinement {
  score: number;
  aspectError: number;
}

export function refineProposalCanvas(
  sourceCanvas: HTMLCanvasElement,
): CanvasBoundaryRefinement | null {
  const context = getContext2d(sourceCanvas);
  const imageData = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const refinement = refineCardQuadInImageData(imageData);
  if (!refinement) {
    return null;
  }

  return {
    ...refinement,
    warpedCanvas: warpCanvasFromQuad(sourceCanvas, refinement.quad),
  };
}

export function refineCardQuadInImageData(
  imageData: ImageDataLike,
): ProposalBoundaryRefinement | null {
  if (imageData.width < 80 || imageData.height < 120) {
    return null;
  }

  const gradients = computeGradientMaps(imageData);
  const left = fitBorderLine(
    "left",
    collectBorderPoints(gradients, "left"),
    imageData.width,
    imageData.height,
  );
  const right = fitBorderLine(
    "right",
    collectBorderPoints(gradients, "right"),
    imageData.width,
    imageData.height,
  );
  const top = fitBorderLine(
    "top",
    collectBorderPoints(gradients, "top"),
    imageData.width,
    imageData.height,
  );
  const bottom = fitBorderLine(
    "bottom",
    collectBorderPoints(gradients, "bottom"),
    imageData.width,
    imageData.height,
  );

  const candidates: ScoredBoundaryCandidate[] = [];

  pushCandidate(
    candidates,
    "observed",
    left && right && top && bottom ? buildObservedQuad(left, right, top, bottom) : null,
    [left, right, top, bottom],
    0,
    imageData.width,
    imageData.height,
  );
  pushCandidate(
    candidates,
    "inferred-right",
    left && top && bottom ? inferRightQuad(left, top, bottom) : null,
    [left, top, bottom],
    24,
    imageData.width,
    imageData.height,
  );
  pushCandidate(
    candidates,
    "inferred-left",
    right && top && bottom ? inferLeftQuad(right, top, bottom) : null,
    [right, top, bottom],
    24,
    imageData.width,
    imageData.height,
  );
  pushCandidate(
    candidates,
    "inferred-bottom",
    left && right && top ? inferBottomQuad(left, right, top) : null,
    [left, right, top],
    14,
    imageData.width,
    imageData.height,
  );
  pushCandidate(
    candidates,
    "inferred-top",
    left && right && bottom ? inferTopQuad(left, right, bottom) : null,
    [left, right, bottom],
    14,
    imageData.width,
    imageData.height,
  );

  candidates.sort((leftCandidate, rightCandidate) => {
    return (
      rightCandidate.score - leftCandidate.score ||
      Number(leftCandidate.isClipped) - Number(rightCandidate.isClipped) ||
      leftCandidate.aspectError - rightCandidate.aspectError
    );
  });

  return candidates[0] ?? null;
}

function pushCandidate(
  candidates: ScoredBoundaryCandidate[],
  method: string,
  quad: VideoQuad | null,
  lines: Array<FittedBorderLine | null>,
  bonus: number,
  width: number,
  height: number,
): void {
  const presentLines = lines.filter(Boolean) as FittedBorderLine[];
  if (!quad || presentLines.length < 3 || !isValidQuad(quad, width, height)) {
    return;
  }

  const boundaryStats = getQuadBoundaryStats(quad, width, height);
  const edgeAnchoredCount = presentLines.filter((line) => line.isEdgeAnchored).length;
  const isClipped =
    edgeAnchoredCount > 0 ||
    boundaryStats.outsidePoints > 0 ||
    boundaryStats.edgeTouchPoints > 0;
  const edgePenalty =
    (method === "observed" ? 95 : 48) * edgeAnchoredCount +
    boundaryStats.outsidePoints * 14 +
    Math.max(0, boundaryStats.edgeTouchPoints - edgeAnchoredCount) * 6;

  candidates.push({
    quad,
    method,
    isClipped,
    aspectError: getQuadAspectError(quad),
    score: lineSupport(...presentLines) + bonus - edgePenalty,
  });
}

function computeGradientMaps(imageData: ImageDataLike): {
  width: number;
  height: number;
  verticalScores: Float32Array;
  horizontalScores: Float32Array;
} {
  const { width, height, data } = imageData;
  const pixelCount = width * height;

  // 1. Convert to luma
  const rawLuma = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const dataIndex = index * 4;
    const r = Number(data[dataIndex] ?? 0);
    const g = Number(data[dataIndex + 1] ?? 0);
    const b = Number(data[dataIndex + 2] ?? 0);
    rawLuma[index] = r * 0.299 + g * 0.587 + b * 0.114;
  }

  // 2. Gaussian blur (5x5, sigma ≈ 1.0) — suppresses noise before gradients
  const luma = gaussianBlur5x5(rawLuma, width, height);

  // 3. Sobel gradients (3x3 kernel, stronger than simple differences)
  const gx = new Float32Array(pixelCount);
  const gy = new Float32Array(pixelCount);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      // Sobel X: [-1 0 1; -2 0 2; -1 0 1]
      gx[index] =
        -(luma[index - width - 1] ?? 0) +
        (luma[index - width + 1] ?? 0) -
        2 * (luma[index - 1] ?? 0) +
        2 * (luma[index + 1] ?? 0) -
        (luma[index + width - 1] ?? 0) +
        (luma[index + width + 1] ?? 0);
      // Sobel Y: [-1 -2 -1; 0 0 0; 1 2 1]
      gy[index] =
        -(luma[index - width - 1] ?? 0) -
        2 * (luma[index - width] ?? 0) -
        (luma[index - width + 1] ?? 0) +
        (luma[index + width - 1] ?? 0) +
        2 * (luma[index + width] ?? 0) +
        (luma[index + width + 1] ?? 0);
    }
  }

  // 4. Compute directional edge scores with non-maximum suppression.
  //    NMS thins edges to 1px along the gradient direction.
  const verticalScores = new Float32Array(pixelCount);
  const horizontalScores = new Float32Array(pixelCount);

  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const index = y * width + x;
      const absGx = Math.abs(gx[index]!);
      const absGy = Math.abs(gy[index]!);

      // Vertical edge score (strong horizontal gradient)
      const vScore = Math.max(0, absGx - absGy * 0.35);
      if (vScore > 0) {
        // NMS: suppress if not a local max horizontally
        const left = Math.max(0, Math.abs(gx[index - 1]!) - Math.abs(gy[index - 1]!) * 0.35);
        const right = Math.max(0, Math.abs(gx[index + 1]!) - Math.abs(gy[index + 1]!) * 0.35);
        verticalScores[index] = vScore >= left && vScore >= right ? vScore : 0;
      }

      // Horizontal edge score (strong vertical gradient)
      const hScore = Math.max(0, absGy - absGx * 0.35);
      if (hScore > 0) {
        // NMS: suppress if not a local max vertically
        const above = Math.max(0, Math.abs(gy[index - width]!) - Math.abs(gx[index - width]!) * 0.35);
        const below = Math.max(0, Math.abs(gy[index + width]!) - Math.abs(gx[index + width]!) * 0.35);
        horizontalScores[index] = hScore >= above && hScore >= below ? hScore : 0;
      }
    }
  }

  return {
    width,
    height,
    verticalScores,
    horizontalScores,
  };
}

/**
 * 5x5 Gaussian blur (sigma ≈ 1.0).
 * Kernel: [1 4 6 4 1] / 256 (separable, applied as two 1D passes).
 */
function gaussianBlur5x5(
  input: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const temp = new Float32Array(input.length);
  const output = new Float32Array(input.length);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const x0 = Math.max(0, x - 2);
      const x1 = Math.max(0, x - 1);
      const x3 = Math.min(width - 1, x + 1);
      const x4 = Math.min(width - 1, x + 2);
      temp[index] =
        (input[y * width + x0]! * 1 +
          input[y * width + x1]! * 4 +
          input[index]! * 6 +
          input[y * width + x3]! * 4 +
          input[y * width + x4]! * 1) /
        16;
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const y0 = Math.max(0, y - 2);
      const y1 = Math.max(0, y - 1);
      const y3 = Math.min(height - 1, y + 1);
      const y4 = Math.min(height - 1, y + 2);
      output[index] =
        (temp[y0 * width + x]! * 1 +
          temp[y1 * width + x]! * 4 +
          temp[index]! * 6 +
          temp[y3 * width + x]! * 4 +
          temp[y4 * width + x]! * 1) /
        16;
    }
  }

  return output;
}

function collectBorderPoints(
  gradients: {
    width: number;
    height: number;
    verticalScores: Float32Array;
    horizontalScores: Float32Array;
  },
  side: "left" | "right" | "top" | "bottom",
): BorderSamplePoint[] {
  const { width, height, verticalScores, horizontalScores } = gradients;
  const points: BorderSamplePoint[] = [];

  if (side === "left" || side === "right") {
    const startX =
      side === "left"
        ? 1
        : Math.max(1, Math.floor(width * (1 - BORDER_SCAN_BAND_RATIO)));
    const endX =
      side === "left"
        ? Math.max(startX + 1, Math.floor(width * BORDER_SCAN_BAND_RATIO))
        : width - 2;

    for (let y = 1; y < height - 1; y += BORDER_SCAN_STEP) {
      let bestX = -1;
      let bestScore = 0;

      for (let x = startX; x <= endX; x += 1) {
        const rawScore = verticalScores[y * width + x] ?? 0;
        if (rawScore <= 0) {
          continue;
        }

        const sideBias =
          side === "left"
            ? 1 - (x - startX) / Math.max(1, endX - startX)
            : (x - startX) / Math.max(1, endX - startX);
        const score = rawScore * (0.8 + sideBias * 0.7);

        if (score > bestScore) {
          bestScore = score;
          bestX = x;
        }
      }

      if (bestX >= 0) {
        points.push({ x: bestX, y, score: bestScore });
      }
    }
  } else {
    const startY =
      side === "top"
        ? 1
        : Math.max(1, Math.floor(height * (1 - BORDER_SCAN_BAND_RATIO)));
    const endY =
      side === "top"
        ? Math.max(startY + 1, Math.floor(height * BORDER_SCAN_BAND_RATIO))
        : height - 2;

    for (let x = 1; x < width - 1; x += BORDER_SCAN_STEP) {
      let bestY = -1;
      let bestScore = 0;

      for (let y = startY; y <= endY; y += 1) {
        const rawScore = horizontalScores[y * width + x] ?? 0;
        if (rawScore <= 0) {
          continue;
        }

        const sideBias =
          side === "top"
            ? 1 - (y - startY) / Math.max(1, endY - startY)
            : (y - startY) / Math.max(1, endY - startY);
        const score = rawScore * (0.8 + sideBias * 0.7);

        if (score > bestScore) {
          bestScore = score;
          bestY = y;
        }
      }

      if (bestY >= 0) {
        points.push({ x, y: bestY, score: bestScore });
      }
    }
  }

  return filterBorderPoints(points);
}

function filterBorderPoints(points: BorderSamplePoint[]): BorderSamplePoint[] {
  if (points.length < MIN_BORDER_POINTS) {
    return [];
  }

  const sortedScores = points
    .map((point) => point.score)
    .sort((left, right) => right - left);
  const strongestScore = sortedScores[0] ?? 0;
  const percentileIndex = Math.min(
    sortedScores.length - 1,
    Math.max(MIN_BORDER_POINTS - 1, Math.floor(sortedScores.length * 0.35)),
  );
  const percentileScore = sortedScores[percentileIndex] ?? strongestScore;
  const cutoff = Math.max(
    MIN_BORDER_SCORE,
    strongestScore * 0.35,
    percentileScore * 0.9,
  );
  const filtered = points.filter((point) => point.score >= cutoff);
  return filtered.length >= MIN_BORDER_POINTS ? filtered : [];
}

function fitBorderLine(
  side: "left" | "right" | "top" | "bottom",
  points: BorderSamplePoint[],
  width: number,
  height: number,
): FittedBorderLine | null {
  if (points.length < MIN_BORDER_POINTS) {
    return null;
  }

  const axis = side === "left" || side === "right" ? "vertical" : "horizontal";
  const initial = fitLine(points, axis);
  if (!initial) {
    return null;
  }

  const residualLimit = axis === "vertical" ? width * 0.05 : height * 0.05;
  const refinedPoints = points.filter((point) => {
    const prediction =
      axis === "vertical"
        ? initial.slope * point.y + initial.intercept
        : initial.slope * point.x + initial.intercept;
    const actual = axis === "vertical" ? point.x : point.y;
    return Math.abs(actual - prediction) <= Math.max(6, residualLimit);
  });

  const fittedPoints = refinedPoints.length >= MIN_BORDER_POINTS ? refinedPoints : points;
  const fitted = fitLine(fittedPoints, axis);
  if (!fitted) {
    return null;
  }

  const edgeTouchRatio = computeEdgeTouchRatio(
    fittedPoints,
    side,
    width,
    height,
  );
  const isEdgeAnchored = edgeTouchRatio >= EDGE_ANCHORED_RATIO;

  if (axis === "vertical") {
    const midX = fitted.slope * (height / 2) + fitted.intercept;
    if (Math.abs(fitted.slope) > MAX_VERTICAL_LINE_SLOPE) {
      return null;
    }
    if (side === "left" && midX > width * 0.62) {
      return null;
    }
    if (side === "right" && midX < width * 0.38) {
      return null;
    }

    return {
      side,
      support: fitted.support,
      edgeTouchRatio,
      isEdgeAnchored,
      points: [
        { x: fitted.intercept, y: 0 },
        { x: fitted.slope * (height - 1) + fitted.intercept, y: height - 1 },
      ],
    };
  }

  const midY = fitted.slope * (width / 2) + fitted.intercept;
  if (Math.abs(fitted.slope) > MAX_HORIZONTAL_LINE_SLOPE) {
    return null;
  }
  if (side === "top" && midY > height * 0.62) {
    return null;
  }
  if (side === "bottom" && midY < height * 0.38) {
    return null;
  }

  return {
    side,
    support: fitted.support,
    edgeTouchRatio,
    isEdgeAnchored,
    points: [
      { x: 0, y: fitted.intercept },
      { x: width - 1, y: fitted.slope * (width - 1) + fitted.intercept },
    ],
  };
}

function fitLine(
  points: BorderSamplePoint[],
  axis: "vertical" | "horizontal",
): { slope: number; intercept: number; support: number } | null {
  if (points.length < MIN_BORDER_POINTS) {
    return null;
  }

  let weightSum = 0;
  let primaryMean = 0;
  let secondaryMean = 0;

  for (const point of points) {
    const weight = point.score;
    const primary = axis === "vertical" ? point.y : point.x;
    const secondary = axis === "vertical" ? point.x : point.y;
    weightSum += weight;
    primaryMean += primary * weight;
    secondaryMean += secondary * weight;
  }

  if (weightSum <= 0) {
    return null;
  }

  primaryMean /= weightSum;
  secondaryMean /= weightSum;

  let numerator = 0;
  let denominator = 0;

  for (const point of points) {
    const weight = point.score;
    const primary = axis === "vertical" ? point.y : point.x;
    const secondary = axis === "vertical" ? point.x : point.y;
    numerator += weight * (primary - primaryMean) * (secondary - secondaryMean);
    denominator += weight * (primary - primaryMean) ** 2;
  }

  if (denominator <= 0) {
    return null;
  }

  return {
    slope: numerator / denominator,
    intercept: secondaryMean - (numerator / denominator) * primaryMean,
    support: weightSum / points.length,
  };
}

function buildObservedQuad(
  left: FittedBorderLine,
  right: FittedBorderLine,
  top: FittedBorderLine,
  bottom: FittedBorderLine,
): VideoQuad | null {
  const tl = intersectLines(left, top);
  const tr = intersectLines(right, top);
  const br = intersectLines(right, bottom);
  const bl = intersectLines(left, bottom);
  if (!tl || !tr || !br || !bl) {
    return null;
  }
  return [tl, tr, br, bl];
}

function inferRightQuad(
  left: FittedBorderLine,
  top: FittedBorderLine,
  bottom: FittedBorderLine,
): VideoQuad | null {
  const tl = intersectLines(left, top);
  const bl = intersectLines(left, bottom);
  if (!tl || !bl) {
    return null;
  }

  const height = distance(tl, bl);
  const width = height * CARD_ASPECT_RATIO;
  const topDirection = orientDirection(top, { x: "positive" });
  const bottomDirection = orientDirection(bottom, { x: "positive" });

  return [
    tl,
    addVector(tl, topDirection, width),
    addVector(bl, bottomDirection, width),
    bl,
  ];
}

function inferLeftQuad(
  right: FittedBorderLine,
  top: FittedBorderLine,
  bottom: FittedBorderLine,
): VideoQuad | null {
  const tr = intersectLines(right, top);
  const br = intersectLines(right, bottom);
  if (!tr || !br) {
    return null;
  }

  const height = distance(tr, br);
  const width = height * CARD_ASPECT_RATIO;
  const topDirection = orientDirection(top, { x: "negative" });
  const bottomDirection = orientDirection(bottom, { x: "negative" });
  const tl = addVector(tr, topDirection, width);
  const bl = addVector(br, bottomDirection, width);

  return [tl, tr, br, bl];
}

function inferBottomQuad(
  left: FittedBorderLine,
  right: FittedBorderLine,
  top: FittedBorderLine,
): VideoQuad | null {
  const tl = intersectLines(left, top);
  const tr = intersectLines(right, top);
  if (!tl || !tr) {
    return null;
  }

  const width = distance(tl, tr);
  const height = width / CARD_ASPECT_RATIO;
  const leftDirection = orientDirection(left, { y: "positive" });
  const rightDirection = orientDirection(right, { y: "positive" });
  const bl = addVector(tl, leftDirection, height);
  const br = addVector(tr, rightDirection, height);

  return [tl, tr, br, bl];
}

function inferTopQuad(
  left: FittedBorderLine,
  right: FittedBorderLine,
  bottom: FittedBorderLine,
): VideoQuad | null {
  const bl = intersectLines(left, bottom);
  const br = intersectLines(right, bottom);
  if (!bl || !br) {
    return null;
  }

  const width = distance(bl, br);
  const height = width / CARD_ASPECT_RATIO;
  const leftDirection = orientDirection(left, { y: "negative" });
  const rightDirection = orientDirection(right, { y: "negative" });
  const tl = addVector(bl, leftDirection, height);
  const tr = addVector(br, rightDirection, height);

  return [tl, tr, br, bl];
}

function lineSupport(...lines: FittedBorderLine[]): number {
  return lines.reduce((sum, line) => {
    const weight = line.isEdgeAnchored ? 0.2 : 1;
    return sum + line.support * weight;
  }, 0);
}

function computeEdgeTouchRatio(
  points: BorderSamplePoint[],
  side: "left" | "right" | "top" | "bottom",
  width: number,
  height: number,
): number {
  if (!points.length) {
    return 0;
  }

  const touched = points.filter((point) => {
    if (side === "left") {
      return point.x <= EDGE_TOUCH_TOLERANCE;
    }
    if (side === "right") {
      return point.x >= width - 1 - EDGE_TOUCH_TOLERANCE;
    }
    if (side === "top") {
      return point.y <= EDGE_TOUCH_TOLERANCE;
    }
    return point.y >= height - 1 - EDGE_TOUCH_TOLERANCE;
  });

  return touched.length / points.length;
}

function getQuadBoundaryStats(
  quad: VideoQuad,
  width: number,
  height: number,
): QuadBoundaryStats {
  let outsidePoints = 0;
  let edgeTouchPoints = 0;

  for (const point of quad) {
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
      outsidePoints += 1;
      continue;
    }

    const edgeDistance = Math.min(
      point.x,
      width - point.x,
      point.y,
      height - point.y,
    );
    if (edgeDistance <= EDGE_TOUCH_TOLERANCE) {
      edgeTouchPoints += 1;
    }
  }

  return {
    outsidePoints,
    edgeTouchPoints,
  };
}

function intersectLines(
  first: FittedBorderLine,
  second: FittedBorderLine,
): VideoQuadPoint | null {
  const lineA = toLineEquation(first.points[0], first.points[1]);
  const lineB = toLineEquation(second.points[0], second.points[1]);
  const determinant = lineA.a * lineB.b - lineB.a * lineA.b;

  if (Math.abs(determinant) < 1e-6) {
    return null;
  }

  return {
    x: (lineA.b * lineB.c - lineB.b * lineA.c) / determinant,
    y: (lineB.a * lineA.c - lineA.a * lineB.c) / determinant,
  };
}

function toLineEquation(first: VideoQuadPoint, second: VideoQuadPoint): {
  a: number;
  b: number;
  c: number;
} {
  return {
    a: first.y - second.y,
    b: second.x - first.x,
    c: first.x * second.y - second.x * first.y,
  };
}

function orientDirection(
  line: FittedBorderLine,
  preference: { x?: "positive" | "negative"; y?: "positive" | "negative" },
): VideoQuadPoint {
  const direction = normalizeVector({
    x: line.points[1].x - line.points[0].x,
    y: line.points[1].y - line.points[0].y,
  });

  if (preference.x) {
    if (preference.x === "positive" && direction.x < 0) {
      return { x: -direction.x, y: -direction.y };
    }
    if (preference.x === "negative" && direction.x > 0) {
      return { x: -direction.x, y: -direction.y };
    }
  }

  if (preference.y) {
    if (preference.y === "positive" && direction.y < 0) {
      return { x: -direction.x, y: -direction.y };
    }
    if (preference.y === "negative" && direction.y > 0) {
      return { x: -direction.x, y: -direction.y };
    }
  }

  return direction;
}

function normalizeVector(vector: VideoQuadPoint): VideoQuadPoint {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude <= 1e-6) {
    return { x: 1, y: 0 };
  }

  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
  };
}

function addVector(
  origin: VideoQuadPoint,
  direction: VideoQuadPoint,
  magnitude: number,
): VideoQuadPoint {
  return {
    x: origin.x + direction.x * magnitude,
    y: origin.y + direction.y * magnitude,
  };
}

function distance(first: VideoQuadPoint, second: VideoQuadPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function getQuadAspectError(quad: VideoQuad): number {
  const widths = [distance(quad[0], quad[1]), distance(quad[3], quad[2])];
  const heights = [distance(quad[0], quad[3]), distance(quad[1], quad[2])];
  const width = (widths[0] + widths[1]) / 2;
  const height = (heights[0] + heights[1]) / 2;
  if (height <= 1e-6) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(width / height - CARD_ASPECT_RATIO);
}

function isValidQuad(
  quad: VideoQuad,
  width: number,
  height: number,
): boolean {
  const aspectError = getQuadAspectError(quad);
  if (!Number.isFinite(aspectError) || aspectError > MAX_QUAD_ASPECT_ERROR) {
    return false;
  }

  const marginX = width * QUAD_BOUNDARY_MARGIN_RATIO;
  const marginY = height * QUAD_BOUNDARY_MARGIN_RATIO;
  for (const point of quad) {
    if (
      point.x < -marginX ||
      point.x > width + marginX ||
      point.y < -marginY ||
      point.y > height + marginY
    ) {
      return false;
    }
  }

  const area = Math.abs(
    quad.reduce((sum, point, index) => {
      const next = quad[(index + 1) % quad.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
  const areaRatio = area / Math.max(1, width * height);
  if (areaRatio < MIN_QUAD_AREA_RATIO || areaRatio > MAX_QUAD_AREA_RATIO) {
    return false;
  }

  return true;
}
