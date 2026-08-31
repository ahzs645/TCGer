import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip, gzipSync } from 'node:zlib';
import { buildYugiohPrintingKey } from '../modules/adapters/yugioh-printing-key';
import {
  canonicalizeYugiohSetCode,
  extractYugiohCollectorNumber,
  extractYugiohSetPrefix,
} from '../modules/adapters/yugioh-set-code';
import { canonicalizePokemonRarity } from '../modules/adapters/pokemon-normalization';
import { resolvePokemonSetArtwork } from '../modules/adapters/pokemon-set-artwork';
import { getPokemonWorldChampionshipCatalog } from '../modules/adapters/pokemon-world-championships';
import {
  deriveCollectionTags,
  gamePackageManifestSchema,
  getGameDefinition,
  type GamePackageManifest,
} from '@tcg/api-types';

type SupportedGame = 'pokemon' | 'magic' | 'yugioh' | 'onepiece' | 'lorcana' | 'dragonball';

interface BuildCliOptions {
  games: SupportedGame[];
  outDir: string;
  limit?: number;
  sync: boolean;
  packagesOnly: boolean;
}

interface CatalogSet {
  code: string;
  name: string;
  serie?: string;
  releasedAt?: string;
  count: number;
  standardCount?: number;
  setType?: string;
  releaseYear?: number;
  iconUrl?: string;
  iconFallbackUrl?: string;
  logoUrl?: string;
  boosters?: PokemonBooster[];
}

interface PokemonBooster {
  id: string;
  name: string;
}

interface PokemonPocketMetadata {
  hp?: number;
  effect?: string;
  cardDescription?: string;
  abilities?: Array<{ type?: string; name: string; effect: string }>;
  attacks?: Array<{ cost: string[]; name: string; effect?: string; damage?: string }>;
  weaknesses?: Array<{ type: string; value: string }>;
  retreatCost?: number;
  boosters?: PokemonBooster[];
}

interface CatalogCard {
  id: string;
  name: string;
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  rarity?: string;
  artist?: string;
  category?: string;
  dexEntries?: Array<{ number: number; name: string }>;
  stage?: string;
  suffix?: string;
  archetype?: string;
  classifications?: string[];
  subtypes?: string[];
  variants?: string[];
  source?: string;
  character?: string;
  era?: string;
  specialTrait?: string;
  treatments?: string[];
  collectionTags?: string[];
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
  imageUrl?: string;
  imageUrlSmall?: string;
  printingKey?: string;
  printingKind?: string;
  sanctionedPlayLegal?: boolean;
  originalPrintingKey?: string;
  attributes?: Record<string, unknown>;
  pokemonWorldChampionship?: {
    year: number;
    playerName: string;
    deckName?: string;
    originalCollectorNumber?: string;
    printedSignature?: boolean;
    cardBack?: string;
    borderStyle?: string;
    stamp?: string;
    sourceProductId?: string;
    sourceUrl?: string;
  };
  pokemonPocket?: PokemonPocketMetadata;
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
  compressedBytes?: number;
  sha256: string;
  file: string;
  packageFile?: string;
  packageSignatureFile?: string;
  sealedProducts?: {
    version: number;
    productCount: number;
    bytes: number;
    compressedBytes?: number;
    sha256: string;
    file: string;
  };
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
  boosters?: PokemonBooster[];
  cards?: Array<{
    id: string;
    localId?: string;
    name: string;
  }>;
}

interface TcgdexPocketCardDetail {
  id: string;
  category?: string;
  illustrator?: string;
  image?: string;
  localId?: string;
  name: string;
  rarity?: string;
  effect?: string;
  hp?: number;
  types?: string[];
  description?: string;
  stage?: string;
  abilities?: Array<{ type?: string; name: string; effect: string }>;
  attacks?: Array<{
    cost?: string[];
    name: string;
    effect?: string;
    damage?: string | number;
  }>;
  weaknesses?: Array<{ type: string; value: string }>;
  retreat?: number;
  boosters?: PokemonBooster[];
}

interface TcgdexCardIndexResponse {
  data?: {
    cards?: Array<{
      id: string;
      rarity?: string;
      illustrator?: string;
      category?: string;
      dexId?: number[];
      stage?: string;
      suffix?: string;
      types?: string[];
    }>;
  };
  errors?: Array<{ message?: string }>;
}

interface ScryfallBulkIndex {
  data?: Array<{
    type?: string;
    download_uri?: string;
    jsonl_download_uri?: string;
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
  artist?: string;
  finishes?: string[];
  frame_effects?: string[];
  promo_types?: string[];
  full_art?: boolean;
  border_color?: string;
  games?: string[];
  card_faces?: Array<{
    type_line?: string;
    mana_cost?: string;
    artist?: string;
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
  archetype?: string;
  card_images?: Array<{
    id?: number | string;
  }>;
  card_sets?: Array<{
    set_code: string;
    set_name: string;
    set_rarity: string;
  }>;
}

interface OnePieceSet {
  set_name?: string;
  set_id?: string;
  structure_deck_name?: string;
  structure_deck_id?: string;
}

interface OnePieceCard {
  card_name?: string;
  card_set_id?: string;
  set_id?: string;
  set_name?: string;
  card_image_id?: string;
  card_image?: string;
  card_rarity?: string;
  rarity?: string;
  card_type?: string;
}

interface LorcastSet {
  id: string;
  name: string;
  code?: string;
  released_at?: string;
  card_count?: number;
}

interface LorcastCard {
  id: string;
  name: string;
  version?: string;
  released_at?: string;
  collector_number?: string;
  rarity?: string;
  type?: string[];
  classifications?: string[];
  illustrators?: string[];
  set?: { id?: string; code?: string; name?: string };
  image_uris?: {
    digital?: { small?: string; normal?: string; large?: string };
    small?: string;
    normal?: string;
    large?: string;
  };
}

interface ApiTcgSet {
  _id: string;
  name: string;
  code?: string;
  release_date?: string;
  logo?: string;
}

interface ApiTcgProduct {
  _id: string | number;
  name: string;
  set?: string | ApiTcgSet;
  release_date?: string;
  code?: string;
  cardNumber?: string;
  images?: Array<{ small?: string; medium?: string; large?: string }>;
  attributes?: Record<string, string | number | boolean | null>;
}

const REPO_ROOT = resolve(__dirname, '../../..');
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'data/catalog');
const POKEMON_API_ROOT = 'https://api.tcgdex.net/v2/en';
const POKEMON_GRAPHQL_URL = 'https://api.tcgdex.net/v2/graphql';
const SCRYFALL_BULK_INDEX_URL = 'https://api.scryfall.com/bulk-data';
const YUGIOH_CARDS_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const ONEPIECE_API_ROOT = 'https://optcgapi.com/api';
const LORCANA_API_ROOT = 'https://api.lorcast.com/v0';
const APITCG_API_ROOT = 'https://api.apitcg.com';
const DRAGONBALL_TCG_SLUG = 'dragon-ball-super-fusion-world';
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
  if (
    normalized === 'pokemon' ||
    normalized === 'magic' ||
    normalized === 'yugioh' ||
    normalized === 'onepiece' ||
    normalized === 'lorcana' ||
    normalized === 'dragonball'
  ) {
    return normalized;
  }
  throw new Error('game must be one of: pokemon, magic, yugioh, onepiece, lorcana, dragonball');
}

function printUsage(): void {
  console.log(`Usage:
  bunx tsx backend/src/scripts/build-catalog-packs.ts [--game pokemon|magic|yugioh|onepiece|lorcana|dragonball] [--out <dir>] [--limit <n>] [--sync] [--packages-only]

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

  const knownOptions = new Set(['game', 'out', 'limit', 'sync', 'packages-only']);
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
      : [
          'pokemon',
          'magic',
          'yugioh',
          'onepiece',
          'lorcana',
          ...(process.env.APITCG_API_KEY ? (['dragonball'] as const) : []),
        ],
    outDir: resolve(values.get('out') ?? DEFAULT_OUT_DIR),
    limit: parseOptionalInteger('limit', values.get('limit')),
    sync: flags.has('sync') || values.get('sync') === 'true',
    packagesOnly: flags.has('packages-only') || values.get('packages-only') === 'true',
  };
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, durationMs);
  });
}

async function fetchWithRetry(
  url: string,
  label: string,
  headers: Record<string, string> = {},
  init: Pick<RequestInit, 'method' | 'body'> = {},
): Promise<Response> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
          ...headers,
        },
      });
      if (response.ok) {
        return response;
      }

      const transient =
        response.status === 408 || response.status === 429 || response.status >= 500;
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

async function fetchPokemonCardIndex(): Promise<
  Map<
    string,
    {
      rarity?: string;
      artist?: string;
      category?: string;
      dexEntries?: Array<{ number: number; name: string }>;
      stage?: string;
      suffix?: string;
      types?: string[];
    }
  >
> {
  const response = await fetchWithRetry(
    POKEMON_GRAPHQL_URL,
    'TCGdex card metadata index',
    { 'Content-Type': 'application/json' },
    {
      method: 'POST',
      body: JSON.stringify({
        query:
          'query CatalogCardMetadata { cards { id rarity illustrator category stage suffix types dexId } }',
      }),
    },
  );
  const payload = (await response.json()) as TcgdexCardIndexResponse;
  if (payload.errors?.length) {
    const message = payload.errors
      .map((error) => error.message)
      .filter(Boolean)
      .join('; ');
    throw new Error(`TCGdex card metadata index failed: ${message || 'unknown GraphQL error'}`);
  }

  const indexedCards = payload.data?.cards;
  if (!indexedCards?.length) {
    throw new Error('TCGdex card metadata index contained no cards');
  }
  return new Map(
    indexedCards.flatMap((card) =>
      card.id
        ? [
            [
              card.id,
              {
                rarity: card.rarity,
                artist: card.illustrator,
                category: card.category,
                dexEntries: card.dexId?.map((number) => ({ number, name: '' })),
                stage: card.stage,
                suffix: card.suffix,
                types: card.types,
              },
            ] as const,
          ]
        : [],
    ),
  );
}

function taggedCard(tcg: SupportedGame, card: CatalogCard): CatalogCard {
  const collectionTags = deriveCollectionTags({ tcg, ...card });
  const attributes = Object.fromEntries(
    Object.entries({ ...card, collectionTags }).filter(
      ([key, value]) =>
        value !== undefined &&
        ![
          'id',
          'name',
          'setCode',
          'setName',
          'collectorNumber',
          'rarity',
          'imageUrl',
          'imageUrlSmall',
          'printingKey',
          'attributes',
        ].includes(key),
    ),
  );
  return {
    ...card,
    collectionTags,
    attributes: { ...attributes, ...card.attributes },
  };
}

async function fetchJson<T>(
  url: string,
  label: string,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetchWithRetry(url, label, headers);
  return (await response.json()) as T;
}

async function fetchPokemonPocketCardDetails(
  cards: Array<{ id: string }>,
): Promise<Map<string, TcgdexPocketCardDetail>> {
  const details = new Map<string, TcgdexPocketCardDetail>();
  for (let offset = 0; offset < cards.length; offset += POKEMON_CONCURRENCY) {
    const batch = cards.slice(offset, offset + POKEMON_CONCURRENCY);
    const values = await Promise.all(
      batch.map((card) =>
        fetchJson<TcgdexPocketCardDetail>(
          `${POKEMON_API_ROOT}/cards/${encodeURIComponent(card.id)}`,
          `TCGdex Pocket card ${card.id}`,
        ),
      ),
    );
    for (const value of values) {
      details.set(value.id, value);
    }
  }
  return details;
}

function pocketMetadata(detail: TcgdexPocketCardDetail): PokemonPocketMetadata {
  return {
    hp: detail.hp,
    effect: detail.effect,
    cardDescription: detail.description,
    abilities: detail.abilities,
    attacks: detail.attacks?.map((attack) => ({
      cost: attack.cost ?? [],
      name: attack.name,
      effect: attack.effect,
      damage: attack.damage === undefined ? undefined : String(attack.damage),
    })),
    weaknesses: detail.weaknesses,
    retreatCost: detail.retreat,
    boosters: detail.boosters,
  };
}

async function buildPokemonPack(updatedAt: string, limit?: number): Promise<CatalogPack> {
  const [summaries, metadataByCardId, worldChampionshipCatalog] = await Promise.all([
    fetchJson<TcgdexSetSummary[]>(`${POKEMON_API_ROOT}/sets`, 'TCGdex set list'),
    fetchPokemonCardIndex(),
    getPokemonWorldChampionshipCatalog(),
  ]);
  const sets: CatalogSet[] = [];
  const cards: CatalogCard[] = [];

  for (
    let offset = 0;
    offset < summaries.length && (!limit || cards.length < limit);
    offset += POKEMON_CONCURRENCY
  ) {
    const batch = summaries.slice(offset, offset + POKEMON_CONCURRENCY);
    const details = await Promise.all(
      batch.map((set) =>
        fetchJson<TcgdexSetDetail>(
          `${POKEMON_API_ROOT}/sets/${encodeURIComponent(set.id)}`,
          `TCGdex set ${set.id}`,
        ),
      ),
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
      const artwork = resolvePokemonSetArtwork(detail.id, detail.symbol, detail.logo);
      const isPocket = detail.serie?.id?.toLowerCase() === 'tcgp';
      const pocketDetails = isPocket
        ? await fetchPokemonPocketCardDetails(setCards)
        : new Map<string, TcgdexPocketCardDetail>();
      sets.push({
        code: detail.id,
        name: detail.name,
        serie: detail.serie?.id,
        releasedAt: detail.releaseDate,
        count: detail.cardCount?.total ?? detail.cards?.length ?? setCards.length,
        standardCount: detail.cardCount?.official,
        boosters: isPocket ? detail.boosters : undefined,
        ...artwork,
      });
      cards.push(
        ...setCards.map((card) => {
          const metadata = metadataByCardId.get(card.id);
          const pocket = pocketDetails.get(card.id);
          return taggedCard('pokemon', {
            id: card.id,
            name: card.name,
            setCode: detail.id,
            collectorNumber: card.localId ?? card.id.slice(detail.id.length + 1),
            rarity: canonicalizePokemonRarity(pocket?.rarity ?? metadata?.rarity, card.name, {
              noneMeansPromo: true,
            }),
            artist: pocket?.illustrator ?? metadata?.artist,
            category: pocket?.category ?? metadata?.category,
            dexEntries: metadata?.dexEntries?.map((entry) => ({
              number: entry.number,
              name: card.name,
            })),
            stage: pocket?.stage ?? metadata?.stage,
            suffix: metadata?.suffix,
            type: pocket?.category ?? metadata?.category,
            types: pocket?.types ?? metadata?.types,
            subtypes: [pocket?.stage ?? metadata?.stage, metadata?.suffix].filter(
              (value): value is string => Boolean(value),
            ),
            pokemonPocket: pocket ? pocketMetadata(pocket) : undefined,
          });
        }),
      );
    }
  }

  const remaining = limit ? Math.max(0, limit - cards.length) : Number.POSITIVE_INFINITY;
  const championshipCards = worldChampionshipCatalog.cards.slice(0, remaining);
  if (championshipCards.length) {
    const includedSetCodes = new Set(
      championshipCards.flatMap((card) => (card.setCode ? [card.setCode] : [])),
    );
    sets.push(
      ...worldChampionshipCatalog.sets
        .filter((set) => includedSetCodes.has(set.code))
        .map((set) => ({
          code: set.code,
          name: set.name,
          count: set.totalCards ?? 0,
          standardCount: set.standardCards,
          setType: set.setType,
          releaseYear: set.releaseYear,
        })),
    );
    cards.push(
      ...championshipCards.map((card) =>
        taggedCard('pokemon', {
          id: card.id,
          name: card.name,
          setCode: card.setCode,
          collectorNumber: card.collectorNumber,
          rarity: card.rarity,
          type: card.supertype,
          imageUrl: card.imageUrl,
          imageUrlSmall: card.imageUrlSmall,
          printingKey: card.printingKey,
          printingKind: card.printingKind,
          sanctionedPlayLegal: card.sanctionedPlayLegal,
          originalPrintingKey: card.originalPrintingKey,
          pokemonWorldChampionship: card.pokemonPrint?.worldChampionship,
        }),
      ),
    );
  }

  return {
    formatVersion: 1,
    tcg: 'pokemon',
    version: 1,
    updatedAt,
    sets,
    cards,
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

async function* streamGzippedJsonLines(response: Response): AsyncGenerator<unknown> {
  if (!response.body) {
    throw new Error('Scryfall JSONL response had no body');
  }

  const compressed = Readable.fromWeb(response.body as never);
  const gunzip = createGunzip();
  const lines = createInterface({ input: compressed.pipe(gunzip), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as unknown;
    }
  } finally {
    lines.close();
    compressed.destroy();
    gunzip.destroy();
  }
}

async function buildMagicPack(updatedAt: string, limit?: number): Promise<CatalogPack> {
  const index = await fetchJson<ScryfallBulkIndex>(
    SCRYFALL_BULK_INDEX_URL,
    'Scryfall bulk-data index',
  );
  const bulkEntry = index.data?.find((entry) => entry.type === 'default_cards');
  const bulkUrl = bulkEntry?.jsonl_download_uri ?? bulkEntry?.download_uri;
  if (!bulkUrl) {
    throw new Error('Scryfall bulk-data index did not contain default_cards');
  }

  const response = await fetchWithRetry(bulkUrl, 'Scryfall default_cards download');
  const cards: CatalogCard[] = [];
  const sets = new Map<string, CatalogSet>();

  const values = bulkEntry?.jsonl_download_uri
    ? streamGzippedJsonLines(response)
    : streamJsonArray(response);
  for await (const value of values) {
    const card = value as ScryfallBulkCard;
    if (!card.id || !card.name || !card.set || !card.set_name || !card.games?.includes('paper')) {
      continue;
    }

    const face = card.card_faces?.[0];
    cards.push(
      taggedCard('magic', {
        id: card.id,
        name: card.name,
        setCode: card.set,
        collectorNumber: card.collector_number,
        rarity: card.rarity,
        type: card.type_line ?? face?.type_line,
        manaCost: card.mana_cost ?? face?.mana_cost,
        colors: card.colors,
        artist: card.artist ?? face?.artist,
        variants: card.finishes,
        treatments: [
          ...(card.frame_effects ?? []),
          ...(card.promo_types ?? []),
          ...(card.full_art ? ['full-art'] : []),
          ...(card.border_color ? [`${card.border_color}-border`] : []),
        ],
      }),
    );

    const existingSet = sets.get(card.set);
    if (existingSet) {
      existingSet.count += 1;
    } else {
      sets.set(card.set, {
        code: card.set,
        name: card.set_name,
        releasedAt: card.released_at,
        count: 1,
        iconUrl: `https://svgs.scryfall.io/sets/${encodeURIComponent(card.set)}.svg`,
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
    cards,
  };
}

async function buildYugiohPack(updatedAt: string, limit?: number): Promise<CatalogPack> {
  const payload = await fetchJson<YgoApiResponse>(YUGIOH_CARDS_URL, 'YGOPRODeck card catalog');
  const sourceCards = limit ? (payload.data ?? []).slice(0, limit) : (payload.data ?? []);
  const cards: CatalogCard[] = [];
  const sets = new Map<string, CatalogSet>();

  for (const card of sourceCards) {
    const primaryArtworkId =
      card.card_images?.[0]?.id !== undefined ? String(card.card_images[0]!.id) : undefined;
    const printings = card.card_sets?.length ? card.card_sets : [undefined];
    for (const printingSet of printings) {
      const setCode = printingSet
        ? (extractYugiohSetPrefix(printingSet.set_code) ??
          canonicalizeYugiohSetCode(printingSet.set_code))
        : undefined;
      const imageId = Number(primaryArtworkId ?? card.id);
      const id = buildYugiohPrintingKey({
        baseExternalId: String(card.id),
        setCode: printingSet?.set_code,
        rarity: printingSet?.set_rarity,
        artworkId: primaryArtworkId,
      });

      cards.push(
        taggedCard('yugioh', {
          id,
          name: card.name,
          setCode,
          setName: printingSet?.set_name,
          collectorNumber: printingSet
            ? extractYugiohCollectorNumber(printingSet.set_code)
            : undefined,
          rarity: printingSet?.set_rarity,
          type: card.type,
          race: card.race,
          atk: card.atk,
          def: card.def,
          level: card.level,
          archetype: card.archetype,
          konamiId: Number.isFinite(imageId) ? imageId : card.id,
        }),
      );

      if (setCode && printingSet) {
        const existingSet = sets.get(setCode);
        if (existingSet) {
          existingSet.count += 1;
        } else {
          sets.set(setCode, {
            code: setCode,
            name: printingSet.set_name,
            count: 1,
          });
        }
      }
    }

    for (const alternateImage of card.card_images?.slice(1) ?? []) {
      const artworkId = alternateImage.id !== undefined ? String(alternateImage.id) : undefined;
      if (!artworkId) continue;
      const imageId = Number(artworkId);
      cards.push(
        taggedCard('yugioh', {
          id: buildYugiohPrintingKey({
            baseExternalId: String(card.id),
            artworkId,
          }),
          name: card.name,
          type: card.type,
          race: card.race,
          atk: card.atk,
          def: card.def,
          level: card.level,
          archetype: card.archetype,
          variants: ['alternate-art'],
          konamiId: Number.isFinite(imageId) ? imageId : card.id,
        }),
      );
    }
  }

  return {
    formatVersion: 1,
    tcg: 'yugioh',
    version: 1,
    updatedAt,
    sets: [...sets.values()],
    cards,
  };
}

function onePieceSetCode(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

async function buildOnePiecePack(updatedAt: string, limit?: number): Promise<CatalogPack> {
  const [setRows, deckRows, setCards, starterCards] = await Promise.all([
    fetchJson<OnePieceSet[]>(`${ONEPIECE_API_ROOT}/allSets/`, 'One Piece set list'),
    fetchJson<OnePieceSet[]>(`${ONEPIECE_API_ROOT}/allDecks/`, 'One Piece deck list'),
    fetchJson<OnePieceCard[]>(`${ONEPIECE_API_ROOT}/allSetCards/`, 'One Piece set cards'),
    fetchJson<OnePieceCard[]>(`${ONEPIECE_API_ROOT}/allSTCards/`, 'One Piece starter cards'),
  ]);

  const names = new Map<string, string>();
  for (const row of [...setRows, ...deckRows]) {
    const code = onePieceSetCode(row.set_id ?? row.structure_deck_id);
    const name = row.set_name ?? row.structure_deck_name;
    if (code && name) names.set(code, name);
  }

  const sourceCards = [...setCards, ...starterCards];
  const selectedCards = limit ? sourceCards.slice(0, limit) : sourceCards;
  const cards: CatalogCard[] = [];
  const sets = new Map<string, CatalogSet>();

  for (const card of selectedCards) {
    const baseId = card.card_image_id ?? card.card_set_id;
    const name = card.card_name?.trim();
    if (!baseId || !name) continue;
    const setCode = onePieceSetCode(card.set_id);
    const imageUrl = card.card_image?.trim() || undefined;
    const imageToken = imageUrl
      ?.split('/')
      .at(-1)
      ?.split('?', 1)[0]
      ?.replace(/\.[^.]+$/, '');
    const id = ['onepiece', setCode ?? 'unknown', imageToken ?? baseId]
      .map((part) => encodeURIComponent(part))
      .join(':');
    cards.push(
      taggedCard('onepiece', {
        id,
        name,
        setCode,
        collectorNumber: card.card_set_id,
        rarity: card.rarity ?? card.card_rarity,
        type: card.card_type,
        imageUrl,
        imageUrlSmall: imageUrl,
      }),
    );

    if (setCode) {
      const existing = sets.get(setCode);
      if (existing) {
        existing.count += 1;
      } else {
        sets.set(setCode, {
          code: setCode,
          name: card.set_name ?? names.get(setCode) ?? setCode,
          count: 1,
        });
      }
    }
  }

  return {
    formatVersion: 1,
    tcg: 'onepiece',
    version: 1,
    updatedAt,
    sets: [...sets.values()],
    cards,
  };
}

function lorcastImages(card: LorcastCard): { imageUrl?: string; imageUrlSmall?: string } {
  const images = card.image_uris?.digital ?? card.image_uris ?? {};
  return {
    imageUrl: images.large ?? images.normal ?? images.small,
    imageUrlSmall: images.small ?? images.normal ?? images.large,
  };
}

async function buildLorcanaPack(updatedAt: string, limit?: number): Promise<CatalogPack> {
  const payload = await fetchJson<{ results?: LorcastSet[] }>(
    `${LORCANA_API_ROOT}/sets`,
    'Lorcast set list',
  );
  const cards: CatalogCard[] = [];
  const sets: CatalogSet[] = [];

  for (const set of payload.results ?? []) {
    if (limit && cards.length >= limit) break;
    const code = set.code ?? set.id;
    const setCards = await fetchJson<LorcastCard[]>(
      `${LORCANA_API_ROOT}/sets/${encodeURIComponent(code)}/cards`,
      `Lorcast set ${code}`,
    );
    const remaining = limit ? limit - cards.length : Number.POSITIVE_INFINITY;
    const selectedCards = setCards.slice(0, remaining);
    sets.push({
      code,
      name: set.name,
      releasedAt: set.released_at,
      count: set.card_count ?? setCards.length,
    });
    cards.push(
      ...selectedCards.map((card) => {
        const collectorNumber = card.collector_number?.trim();
        const cardSetCode = card.set?.code ?? code;
        return taggedCard('lorcana', {
          id: collectorNumber ? `${cardSetCode}:${collectorNumber}` : card.id,
          name: card.version ? `${card.name} - ${card.version}` : card.name,
          setCode: cardSetCode,
          collectorNumber,
          rarity: card.rarity,
          type: card.type?.join(' · '),
          artist: card.illustrators?.join(' / '),
          classifications: card.classifications,
          ...lorcastImages(card),
        });
      }),
    );
    // Lorcast asks clients to leave 50–100 ms between requests.
    await sleep(100);
  }

  return {
    formatVersion: 1,
    tcg: 'lorcana',
    version: 1,
    updatedAt,
    sets,
    cards,
  };
}

function dragonBallAttribute(
  attributes: Record<string, string | number | boolean | null>,
  ...names: string[]
): string | number | boolean | null | undefined {
  const normalized = names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return Object.entries(attributes).find(([key]) =>
    normalized.includes(key.toLowerCase().replace(/[^a-z0-9]/g, '')),
  )?.[1];
}

async function buildDragonBallPack(updatedAt: string, limit?: number): Promise<CatalogPack> {
  const apiKey = process.env.APITCG_API_KEY;
  if (!apiKey) {
    throw new Error('APITCG_API_KEY is required to build the dragonball catalog');
  }
  const headers = { 'x-api-key': apiKey };
  const setUrl = new URL(`${APITCG_API_ROOT}/api/${DRAGONBALL_TCG_SLUG}/sets`);
  setUrl.searchParams.set('limit', '100');
  const setPayload = await fetchJson<{ data?: ApiTcgSet[] }>(
    setUrl.toString(),
    'API TCG Dragon Ball set list',
    headers,
  );
  const setById = new Map((setPayload.data ?? []).map((set) => [set._id, set] as const));
  const setByCode = new Map(
    (setPayload.data ?? []).flatMap((set) => (set.code ? [[set.code, set] as const] : [])),
  );
  const cards: CatalogCard[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (cards.length < total && (!limit || cards.length < limit)) {
    const pageUrl = new URL(`${APITCG_API_ROOT}/api/products`);
    pageUrl.searchParams.set('tcg', DRAGONBALL_TCG_SLUG);
    pageUrl.searchParams.set('type', 'card');
    pageUrl.searchParams.set('populate', 'set');
    pageUrl.searchParams.set('limit', '100');
    pageUrl.searchParams.set('page', String(page));
    const payload = await fetchJson<{ data?: ApiTcgProduct[]; total?: number }>(
      pageUrl.toString(),
      `API TCG Dragon Ball cards page ${page}`,
      headers,
    );
    total = payload.total ?? 0;
    const products = payload.data ?? [];
    if (!products.length) break;
    for (const product of products) {
      if (limit && cards.length >= limit) break;
      const attributes = product.attributes ?? {};
      const set =
        typeof product.set === 'object'
          ? product.set
          : product.set
            ? (setById.get(product.set) ?? setByCode.get(product.set))
            : undefined;
      const image = product.images?.[0];
      cards.push(
        taggedCard('dragonball', {
          id: String(product._id),
          name: product.name,
          setCode:
            set?.code ?? set?._id ?? (typeof product.set === 'string' ? product.set : undefined),
          collectorNumber: product.cardNumber ?? product.code,
          rarity: String(dragonBallAttribute(attributes, 'rarity') ?? '') || undefined,
          type: String(dragonBallAttribute(attributes, 'type', 'card type') ?? '') || undefined,
          character: String(dragonBallAttribute(attributes, 'character') ?? '') || undefined,
          era: String(dragonBallAttribute(attributes, 'era') ?? '') || undefined,
          specialTrait:
            String(dragonBallAttribute(attributes, 'special trait', 'specialTrait') ?? '') ||
            undefined,
          imageUrl: image?.large ?? image?.medium ?? image?.small,
          imageUrlSmall: image?.small ?? image?.medium ?? image?.large,
        }),
      );
    }
    page += 1;
  }

  if (!setPayload.data?.length) {
    throw new Error('API TCG returned no Dragon Ball sets; refusing to publish an empty catalog');
  }
  if (!cards.length) {
    throw new Error('API TCG returned no Dragon Ball cards; refusing to publish an empty catalog');
  }

  const counts = new Map<string, number>();
  for (const card of cards) {
    if (card.setCode) counts.set(card.setCode, (counts.get(card.setCode) ?? 0) + 1);
  }
  const sets = (setPayload.data ?? []).map((set) => {
    const code = set.code ?? set._id;
    return {
      code,
      name: set.name,
      releasedAt: set.release_date,
      count: counts.get(code) ?? counts.get(set._id) ?? 0,
      logoUrl: set.logo,
    };
  });

  return {
    formatVersion: 1,
    tcg: 'dragonball',
    version: 1,
    updatedAt,
    sets,
    cards,
  };
}

async function loadExistingManifest(outDir: string): Promise<CatalogManifest | undefined> {
  try {
    return JSON.parse(await readFile(resolve(outDir, 'manifest.json'), 'utf8')) as CatalogManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function existingPackUpdatedAt(
  outDir: string,
  entry: ManifestGame,
): Promise<string | undefined> {
  try {
    const pack = JSON.parse(await readFile(resolve(outDir, entry.file), 'utf8')) as Pick<
      CatalogPack,
      'updatedAt'
    >;
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
  existingEntry?: ManifestGame,
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
    compressedBytes: gzipSync(contents, { level: 9 }).byteLength,
    sha256,
    file,
    sealedProducts: existingEntry?.sealedProducts,
  };
}

function officialGamePackage(
  game: SupportedGame,
  entry: ManifestGame,
  publishedAt: string,
  signing?: { keyId: string; publicKey: string; signatureFile: string },
): GamePackageManifest {
  const definition = getGameDefinition(game);
  const publicCatalogRoot = (
    process.env.TCGER_CATALOG_PUBLIC_BASE_URL ?? 'https://assets.tcger.ahmadjalil.com/catalogs'
  ).replace(/\/$/, '');
  return gamePackageManifestSchema.parse({
    schema: 'https://tcger.app/schemas/game-package-manifest/v1',
    packageId: `${game}-catalog`,
    packageVersion: String(entry.version),
    publishedAt,
    update: {
      sequence: entry.version,
      manifestUrl: `${publicCatalogRoot}/${game}.game-package.json`,
    },
    game: {
      id: game,
      name: definition.label,
      shortName: definition.shortLabel,
      description: `TCGer's official ${definition.label} catalog package.`,
      homepage: 'https://tcger.app',
      accentColor: definition.presentation?.accentColor,
    },
    publisher: {
      id: 'tcger',
      name: 'TCGer',
      homepage: 'https://tcger.app',
      signingKey: signing
        ? {
            id: signing.keyId,
            algorithm: 'ed25519',
            publicKey: signing.publicKey,
          }
        : undefined,
    },
    signature: signing
      ? {
          algorithm: 'ed25519',
          keyId: signing.keyId,
          url: `./${signing.signatureFile}`,
        }
      : undefined,
    catalog: {
      schema: 'tcger-catalog-v1',
      asset: {
        url: `./${entry.file}`,
        bytes: entry.bytes,
        sha256: entry.sha256,
        mediaType: 'application/json',
      },
      cardCount: entry.cardCount,
      setCount: entry.setCount,
    },
    sealedProducts: entry.sealedProducts
      ? {
          schema: 'tcger-sealed-catalog-v1',
          asset: {
            url: `./${entry.sealedProducts.file}`,
            bytes: entry.sealedProducts.bytes,
            sha256: entry.sealedProducts.sha256,
            mediaType: 'application/json',
          },
          productCount: entry.sealedProducts.productCount,
        }
      : undefined,
    filters: [],
    definition: {
      ...definition,
      interfaces: {
        search: true,
        collection: true,
        sets: true,
        wishlists: true,
        decks: false,
        pricing: false,
        sealedProducts: Boolean(entry.sealedProducts),
        scanner: false,
        packOpening: false,
        features: definition.interfaces?.features ?? [],
      },
    },
  });
}

async function writeOfficialGamePackages(outDir: string, manifest: CatalogManifest): Promise<void> {
  const privateKeyPath = process.env.TCGER_GAME_PACKAGE_SIGNING_PRIVATE_KEY;
  const keyId = process.env.TCGER_GAME_PACKAGE_SIGNING_KEY_ID;
  if (Boolean(privateKeyPath) !== Boolean(keyId)) {
    throw new Error(
      'TCGER_GAME_PACKAGE_SIGNING_PRIVATE_KEY and TCGER_GAME_PACKAGE_SIGNING_KEY_ID must be provided together',
    );
  }
  const privateKey = privateKeyPath
    ? createPrivateKey(await readFile(resolve(privateKeyPath)))
    : undefined;
  if (privateKey && privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('The official game-package signing key must be Ed25519');
  }
  const publicKey = privateKey
    ? (() => {
        const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
        return spki.subarray(spki.length - 32).toString('base64');
      })()
    : undefined;
  for (const game of Object.keys(manifest.games) as SupportedGame[]) {
    const entry = manifest.games[game];
    if (!entry) continue;
    const packageFile = `${game}.game-package.json`;
    const signatureFile = `${packageFile}.sig`;
    const gamePackage = officialGamePackage(
      game,
      entry,
      manifest.generatedAt,
      privateKey && keyId && publicKey ? { keyId, publicKey, signatureFile } : undefined,
    );
    const contents = Buffer.from(`${JSON.stringify(gamePackage, null, 2)}\n`);
    await writeFile(resolve(outDir, packageFile), contents);
    if (privateKey) {
      await writeFile(resolve(outDir, signatureFile), sign(null, contents, privateKey));
    }
    entry.packageFile = packageFile;
    entry.packageSignatureFile = privateKey ? signatureFile : undefined;
  }
}

async function syncOutputs(outDir: string, manifest: CatalogManifest): Promise<void> {
  const destinations = [
    resolve(REPO_ROOT, 'frontend/public/catalog'),
    resolve(REPO_ROOT, 'mobile-apps/ios/TCGer/TCGer/Resources/Catalogs'),
  ];
  for (const destination of destinations) {
    await mkdir(destination, { recursive: true });
    const currentFiles = new Set(
      Object.values(manifest.games)
        .flatMap((entry) => [
          entry?.file,
          entry?.packageFile,
          entry?.packageSignatureFile,
          entry?.sealedProducts?.file,
        ])
        .filter((file): file is string => Boolean(file)),
    );
    for (const filename of await readdir(destination)) {
      if (
        (filename.endsWith('.pack.json') ||
          filename.endsWith('.game-package.json') ||
          filename.endsWith('.game-package.json.sig')) &&
        !currentFiles.has(filename)
      ) {
        await unlink(resolve(destination, filename));
      }
    }
    await copyFile(resolve(outDir, 'manifest.json'), resolve(destination, 'manifest.json'));
    for (const game of Object.keys(manifest.games) as SupportedGame[]) {
      const entry = manifest.games[game];
      if (entry) {
        await copyFile(resolve(outDir, entry.file), resolve(destination, entry.file));
        if (entry.packageFile) {
          await copyFile(
            resolve(outDir, entry.packageFile),
            resolve(destination, entry.packageFile),
          );
        }
        if (entry.packageSignatureFile) {
          await copyFile(
            resolve(outDir, entry.packageSignatureFile),
            resolve(destination, entry.packageSignatureFile),
          );
        }
        if (entry.sealedProducts) {
          await copyFile(
            resolve(outDir, entry.sealedProducts.file),
            resolve(destination, entry.sealedProducts.file),
          );
        }
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
  if (options.packagesOnly) {
    if (!existingManifest) throw new Error('--packages-only requires an existing catalog manifest');
    await writeOfficialGamePackages(options.outDir, existingManifest);
    await writeFile(
      resolve(options.outDir, 'manifest.json'),
      `${JSON.stringify(existingManifest, null, 2)}\n`,
    );
    if (options.sync) await syncOutputs(options.outDir, existingManifest);
    console.log('Emitted official game package manifests.');
    return;
  }
  const manifest: CatalogManifest = {
    formatVersion: 1,
    generatedAt,
    games: { ...existingManifest?.games },
  };

  for (const game of options.games) {
    console.log(`Building ${game} catalog${options.limit ? ` (limit ${options.limit})` : ''}...`);
    const pack =
      game === 'pokemon'
        ? await buildPokemonPack(generatedAt, options.limit)
        : game === 'magic'
          ? await buildMagicPack(generatedAt, options.limit)
          : game === 'yugioh'
            ? await buildYugiohPack(generatedAt, options.limit)
            : game === 'onepiece'
              ? await buildOnePiecePack(generatedAt, options.limit)
              : game === 'lorcana'
                ? await buildLorcanaPack(generatedAt, options.limit)
                : await buildDragonBallPack(generatedAt, options.limit);
    manifest.games[game] = await writePack(options.outDir, pack, existingManifest?.games[game]);
    console.log(JSON.stringify({ game, ...manifest.games[game] }));
  }

  await writeOfficialGamePackages(options.outDir, manifest);
  await writeFile(
    resolve(options.outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  if (options.sync) {
    await syncOutputs(options.outDir, manifest);
    console.log('Synced catalog packs to web and iOS resources.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
