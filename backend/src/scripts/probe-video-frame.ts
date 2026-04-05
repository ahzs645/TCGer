import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';

import { prepareRuntimeScanImage, type ScanRuntimeVariant } from '../modules/card-scan/preprocess';
import { scanCardImage, type ScanResult } from '../modules/card-scan/scan.service';
import {
  buildVideoSourceVariantsForDebug,
  type VideoSourceVariant,
} from '../modules/card-scan/video-scan.service';

type SupportedTcg = 'magic' | 'pokemon' | 'yugioh';
type RoiKind = 'title' | 'footer';
type OutputFormat = 'png' | 'jpeg';

interface ProbeOptions {
  framePath: string;
  tcg: SupportedTcg;
  outputDir: string;
}

interface OcrRoi {
  name: string;
  kind: RoiKind;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface OcrVariant {
  name: string;
  image: Buffer;
}

interface OcrProbeResult {
  roi: string;
  kind: RoiKind;
  mode: string;
  confidence: number;
  text: string;
}

const STRONG_MATCH_CONFIDENCE = 0.82;

function parseSupportedTcg(value: string | undefined): SupportedTcg {
  if (value === 'magic' || value === 'pokemon' || value === 'yugioh') {
    return value;
  }

  return 'pokemon';
}

function parseOptions(argv: string[]): ProbeOptions {
  const args = [...argv];
  let framePath = '';
  let tcg = parseSupportedTcg(undefined);
  let outputDir = path.join('/tmp', 'tcger-video-frame-probe');

  while (args.length) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === '--frame') {
      framePath = args.shift() ?? framePath;
      continue;
    }

    if (token === '--tcg') {
      tcg = parseSupportedTcg(args.shift());
      continue;
    }

    if (token === '--output-dir') {
      outputDir = args.shift() ?? outputDir;
      continue;
    }

    if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (!framePath) {
    throw new Error('--frame is required');
  }

  return {
    framePath,
    tcg,
    outputDir,
  };
}

function printUsage(): void {
  console.log(`Usage:
  npm run probe:video-frame -- --frame /path/to/frame.jpg --tcg pokemon --output-dir /tmp/tcger-video-frame-probe`);
}

function scoreVideoResult(result: ScanResult): number {
  const match = result.bestMatch;
  const qualityBonus = (result.meta.quality?.score ?? 0) * 100;
  const perspectiveBonus = result.meta.perspectiveCorrected ? 20 : 0;
  const rerankBonus = result.meta.rerankUsed ? 10 : 0;

  if (!match) {
    return qualityBonus + perspectiveBonus + rerankBonus - result.meta.shortlistSize;
  }

  return (
    match.confidence * 1000 -
    match.distance * 2 +
    qualityBonus +
    perspectiveBonus +
    rerankBonus
  );
}

function compareVideoResults(left: ScanResult, right: ScanResult): number {
  return scoreVideoResult(left) - scoreVideoResult(right);
}

function chooseBestScanResult(
  results: Array<{ variant: VideoSourceVariant; result: ScanResult }>
): { variant: VideoSourceVariant; result: ScanResult } {
  let best = results[0]!;

  for (const entry of results.slice(1)) {
    if (compareVideoResults(entry.result, best.result) > 0) {
      best = entry;
    }

    if (
      entry.result.bestMatch &&
      (entry.result.bestMatch.confidence >= STRONG_MATCH_CONFIDENCE || entry.result.bestMatch.distance <= 24)
    ) {
      return entry;
    }
  }

  return best;
}

function buildOcrRois(tcg: SupportedTcg): OcrRoi[] {
  if (tcg === 'pokemon') {
    return [
      { name: 'title-exact', kind: 'title', left: 0.22, top: 0.04, width: 0.55, height: 0.12 },
      { name: 'title-tall', kind: 'title', left: 0.18, top: 0.02, width: 0.62, height: 0.16 },
      { name: 'title-upper', kind: 'title', left: 0.18, top: 0.0, width: 0.62, height: 0.12 },
      { name: 'top-band', kind: 'title', left: 0.12, top: 0.0, width: 0.74, height: 0.22 },
      { name: 'footer-band', kind: 'footer', left: 0.12, top: 0.76, width: 0.74, height: 0.18 },
      { name: 'footer-right', kind: 'footer', left: 0.50, top: 0.78, width: 0.32, height: 0.15 },
    ];
  }

  return [
    { name: 'title-band', kind: 'title', left: 0.16, top: 0.03, width: 0.7, height: 0.14 },
    { name: 'footer-band', kind: 'footer', left: 0.12, top: 0.78, width: 0.76, height: 0.18 },
  ];
}

function clampRegion(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function extractOcrRoi(imageBuffer: Buffer, roi: OcrRoi): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? 1024;
  const height = metadata.height ?? 1024;
  const left = clampRegion(Math.round(width * roi.left), 0, width - 1);
  const top = clampRegion(Math.round(height * roi.top), 0, height - 1);
  const extractWidth = clampRegion(Math.round(width * roi.width), 32, width - left);
  const extractHeight = clampRegion(Math.round(height * roi.height), 32, height - top);

  return sharp(imageBuffer)
    .extract({
      left,
      top,
      width: extractWidth,
      height: extractHeight,
    })
    .resize({
      width: extractWidth * 2,
      height: extractHeight * 2,
      fit: 'fill',
    })
    .png()
    .toBuffer();
}

async function buildOcrImageVariants(imageBuffer: Buffer): Promise<OcrVariant[]> {
  const base = sharp(imageBuffer);

  return [
    {
      name: 'gray-norm',
      image: await base.clone().grayscale().normalize().png().toBuffer(),
    },
    {
      name: 'gray-thresh',
      image: await base.clone().grayscale().normalize().threshold(170).png().toBuffer(),
    },
    {
      name: 'gray-thresh-invert',
      image: await base.clone().grayscale().normalize().threshold(170).negate().png().toBuffer(),
    },
  ];
}

async function runOcrProbe(
  imageBuffer: Buffer,
  tcg: SupportedTcg,
  outputDir: string
): Promise<OcrProbeResult[]> {
  const cacheDir = path.join('/tmp', 'tcger-tesseract-cache');
  await mkdir(cacheDir, { recursive: true });
  const worker = await createWorker('eng', 1, { cachePath: cacheDir });
  const results: OcrProbeResult[] = [];
  const roiDir = path.join(outputDir, 'ocr');
  await mkdir(roiDir, { recursive: true });

  try {
    for (const roi of buildOcrRois(tcg)) {
      const roiBuffer = await extractOcrRoi(imageBuffer, roi);
      const variants = await buildOcrImageVariants(roiBuffer);

      for (const variant of variants) {
        await writeImage(path.join(roiDir, `${roi.name}-${variant.name}.png`), variant.image, 'png');
        await worker.setParameters(
          roi.kind === 'title'
            ? {
                tessedit_pageseg_mode: PSM.SINGLE_LINE,
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -',
              }
            : {
                tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
                tessedit_char_whitelist:
                  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./- ',
              }
        );
        const recognition = await worker.recognize(variant.image);
        results.push({
          roi: roi.name,
          kind: roi.kind,
          mode: variant.name,
          confidence: recognition.data.confidence,
          text: recognition.data.text.replace(/\s+/g, ' ').trim(),
        });
      }
    }
  } finally {
    await worker.terminate();
  }

  return results;
}

async function writeImage(filePath: string, imageBuffer: Buffer, format: OutputFormat): Promise<void> {
  const pipeline = sharp(imageBuffer);
  const encoded =
    format === 'jpeg' ? await pipeline.jpeg({ quality: 90 }).toBuffer() : await pipeline.png().toBuffer();
  await writeFile(filePath, encoded);
}

async function saveRuntimeVariants(
  variants: ScanRuntimeVariant[],
  outputDir: string
): Promise<Array<{ name: string; path: string }>> {
  const runtimeDir = path.join(outputDir, 'runtime');
  await mkdir(runtimeDir, { recursive: true });

  const outputs: Array<{ name: string; path: string }> = [];
  for (const variant of variants) {
    const filePath = path.join(runtimeDir, `${variant.name}.png`);
    await writeImage(filePath, variant.image, 'png');
    outputs.push({ name: variant.name, path: filePath });
  }

  return outputs;
}

async function saveSourceVariants(
  variants: VideoSourceVariant[],
  outputDir: string
): Promise<Array<{ name: string; path: string; width: number; height: number }>> {
  const sourceDir = path.join(outputDir, 'source');
  await mkdir(sourceDir, { recursive: true });

  const outputs: Array<{ name: string; path: string; width: number; height: number }> = [];
  for (const variant of variants) {
    const filePath = path.join(sourceDir, `${variant.name}.png`);
    await writeImage(filePath, variant.image, 'png');
    outputs.push({
      name: variant.name,
      path: filePath,
      width: variant.width,
      height: variant.height,
    });
  }

  return outputs;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const frameBuffer = await readFile(options.framePath);
  await mkdir(options.outputDir, { recursive: true });

  const sourceVariants = await buildVideoSourceVariantsForDebug(frameBuffer);
  const scanResults = await Promise.all(
    sourceVariants.map(async (variant) => ({
      variant,
      result: await scanCardImage(variant.image, options.tcg),
    }))
  );
  const best = chooseBestScanResult(scanResults);
  const runtimePreparation = await prepareRuntimeScanImage(best.variant.image);
  const ocrResults = await runOcrProbe(runtimePreparation.primaryVariant.image, options.tcg, options.outputDir);

  const report = {
    framePath: options.framePath,
    tcg: options.tcg,
    sourceVariants: await saveSourceVariants(sourceVariants, options.outputDir),
    scanResults: scanResults.map(({ variant, result }) => ({
      name: variant.name,
      width: variant.width,
      height: variant.height,
      bestMatch: result.bestMatch,
      candidates: result.candidates,
      meta: result.meta,
      score: scoreVideoResult(result),
    })),
    bestSourceVariant: best.variant.name,
    bestSourceResult: {
      bestMatch: best.result.bestMatch,
      candidates: best.result.candidates,
      meta: best.result.meta,
      score: scoreVideoResult(best.result),
    },
    runtimeVariants: await saveRuntimeVariants(runtimePreparation.variants, options.outputDir),
    ocrResults,
  };

  const reportPath = path.join(options.outputDir, 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outputDir: options.outputDir, reportPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
