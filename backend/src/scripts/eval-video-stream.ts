/**
 * Score scanner stream output against timestamped video ground truth.
 *
 * Supports:
 * - backend/src/scripts/scan-video.ts JSON output (`frames[].proposals[]`)
 * - browser-style frame states (`[{ timestampSeconds, bestMatch, candidates, proposalMatches }]`)
 * - a wrapper object with `frames`, `frameStates`, `results`, or `observations`
 *
 * By default, frame-like results are scored as one best observation per frame.
 * Use --include-proposals to also score every proposal-level match.
 *
 * Usage:
 *   npm run eval:video-stream -- \
 *     --ground-truth fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.json \
 *     --results /tmp/scan-results.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface GroundTruthManifest {
  version: number;
  kind: string;
  name?: string;
  tcg?: string;
  windows: GroundTruthWindow[];
}

interface GroundTruthWindow {
  id: string;
  startSeconds: number;
  endSeconds: number;
  name: string;
  expectedExternalIds?: string[];
  acceptedNames?: string[];
  tags?: string[];
}

interface CandidateLike {
  externalId?: string | null;
  name?: string | null;
  setCode?: string | null;
  confidence?: number | null;
  similarity?: number | null;
  artworkSimilarity?: number | null;
  passedThreshold?: boolean | null;
  proposalLabel?: string | null;
}

interface Observation {
  seconds: number;
  source: string;
  bestMatch: CandidateLike | null;
  candidates: CandidateLike[];
}

interface WindowScore {
  id: string;
  expectedName: string;
  startSeconds: number;
  endSeconds: number;
  tags: string[];
  observations: number;
  detections: number;
  top1NameHit: boolean;
  top1ExternalIdHit: boolean;
  candidateNameHit: boolean;
  candidateExternalIdHit: boolean;
  bestObservation: {
    seconds: number;
    name: string | null;
    externalId: string | null;
    confidence: number | null;
    source: string;
  } | null;
}

interface EvalOptions {
  groundTruthPath: string;
  resultsPath: string;
  outPath?: string;
  includeTags: Set<string>;
  excludeTags: Set<string>;
  includeProposals: boolean;
}

function parseArgs(argv: string[]): EvalOptions {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
  };
  const hasFlag = (flag: string): boolean => argv.includes(flag);

  const splitSet = (value: string | undefined): Set<string> =>
    new Set(
      (value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    );

  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    process.exit(0);
  }

  const groundTruthPath = get('--ground-truth') ?? get('--gt');
  const resultsPath = get('--results');
  if (!groundTruthPath || !resultsPath) {
    printUsage();
    process.exit(1);
  }

  return {
    groundTruthPath,
    resultsPath,
    outPath: get('--out'),
    includeTags: splitSet(get('--include-tags')),
    excludeTags: splitSet(get('--exclude-tags')),
    includeProposals: hasFlag('--include-proposals') || hasFlag('--proposals'),
  };
}

function printUsage(): void {
  console.log(`Usage:
  npm run eval:video-stream -- --ground-truth <ground-truth.json> --results <scanner-results.json> [options]

Options:
  --out <path>            write the JSON report to a file
  --include-tags a,b      only score windows containing at least one listed tag
  --exclude-tags a,b      skip windows containing any listed tag
  --include-proposals     also score proposalMatches/proposals (alias: --proposals)`);
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeExternalId(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function candidateConfidence(candidate: CandidateLike | null): number | null {
  if (!candidate) {
    return null;
  }

  const value = candidate.confidence ?? candidate.similarity ?? candidate.artworkSimilarity ?? null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function candidateMatchesName(candidate: CandidateLike | null, window: GroundTruthWindow): boolean {
  if (!candidate?.name) {
    return false;
  }

  const acceptedNames = [window.name, ...(window.acceptedNames ?? [])].map(normalizeName);
  return acceptedNames.includes(normalizeName(candidate.name));
}

function candidateMatchesExternalId(
  candidate: CandidateLike | null,
  window: GroundTruthWindow,
): boolean {
  if (!candidate?.externalId || !window.expectedExternalIds?.length) {
    return false;
  }

  const acceptedIds = new Set(window.expectedExternalIds.map(normalizeExternalId));
  return acceptedIds.has(normalizeExternalId(candidate.externalId));
}

function inWindow(observation: Observation, window: GroundTruthWindow): boolean {
  return observation.seconds >= window.startSeconds && observation.seconds <= window.endSeconds;
}

function hasAnyTag(window: GroundTruthWindow, tags: Set<string>): boolean {
  if (!tags.size) {
    return false;
  }

  const windowTags = new Set(window.tags ?? []);
  for (const tag of tags) {
    if (windowTags.has(tag)) {
      return true;
    }
  }
  return false;
}

function shouldScoreWindow(window: GroundTruthWindow, options: EvalOptions): boolean {
  if (hasAnyTag(window, options.excludeTags)) {
    return false;
  }

  if (!options.includeTags.size) {
    return true;
  }

  return hasAnyTag(window, options.includeTags);
}

function toCandidate(value: unknown): CandidateLike | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as CandidateLike;
  if (!candidate.name && !candidate.externalId) {
    return null;
  }

  return candidate;
}

function toCandidateArray(value: unknown): CandidateLike[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(toCandidate)
    .filter((candidate): candidate is CandidateLike => Boolean(candidate));
}

function numberFrom(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractObservations(raw: unknown, options: EvalOptions): Observation[] {
  const root = raw as Record<string, unknown>;
  const observations: Observation[] = [];

  if (Array.isArray(raw)) {
    observations.push(...extractBrowserFrameObservations(raw, 'array', options.includeProposals));
  }

  if (Array.isArray(root.frames)) {
    observations.push(...extractScanVideoFrameObservations(root.frames, options.includeProposals));
    observations.push(
      ...extractBrowserFrameObservations(root.frames, 'frames', options.includeProposals),
    );
  }

  for (const key of ['frameStates', 'results', 'observations']) {
    if (Array.isArray(root[key])) {
      observations.push(
        ...extractBrowserFrameObservations(root[key] as unknown[], key, options.includeProposals),
      );
    }
  }

  if (Array.isArray(root.detections)) {
    observations.push(...extractDetectionObservations(root.detections));
  }

  return observations
    .filter((observation) => Number.isFinite(observation.seconds))
    .sort((left, right) => left.seconds - right.seconds);
}

function extractScanVideoFrameObservations(
  frames: unknown[],
  includeProposals: boolean,
): Observation[] {
  const observations: Observation[] = [];

  for (const frame of frames) {
    if (!frame || typeof frame !== 'object') {
      continue;
    }

    const frameRecord = frame as Record<string, unknown>;
    const seconds = numberFrom(frameRecord.seconds);
    if (seconds === null || !Array.isArray(frameRecord.proposals)) {
      continue;
    }

    const frameObservations: Observation[] = [];
    for (const proposal of frameRecord.proposals) {
      if (!proposal || typeof proposal !== 'object') {
        continue;
      }

      const proposalRecord = proposal as Record<string, unknown>;
      const bestMatch = toCandidate(proposalRecord.bestMatch);
      frameObservations.push({
        seconds,
        source: 'scan-video.frames.proposals',
        bestMatch,
        candidates: bestMatch ? [bestMatch] : [],
      });
    }

    if (includeProposals) {
      observations.push(...frameObservations);
      continue;
    }

    const bestObservation = chooseBestObservation(frameObservations);
    if (bestObservation) {
      observations.push({
        ...bestObservation,
        source: 'scan-video.frames.bestProposal',
      });
    }
  }

  return observations;
}

function extractDetectionObservations(detections: unknown[]): Observation[] {
  const observations: Observation[] = [];

  for (const detection of detections) {
    if (!detection || typeof detection !== 'object') {
      continue;
    }

    const record = detection as Record<string, unknown>;
    const seconds = numberFrom(record.seconds);
    const bestMatch = toCandidate(record.card);
    if (seconds === null) {
      continue;
    }

    observations.push({
      seconds,
      source: 'scan-video.detections',
      bestMatch,
      candidates: bestMatch ? [bestMatch] : [],
    });
  }

  return observations;
}

function extractBrowserFrameObservations(
  frames: unknown[],
  source: string,
  includeProposals: boolean,
): Observation[] {
  const observations: Observation[] = [];

  for (const frame of frames) {
    if (!frame || typeof frame !== 'object') {
      continue;
    }

    const frameRecord = frame as Record<string, unknown>;
    const seconds =
      numberFrom(frameRecord.timestampSeconds) ??
      numberFrom(frameRecord.seconds) ??
      numberFrom(frameRecord.currentTime);
    if (seconds === null) {
      continue;
    }

    const bestObservationRecord =
      frameRecord.bestObservation && typeof frameRecord.bestObservation === 'object'
        ? (frameRecord.bestObservation as Record<string, unknown>)
        : null;
    const bestMatch =
      toCandidate(frameRecord.bestMatch) ??
      toCandidate(bestObservationRecord?.bestMatch) ??
      toCandidate(frameRecord.top);
    const frameCandidates = toCandidateArray(frameRecord.candidates);
    const candidates =
      frameCandidates.length > 0
        ? frameCandidates
        : toCandidateArray(bestObservationRecord?.candidates);
    if (bestMatch || candidates.length) {
      observations.push({
        seconds,
        source: `${source}.bestObservation`,
        bestMatch,
        candidates,
      });
    }

    if (includeProposals && Array.isArray(frameRecord.proposalMatches)) {
      for (const proposalMatch of frameRecord.proposalMatches) {
        if (!proposalMatch || typeof proposalMatch !== 'object') {
          continue;
        }

        const proposalRecord = proposalMatch as Record<string, unknown>;
        const proposalBest = toCandidate(proposalRecord.bestMatch);
        const proposalCandidates = toCandidateArray(proposalRecord.candidates);
        observations.push({
          seconds,
          source: `${source}.proposalMatches`,
          bestMatch: proposalBest,
          candidates: proposalCandidates,
        });
      }
    }
  }

  return observations;
}

function scoreWindow(window: GroundTruthWindow, observations: Observation[]): WindowScore {
  const windowObservations = observations.filter((observation) => inWindow(observation, window));
  const detections = windowObservations.filter(
    (observation) => observation.bestMatch || observation.candidates.length,
  );

  const top1NameHit = detections.some((observation) =>
    candidateMatchesName(observation.bestMatch, window),
  );
  const top1ExternalIdHit = detections.some((observation) =>
    candidateMatchesExternalId(observation.bestMatch, window),
  );
  const candidateNameHit = detections.some((observation) =>
    observation.candidates.some((candidate) => candidateMatchesName(candidate, window)),
  );
  const candidateExternalIdHit = detections.some((observation) =>
    observation.candidates.some((candidate) => candidateMatchesExternalId(candidate, window)),
  );

  const bestObservation = chooseBestObservation(detections);

  return {
    id: window.id,
    expectedName: window.name,
    startSeconds: window.startSeconds,
    endSeconds: window.endSeconds,
    tags: window.tags ?? [],
    observations: windowObservations.length,
    detections: detections.length,
    top1NameHit,
    top1ExternalIdHit,
    candidateNameHit,
    candidateExternalIdHit,
    bestObservation: bestObservation
      ? {
          seconds: bestObservation.seconds,
          name: bestObservation.bestMatch?.name ?? null,
          externalId: bestObservation.bestMatch?.externalId ?? null,
          confidence: candidateConfidence(bestObservation.bestMatch),
          source: bestObservation.source,
        }
      : null,
  };
}

function chooseBestObservation(observations: Observation[]): Observation | null {
  let best: Observation | null = null;
  let bestConfidence = Number.NEGATIVE_INFINITY;

  for (const observation of observations) {
    const confidence = candidateConfidence(observation.bestMatch) ?? 0;
    if (!best || confidence > bestConfidence) {
      best = observation;
      bestConfidence = confidence;
    }
  }

  return best;
}

function findFalsePositives(
  observations: Observation[],
  windows: GroundTruthWindow[],
): Observation[] {
  return observations.filter((observation) => {
    if (!observation.bestMatch) {
      return false;
    }

    return !windows.some((window) => inWindow(observation, window));
  });
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(
    readFileSync(resolve(options.groundTruthPath), 'utf8'),
  ) as GroundTruthManifest;
  const results = JSON.parse(readFileSync(resolve(options.resultsPath), 'utf8')) as unknown;
  const scoredWindows = manifest.windows.filter((window) => shouldScoreWindow(window, options));
  const observations = extractObservations(results, options);
  const windowScores = scoredWindows.map((window) => scoreWindow(window, observations));
  const falsePositives = findFalsePositives(observations, scoredWindows);

  const summary = {
    manifest: manifest.name ?? null,
    windows: windowScores.length,
    externalIdWindows: windowScores.filter((score) => {
      const window = scoredWindows.find((candidate) => candidate.id === score.id);
      return Boolean(window?.expectedExternalIds?.length);
    }).length,
    observations: observations.length,
    scoringMode: options.includeProposals ? 'best-observation+proposals' : 'best-observation',
    coveredWindows: windowScores.filter((score) => score.detections > 0).length,
    top1NameHits: windowScores.filter((score) => score.top1NameHit).length,
    top1ExternalIdHits: windowScores.filter((score) => score.top1ExternalIdHit).length,
    candidateNameHits: windowScores.filter((score) => score.candidateNameHit).length,
    candidateExternalIdHits: windowScores.filter((score) => score.candidateExternalIdHit).length,
    falsePositiveObservations: falsePositives.length,
  };

  const report = {
    summary: {
      ...summary,
      coverageRate: percent(summary.coveredWindows, summary.windows),
      top1NameAccuracy: percent(summary.top1NameHits, summary.windows),
      top1ExternalIdAccuracy: percent(summary.top1ExternalIdHits, summary.externalIdWindows),
      candidateNameRecall: percent(summary.candidateNameHits, summary.windows),
      candidateExternalIdRecall: percent(
        summary.candidateExternalIdHits,
        summary.externalIdWindows,
      ),
    },
    misses: windowScores.filter((score) => !score.top1NameHit),
    windows: windowScores,
    falsePositives: falsePositives.slice(0, 100).map((observation) => ({
      seconds: observation.seconds,
      name: observation.bestMatch?.name ?? null,
      externalId: observation.bestMatch?.externalId ?? null,
      confidence: candidateConfidence(observation.bestMatch),
      source: observation.source,
    })),
  };

  const output = JSON.stringify(report, null, 2);
  if (options.outPath) {
    writeFileSync(resolve(options.outPath), `${output}\n`);
  }

  console.log(output);
}

main();
