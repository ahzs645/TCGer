import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CardHashRecord } from '../modules/card-scan/hash-store';
import {
  computeCardFeatureHashes,
  flattenCardFeatureHashes,
  hasCompleteCardFeatureHashes,
} from '../modules/card-scan/feature-hashes';
import { preprocessCardImage } from '../modules/card-scan/preprocess';

type SupportedTcg = 'magic' | 'pokemon' | 'yugioh';

interface CardHashFilePayload {
  version?: number;
  entries?: CardHashRecord[];
}

interface CardLibraryIndexEntry {
  externalId: string;
  localImagePath: string;
}

interface CardLibraryIndexPayload {
  entries?: CardLibraryIndexEntry[];
}

interface BackfillOptions {
  tcg: SupportedTcg;
  dataDir: string;
  libraryIndex: string;
  force: boolean;
  limit?: number;
  concurrency: number;
}

interface BackfillStats {
  tcg: SupportedTcg;
  totalLibraryEntries: number;
  considered: number;
  updated: number;
  skipped: number;
  missingHashRecords: number;
  missingImages: number;
}

interface BackfillTask {
  record: CardHashRecord;
  imagePath: string;
}

function parseSupportedTcg(value: string | undefined): SupportedTcg {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'magic' || normalized === 'pokemon' || normalized === 'yugioh') {
    return normalized;
  }

  throw new Error('tcg must be one of: magic, pokemon, yugioh');
}

function parsePositiveInteger(flagName: string, value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function printUsage(): void {
  console.log(`Usage:
  npm run backfill:hash-features -- --tcg pokemon --data-dir /data/card-scan --library-index /data/card-library/pokemon/index.json [--force] [--limit 500]

Environment fallbacks:
  CARD_HASH_BACKFILL_TCG
  CARD_SCAN_DATA_DIR
  CARD_HASH_LIBRARY_INDEX
  CARD_HASH_BACKFILL_FORCE
  CARD_HASH_BACKFILL_LIMIT
  CARD_HASH_BACKFILL_CONCURRENCY`);
}

function parseOptions(argv: string[]): BackfillOptions | null {
  const args = [...argv];
  const values = new Map<string, string>();
  const flags = new Set<string>();

  while (args.length) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === '--help' || token === '-h') {
      printUsage();
      return null;
    }

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      values.set(rawKey, inlineValue);
      continue;
    }

    const next = args[0];
    if (next && !next.startsWith('--')) {
      values.set(rawKey, args.shift()!);
      continue;
    }

    flags.add(rawKey);
  }

  const tcg = parseSupportedTcg(values.get('tcg') ?? process.env.CARD_HASH_BACKFILL_TCG);
  const dataDir = values.get('data-dir') ?? values.get('dataDir') ?? process.env.CARD_SCAN_DATA_DIR;
  const libraryIndex =
    values.get('library-index') ??
    values.get('libraryIndex') ??
    process.env.CARD_HASH_LIBRARY_INDEX ??
    path.join(path.resolve(dataDir ?? ''), '..', 'card-library', tcg, 'index.json');

  if (!dataDir) {
    throw new Error('data-dir is required');
  }

  const force = values.has('force')
    ? parseBoolean(values.get('force'), true)
    : flags.has('force')
      ? true
      : parseBoolean(process.env.CARD_HASH_BACKFILL_FORCE, false);

  const limit =
    parsePositiveInteger('limit', values.get('limit') ?? process.env.CARD_HASH_BACKFILL_LIMIT);
  const concurrency =
    parsePositiveInteger(
      'concurrency',
      values.get('concurrency') ?? process.env.CARD_HASH_BACKFILL_CONCURRENCY
    ) ?? 8;

  return {
    tcg,
    dataDir,
    libraryIndex,
    force,
    limit,
    concurrency,
  };
}

function compareEntriesByName(left: CardHashRecord, right: CardHashRecord): number {
  return (
    left.name.localeCompare(right.name) ||
    left.tcg.localeCompare(right.tcg) ||
    left.externalId.localeCompare(right.externalId)
  );
}

async function loadHashEntries(filePath: string): Promise<CardHashRecord[]> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as CardHashFilePayload | CardHashRecord[];
  const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? [];

  return entries.map((entry) => ({
    ...entry,
    setCode: entry.setCode ?? null,
    setName: entry.setName ?? null,
    rarity: entry.rarity ?? null,
    imageUrl: entry.imageUrl ?? null,
    titleRHash: entry.titleRHash ?? null,
    titleGHash: entry.titleGHash ?? null,
    titleBHash: entry.titleBHash ?? null,
    footerRHash: entry.footerRHash ?? null,
    footerGHash: entry.footerGHash ?? null,
    footerBHash: entry.footerBHash ?? null,
    hashSize: entry.hashSize ?? 16,
  }));
}

async function loadLibraryEntries(indexPath: string): Promise<CardLibraryIndexEntry[]> {
  const raw = await readFile(indexPath, 'utf8');
  const parsed = JSON.parse(raw) as CardLibraryIndexPayload;

  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    return;
  }

  const hashesPath = path.join(options.dataDir, 'hashes.json');
  const hashEntries = await loadHashEntries(hashesPath);
  const libraryEntries = await loadLibraryEntries(options.libraryIndex);
  const libraryRoot = path.dirname(options.libraryIndex);
  const hashMap = new Map(
    hashEntries
      .filter((entry) => entry.tcg === options.tcg)
      .map((entry) => [entry.externalId, entry] as const)
  );

  const stats: BackfillStats = {
    tcg: options.tcg,
    totalLibraryEntries: libraryEntries.length,
    considered: 0,
    updated: 0,
    skipped: 0,
    missingHashRecords: 0,
    missingImages: 0,
  };

  console.log(
    JSON.stringify(
      {
        action: 'card-hash-feature-backfill',
        options,
        hashesPath,
      },
      null,
      2
    )
  );

  const tasks: BackfillTask[] = [];

  for (const libraryEntry of libraryEntries) {
    if (options.limit && stats.considered >= options.limit) {
      break;
    }

    const record = hashMap.get(libraryEntry.externalId);
    if (!record) {
      stats.missingHashRecords++;
      continue;
    }

    stats.considered++;
    if (!options.force && hasCompleteCardFeatureHashes(record)) {
      stats.skipped++;
      continue;
    }

    tasks.push({
      record,
      imagePath: path.join(libraryRoot, libraryEntry.localImagePath),
    });
  }

  let nextProgressUpdate = 250;
  let nextTaskIndex = 0;

  async function processTask(task: BackfillTask): Promise<void> {
    try {
      const imageBuffer = await readFile(task.imagePath);
      const processed = await preprocessCardImage(imageBuffer);
      const featureHashes = await computeCardFeatureHashes(options!.tcg, processed);
      Object.assign(task.record, flattenCardFeatureHashes(featureHashes));
      stats.updated++;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        stats.missingImages++;
        return;
      }

      throw error;
    }

    if (stats.updated >= nextProgressUpdate) {
      nextProgressUpdate = stats.updated + 250;
      console.log(
        JSON.stringify(
          {
            progress: {
              considered: stats.considered,
              updated: stats.updated,
              skipped: stats.skipped,
              missingHashRecords: stats.missingHashRecords,
              missingImages: stats.missingImages,
            },
          },
          null,
          2
        )
      );
    }
  }

  const workers = Array.from(
    { length: Math.min(options!.concurrency, Math.max(tasks.length, 1)) },
    async () => {
      for (let task = tasks[nextTaskIndex++]; task; task = tasks[nextTaskIndex++]) {
        await processTask(task);
      }
    }
  );

  await Promise.all(workers);

  const payload = JSON.stringify(
    {
      version: 1,
      entries: hashEntries.sort(compareEntriesByName),
    },
    null,
    0
  );
  await writeFile(hashesPath, `${payload}\n`, 'utf8');

  console.log(JSON.stringify({ result: stats }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
