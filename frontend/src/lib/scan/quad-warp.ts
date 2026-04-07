import { createCanvas, getContext2d } from "./canvas-utils";
import type {
  VideoQuad,
  VideoQuadPoint,
} from "./scan-types";

export function warpCanvasFromQuad(
  sourceCanvas: HTMLCanvasElement,
  quad: VideoQuad,
): HTMLCanvasElement {
  const topWidth = distance(quad[0], quad[1]);
  const bottomWidth = distance(quad[3], quad[2]);
  const leftHeight = distance(quad[0], quad[3]);
  const rightHeight = distance(quad[1], quad[2]);
  const width = Math.max(1, Math.round((topWidth + bottomWidth) / 2));
  const height = Math.max(1, Math.round((leftHeight + rightHeight) / 2));
  const canvas = createCanvas(width, height);
  const context = getContext2d(canvas);
  context.clearRect(0, 0, width, height);

  drawWarpedTriangle(
    context,
    sourceCanvas,
    [quad[0], quad[1], quad[3]],
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: height },
    ],
  );
  drawWarpedTriangle(
    context,
    sourceCanvas,
    [quad[1], quad[2], quad[3]],
    [
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
  );

  return canvas;
}

function drawWarpedTriangle(
  context: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  sourceTriangle: [VideoQuadPoint, VideoQuadPoint, VideoQuadPoint],
  destinationTriangle: [VideoQuadPoint, VideoQuadPoint, VideoQuadPoint],
): void {
  const affine = computeAffineTransform(sourceTriangle, destinationTriangle);
  if (!affine) {
    return;
  }

  context.save();
  context.beginPath();
  context.moveTo(destinationTriangle[0].x, destinationTriangle[0].y);
  context.lineTo(destinationTriangle[1].x, destinationTriangle[1].y);
  context.lineTo(destinationTriangle[2].x, destinationTriangle[2].y);
  context.closePath();
  context.clip();
  context.transform(
    affine.a,
    affine.b,
    affine.c,
    affine.d,
    affine.e,
    affine.f,
  );
  context.drawImage(sourceCanvas, 0, 0);
  context.restore();
}

function computeAffineTransform(
  sourceTriangle: [VideoQuadPoint, VideoQuadPoint, VideoQuadPoint],
  destinationTriangle: [VideoQuadPoint, VideoQuadPoint, VideoQuadPoint],
): { a: number; b: number; c: number; d: number; e: number; f: number } | null {
  const matrix = invert3x3([
    [sourceTriangle[0].x, sourceTriangle[0].y, 1],
    [sourceTriangle[1].x, sourceTriangle[1].y, 1],
    [sourceTriangle[2].x, sourceTriangle[2].y, 1],
  ]);

  if (!matrix) {
    return null;
  }

  const xVector = multiplyMatrix3x3Vector(matrix, [
    destinationTriangle[0].x,
    destinationTriangle[1].x,
    destinationTriangle[2].x,
  ]);
  const yVector = multiplyMatrix3x3Vector(matrix, [
    destinationTriangle[0].y,
    destinationTriangle[1].y,
    destinationTriangle[2].y,
  ]);

  return {
    a: xVector[0],
    b: yVector[0],
    c: xVector[1],
    d: yVector[1],
    e: xVector[2],
    f: yVector[2],
  };
}

function invert3x3(matrix: number[][]): number[][] | null {
  const [
    [a, b, c],
    [d, e, f],
    [g, h, i],
  ] = matrix;
  const determinant =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);

  if (Math.abs(determinant) < 1e-8) {
    return null;
  }

  const invDeterminant = 1 / determinant;

  return [
    [
      (e * i - f * h) * invDeterminant,
      (c * h - b * i) * invDeterminant,
      (b * f - c * e) * invDeterminant,
    ],
    [
      (f * g - d * i) * invDeterminant,
      (a * i - c * g) * invDeterminant,
      (c * d - a * f) * invDeterminant,
    ],
    [
      (d * h - e * g) * invDeterminant,
      (b * g - a * h) * invDeterminant,
      (a * e - b * d) * invDeterminant,
    ],
  ];
}

function multiplyMatrix3x3Vector(
  matrix: number[][],
  vector: [number, number, number],
): [number, number, number] {
  return [
    matrix[0]![0]! * vector[0] + matrix[0]![1]! * vector[1] + matrix[0]![2]! * vector[2],
    matrix[1]![0]! * vector[0] + matrix[1]![1]! * vector[1] + matrix[1]![2]! * vector[2],
    matrix[2]![0]! * vector[0] + matrix[2]![1]! * vector[1] + matrix[2]![2]! * vector[2],
  ];
}

function distance(first: VideoQuadPoint, second: VideoQuadPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
