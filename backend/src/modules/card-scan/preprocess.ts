import sharp from 'sharp';

/**
 * Normalize card images into a stable input for perceptual hashing.
 * The builder and runtime scan path must share the exact same preprocessing.
 */
export async function preprocessCardImage(imageBuffer: Buffer): Promise<Buffer> {
  const targetSize = 1024;

  const image = sharp(imageBuffer).rotate();
  const metadata = await image.metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const isLandscape = width > height;

  let processed = isLandscape ? image.rotate(90) : image;

  processed = processed.resize(targetSize, targetSize, {
    fit: 'contain',
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  });

  processed = processed.normalize();

  return processed.removeAlpha().toBuffer();
}
