import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildYugiohPrintingKey
} from '../modules/adapters/yugioh-printing-key';
import {
  canonicalizeYugiohSetCode,
  extractYugiohCollectorNumber,
  extractYugiohSetPrefix
} from '../modules/adapters/yugioh-set-code';
import { resolveTcgdexAssetUrl } from '../modules/adapters/tcgdex-assets';

type SupportedGame = 'pokemon' | 'magic' | 'yugioh';

interface BuildCliOptions {
  games: SupportedGame[];
  outDir: string;
  limit?: number;
  sync: boolean;
}

interface CatalogSet {
  code: string;
  name: string;
  serie?: string;
  releasedAt?: string;
  count: number;
  standardCount?: number;
  iconUrl?: string;
  logoUrl?: string;
}

interface CatalogCard {
  id: string;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  rarity?: string;
  type?: string;
  types?: string[];
  hp?: number;
  manaCost?: string;
  colors?: string[];
  race?: string;
  atk?: number;
  def?: number;
  level?: number;
  konamiId?: number;
}

interface CatalogPack {
  formatVersion: 1;
  tcg: SupportedGame;
  version: number;
  updatedAt: string;
  sets: CatalogSet[];
  cards: CatalogCard[];
}

interface ManifestGame {
  version: number;
  cardCount: number;
  setCount: number;
  bytes: number;
  sha256: string;
  file: string;
}

interface CatalogManifest {
  formatVersion: 1;
  generatedAt: string;
  games: Partial<Record<SupportedGame, ManifestGame>>;
}

interface TcgdexSetSummary {
  id: string;
  name: string;
}

interface TcgdexSetDetail extends TcgdexSetSummary {
  serie?: { id?: string };
  releaseDate?: string;
  cardCount?: { total?: number; official?: number };
  logo?: string;
  symbol?: string;
  cards?: Array<{
    id: string;
    localId?: string;
    name: string;
  }>;
}

interface ScryfallBulkIndex {
  data?: Array<{
    type?: string;
    download_uri?: string;
  }>;
}

interface ScryfallBulkCard {
  id?: string;
  name?: string;
  set?: string;
  set_name?: string;
  released_at?: string;
  collector_number?: string;
  rarity?: string;
  type_line?: string;
  mana_cost?: string;
  colors?: string[];
  games?: string[];
  card_faces?: Array<{
    type_line?: string;
    mana_cost?: string;
  }>;
}

interface YgoApiResponse {
  data?: YgoCard[];
}

interface YgoCard {
  id: number;
  name: string;
  type?: string;
  race?: string;
  atk?: number;
  def?: number;
  level?: number;
  card_images?: Array<{
    id?: number | string;
  }>;
  card_sets?: Array<{
    set_code: string;
    set_name: string;
    set_rarity: string;
  }>;
}

const REPO_ROOT = resolve(__dirname, '../../..');
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'data/catalog');
const POKEMON_API_ROOT = 'https://api.tcgdex.net/v2/en';
const SCRYFALL_BULK_INDEX_URL = 'https://api.scryfall.com/bulk-data';
const YUGIOH_CARDS_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const POKEMON_CONCURRENCY = 8;
const USER_AGENT = 'TCGer-catalog-pack-builder/1.0';

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

function parseSupportedGame(value: string | undefined): SupportedGame {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'pokemon' || normalized === 'magic' || normalized === 'yugioh') {
    return normalized;
  }
  throw new Error('game must be one of: pokemon, magic, yugioh');
}

function printUsage(): void {
  console.log(`Usage:
  bunx tsx backend/src/scripts/build-catalog-packs.ts [--game pokemon|magic|yugioh] [--out <dir>] [--limit <n>] [--sync]

Defaults:
  --game all
  --out data/catalog`);
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

  const knownOptions = new Set(['game', 'out', 'limit', 'sync']);
  for (const key of [...values.keys(), ...flags]) {
    if (!knownOptions.has(key)) {
      throw new Error(`Unknown option: --${key}`);
    }
  }
  if (flags.has('game') || flags.has('out') || flags.has('limit')) {
    throw new Error('--game, --out, and --limit require values');
  }

  return {
    games: values.has('game')
      ? [parseSupportedGame(values.get('game'))]
      : ['pokemon', 'magic', 'yugioh'],
    outDir: resolve(values.get('out') ?? DEFAULT_OUT_DIR),
    limit: parseOptionalInteger('limit', values.get('limit')),
    sync: flags.has('sync') || values.get('sync') === 'true'
  };
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, durationMs);
  });
}

async function fetchWithRetry(url: string, label: string): Promise<Response> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT
        }
      });
      if (response.ok) {
        return response;
      }

      const transient = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!transient || attempt === maxAttempts) {
        throw new Error(`${label} failed: HTTP ${response.status}`);
      }
      await response.body?.cancel();
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * 2 ** (attempt - 1));
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`${label} failed after ${maxAttempts} attempts`);
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const response = await fetchWithRetry(url, label);
  return (await response.json()) as T;
}

async function buildPokemonPack(updatedAt: string, limit?: number): Promise<CatalogPack> {
  const summaries = await fetchJson<TcgdexSetSummary[]>(
    `${POKEMON_API_ROOT}/sets`,
    'TCGdex set list'
  );
  const sets: CatalogSet[] = [];
  const cards: CatalogCard[] = [];

  for (let offset = 0; offset < summaries.length && (!limit || cards.length < limit); offset += POKEMON_CONCURRENCY) {
    const batch = summaries.slice(offset, offset + POKEMON_CONCURRENCY);
    const details = await Promise.all(
      batch.map((set) =>
        fetchJson<TcgdexSetDetail>(
          `${POKEMON_API_ROOT}/sets/${encodeURIComponent(set.id)}`,
          `TCGdex set ${set.id}`
        )
      )
    );

    for (const detail of details) {
      if (limit && cards.length >= limit) {
        break;
      }
      const remaining = limit ? limit - cards.length : Number.POSITIVE_INFINITY;
      const setCards = (detail.cards ?? []).slice(0, remaining);
      if (!setCards.length) {
        continue;
      }
      sets.push({
        code: detail.id,
        name: detail.name,
        serie: detail.serie?.id,
        releasedAt: detail.releaseDate,
        count: detail.cardCount?.total ?? detail.cards?.length ?? setCards.length,
        standardCount: detail.cardCount?.official,
        iconUrl: resolveTcgdexAssetUrl(detail.symbol),
        logoUrl: resolveTcgdexAssetUrl(detail.logo)
      });
      cards.push(
        ...setCards.map((card) => ({
          id: card.id,
          name: card.name,
          setCode: detail.id,
          collectorNumber: card.localId ?? card.id.slice(detail.id.length + 1)
        }))
      );
    }
  }

  return {
    formatVersion: 1,
    tcg: 'pokemon',
    version: 1,
    updatedAt,
    sets,
    cards
  };
}

async function* streamJsonArray(response: Response): AsyncGenerator<unknown> {
  if (!response.body) {
    throw new Error('Scryfall bulk response had no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let finished = false;

  const parseChunk = (chunk: string): unknown[] => {
    const values: unknown[] = [];
    for (const character of chunk) {
      if (depth === 0) {
        if (character === '{') {
          buffer = character;
          depth = 1;
        }
        continue;
      }

      buffer += character;
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
      } else if (character === '"') {
        inString = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          values.push(JSON.parse(buffer) as unknown);
          buffer = '';
        }
      }
    }
    return values;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      for (const parsed of parseChunk(decoder.decode(value, { stream: true }))) {
        yield parsed;
      }
    }
    for (const parsed of parseChunk(decoder.decode())) {
      yield parsed;
    }
    if (depth !== 0 || inString) {
      throw new Error('Scryfall bulk JSON ended in the middle of an object');
    }
    finished = true;
  } finally {
    if (!finished) {
      await reader.cancel().catch(() => {});
    }
    reader.releaseLock();
  }
}

async function buildMagicPack(updatedAt: string, limit?: number): Promise<CatalogPack> {
  const index = await fetchJson<ScryfallBulkIndex>(
    SCRYFALL_BULK_INDEX_URL,
    'Scryfall bulk-data index'
  );
  const bulkUrl = index.data?.find((entry) => entry.type === 'default_cards')?.download_uri;
  if (!bulkUrl) {
    throw new Error('Scryfall bulk-data index did not contain default_cards');
  }

  const response = await fetchWithRetry(bulkUrl, 'Scryfall default_cards download');
  const cards: CatalogCard[] = [];
  const sets = new Map<string, CatalogSet>();

  for await (const value of streamJsonArray(response)) {
    const card = value as ScryfallBulkCard;
    if (
      !card.id ||
      !card.name ||
      !card.set ||
      !card.set_name ||
      !card.games?.includes('paper')
    ) {
      continue;
    }

    const face = card.card_faces?.[0];
    cards.push({
      id: card.id,
      name: card.name,
      setCode: card.set,
      collectorNumber: card.collector_number,
      rarity: card.rarity,
      type: card.type_line ?? face?.type_line,
      manaCost: card.mana_cost ?? face?.mana_cost,
      colors: card.colors
    });

    const existingSet = sets.get(card.set);
    if (existingSet) {
      existingSet.count += 1;
    } else {
      sets.set(card.set, {
        code: card.set,
        name: card.set_name,
        releasedAt: card.released_at,
        count: 1,
        iconUrl: `https://svgs.scryfall.io/sets/${encodeURIComponent(card.set)}.svg`
      });
    }

    if (limit && cards.length >= limit) {
      break;
    }
  }

  return {
    formatVersion: 1,
    tcg: 'magic',
    version: 1,
    updatedAt,
    sets: [...sets.values()],
    cards
  };
}

async function buildYugiohPack(updatedAt: string, limit?: number): Promise<CatalogPack> {
  const payload = await fetchJson<YgoApiResponse>(YUGIOH_CARDS_URL, 'YGOPRODeck card catalog');
  const sourceCards = limit ? (payload.data ?? []).slice(0, limit) : payload.data ?? [];
  const cards: CatalogCard[] = [];
  const sets = new Map<string, CatalogSet>();

  for (const card of sourceCards) {
    const printingSet = card.card_sets?.[0];
    const image = card.card_images?.[0];
    const artworkId = image?.id !== undefined ? String(image.id) : undefined;
    const setCode = printingSet
      ? extractYugiohSetPrefix(printingSet.set_code) ??
        canonicalizeYugiohSetCode(printingSet.set_code)
      : undefined;
    const imageId = Number(artworkId ?? card.id);
    const id = buildYugiohPrintingKey({
      baseExternalId: String(card.id),
      setCode: printingSet?.set_code,
      rarity: printingSet?.set_rarity,
      artworkId
    });

    cards.push({
      id,
      name: card.name,
      setCode,
      collectorNumber: printingSet
        ? extractYugiohCollectorNumber(printingSet.set_code)
        : undefined,
      rarity: printingSet?.set_rarity,
      type: card.type,
      race: card.race,
      atk: card.atk,
      def: card.def,
      level: card.level,
      konamiId: Number.isFinite(imageId) ? imageId : card.id
    });

    if (setCode && printingSet) {
      const existingSet = sets.get(setCode);
      if (existingSet) {
        existingSet.count += 1;
      } else {
        sets.set(setCode, {
          code: setCode,
          name: printingSet.set_name,
          count: 1
        });
      }
    }
  }

  return {
    formatVersion: 1,
    tcg: 'yugioh',
    version: 1,
    updatedAt,
    sets: [...sets.values()],
    cards
  };
}

async function loadExistingManifest(outDir: string): Promise<CatalogManifest | undefined> {
  try {
    return JSON.parse(
      await readFile(resolve(outDir, 'manifest.json'), 'utf8')
    ) as CatalogManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function existingPackUpdatedAt(
  outDir: string,
  entry: ManifestGame
): Promise<string | undefined> {
  try {
    const pack = JSON.parse(
      await readFile(resolve(outDir, entry.file), 'utf8')
    ) as Pick<CatalogPack, 'updatedAt'>;
    return typeof pack.updatedAt === 'string' ? pack.updatedAt : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function packSha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function writePack(
  outDir: string,
  pack: CatalogPack,
  existingEntry?: ManifestGame
): Promise<ManifestGame> {
  const generatedAt = pack.updatedAt;
  let contents: string | undefined;

  if (existingEntry) {
    const updatedAt = await existingPackUpdatedAt(outDir, existingEntry);
    if (updatedAt) {
      pack.version = existingEntry.version;
      pack.updatedAt = updatedAt;
      const comparisonContents = JSON.stringify(pack);
      if (packSha256(comparisonContents) === existingEntry.sha256) {
        contents = comparisonContents;
      }
    }
  }

  if (!contents) {
    pack.version = existingEntry ? existingEntry.version + 1 : 1;
    pack.updatedAt = generatedAt;
    contents = JSON.stringify(pack);
  }

  const sha256 = packSha256(contents);
  const file = `${pack.tcg}.v${pack.version}.${sha256.slice(0, 16)}.pack.json`;
  await writeFile(resolve(outDir, file), contents);
  return {
    version: pack.version,
    cardCount: pack.cards.length,
    setCount: pack.sets.length,
    bytes: Buffer.byteLength(contents),
    sha256,
    file
  };
}

async function syncOutputs(
  outDir: string,
  manifest: CatalogManifest,
  builtGames: SupportedGame[]
): Promise<void> {
  const destinations = [
    resolve(REPO_ROOT, 'frontend/public/catalog'),
    resolve(REPO_ROOT, 'mobile-apps/ios/TCGer/TCGer/Resources/Catalogs')
  ];
  for (const destination of destinations) {
    await mkdir(destination, { recursive: true });
    await copyFile(resolve(outDir, 'manifest.json'), resolve(destination, 'manifest.json'));
    for (const game of builtGames) {
      const entry = manifest.games[game];
      if (entry) {
        await copyFile(resolve(outDir, entry.file), resolve(destination, entry.file));
      }
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    return;
  }

  await mkdir(options.outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const existingManifest = await loadExistingManifest(options.outDir);
  const manifest: CatalogManifest = {
    formatVersion: 1,
    generatedAt,
    games: { ...existingManifest?.games }
  };

  for (const game of options.games) {
    console.log(`Building ${game} catalog${options.limit ? ` (limit ${options.limit})` : ''}...`);
    const pack =
      game === 'pokemon'
        ? await buildPokemonPack(generatedAt, options.limit)
        : game === 'magic'
          ? await buildMagicPack(generatedAt, options.limit)
          : await buildYugiohPack(generatedAt, options.limit);
    manifest.games[game] = await writePack(
      options.outDir,
      pack,
      existingManifest?.games[game]
    );
    console.log(JSON.stringify({ game, ...manifest.games[game] }));
  }

  await writeFile(
    resolve(options.outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  if (options.sync) {
    await syncOutputs(options.outDir, manifest, options.games);
    console.log('Synced catalog packs to web and iOS resources.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
