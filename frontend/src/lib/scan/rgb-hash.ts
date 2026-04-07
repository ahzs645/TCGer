import { createCanvas, getContext2d } from "./canvas-utils";
import type { RGBHash } from "./scan-types";

const DEFAULT_HASH_SIZE = 16;
const HIGHFREQ_FACTOR = 4;

const cosineTableCache = new Map<number, Float64Array>();

export function computeRGBHashFromCanvas(
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

export function hammingDistance(hash1: string, hash2: string): number {
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
