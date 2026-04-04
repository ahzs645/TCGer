import { readFile } from 'node:fs/promises';
import path from 'node:path';

interface BenchmarkOptions {
  dataDir: string;
  libraryIndex?: string;
  tcg?: 'magic' | 'pokemon' | 'yugioh';
  sample: number;
  images: string[];
}

interface LibraryIndexEntry {
  externalId: string;
  name: string;
  localImagePath: string;
}

interface LibraryIndexPayload {
  entries?: LibraryIndexEntry[];
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptions(argv: string[]): BenchmarkOptions {
  const args = [...argv];
  const images: string[] = [];
  let dataDir = process.env.CARD_SCAN_DATA_DIR ?? '';
  let libraryIndex = process.env.CARD_HASH_LIBRARY_INDEX;
  let tcg = process.env.CARD_HASH_BUILD_TCG as BenchmarkOptions['tcg'];
  let sample = parsePositiveInteger(process.env.CARD_SCAN_BENCHMARK_SAMPLE, 50);

  while (args.length) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === '--data-dir') {
      dataDir = args.shift() ?? dataDir;
      continue;
    }

    if (token === '--library-index') {
      libraryIndex = args.shift() ?? libraryIndex;
      continue;
    }

    if (token === '--tcg') {
      const value = args.shift();
      if (value === 'magic' || value === 'pokemon' || value === 'yugioh') {
        tcg = value;
      }
      continue;
    }

    if (token === '--sample') {
      sample = parsePositiveInteger(args.shift(), sample);
      continue;
    }

    if (token === '--image') {
      const imagePath = args.shift();
      if (imagePath) {
        images.push(imagePath);
      }
      continue;
    }
  }

  if (!dataDir) {
    throw new Error('--data-dir or CARD_SCAN_DATA_DIR is required');
  }

  return {
    dataDir,
    libraryIndex,
    tcg,
    sample,
    images,
  };
}

async function resolveBenchmarkInputs(options: BenchmarkOptions): Promise<string[]> {
  if (options.images.length) {
    return options.images;
  }

  if (!options.libraryIndex) {
    throw new Error('Provide at least one --image or a --library-index');
  }

  const raw = await readFile(options.libraryIndex, 'utf8');
  const parsed = JSON.parse(raw) as LibraryIndexPayload;
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  if (!entries.length) {
    throw new Error('Library index contains no entries');
  }

  const baseDir = path.dirname(options.libraryIndex);
  const limit = Math.min(entries.length, options.sample);
  const step = Math.max(1, Math.floor(entries.length / limit));
  const inputs: string[] = [];

  for (let index = 0; index < entries.length && inputs.length < limit; index += step) {
    inputs.push(path.join(baseDir, entries[index]!.localImagePath));
  }

  return inputs;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  process.env.NODE_ENV = 'test';
  process.env.BACKEND_MODE = 'convex';
  process.env.CARD_SCAN_STORE = 'file';
  process.env.CARD_SCAN_DATA_DIR = options.dataDir;

  const inputs = await resolveBenchmarkInputs(options);
  const { scanCardImage } = await import('../modules/card-scan');
  type BenchmarkScanResult = Awaited<ReturnType<typeof scanCardImage>>;

  const results: Array<{
    imagePath: string;
    ms: number;
    bestMatch: BenchmarkScanResult['bestMatch'];
    meta: BenchmarkScanResult['meta'];
  }> = [];

  for (const imagePath of inputs) {
    const imageBuffer = await readFile(imagePath);
    const startedAt = performance.now();
    const result = await scanCardImage(imageBuffer, options.tcg);
    const elapsedMs = performance.now() - startedAt;

    results.push({
      imagePath,
      ms: Number(elapsedMs.toFixed(2)),
      bestMatch: result.bestMatch,
      meta: result.meta,
    });
  }

  const matched = results.filter((result) => result.bestMatch !== null);
  const averageMs =
    results.reduce((total, result) => total + result.ms, 0) / Math.max(1, results.length);

  console.log(
    JSON.stringify(
      {
        sampleSize: results.length,
        matched: matched.length,
        averageMs: Number(averageMs.toFixed(2)),
        results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
