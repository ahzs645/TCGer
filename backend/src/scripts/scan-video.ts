import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import sharp from 'sharp';

import type { ScanResult } from '../modules/card-scan';

const execFileAsync = promisify(execFile);
const DEFAULT_CARD_ASPECT_RATIO = 0.714;
const DEFAULT_CENTERS_X = [0.5, 0.6, 0.65, 0.55, 0.45];
const DEFAULT_CENTERS_Y = [0.52, 0.48, 0.56];
const DEFAULT_HEIGHT_RATIOS = [0.75, 0.65, 0.85, 0.55];
const DEFAULT_MAX_WINDOWS = 24;
const STRONG_MATCH_DISTANCE = 120;

type SupportedTcg = 'magic' | 'pokemon' | 'yugioh';

interface VideoScanOptions {
  videoPath: string;
  tcg: SupportedTcg;
  fps: number;
  offsetSeconds: number;
  durationSeconds?: number;
  maxFrames?: number;
  cardAspectRatio: number;
  maxWindows: number;
  keepFrames: boolean;
}

interface FrameWindow {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  heightRatio: number;
}

interface FrameDetection {
  framePath: string;
  frameIndex: number;
  seconds: number;
  window: FrameWindow;
  match: NonNullable<ScanResult['bestMatch']>;
  meta: ScanResult['meta'];
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseSupportedTcg(value: string | undefined): SupportedTcg {
  if (value === 'magic' || value === 'pokemon' || value === 'yugioh') {
    return value;
  }

  return 'pokemon';
}

function parseOptions(argv: string[]): VideoScanOptions {
  const args = [...argv];
  let videoPath = process.env.CARD_SCAN_VIDEO_PATH ?? '';
  let tcg = parseSupportedTcg(process.env.CARD_SCAN_VIDEO_TCG);
  let fps = parsePositiveNumber(process.env.CARD_SCAN_VIDEO_FPS, 0.1);
  let offsetSeconds = parsePositiveNumber(process.env.CARD_SCAN_VIDEO_OFFSET, 0);
  let durationSeconds = parsePositiveInteger(process.env.CARD_SCAN_VIDEO_DURATION);
  let maxFrames = parsePositiveInteger(process.env.CARD_SCAN_VIDEO_MAX_FRAMES);
  let maxWindows = parsePositiveInteger(process.env.CARD_SCAN_VIDEO_MAX_WINDOWS) ?? DEFAULT_MAX_WINDOWS;
  let cardAspectRatio = parsePositiveNumber(
    process.env.CARD_SCAN_VIDEO_ASPECT_RATIO,
    DEFAULT_CARD_ASPECT_RATIO
  );
  let keepFrames = process.env.CARD_SCAN_VIDEO_KEEP_FRAMES === '1';

  while (args.length) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === '--video') {
      videoPath = args.shift() ?? videoPath;
      continue;
    }

    if (token === '--tcg') {
      tcg = parseSupportedTcg(args.shift());
      continue;
    }

    if (token === '--fps') {
      fps = parsePositiveNumber(args.shift(), fps);
      continue;
    }

    if (token === '--offset') {
      offsetSeconds = parsePositiveNumber(args.shift(), offsetSeconds);
      continue;
    }

    if (token === '--duration') {
      durationSeconds = parsePositiveInteger(args.shift()) ?? durationSeconds;
      continue;
    }

    if (token === '--max-frames') {
      maxFrames = parsePositiveInteger(args.shift()) ?? maxFrames;
      continue;
    }

    if (token === '--max-windows') {
      maxWindows = parsePositiveInteger(args.shift()) ?? maxWindows;
      continue;
    }

    if (token === '--aspect-ratio') {
      cardAspectRatio = parsePositiveNumber(args.shift(), cardAspectRatio);
      continue;
    }

    if (token === '--keep-frames') {
      keepFrames = true;
      continue;
    }

    if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (!videoPath) {
    throw new Error('--video or CARD_SCAN_VIDEO_PATH is required');
  }

  return {
    videoPath,
    tcg,
    fps,
    offsetSeconds,
    durationSeconds,
    maxFrames,
    cardAspectRatio,
    maxWindows,
    keepFrames,
  };
}

function printUsage(): void {
  console.log(`Usage:
  npm run scan:video -- --video /path/to/video.mp4 --tcg pokemon --fps 0.1 --offset 0 --duration 180 --max-windows 24

Environment fallbacks:
  CARD_SCAN_VIDEO_PATH
  CARD_SCAN_VIDEO_TCG
  CARD_SCAN_VIDEO_FPS
  CARD_SCAN_VIDEO_OFFSET
  CARD_SCAN_VIDEO_DURATION
  CARD_SCAN_VIDEO_MAX_FRAMES
  CARD_SCAN_VIDEO_MAX_WINDOWS
  CARD_SCAN_VIDEO_ASPECT_RATIO
  CARD_SCAN_VIDEO_KEEP_FRAMES`);
}

function formatSeconds(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remaining = totalSeconds % 60;

  return [hours, minutes, remaining].map((value) => String(value).padStart(2, '0')).join(':');
}

function buildFrameWindows(
  frameWidth: number,
  frameHeight: number,
  aspectRatio: number,
  maxWindows: number
): FrameWindow[] {
  const windows: FrameWindow[] = [];

  for (const heightRatio of DEFAULT_HEIGHT_RATIOS) {
    const targetHeight = Math.min(frameHeight, Math.round(frameHeight * heightRatio));
    const targetWidth = Math.min(frameWidth, Math.round(targetHeight * aspectRatio));
    if (targetWidth <= 0 || targetHeight <= 0) {
      continue;
    }

    for (const centerX of DEFAULT_CENTERS_X) {
      for (const centerY of DEFAULT_CENTERS_Y) {
        const left = Math.max(
          0,
          Math.min(frameWidth - targetWidth, Math.round(frameWidth * centerX - targetWidth / 2))
        );
        const top = Math.max(
          0,
          Math.min(frameHeight - targetHeight, Math.round(frameHeight * centerY - targetHeight / 2))
        );

        windows.push({
          left,
          top,
          width: targetWidth,
          height: targetHeight,
          centerX,
          centerY,
          heightRatio,
        });

        if (windows.length >= maxWindows) {
          return windows;
        }
      }
    }
  }

  return windows;
}

async function extractFrames(
  options: VideoScanOptions,
  outputDir: string
): Promise<string[]> {
  const args = ['-hide_banner', '-loglevel', 'error'];

  if (options.offsetSeconds > 0) {
    args.push('-ss', String(options.offsetSeconds));
  }

  args.push('-i', options.videoPath);

  if (options.durationSeconds) {
    args.push('-t', String(options.durationSeconds));
  }

  args.push('-vf', `fps=${options.fps}`, '-q:v', '2', path.join(outputDir, 'frame-%06d.jpg'));

  await execFileAsync('ffmpeg', args);

  const frameFiles = (await readdir(outputDir))
    .filter((entry) => entry.endsWith('.jpg'))
    .sort()
    .map((entry) => path.join(outputDir, entry));

  return options.maxFrames ? frameFiles.slice(0, options.maxFrames) : frameFiles;
}

async function scanFrame(
  framePath: string,
  frameIndex: number,
  seconds: number,
  tcg: SupportedTcg,
  aspectRatio: number,
  maxWindows: number,
  scanCardImageFn: (imageBuffer: Buffer, tcgFilter?: string) => Promise<ScanResult>
): Promise<FrameDetection | null> {
  const frameBuffer = await readFile(framePath);
  const frameImage = sharp(frameBuffer);
  const metadata = await frameImage.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const windows = buildFrameWindows(width, height, aspectRatio, maxWindows);
  let bestDetection: FrameDetection | null = null;

  for (const window of windows) {
    const cropBuffer = await frameImage.clone().extract(window).toBuffer();
    const result = await scanCardImageFn(cropBuffer, tcg);
    if (!result.bestMatch) {
      continue;
    }

    const detection: FrameDetection = {
      framePath,
      frameIndex,
      seconds,
      window,
      match: result.bestMatch,
      meta: result.meta,
    };

    if (
      !bestDetection ||
      detection.match.distance < bestDetection.match.distance ||
      (detection.match.distance === bestDetection.match.distance &&
        detection.match.confidence > bestDetection.match.confidence)
    ) {
      bestDetection = detection;
    }

    if (detection.match.distance <= STRONG_MATCH_DISTANCE) {
      break;
    }
  }

  return bestDetection;
}

function summarizeDetections(detections: FrameDetection[]) {
  const byCard = new Map<
    string,
    {
      externalId: string;
      name: string;
      setCode: string | null;
      count: number;
      bestDistance: number;
      bestConfidence: number;
      frames: string[];
    }
  >();

  for (const detection of detections) {
    const key = `${detection.match.tcg}:${detection.match.externalId}`;
    const existing = byCard.get(key);

    if (!existing) {
      byCard.set(key, {
        externalId: detection.match.externalId,
        name: detection.match.name,
        setCode: detection.match.setCode,
        count: 1,
        bestDistance: detection.match.distance,
        bestConfidence: detection.match.confidence,
        frames: [formatSeconds(detection.seconds)],
      });
      continue;
    }

    existing.count++;
    existing.bestDistance = Math.min(existing.bestDistance, detection.match.distance);
    existing.bestConfidence = Math.max(existing.bestConfidence, detection.match.confidence);
    existing.frames.push(formatSeconds(detection.seconds));
  }

  return Array.from(byCard.values()).sort((left, right) => {
    return (
      right.count - left.count ||
      left.bestDistance - right.bestDistance ||
      right.bestConfidence - left.bestConfidence ||
      left.externalId.localeCompare(right.externalId)
    );
  });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  process.env.NODE_ENV = 'test';
  process.env.BACKEND_MODE = 'convex';
  process.env.CARD_SCAN_STORE = 'file';
  const { scanCardImage } = await import('../modules/card-scan');

  const framesDir = await mkdtemp(path.join(os.tmpdir(), 'tcger-video-scan-'));

  try {
    const frameFiles = await extractFrames(options, framesDir);
    if (!frameFiles.length) {
      throw new Error('No frames were extracted from the video');
    }

    const detections: FrameDetection[] = [];

    for (const [index, framePath] of frameFiles.entries()) {
      const seconds = options.offsetSeconds + index / options.fps;
      const detection = await scanFrame(
        framePath,
        index,
        seconds,
        options.tcg,
        options.cardAspectRatio,
        options.maxWindows,
        scanCardImage
      );

      if (detection) {
        detections.push(detection);
      }
    }

    console.log(
      JSON.stringify(
        {
          videoPath: options.videoPath,
          tcg: options.tcg,
          fps: options.fps,
          offsetSeconds: options.offsetSeconds,
          durationSeconds: options.durationSeconds ?? null,
          framesScanned: frameFiles.length,
          matchedFrames: detections.length,
          maxWindows: options.maxWindows,
          detections: detections.map((detection) => ({
            frame: path.basename(detection.framePath),
            timestamp: formatSeconds(detection.seconds),
            seconds: Number(detection.seconds.toFixed(2)),
            window: detection.window,
            match: {
              externalId: detection.match.externalId,
              name: detection.match.name,
              setCode: detection.match.setCode,
              confidence: detection.match.confidence,
              distance: detection.match.distance,
              fullDistance: detection.match.fullDistance ?? null,
              titleDistance: detection.match.titleDistance ?? null,
              footerDistance: detection.match.footerDistance ?? null,
            },
            meta: detection.meta,
          })),
          summary: summarizeDetections(detections),
        },
        null,
        2
      )
    );
  } finally {
    if (!options.keepFrames) {
      await rm(framesDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
