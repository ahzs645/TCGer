import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { scanCardImage, type ScanResult } from '../modules/card-scan';
import { buildDetectorCropVariants } from '../modules/card-scan/detector-crop';

type SupportedTcg = 'magic' | 'pokemon' | 'yugioh';

interface DetectionRow {
  confidence: number;
  polygon: number[][];
}

interface FrameSummaryRow {
  frame: string;
  detections: DetectionRow[];
  count: number;
  top_confidence: number | null;
}

interface DetectorSummary {
  total_frames: number;
  frames_with_detection: number;
  frames_without_detection: number;
  frames_with_multiple_detections: number;
  results: FrameSummaryRow[];
}

interface ProbeOptions {
  summaryPath: string;
  framesDir: string;
  outputDir: string;
  tcg: SupportedTcg;
  secondsPerFrame: number;
  limit?: number;
}

interface VariantProbeResult {
  name: string;
  cropPath: string;
  scan: ScanResult;
}

interface FrameProbeResult {
  frame: string;
  seconds: number;
  detectorConfidence: number;
  bestVariant: string | null;
  bestMatchId: string | null;
  bestMatchName: string | null;
  bestMatchConfidence: number | null;
  bestMatchDistance: number | null;
  bestShortlistSize: number;
  variantResults: Array<{
    name: string;
    cropPath: string;
    bestMatchId: string | null;
    bestMatchName: string | null;
    bestMatchConfidence: number | null;
    bestMatchDistance: number | null;
    shortlistSize: number;
    perspectiveCorrected: boolean;
    variantUsed: string;
  }>;
}

function parseSupportedTcg(value: string | undefined): SupportedTcg {
  if (value === 'magic' || value === 'pokemon' || value === 'yugioh') {
    return value;
  }

  return 'pokemon';
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptions(argv: string[]): ProbeOptions {
  const args = [...argv];
  let summaryPath = '';
  let framesDir = '';
  let outputDir = path.join('/tmp', 'tcger-detector-handoff');
  let tcg = parseSupportedTcg(undefined);
  let secondsPerFrame = parsePositiveNumber(undefined, 4);
  let limit = parsePositiveInteger(undefined);

  while (args.length) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === '--summary') {
      summaryPath = args.shift() ?? summaryPath;
      continue;
    }

    if (token === '--frames-dir') {
      framesDir = args.shift() ?? framesDir;
      continue;
    }

    if (token === '--output-dir') {
      outputDir = args.shift() ?? outputDir;
      continue;
    }

    if (token === '--tcg') {
      tcg = parseSupportedTcg(args.shift());
      continue;
    }

    if (token === '--seconds-per-frame') {
      secondsPerFrame = parsePositiveNumber(args.shift(), secondsPerFrame);
      continue;
    }

    if (token === '--limit') {
      limit = parsePositiveInteger(args.shift()) ?? limit;
      continue;
    }

    if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (!summaryPath) {
    throw new Error('--summary is required');
  }

  if (!framesDir) {
    throw new Error('--frames-dir is required');
  }

  return {
    summaryPath,
    framesDir,
    outputDir,
    tcg,
    secondsPerFrame,
    limit,
  };
}

function printUsage(): void {
  console.log(`Usage:
  npm run probe:detector-handoff -- \
    --summary /tmp/tcger-cardcaptor-video/cardcaptor-summary.json \
    --frames-dir /tmp/tcger-cardcaptor-video/frames \
    --tcg pokemon \
    --seconds-per-frame 4 \
    --output-dir /tmp/tcger-detector-handoff`);
}

function scoreScanResult(result: ScanResult): number {
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

function chooseBestVariant(results: VariantProbeResult[]): VariantProbeResult | null {
  let best: VariantProbeResult | null = null;

  for (const result of results) {
    if (!best || scoreScanResult(result.scan) > scoreScanResult(best.scan)) {
      best = result;
    }
  }

  return best;
}

function frameToSeconds(frame: string, secondsPerFrame: number): number {
  const number = Number(frame.match(/frame-(\d+)\.jpg/)?.[1] ?? '1');
  return (number - 1) * secondsPerFrame;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const summary = JSON.parse(await readFile(options.summaryPath, 'utf8')) as DetectorSummary;
  const rows = summary.results.filter((row) => row.count > 0);
  const targetRows = options.limit ? rows.slice(0, options.limit) : rows;

  await mkdir(options.outputDir, { recursive: true });
  const cropsDir = path.join(options.outputDir, 'crops');
  await mkdir(cropsDir, { recursive: true });

  const frameResults: FrameProbeResult[] = [];
  const variantWins = new Map<string, number>();

  for (const row of targetRows) {
    const framePath = path.join(options.framesDir, row.frame);
    const frameBuffer = await readFile(framePath);
    const topDetection = row.detections[0];
    if (!topDetection) {
      continue;
    }

    const detectorResult = await buildDetectorCropVariants(frameBuffer, topDetection.polygon);
    const variantResults: VariantProbeResult[] = [];

    for (const variant of detectorResult.variants) {
      const cropPath = path.join(cropsDir, `${row.frame.replace('.jpg', '')}-${variant.name}.png`);
      await writeFile(cropPath, variant.image);
      const scan = await scanCardImage(variant.image, options.tcg);
      variantResults.push({
        name: variant.name,
        cropPath,
        scan,
      });
    }

    const best = chooseBestVariant(variantResults);
    if (best) {
      variantWins.set(best.name, (variantWins.get(best.name) ?? 0) + 1);
    }

    frameResults.push({
      frame: row.frame,
      seconds: frameToSeconds(row.frame, options.secondsPerFrame),
      detectorConfidence: topDetection.confidence,
      bestVariant: best?.name ?? null,
      bestMatchId: best?.scan.bestMatch?.externalId ?? null,
      bestMatchName: best?.scan.bestMatch?.name ?? null,
      bestMatchConfidence: best?.scan.bestMatch?.confidence ?? null,
      bestMatchDistance: best?.scan.bestMatch?.distance ?? null,
      bestShortlistSize: best?.scan.meta.shortlistSize ?? 0,
      variantResults: variantResults.map((variant) => ({
        name: variant.name,
        cropPath: variant.cropPath,
        bestMatchId: variant.scan.bestMatch?.externalId ?? null,
        bestMatchName: variant.scan.bestMatch?.name ?? null,
        bestMatchConfidence: variant.scan.bestMatch?.confidence ?? null,
        bestMatchDistance: variant.scan.bestMatch?.distance ?? null,
        shortlistSize: variant.scan.meta.shortlistSize,
        perspectiveCorrected: variant.scan.meta.perspectiveCorrected,
        variantUsed: variant.scan.meta.variantUsed,
      })),
    });
  }

  const matchedFrames = frameResults.filter((result) => result.bestMatchId);
  const strongFrames = frameResults.filter((result) => (result.bestMatchConfidence ?? 0) >= 0.6);
  const output = {
    totalEvaluated: frameResults.length,
    matchedFrames: matchedFrames.length,
    strongFrames: strongFrames.length,
    variantWins: Object.fromEntries([...variantWins.entries()].sort()),
    frameResults,
  };

  const reportPath = path.join(options.outputDir, 'report.json');
  await writeFile(reportPath, JSON.stringify(output, null, 2));

  console.log(
    JSON.stringify(
      {
        totalEvaluated: output.totalEvaluated,
        matchedFrames: output.matchedFrames,
        strongFrames: output.strongFrames,
        variantWins: output.variantWins,
      },
      null,
      2
    )
  );
  console.log('top matches:');
  for (const result of matchedFrames
    .sort((left, right) => (right.bestMatchConfidence ?? 0) - (left.bestMatchConfidence ?? 0))
    .slice(0, 10)) {
    console.log(
      result.frame,
      result.seconds,
      result.bestVariant,
      result.bestMatchId,
      result.bestMatchName,
      result.bestMatchConfidence,
      result.bestMatchDistance
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
