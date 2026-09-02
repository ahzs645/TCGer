#!/usr/bin/env -S npx tsx

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import {
  warpQuadToCard,
  type Point,
  type RgbaImage,
} from "../../frontend/src/lib/scan/card-rectify";

interface CropCase {
  caseId: string;
  sourcePath: string;
  sourceSha256: string;
  quad: [number, number][];
}

interface CasesDocument {
  cases: CropCase[];
}

async function main(): Promise<void> {
  const [casesPath, outputRoot] = process.argv.slice(2);
  if (!casesPath || !outputRoot) {
    throw new Error("usage: crop_parity_web.ts CASES_JSON OUTPUT_DIRECTORY");
  }
  const document = JSON.parse(
    await readFile(casesPath, "utf8"),
  ) as CasesDocument;
  await mkdir(outputRoot, { recursive: true });
  for (const fixture of document.cases) {
    const decoded = await sharp(fixture.sourcePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const source: RgbaImage = {
      data: new Uint8ClampedArray(decoded.data),
      width: decoded.info.width,
      height: decoded.info.height,
    };
    const quad: Point[] = fixture.quad.map(([x, y]) => ({
      x: x * source.width,
      y: y * source.height,
    }));
    const crop = warpQuadToCard(source, quad, 720, 1000);
    if (!crop) throw new Error(`homography failed for ${fixture.caseId}`);
    await sharp(Buffer.from(crop.data), {
      raw: { width: crop.width, height: crop.height, channels: 4 },
    })
      .png()
      .toFile(path.join(outputRoot, `${fixture.caseId}.png`));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
