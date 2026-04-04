import { buildHashDatabase, getHashDatabaseStats } from '../modules/card-scan';
import { getCardHashStoreDetails } from '../modules/card-scan/hash-store';

type SupportedTcg = 'magic' | 'pokemon' | 'yugioh';

interface BuildCliOptions {
  tcg: SupportedTcg;
  limit?: number;
  setCode?: string;
  force: boolean;
  statsOnly: boolean;
  concurrency?: number;
  upsertBatchSize?: number;
  libraryDir?: string;
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

function parseOptionalInteger(flagName: string, value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }

  return parsed;
}

function parseSupportedTcg(value: string | undefined): SupportedTcg {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'magic' || normalized === 'pokemon' || normalized === 'yugioh') {
    return normalized;
  }

  throw new Error('tcg must be one of: magic, pokemon, yugioh');
}

function printUsage(): void {
  console.log(`Usage:
  npm run build:hashes -- --tcg pokemon [--force] [--limit 1000] [--set-code sv7] [--library-dir /tmp/card-library]

Environment fallbacks:
  CARD_HASH_BUILD_TCG
  CARD_HASH_BUILD_LIMIT
  CARD_HASH_BUILD_SET_CODE
  CARD_HASH_BUILD_FORCE
  CARD_HASH_BUILD_STATS_ONLY
  CARD_HASH_BUILD_CONCURRENCY
  CARD_HASH_BUILD_UPSERT_BATCH_SIZE
  CARD_HASH_LIBRARY_DIR`);
}

function parseOptions(argv: string[]): BuildCliOptions | null {
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

  const tcgValue = values.get('tcg') ?? process.env.CARD_HASH_BUILD_TCG ?? 'pokemon';
  const limitValue = values.get('limit') ?? process.env.CARD_HASH_BUILD_LIMIT;
  const setCode = values.get('set-code') ?? values.get('setCode') ?? process.env.CARD_HASH_BUILD_SET_CODE;
  const force = values.has('force')
    ? parseBoolean(values.get('force'), true)
    : flags.has('force')
      ? true
      : parseBoolean(process.env.CARD_HASH_BUILD_FORCE, false);
  const statsOnly = values.has('stats-only')
    ? parseBoolean(values.get('stats-only'), true)
    : flags.has('stats-only')
      ? true
      : parseBoolean(process.env.CARD_HASH_BUILD_STATS_ONLY, false);
  const concurrencyValue = values.get('concurrency') ?? process.env.CARD_HASH_BUILD_CONCURRENCY;
  const upsertBatchSizeValue =
    values.get('upsert-batch-size') ??
    values.get('upsertBatchSize') ??
    process.env.CARD_HASH_BUILD_UPSERT_BATCH_SIZE;
  const libraryDir =
    values.get('library-dir') ??
    values.get('libraryDir') ??
    process.env.CARD_HASH_LIBRARY_DIR;

  return {
    tcg: parseSupportedTcg(tcgValue),
    limit: parseOptionalInteger('limit', limitValue),
    setCode: setCode?.trim() || undefined,
    force,
    statsOnly,
    concurrency: parseOptionalInteger('concurrency', concurrencyValue),
    upsertBatchSize: parseOptionalInteger('upsert-batch-size', upsertBatchSizeValue),
    libraryDir: libraryDir?.trim() || undefined,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    return;
  }

  console.log(
    JSON.stringify(
      {
        action: options.statsOnly ? 'card-hash-stats' : 'card-hash-build',
        options,
        store: getCardHashStoreDetails(),
        libraryDir: options.libraryDir ?? null,
      },
      null,
      2
    )
  );

  if (!options.statsOnly) {
    const result = await buildHashDatabase(options.tcg, {
      limit: options.limit,
      setCode: options.setCode,
      force: options.force,
      concurrency: options.concurrency,
      upsertBatchSize: options.upsertBatchSize,
      libraryDir: options.libraryDir,
    });

    console.log(JSON.stringify({ result }, null, 2));
  }

  const stats = await getHashDatabaseStats();
  console.log(JSON.stringify({ stats, store: getCardHashStoreDetails() }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
