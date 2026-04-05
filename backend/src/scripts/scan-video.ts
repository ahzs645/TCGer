import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import sharp from 'sharp';

import type { ScanMatch, ScanResult } from '../modules/card-scan';
import {
  initCardDetector,
  detectCards,
  detectionToExtractRegion,
  extractRotatedCrop,
  ocrCardTitle,
  levenshtein,
} from '../modules/card-scan/card-detector';

const execFileAsync = promisify(execFile);
const DEFAULT_CARD_ASPECT_RATIO = 0.714;
const DEFAULT_CENTERS_X = [0.5, 0.6, 0.65, 0.55, 0.45];
const DEFAULT_CENTERS_Y = [0.52, 0.48, 0.56];
const DEFAULT_HEIGHT_RATIOS = [0.75, 0.65, 0.85, 0.55];
const DEFAULT_MAX_WINDOWS = 24;
const DEFAULT_MAX_PROPOSALS = 3;
const DEFAULT_TRACK_TTL_FRAMES = 3;
const DEFAULT_MIN_STABLE_FRAMES = 2;
const PROPOSAL_SCORE_FLOOR = 10;
const PROPOSAL_QUALITY_FLOOR = 0.08;
const PROPOSAL_NMS_IOU = 0.55;
const TRACK_IOU_GATING = 0.08;
const TRACK_CENTER_GATING = 0.45;
const TRACK_SIZE_DELTA_GATING = 0.7;
const TRACK_ASSOCIATION_THRESHOLD = 0.35;
const EMIT_SCORE_THRESHOLD = 0.5;
const FINALIZE_SCORE_THRESHOLD = 0.55;
const EMIT_MARGIN_THRESHOLD = 0.08;
const MATCH_DISTANCE_REFERENCE = 240;

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
  maxProposals: number;
  trackTtlFrames: number;
  minStableFrames: number;
  keepFrames: boolean;
  detectorModelPath?: string;
  detectorInputSize: number;
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

interface MinimalMatch {
  externalId: string;
  tcg: string;
  name: string;
  setCode: string | null;
  confidence: number;
  distance: number;
  fullDistance?: number;
  titleDistance?: number | null;
  footerDistance?: number | null;
}

interface FrameProposal {
  framePath: string;
  frameIndex: number;
  seconds: number;
  window: FrameWindow;
  result: ScanResult;
  score: number;
  ocrText: string | null;
}

interface TrackCandidateEvidence {
  key: string;
  match: MinimalMatch;
  totalConfidence: number;
  bestConfidence: number;
  bestDistance: number;
  totalCropQuality: number;
  observations: number;
  topWins: number;
}

interface TrackObservation {
  frame: string;
  timestamp: string;
  seconds: number;
  window: FrameWindow;
  score: number;
  quality: number | null;
  bestMatch: MinimalMatch | null;
}

interface VideoTrack {
  id: number;
  status: 'active' | 'finalized';
  firstSeenFrame: number;
  lastSeenFrame: number;
  firstSeenSeconds: number;
  lastSeenSeconds: number;
  missCount: number;
  stableFrameCount: number;
  observationCount: number;
  hasEmitted: boolean;
  finalCardKey: string | null;
  finalCardId: string | null;
  finalCardName: string | null;
  finalSetCode: string | null;
  lastWindow: FrameWindow;
  bestCropQuality: number;
  bestProposalScore: number;
  bestProposal: TrackObservation | null;
  ocrVotes: {
    title: string[];
    collectorNumber: string[];
    setText: string[];
  };
  candidateScores: Map<string, TrackCandidateEvidence>;
  lastLeaderKey: string | null;
  consecutiveLeaderCount: number;
  observations: TrackObservation[];
}

interface TrackRanking {
  key: string;
  score: number;
  evidence: TrackCandidateEvidence;
}

interface TrackEvent {
  type: 'emit' | 'finalize';
  trackId: number;
  seconds: number;
  timestamp: string;
  reason: string;
  card: MinimalMatch | null;
  score: number | null;
  margin: number | null;
}

interface FrameSummary {
  frame: string;
  timestamp: string;
  seconds: number;
  proposals: Array<{
    trackId: number | null;
    window: FrameWindow;
    score: number;
    quality: number | null;
    bestMatch: MinimalMatch | null;
  }>;
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
  let maxProposals =
    parsePositiveInteger(process.env.CARD_SCAN_VIDEO_MAX_PROPOSALS) ?? DEFAULT_MAX_PROPOSALS;
  let trackTtlFrames =
    parsePositiveInteger(process.env.CARD_SCAN_VIDEO_TRACK_TTL_FRAMES) ?? DEFAULT_TRACK_TTL_FRAMES;
  let minStableFrames =
    parsePositiveInteger(process.env.CARD_SCAN_VIDEO_MIN_STABLE_FRAMES) ?? DEFAULT_MIN_STABLE_FRAMES;
  let cardAspectRatio = parsePositiveNumber(
    process.env.CARD_SCAN_VIDEO_ASPECT_RATIO,
    DEFAULT_CARD_ASPECT_RATIO
  );
  let keepFrames = process.env.CARD_SCAN_VIDEO_KEEP_FRAMES === '1';
  let detectorModelPath: string | undefined = process.env.CARD_SCAN_DETECTOR_MODEL;
  let detectorInputSize = parsePositiveNumber(process.env.CARD_SCAN_DETECTOR_INPUT_SIZE, 1088);

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

    if (token === '--max-proposals') {
      maxProposals = parsePositiveInteger(args.shift()) ?? maxProposals;
      continue;
    }

    if (token === '--track-ttl') {
      trackTtlFrames = parsePositiveInteger(args.shift()) ?? trackTtlFrames;
      continue;
    }

    if (token === '--min-stable') {
      minStableFrames = parsePositiveInteger(args.shift()) ?? minStableFrames;
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

    if (token === '--detector') {
      detectorModelPath = args.shift() ?? detectorModelPath;
      continue;
    }

    if (token === '--detector-input-size') {
      detectorInputSize = parsePositiveNumber(args.shift(), detectorInputSize);
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
    maxProposals,
    trackTtlFrames,
    minStableFrames,
    keepFrames,
    detectorModelPath,
    detectorInputSize,
  };
}

function printUsage(): void {
  console.log(`Usage:
  npm run scan:video -- --video /path/to/video.mp4 --tcg pokemon --fps 1 --offset 0 --duration 60 --max-windows 24 --max-proposals 3 --track-ttl 3 --min-stable 2

Environment fallbacks:
  CARD_SCAN_VIDEO_PATH
  CARD_SCAN_VIDEO_TCG
  CARD_SCAN_VIDEO_FPS
  CARD_SCAN_VIDEO_OFFSET
  CARD_SCAN_VIDEO_DURATION
  CARD_SCAN_VIDEO_MAX_FRAMES
  CARD_SCAN_VIDEO_MAX_WINDOWS
  CARD_SCAN_VIDEO_MAX_PROPOSALS
  CARD_SCAN_VIDEO_TRACK_TTL_FRAMES
  CARD_SCAN_VIDEO_MIN_STABLE_FRAMES
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

function toMinimalMatch(match: ScanMatch | null): MinimalMatch | null {
  if (!match) {
    return null;
  }

  return {
    externalId: match.externalId,
    tcg: match.tcg,
    name: match.name,
    setCode: match.setCode ?? null,
    confidence: match.confidence,
    distance: match.distance,
    fullDistance: match.fullDistance,
    titleDistance: match.titleDistance ?? null,
    footerDistance: match.footerDistance ?? null,
  };
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

function buildFrameWindows(
  frameWidth: number,
  frameHeight: number,
  aspectRatio: number,
  maxWindows: number
): FrameWindow[] {
  const windows: FrameWindow[] = [
    {
      left: 0,
      top: 0,
      width: frameWidth,
      height: frameHeight,
      centerX: 0.5,
      centerY: 0.5,
      heightRatio: 1,
    },
  ];

  if (windows.length >= maxWindows) {
    return windows;
  }

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

function shouldKeepProposal(result: ScanResult, score: number): boolean {
  const quality = result.meta.quality?.score ?? 0;

  return (
    Boolean(result.bestMatch) ||
    result.meta.shortlistSize > 0 ||
    result.meta.perspectiveCorrected ||
    quality >= PROPOSAL_QUALITY_FLOOR ||
    score >= PROPOSAL_SCORE_FLOOR
  );
}

function windowArea(window: FrameWindow): number {
  return window.width * window.height;
}

function windowIou(left: FrameWindow, right: FrameWindow): number {
  const x1 = Math.max(left.left, right.left);
  const y1 = Math.max(left.top, right.top);
  const x2 = Math.min(left.left + left.width, right.left + right.width);
  const y2 = Math.min(left.top + left.height, right.top + right.height);

  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersection = intersectionWidth * intersectionHeight;
  if (!intersection) {
    return 0;
  }

  const union = windowArea(left) + windowArea(right) - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizedCenterDistance(left: FrameWindow, right: FrameWindow): number {
  const leftCenterX = left.left + left.width / 2;
  const leftCenterY = left.top + left.height / 2;
  const rightCenterX = right.left + right.width / 2;
  const rightCenterY = right.top + right.height / 2;
  const deltaX = leftCenterX - rightCenterX;
  const deltaY = leftCenterY - rightCenterY;
  const distance = Math.hypot(deltaX, deltaY);
  const normalizer = Math.max(left.width, left.height, right.width, right.height, 1);
  return Math.min(1, distance / normalizer);
}

function sizeDeltaRatio(left: FrameWindow, right: FrameWindow): number {
  const leftArea = windowArea(left);
  const rightArea = windowArea(right);
  if (!leftArea || !rightArea) {
    return 1;
  }

  return Math.min(1, Math.abs(leftArea - rightArea) / Math.max(leftArea, rightArea));
}

function filterDistinctProposals(proposals: FrameProposal[], maxProposals: number): FrameProposal[] {
  const selected: FrameProposal[] = [];

  for (const proposal of [...proposals].sort((left, right) => right.score - left.score)) {
    if (selected.some((existing) => windowIou(existing.window, proposal.window) >= PROPOSAL_NMS_IOU)) {
      continue;
    }

    selected.push(proposal);
    if (selected.length >= maxProposals) {
      break;
    }
  }

  return selected;
}

async function scanFrameProposals(
  framePath: string,
  frameIndex: number,
  seconds: number,
  tcg: SupportedTcg,
  aspectRatio: number,
  maxWindows: number,
  maxProposals: number,
  scanCardImageFn: (imageBuffer: Buffer, tcgFilter?: string) => Promise<ScanResult>
): Promise<FrameProposal[]> {
  const frameBuffer = await readFile(framePath);
  const frameImage = sharp(frameBuffer);
  const metadata = await frameImage.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    return [];
  }

  const windows = buildFrameWindows(width, height, aspectRatio, maxWindows);
  const proposals: FrameProposal[] = [];

  for (const window of windows) {
    const cropBuffer = await frameImage.clone().extract(window).toBuffer();
    const result = await scanCardImageFn(cropBuffer, tcg);
    const score = scoreScanResult(result);

    if (!shouldKeepProposal(result, score)) {
      continue;
    }

    proposals.push({
      framePath,
      frameIndex,
      seconds,
      window,
      result,
      ocrText: null,
      score,
    });
  }

  return filterDistinctProposals(proposals, maxProposals);
}

async function scanFrameProposalsWithDetector(
  framePath: string,
  frameIndex: number,
  seconds: number,
  tcg: SupportedTcg,
  maxProposals: number,
  scanCardImageFn: (imageBuffer: Buffer, tcgFilter?: string, options?: { maxDistanceOverride?: number }) => Promise<ScanResult>
): Promise<FrameProposal[]> {
  const frameBuffer = await readFile(framePath);
  const frameImage = sharp(frameBuffer);
  const metadata = await frameImage.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    return [];
  }

  const detections = await detectCards(frameBuffer, 0.25, 0.08);
  if (!detections.length) {
    return [];
  }

  const proposals: FrameProposal[] = [];

  for (const det of detections) {
    const region = detectionToExtractRegion(det, width, height);
    const window: FrameWindow = {
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
      centerX: det.cx / width,
      centerY: det.cy / height,
      heightRatio: region.height / height,
    };

    const cropBuffer = await extractRotatedCrop(frameBuffer, det, width, height);
    // Detector gives high-confidence localization — use relaxed hash threshold
    const result = await scanCardImageFn(cropBuffer, tcg, { maxDistanceOverride: 320 });

    // OCR-based narrowing: use tight crop (no expansion) for cleaner OCR
    const tightCrop = await extractRotatedCrop(frameBuffer, {
      ...det,
      width: det.width / (1 + 0.08),
      height: det.height / (1 + 0.08),
    }, width, height);
    let ocrText: string | null = null;
    try { ocrText = await ocrCardTitle(tightCrop); } catch { /* ignore */ }

    // Only use OCR for narrowing when the text looks plausible:
    // - mostly alphabetic (>70% alpha chars)
    // - reasonable length (4-20 chars)
    // - not all caps garbage
    if (ocrText) {
      const alphaRatio = (ocrText.match(/[a-zA-Z]/g)?.length ?? 0) / Math.max(1, ocrText.length);
      const isPlausible = alphaRatio >= 0.7 && ocrText.length >= 4 && ocrText.length <= 20 && ocrText !== ocrText.toUpperCase();

      if (isPlausible) {
        const ocrFirst = ocrText.toLowerCase().split(/\s+/)[0] ?? '';
        if (ocrFirst.length >= 3) {
          console.error(`[detector-ocr] text="${ocrText}" → name filter (${ocrFirst})`);
          const ocrResult = await scanCardImageFn(cropBuffer, tcg, {
            maxDistanceOverride: 380,
            ocrNameHint: ocrFirst,
          });
          if (ocrResult.candidates.length > 0) {
            const reranked = [...ocrResult.candidates].sort((a, b) => {
              const aName = a.name.toLowerCase().split(/\s+/)[0] ?? '';
              const bName = b.name.toLowerCase().split(/\s+/)[0] ?? '';
              const aLev = levenshtein(ocrFirst.slice(0, aName.length + 2), aName);
              const bLev = levenshtein(ocrFirst.slice(0, bName.length + 2), bName);
              const aNorm = aName.length > 0 ? aLev / aName.length : 1;
              const bNorm = bName.length > 0 ? bLev / bName.length : 1;
              if (Math.abs(aNorm - bNorm) > 0.1) return aNorm - bNorm;
              return a.distance - b.distance;
            });
            const ocrBest = reranked[0]!;
            // Check if OCR name is a strong match (low levenshtein to top candidate)
            const ocrBestName = ocrBest.name.toLowerCase().split(/\s+/)[0] ?? '';
            const ocrLev = levenshtein(ocrFirst.slice(0, ocrBestName.length + 2), ocrBestName);
            const isExactNameMatch = ocrLev <= 1;

            // Trust OCR when it's an exact name match, or when distance is close
            if (isExactNameMatch || !result.bestMatch || ocrBest.distance <= result.bestMatch.distance + 30) {
              result.bestMatch = ocrBest;
              result.candidates = reranked;
            }
          }
        }
      } else {
        // OCR text is garbage — still store it for multi-frame accumulation but don't use for filtering
        ocrText = null;
      }
    }

    const score = scoreScanResult(result);

    if (!shouldKeepProposal(result, score)) {
      continue;
    }

    proposals.push({ framePath, frameIndex, seconds, window, result, score, ocrText });
  }

  return filterDistinctProposals(proposals, maxProposals);
}

function proposalSignal(proposal: FrameProposal): number {
  if (proposal.result.bestMatch) {
    return proposal.result.bestMatch.confidence;
  }

  return Math.min(1, proposal.score / 100);
}

function scoreAssociation(track: VideoTrack, proposal: FrameProposal): number {
  const iou = windowIou(track.lastWindow, proposal.window);
  const centerDistance = normalizedCenterDistance(track.lastWindow, proposal.window);
  const sizeDelta = sizeDeltaRatio(track.lastWindow, proposal.window);

  if (iou < TRACK_IOU_GATING && centerDistance > TRACK_CENTER_GATING) {
    return -1;
  }

  if (sizeDelta > TRACK_SIZE_DELTA_GATING && iou < 0.2) {
    return -1;
  }

  let score =
    iou * 0.5 +
    (1 - centerDistance) * 0.25 +
    (1 - sizeDelta) * 0.15 +
    proposalSignal(proposal) * 0.1;

  if (track.finalCardKey) {
    const cardKeys = proposal.result.candidates.map((candidate) => `${candidate.tcg}:${candidate.externalId}`);
    if (cardKeys.includes(track.finalCardKey)) {
      score += 0.05;
    }
  }

  if (track.lastLeaderKey) {
    const cardKeys = proposal.result.candidates.map((candidate) => `${candidate.tcg}:${candidate.externalId}`);
    if (cardKeys.includes(track.lastLeaderKey)) {
      score += 0.05;
    }
  }

  return score;
}

function associateProposalsToTracks(
  tracks: VideoTrack[],
  proposals: FrameProposal[]
): Map<number, VideoTrack> {
  const pairs: Array<{ track: VideoTrack; proposalIndex: number; score: number }> = [];

  for (const track of tracks) {
    for (const [proposalIndex, proposal] of proposals.entries()) {
      const score = scoreAssociation(track, proposal);
      if (score >= TRACK_ASSOCIATION_THRESHOLD) {
        pairs.push({ track, proposalIndex, score });
      }
    }
  }

  pairs.sort((left, right) => right.score - left.score);

  const assignedTracks = new Set<number>();
  const assignedProposals = new Set<number>();
  const assignments = new Map<number, VideoTrack>();

  for (const pair of pairs) {
    if (assignedTracks.has(pair.track.id) || assignedProposals.has(pair.proposalIndex)) {
      continue;
    }

    assignments.set(pair.proposalIndex, pair.track);
    assignedTracks.add(pair.track.id);
    assignedProposals.add(pair.proposalIndex);
  }

  return assignments;
}

function createObservation(proposal: FrameProposal): TrackObservation {
  return {
    frame: path.basename(proposal.framePath),
    timestamp: formatSeconds(proposal.seconds),
    seconds: Number(proposal.seconds.toFixed(2)),
    window: proposal.window,
    score: Number(proposal.score.toFixed(2)),
    quality: proposal.result.meta.quality?.score ?? null,
    bestMatch: toMinimalMatch(proposal.result.bestMatch),
  };
}

function createTrack(trackId: number, proposal: FrameProposal): VideoTrack {
  return {
    id: trackId,
    status: 'active',
    firstSeenFrame: proposal.frameIndex,
    lastSeenFrame: proposal.frameIndex,
    firstSeenSeconds: proposal.seconds,
    lastSeenSeconds: proposal.seconds,
    missCount: 0,
    stableFrameCount: 0,
    observationCount: 0,
    hasEmitted: false,
    finalCardKey: null,
    finalCardId: null,
    finalCardName: null,
    finalSetCode: null,
    lastWindow: proposal.window,
    bestCropQuality: 0,
    bestProposalScore: Number.NEGATIVE_INFINITY,
    bestProposal: null,
    ocrVotes: {
      title: [],
      collectorNumber: [],
      setText: [],
    },
    candidateScores: new Map<string, TrackCandidateEvidence>(),
    lastLeaderKey: null,
    consecutiveLeaderCount: 0,
    observations: [],
  };
}

function updateCandidateScores(track: VideoTrack, proposal: FrameProposal): void {
  const quality = proposal.result.meta.quality?.score ?? 0;

  for (const [index, candidate] of proposal.result.candidates.entries()) {
    const key = `${candidate.tcg}:${candidate.externalId}`;
    const weight = index === 0 ? 1 : Math.max(0.3, 1 - index * 0.25);
    const confidenceContribution = candidate.confidence * weight;
    const existing = track.candidateScores.get(key);

    if (existing) {
      existing.totalConfidence += confidenceContribution;
      existing.bestConfidence = Math.max(existing.bestConfidence, candidate.confidence);
      existing.bestDistance = Math.min(existing.bestDistance, candidate.distance);
      existing.totalCropQuality += quality;
      existing.observations += 1;
      if (index === 0) {
        existing.topWins += 1;
      }
      if (
        candidate.confidence > existing.match.confidence ||
        candidate.distance < existing.match.distance
      ) {
        existing.match = toMinimalMatch(candidate)!;
      }
      continue;
    }

    track.candidateScores.set(key, {
      key,
      match: toMinimalMatch(candidate)!,
      totalConfidence: confidenceContribution,
      bestConfidence: candidate.confidence,
      bestDistance: candidate.distance,
      totalCropQuality: quality,
      observations: 1,
      topWins: index === 0 ? 1 : 0,
    });
  }
}

function computeOcrConsensusScore(track: VideoTrack, candidateName: string): number {
  const votes = track.ocrVotes.title;
  if (votes.length === 0) return 0;

  const candidateFirst = candidateName.toLowerCase().split(/\s+/)[0] ?? '';
  if (candidateFirst.length < 2) return 0;

  let totalScore = 0;
  for (const vote of votes) {
    const voteFirst = vote.split(/\s+/)[0] ?? '';
    const truncated = voteFirst.slice(0, candidateFirst.length + 2);
    const dist = levenshtein(truncated, candidateFirst);
    const maxLen = Math.max(truncated.length, candidateFirst.length, 1);
    totalScore += Math.max(0, 1 - dist / maxLen);
  }

  return totalScore / votes.length;
}

function rankTrackCandidates(track: VideoTrack): TrackRanking[] {
  const hasOcrVotes = track.ocrVotes.title.length > 0;

  return Array.from(track.candidateScores.values())
    .map((evidence) => {
      const avgConfidence = evidence.totalConfidence / Math.max(1, evidence.observations);
      const distanceScore = Math.max(0, 1 - evidence.bestDistance / MATCH_DISTANCE_REFERENCE);
      const temporalConsistency = evidence.topWins / Math.max(1, track.observationCount);
      const cropQuality = evidence.totalCropQuality / Math.max(1, evidence.observations);

      const score = hasOcrVotes
        ? (() => {
            const ocrScore = computeOcrConsensusScore(track, evidence.match.name);
            return (
              avgConfidence * 0.35 +
              distanceScore * 0.25 +
              temporalConsistency * 0.10 +
              cropQuality * 0.10 +
              ocrScore * 0.20
            );
          })()
        : avgConfidence * 0.45 +
          distanceScore * 0.3 +
          temporalConsistency * 0.15 +
          cropQuality * 0.1;

      return {
        key: evidence.key,
        evidence,
        score: Number(score.toFixed(4)),
      };
    })
    .sort((left, right) => {
      return (
        right.score - left.score ||
        right.evidence.bestConfidence - left.evidence.bestConfidence ||
        left.evidence.bestDistance - right.evidence.bestDistance ||
        left.evidence.match.externalId.localeCompare(right.evidence.match.externalId)
      );
    });
}

function maybeEmitTrack(
  track: VideoTrack,
  seconds: number,
  minStableFrames: number,
  events: TrackEvent[]
): void {
  if (track.hasEmitted) {
    return;
  }

  const rankings = rankTrackCandidates(track);
  const leader = rankings[0];
  if (!leader) {
    return;
  }

  const margin = rankings[1] ? leader.score - rankings[1].score : null;
  const strongMargin = margin === null || margin >= EMIT_MARGIN_THRESHOLD;

  if (
    track.stableFrameCount < minStableFrames ||
    track.observationCount < minStableFrames ||
    track.consecutiveLeaderCount < minStableFrames ||
    leader.score < EMIT_SCORE_THRESHOLD ||
    !strongMargin
  ) {
    return;
  }

  track.hasEmitted = true;
  track.finalCardKey = leader.key;
  track.finalCardId = leader.evidence.match.externalId;
  track.finalCardName = leader.evidence.match.name;
  track.finalSetCode = leader.evidence.match.setCode ?? null;
  events.push({
    type: 'emit',
    trackId: track.id,
    seconds: Number(seconds.toFixed(2)),
    timestamp: formatSeconds(seconds),
    reason: 'stable-track',
    card: leader.evidence.match,
    score: leader.score,
    margin,
  });
}

function updateTrack(
  track: VideoTrack,
  proposal: FrameProposal,
  minStableFrames: number,
  events: TrackEvent[]
): void {
  const observation = createObservation(proposal);

  track.lastSeenFrame = proposal.frameIndex;
  track.lastSeenSeconds = proposal.seconds;
  track.lastWindow = proposal.window;
  track.missCount = 0;
  track.stableFrameCount += 1;
  track.observationCount += 1;
  track.observations.push(observation);

  if (proposal.ocrText) {
    track.ocrVotes.title.push(proposal.ocrText.toLowerCase());
  }

  const quality = proposal.result.meta.quality?.score ?? 0;
  if (
    !track.bestProposal ||
    quality > track.bestCropQuality ||
    proposal.score > track.bestProposalScore
  ) {
    track.bestCropQuality = Math.max(track.bestCropQuality, quality);
    track.bestProposalScore = Math.max(track.bestProposalScore, proposal.score);
    track.bestProposal = observation;
  }

  updateCandidateScores(track, proposal);

  const rankings = rankTrackCandidates(track);
  const leader = rankings[0] ?? null;
  if (leader?.key === track.lastLeaderKey) {
    track.consecutiveLeaderCount += 1;
  } else if (leader) {
    track.lastLeaderKey = leader.key;
    track.consecutiveLeaderCount = 1;
  } else {
    track.lastLeaderKey = null;
    track.consecutiveLeaderCount = 0;
  }

  maybeEmitTrack(track, proposal.seconds, minStableFrames, events);
}

function maybeEmitOnFinalize(track: VideoTrack, seconds: number, events: TrackEvent[]): void {
  if (track.hasEmitted) {
    return;
  }

  const rankings = rankTrackCandidates(track);
  const leader = rankings[0];
  if (!leader || leader.score < FINALIZE_SCORE_THRESHOLD) {
    return;
  }

  const margin = rankings[1] ? leader.score - rankings[1].score : null;
  track.hasEmitted = true;
  track.finalCardKey = leader.key;
  track.finalCardId = leader.evidence.match.externalId;
  track.finalCardName = leader.evidence.match.name;
  track.finalSetCode = leader.evidence.match.setCode ?? null;
  events.push({
    type: 'emit',
    trackId: track.id,
    seconds: Number(seconds.toFixed(2)),
    timestamp: formatSeconds(seconds),
    reason: 'finalize-threshold',
    card: leader.evidence.match,
    score: leader.score,
    margin,
  });
}

function finalizeTrack(
  track: VideoTrack,
  seconds: number,
  reason: string,
  events: TrackEvent[]
): void {
  maybeEmitOnFinalize(track, seconds, events);
  track.status = 'finalized';
  events.push({
    type: 'finalize',
    trackId: track.id,
    seconds: Number(seconds.toFixed(2)),
    timestamp: formatSeconds(seconds),
    reason,
    card: track.finalCardId
      ? {
          externalId: track.finalCardId,
          tcg: track.finalCardKey?.split(':')[0] ?? 'pokemon',
          name: track.finalCardName ?? track.finalCardId,
          setCode: track.finalSetCode,
          confidence: 0,
          distance: 0,
        }
      : null,
    score: null,
    margin: null,
  });
}

function finalizeExpiredTracks(
  tracks: VideoTrack[],
  finalized: VideoTrack[],
  currentSeconds: number,
  trackTtlFrames: number,
  events: TrackEvent[]
): VideoTrack[] {
  const remaining: VideoTrack[] = [];

  for (const track of tracks) {
    if (track.missCount >= trackTtlFrames) {
      finalizeTrack(track, currentSeconds, 'miss-ttl', events);
      finalized.push(track);
      continue;
    }

    remaining.push(track);
  }

  return remaining;
}

function shouldStartTrack(proposal: FrameProposal): boolean {
  return shouldKeepProposal(proposal.result, proposal.score);
}

function summarizeTracks(tracks: VideoTrack[]) {
  const byCard = new Map<
    string,
    {
      externalId: string;
      name: string;
      setCode: string | null;
      trackCount: number;
      firstSeen: string[];
      lastSeen: string[];
    }
  >();

  for (const track of tracks) {
    if (!track.finalCardKey || !track.finalCardId || !track.finalCardName) {
      continue;
    }

    const existing = byCard.get(track.finalCardKey);
    if (existing) {
      existing.trackCount += 1;
      existing.firstSeen.push(formatSeconds(track.firstSeenSeconds));
      existing.lastSeen.push(formatSeconds(track.lastSeenSeconds));
      continue;
    }

    byCard.set(track.finalCardKey, {
      externalId: track.finalCardId,
      name: track.finalCardName,
      setCode: track.finalSetCode,
      trackCount: 1,
      firstSeen: [formatSeconds(track.firstSeenSeconds)],
      lastSeen: [formatSeconds(track.lastSeenSeconds)],
    });
  }

  return Array.from(byCard.values()).sort((left, right) => {
    return (
      right.trackCount - left.trackCount ||
      left.name.localeCompare(right.name) ||
      left.externalId.localeCompare(right.externalId)
    );
  });
}

function summarizeTrack(track: VideoTrack) {
  return {
    trackId: track.id,
    status: track.status,
    firstSeenFrame: track.firstSeenFrame,
    lastSeenFrame: track.lastSeenFrame,
    firstSeenAt: formatSeconds(track.firstSeenSeconds),
    lastSeenAt: formatSeconds(track.lastSeenSeconds),
    observationCount: track.observationCount,
    stableFrameCount: track.stableFrameCount,
    hasEmitted: track.hasEmitted,
    finalCardId: track.finalCardId,
    finalCardName: track.finalCardName,
    finalSetCode: track.finalSetCode,
    bestCropQuality: Number(track.bestCropQuality.toFixed(4)),
    ocrVotes: track.ocrVotes.title.length > 0 ? track.ocrVotes : undefined,
    bestProposal: track.bestProposal,
    topCandidates: rankTrackCandidates(track).slice(0, 5).map((candidate) => ({
      externalId: candidate.evidence.match.externalId,
      tcg: candidate.evidence.match.tcg,
      name: candidate.evidence.match.name,
      setCode: candidate.evidence.match.setCode,
      trackScore: candidate.score,
      bestConfidence: candidate.evidence.bestConfidence,
      bestDistance: candidate.evidence.bestDistance,
      observations: candidate.evidence.observations,
      topWins: candidate.evidence.topWins,
    })),
    observations: track.observations,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  process.env.NODE_ENV = 'test';
  process.env.BACKEND_MODE = 'convex';
  process.env.CARD_SCAN_STORE = 'file';
  const { scanCardImage } = await import('../modules/card-scan');

  const useDetector = Boolean(options.detectorModelPath);
  if (useDetector) {
    console.error(`[scan-video] initialising detector: ${options.detectorModelPath}`);
    await initCardDetector(options.detectorModelPath!, options.detectorInputSize);
    console.error('[scan-video] detector ready');
  }

  const framesDir = await mkdtemp(path.join(os.tmpdir(), 'tcger-video-scan-'));
  let nextTrackId = 1;

  try {
    const frameFiles = await extractFrames(options, framesDir);
    if (!frameFiles.length) {
      throw new Error('No frames were extracted from the video');
    }

    const frameSummaries: FrameSummary[] = [];
    const finalizedTracks: VideoTrack[] = [];
    let activeTracks: VideoTrack[] = [];
    const events: TrackEvent[] = [];
    let matchedFrames = 0;

    for (const [index, framePath] of frameFiles.entries()) {
      const seconds = options.offsetSeconds + index / options.fps;
      const proposals = useDetector
        ? await scanFrameProposalsWithDetector(
            framePath,
            index,
            seconds,
            options.tcg,
            options.maxProposals,
            scanCardImage
          )
        : await scanFrameProposals(
            framePath,
            index,
            seconds,
            options.tcg,
            options.cardAspectRatio,
            options.maxWindows,
            options.maxProposals,
            scanCardImage
          );
      const assignments = associateProposalsToTracks(activeTracks, proposals);
      const matchedTrackIds = new Set<number>();
      const summaryTrackIds = new Map<number, number>();
      const unmatchedProposalIndices: number[] = [];
      let frameMatched = false;

      const summaryProposals: FrameSummary['proposals'] = [];

      for (const [proposalIndex, proposal] of proposals.entries()) {
        const track = assignments.get(proposalIndex) ?? null;

        if (track) {
          updateTrack(track, proposal, options.minStableFrames, events);
          matchedTrackIds.add(track.id);
          summaryTrackIds.set(proposalIndex, track.id);
        } else {
          unmatchedProposalIndices.push(proposalIndex);
        }

        if (proposal.result.bestMatch) {
          frameMatched = true;
        }
      }

      for (const proposalIndex of unmatchedProposalIndices) {
        const proposal = proposals[proposalIndex]!;
        if (!shouldStartTrack(proposal)) {
          continue;
        }

        const track = createTrack(nextTrackId++, proposal);
        activeTracks.push(track);
        updateTrack(track, proposal, options.minStableFrames, events);
        matchedTrackIds.add(track.id);
        summaryTrackIds.set(proposalIndex, track.id);
        break;
      }

      if (frameMatched) {
        matchedFrames += 1;
      }

      for (const [proposalIndex, proposal] of proposals.entries()) {
        summaryProposals.push({
          trackId: summaryTrackIds.get(proposalIndex) ?? null,
          window: proposal.window,
          score: Number(proposal.score.toFixed(2)),
          quality: proposal.result.meta.quality?.score ?? null,
          bestMatch: toMinimalMatch(proposal.result.bestMatch),
        });
      }

      for (const track of activeTracks) {
        if (!matchedTrackIds.has(track.id)) {
          track.missCount += 1;
        }
      }

      frameSummaries.push({
        frame: path.basename(framePath),
        timestamp: formatSeconds(seconds),
        seconds: Number(seconds.toFixed(2)),
        proposals: summaryProposals,
      });

      activeTracks = finalizeExpiredTracks(
        activeTracks,
        finalizedTracks,
        seconds,
        options.trackTtlFrames,
        events
      );
    }

    const endSeconds =
      options.offsetSeconds + Math.max(0, (frameFiles.length - 1) / Math.max(options.fps, 1));

    for (const track of activeTracks) {
      finalizeTrack(track, endSeconds, 'end-of-video', events);
      finalizedTracks.push(track);
    }

    const detections = events
      .filter((event) => event.type === 'emit')
      .map((event) => ({
        trackId: event.trackId,
        timestamp: event.timestamp,
        seconds: event.seconds,
        reason: event.reason,
        card: event.card,
        score: event.score,
        margin: event.margin,
      }));

    console.log(
      JSON.stringify(
        {
          videoPath: options.videoPath,
          tcg: options.tcg,
          fps: options.fps,
          offsetSeconds: options.offsetSeconds,
          durationSeconds: options.durationSeconds ?? null,
          detector: options.detectorModelPath ?? null,
          framesScanned: frameFiles.length,
          matchedFrames,
          maxWindows: useDetector ? null : options.maxWindows,
          maxProposals: options.maxProposals,
          trackTtlFrames: options.trackTtlFrames,
          minStableFrames: options.minStableFrames,
          detections,
          events,
          tracks: finalizedTracks.map(summarizeTrack),
          summary: summarizeTracks(finalizedTracks),
          frames: frameSummaries,
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
  console.error(error);
  process.exit(1);
});
