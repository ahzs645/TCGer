/**
 * Perceptual Hash (pHash) implementation for card recognition.
 *
 * Algorithm (inspired by Moss Machine / imagehash):
 *   1. Resize image to (hashSize*4) × (hashSize*4) grayscale per channel
 *   2. Compute 2-D DCT (Discrete Cosine Transform)
 *   3. Keep top-left hashSize × hashSize low-frequency coefficients
 *   4. Threshold against the median → 1/0 bits → hex string
 *
 * We split the card image into R, G, B channels and hash each independently
 * for a 256-bit-per-channel fingerprint (hashSize=16 → 16×16 = 256 bits).
 *
 * This matches the Moss Machine approach of separate RGB channel hashing,
 * giving much better discrimination than a single grayscale hash.
 */

import sharp from 'sharp';

// ---------- types ----------

export interface RGBHash {
  r: string; // hex-encoded red channel pHash
  g: string; // hex-encoded green channel pHash
  b: string; // hex-encoded blue channel pHash
}

// ---------- constants ----------

/** Default hash size (16 → 256 bit per channel). */
const DEFAULT_HASH_SIZE = 16;

/** We compute the DCT on a (highfreqFactor * hashSize)² image. */
const HIGHFREQ_FACTOR = 4;

// ---------- public API ----------

/**
 * Compute a perceptual hash from image bytes.
 * Returns separate R, G, B channel hashes as hex strings.
 */
export async function computeRGBHash(
  imageInput: Buffer | string,
  hashSize: number = DEFAULT_HASH_SIZE
): Promise<RGBHash> {
  const dctSize = hashSize * HIGHFREQ_FACTOR; // e.g. 64

  // Load image with sharp, ensure portrait orientation, resize
  let img = sharp(imageInput).rotate(); // auto-rotate based on EXIF

  // Get metadata to check orientation
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  // Rotate to portrait if landscape (card images should be portrait)
  if (width > height) {
    img = img.rotate(90);
  }

  // Resize to dctSize × dctSize for each channel extraction
  const resized = img.resize(dctSize, dctSize, { fit: 'fill' });

  // Extract raw RGB pixel data
  const { data } = await resized
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Separate into R, G, B channel arrays
  const pixels = dctSize * dctSize;
  const rChannel = new Float64Array(pixels);
  const gChannel = new Float64Array(pixels);
  const bChannel = new Float64Array(pixels);

  for (let i = 0; i < pixels; i++) {
    rChannel[i] = data[i * 3];
    gChannel[i] = data[i * 3 + 1];
    bChannel[i] = data[i * 3 + 2];
  }

  // Compute pHash for each channel
  const rHash = channelPHash(rChannel, dctSize, hashSize);
  const gHash = channelPHash(gChannel, dctSize, hashSize);
  const bHash = channelPHash(bChannel, dctSize, hashSize);

  return { r: rHash, g: gHash, b: bHash };
}

/**
 * Compute Hamming distance between two hex hash strings.
 * Returns the number of differing bits.
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) {
    return Infinity;
  }

  let distance = 0;

  // Process 8 hex chars (32 bits) at a time for performance
  for (let i = 0; i < hash1.length; i += 8) {
    const chunk1 = parseInt(hash1.substring(i, i + 8), 16);
    const chunk2 = parseInt(hash2.substring(i, i + 8), 16);
    let xor = (chunk1 ^ chunk2) >>> 0;

    // Popcount (Brian Kernighan's method)
    while (xor) {
      distance++;
      xor &= xor - 1;
    }
  }

  return distance;
}

/**
 * Compute combined RGB Hamming distance (sum of per-channel distances).
 */
export function rgbHammingDistance(a: RGBHash, b: RGBHash): number {
  return (
    hammingDistance(a.r, b.r) +
    hammingDistance(a.g, b.g) +
    hammingDistance(a.b, b.b)
  );
}

// ---------- internals ----------

/**
 * Compute pHash for a single channel.
 * 1. Apply 2D DCT
 * 2. Keep top-left hashSize × hashSize block (low frequencies)
 * 3. Compute median of those coefficients (excluding DC)
 * 4. Threshold: bit = coefficient > median ? 1 : 0
 * 5. Encode bits as hex string
 */
function channelPHash(
  channel: Float64Array,
  dctSize: number,
  hashSize: number
): string {
  // 2D DCT via separable 1D DCTs (rows then columns)
  const dctResult = dct2d(channel, dctSize);

  // Extract low-frequency hashSize × hashSize block (skip DC at [0,0])
  const lowFreq: number[] = [];
  for (let y = 0; y < hashSize; y++) {
    for (let x = 0; x < hashSize; x++) {
      if (x === 0 && y === 0) continue; // skip DC component
      lowFreq.push(dctResult[y * dctSize + x]);
    }
  }

  // Median threshold
  const sorted = [...lowFreq].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  // Generate bit string: 1 if > median, 0 otherwise
  // Total bits = hashSize² (including DC position which we set to 0)
  const totalBits = hashSize * hashSize;
  const bits = new Uint8Array(totalBits);
  let freqIdx = 0;
  for (let y = 0; y < hashSize; y++) {
    for (let x = 0; x < hashSize; x++) {
      if (x === 0 && y === 0) {
        bits[0] = 0; // DC always 0
      } else {
        bits[y * hashSize + x] = lowFreq[freqIdx] > median ? 1 : 0;
        freqIdx++;
      }
    }
  }

  // Convert bits to hex
  return bitsToHex(bits);
}

/**
 * 2D DCT via separable 1D transforms (row-wise then column-wise).
 */
function dct2d(data: Float64Array, size: number): Float64Array {
  const result = new Float64Array(size * size);

  // Row-wise DCT
  for (let y = 0; y < size; y++) {
    const row = data.subarray(y * size, (y + 1) * size);
    const dctRow = dct1d(row, size);
    result.set(dctRow, y * size);
  }

  // Column-wise DCT (operate on result)
  const col = new Float64Array(size);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      col[y] = result[y * size + x];
    }
    const dctCol = dct1d(col, size);
    for (let y = 0; y < size; y++) {
      result[y * size + x] = dctCol[y];
    }
  }

  return result;
}

/**
 * 1D Type-II DCT.
 */
function dct1d(input: Float64Array, size: number): Float64Array {
  const output = new Float64Array(size);
  const factor = Math.PI / size;

  for (let k = 0; k < size; k++) {
    let sum = 0;
    for (let n = 0; n < size; n++) {
      sum += input[n] * Math.cos(factor * (n + 0.5) * k);
    }
    output[k] = sum;
  }

  return output;
}

/**
 * Convert a Uint8Array of 0/1 bits to a hex string.
 */
function bitsToHex(bits: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble =
      ((bits[i] || 0) << 3) |
      ((bits[i + 1] || 0) << 2) |
      ((bits[i + 2] || 0) << 1) |
      (bits[i + 3] || 0);
    hex += nibble.toString(16);
  }
  return hex;
}
