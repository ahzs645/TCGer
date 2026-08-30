import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

type SupportedGame =
  | 'pokemon'
  | 'magic'
  | 'yugioh'
  | 'onepiece'
  | 'lorcana'
  | 'dragonball';

interface BuildOptions {
  games: SupportedGame[];
  outDir: string;
  maxGroups?: number;
  sync: boolean;
}

interface TcgCsvGroup {
  groupId: number;
  name: string;
  abbreviation?: string;
  isSupplemental?: boolean;
  publishedOn?: string;
}

interface CatalogSealedProduct {
  id: string;
  tcg: SupportedGame;
  name: string;
  productType: string;
  setCode?: string;
  cardsPerPack?: number;
  packsPerBox?: number;
  releaseDate?: string;
  imageUrl?: string;
  marketPrice?: number;
  upc?: string;
  contentMode?: 'fixed' | 'pool';
  contentCount?: number;
  contents?: Array<{
    externalId?: string;
    name: string;
    quantity?: number;
    setCode?: string;
    rarity?: string;
    imageUrl?: string;
  }>;
  contentSource?: string;
  contentUpdatedAt?: string;
}

interface SealedCatalogPack {
  formatVersion: 1;
  tcg: SupportedGame;
  version: number;
  updatedAt: string;
  products: CatalogSealedProduct[];
}

interface SealedManifestEntry {
  version: number;
  productCount: number;
  bytes: number;
  compressedBytes?: number;
  sha256: string;
  file: string;
}

interface ManifestGame {
  version: number;
  cardCount: number;
  setCount: number;
  bytes: number;
  compressedBytes?: number;
  sha256: string;
  file: string;
  sealedProducts?: SealedManifestEntry;
}

interface CatalogManifest {
  formatVersion: 1;
  generatedAt: string;
  games: Partial<Record<SupportedGame, ManifestGame>>;
}

const REPO_ROOT = resolve(__dirname, '../../..');
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'data/catalog');
const TCGCSV_ROOT = 'https://tcgcsv.com/tcgplayer';
const YGOPRO_ROOT = 'https://db.ygoprodeck.com/api/v7';
const USER_AGENT = 'TCGer-sealed-catalog-builder/1.0';
const REQUEST_DELAY_MS = 110;

const CATEGORY_IDS: Record<SupportedGame, number[]> = {
  magic: [1],
  yugioh: [2],
  pokemon: [3],
  dragonball: [27, 80],
  onepiece: [68],
  lorcana: [71],
};

const ALL_GAMES = Object.keys(CATEGORY_IDS) as SupportedGame[];

const SEALED_NAME_PATTERN = new RegExp(
  [
    'booster\\s*(?:box|pack|display|bundle)',
    'collector\\s*booster',
    'draft\\s*booster',
    'set\\s*booster',
    'play\\s*booster',
    'elite\\s*trainer\\s*box',
    'trainer\\s*box',
    'illumineer[’\']?s\\s*trove',
    'starter\\s*(?:deck|set|kit)',
    'structure\\s*deck',
    'theme\\s*deck',
    'battle\\s*deck',
    'commander\\s*deck',
    'deck\\s*set',
    'prerelease\\s*(?:pack|kit)',
    'build\\s*(?:&|and)\\s*battle',
    'gift\\s*(?:box|set|bundle)',
    'collection\\s*(?:box|case)',
    '(?:display|case)\\s*(?:box|of|contains)',
    '\\b(?:tin|bundle|blister|trove)\\b',
    '\\b(?:box|case|collection)\\b',
  ].join('|'),
  'i',
);

const EXCLUDED_NAME_PATTERN = new RegExp(
  [
    'code\\s*card',
    'online\\s*code',
    'digital\\s*code',
    'deck\\s*box',
    'storage\\s*box',
    'card\\s*sleeves?',
    'playmat',
    'binder',
    'portfolio',
    'dice\\s*(?:set|bag|pack)?',
    'token\\s*(?:set|pack|collection)',
    'empty\\s*(?:box|tin|pack|wrapper)',
    'wrapper\\s*only',
  ].join('|'),
  'i',
);

const CARD_IDENTITY_FIELDS = [
  'extRarity',
  'extNumber',
  'extCardType',
  'extHP',
  'extStage',
  'extAttack1',
  'extWeakness',
  'extResistance',
  'extRetreatCost',
] as const;

function printUsage(): void {
  console.log(`Usage:
  npx tsx src/scripts/build-sealed-catalog-packs.ts [--game pokemon|magic|yugioh|onepiece|lorcana|dragonball] [--out <dir>] [--max-groups <n>] [--sync]

Defaults:
  --game all
  --out data/catalog

The builder reads TCGCSV at a polite sequential rate. Use --max-groups only
with a temporary --out directory for quick validation builds.`);
}

function positiveInteger(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseGame(value: string | undefined): SupportedGame {
  const normalized = value?.trim().toLowerCase() as SupportedGame | undefined;
  if (normalized && ALL_GAMES.includes(normalized)) return normalized;
  throw new Error(`game must be one of: ${ALL_GAMES.join(', ')}`);
}

function parseOptions(argv: string[]): BuildOptions | null {
  const args = [...argv];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  while (args.length) {
    const token = args.shift();
    if (!token) continue;
    if (token === '--help' || token === '-h') return null;
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const [key, inline] = token.slice(2).split('=', 2);
    if (inline !== undefined) values.set(key, inline);
    else if (args[0] && !args[0]!.startsWith('--')) values.set(key, args.shift()!);
    else flags.add(key);
  }

  const known = new Set(['game', 'out', 'max-groups', 'sync']);
  for (const key of [...values.keys(), ...flags]) {
    if (!known.has(key)) throw new Error(`Unknown option: --${key}`);
  }
  if (flags.has('game') || flags.has('out') || flags.has('max-groups')) {
    throw new Error('--game, --out, and --max-groups require values');
  }
  return {
    games: values.has('game') ? [parseGame(values.get('game'))] : ALL_GAMES,
    outDir: resolve(values.get('out') ?? DEFAULT_OUT_DIR),
    maxGroups: positiveInteger('--max-groups', values.get('max-groups')),
    sync: flags.has('sync') || values.get('sync') === 'true',
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function fetchText(url: string, label: string): Promise<string> {
  const attempts = 4;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv, application/json' },
      });
      if (response.ok) return await response.text();
      const transient = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!transient || attempt === attempts) {
        throw new Error(`${label} failed: HTTP ${response.status}`);
      }
      await response.body?.cancel();
    } catch (error) {
      if (attempt === attempts) throw error;
    }
    await sleep(500 * 2 ** (attempt - 1));
  }
  throw new Error(`${label} failed after ${attempts} attempts`);
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  return JSON.parse(await fetchText(url, label)) as T;
}

async function fetchGroups(categoryId: number): Promise<TcgCsvGroup[]> {
  const text = await fetchText(`${TCGCSV_ROOT}/${categoryId}/groups`, `TCGCSV category ${categoryId}`);
  const payload = JSON.parse(text) as { results?: TcgCsvGroup[] };
  return payload.results ?? [];
}

/** RFC 4180 parser kept local so catalog builds do not add a runtime dependency. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const headers = rows.shift()?.map((value, index) =>
    index === 0 ? value.replace(/^\uFEFF/, '') : value,
  );
  if (!headers?.length) return [];
  return rows
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function digits(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\D/g, '');
  return normalized && normalized.length >= 8 && normalized.length <= 14 ? normalized : undefined;
}

function positiveNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function isSealedProductRow(row: Record<string, string>): boolean {
  const name = row.name?.trim();
  if (!name || !row.productId?.trim() || EXCLUDED_NAME_PATTERN.test(name)) return false;
  if (CARD_IDENTITY_FIELDS.some((fieldName) => Boolean(row[fieldName]?.trim()))) return false;
  return Boolean(digits(row.extUPC)) || SEALED_NAME_PATTERN.test(name);
}

export function sealedProductType(name: string): string {
  const normalized = name.toLowerCase();
  if (/elite\s*trainer\s*box|\betb\b/.test(normalized)) return 'etb';
  if (/\bcase\b/.test(normalized)) return 'case';
  if (/\btin\b/.test(normalized)) return 'tin';
  if (/\b(?:starter|structure|theme|battle|commander)\s*deck\b|\bdeck\s*set\b/.test(normalized)) return 'deck';
  if (/\b(?:booster\s*)?(?:box|display)\b/.test(normalized)) return 'box';
  if (/\b(?:booster\s*)?pack\b|\bblister\b/.test(normalized)) return 'booster';
  if (/\bbundle\b/.test(normalized)) return 'bundle';
  if (/\bcollection\b/.test(normalized)) return 'collection';
  return 'sealed';
}

function contentsCounts(cardText: string | undefined): Pick<CatalogSealedProduct, 'cardsPerPack' | 'packsPerBox'> {
  const text = cardText?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') ?? '';
  const cards = text.match(/(\d{1,3})\s+cards?\s+(?:in|per)\s+(?:each\s+)?(?:booster\s+)?pack/i);
  const packs = text.match(/(?:contains?|includes?|with)\s+(\d{1,3})\s+(?:tcg\s+)?(?:booster\s+)?packs?/i);
  return {
    cardsPerPack: cards ? positiveNumber(cards[1]) : undefined,
    packsPerBox: packs ? positiveNumber(packs[1]) : undefined,
  };
}

function releaseDate(group: TcgCsvGroup): string | undefined {
  if (group.isSupplemental || !group.publishedOn) return undefined;
  const match = group.publishedOn.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0];
}

function rowToProduct(
  game: SupportedGame,
  group: TcgCsvGroup,
  row: Record<string, string>,
): CatalogSealedProduct {
  return {
    id: `tcgplayer:${row.productId.trim()}`,
    tcg: game,
    name: row.name.trim(),
    productType: sealedProductType(row.name),
    setCode: group.abbreviation?.trim() || undefined,
    ...contentsCounts(row.extCardText),
    releaseDate: releaseDate(group),
    imageUrl: row.imageUrl?.trim() || undefined,
    marketPrice: positiveNumber(row.marketPrice),
    upc: digits(row.extUPC),
  };
}

interface YgoSetRow {
  set_name?: string;
  set_code?: string;
  num_of_cards?: number;
  tcg_date?: string;
}

interface YgoCardRow {
  id?: number;
  name?: string;
  card_sets?: Array<{
    set_name?: string;
    set_code?: string;
    set_rarity?: string;
  }>;
  card_images?: Array<{ image_url_small?: string; image_url?: string }>;
}

function normalizedProductName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function isYugiohFixedDeckSet(name: string): boolean {
  return /\b(?:structure|starter) deck\b/i.test(name.trim());
}

async function enrichYugiohDeckContents(
  products: Map<string, CatalogSealedProduct>,
  updatedAt: string,
): Promise<void> {
  const [setRows, cardsPayload] = await Promise.all([
    fetchJson<YgoSetRow[]>(`${YGOPRO_ROOT}/cardsets.php`, 'YGOPRODeck card sets'),
    fetchJson<{ data?: YgoCardRow[] }>(`${YGOPRO_ROOT}/cardinfo.php?format=tcg`, 'YGOPRODeck cards'),
  ]);
  const deckSets = setRows.filter((row) => row.set_name && isYugiohFixedDeckSet(row.set_name));
  const deckNames = new Set(deckSets.map((row) => row.set_name!));
  const contentsBySet = new Map<string, NonNullable<CatalogSealedProduct['contents']>>();
  for (const card of cardsPayload.data ?? []) {
    if (!card.name) continue;
    for (const printing of card.card_sets ?? []) {
      if (!printing.set_name || !deckNames.has(printing.set_name)) continue;
      const contents = contentsBySet.get(printing.set_name) ?? [];
      contents.push({
        externalId: card.id === undefined ? undefined : String(card.id),
        name: card.name,
        setCode: printing.set_code,
        rarity: printing.set_rarity,
        imageUrl: card.card_images?.[0]?.image_url_small ?? card.card_images?.[0]?.image_url,
      });
      contentsBySet.set(printing.set_name, contents);
    }
  }

  const existingProducts = [...products.values()];
  for (const set of deckSets) {
    const setName = set.set_name!;
    const contents = contentsBySet.get(setName);
    if (!contents?.length) continue;
    const uniqueContents = [...new Map(
      contents.map((content) => [
        `${content.externalId ?? content.name}:${content.setCode ?? ''}`,
        content,
      ]),
    ).values()];
    const normalizedSet = normalizedProductName(setName);
    const matches = existingProducts.filter((product) => {
      if (product.productType !== 'deck') return false;
      const normalizedProduct = normalizedProductName(product.name);
      return normalizedProduct.includes(normalizedSet) || normalizedSet.includes(normalizedProduct);
    });
    const targets = matches.length ? matches : [{
      id: `ygoprodeck:set:${set.set_code ?? normalizedSet.replace(/ /g, '-')}`,
      tcg: 'yugioh' as const,
      name: setName,
      productType: 'deck',
      setCode: set.set_code,
      releaseDate: set.tcg_date,
    }];
    for (const product of targets) {
      const enriched: CatalogSealedProduct = {
        ...product,
        contentMode: 'fixed',
        contentCount: uniqueContents.length,
        contents: uniqueContents,
        contentSource: `${YGOPRO_ROOT}/cardinfo.php?cardset=${encodeURIComponent(setName)}`,
        contentUpdatedAt: updatedAt,
      };
      products.set(enriched.id, enriched);
    }
  }
}

async function buildPack(
  game: SupportedGame,
  updatedAt: string,
  maxGroups?: number,
): Promise<SealedCatalogPack> {
  const products = new Map<string, CatalogSealedProduct>();
  let processedGroups = 0;
  for (const categoryId of CATEGORY_IDS[game]) {
    const groups = await fetchGroups(categoryId);
    for (const group of groups) {
      if (maxGroups && processedGroups >= maxGroups) break;
      const csv = await fetchText(
        `${TCGCSV_ROOT}/${categoryId}/${group.groupId}/ProductsAndPrices.csv`,
        `TCGCSV ${game} group ${group.groupId}`,
      );
      for (const row of parseCsv(csv)) {
        if (!isSealedProductRow(row)) continue;
        const product = rowToProduct(game, group, row);
        const existing = products.get(product.id);
        if (!existing || (!existing.marketPrice && product.marketPrice)) {
          products.set(product.id, product);
        }
      }
      processedGroups += 1;
      if (processedGroups % 50 === 0) {
        console.log(`${game}: ${processedGroups} groups, ${products.size} sealed products`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
    if (maxGroups && processedGroups >= maxGroups) break;
  }

  if (game === 'yugioh') {
    await enrichYugiohDeckContents(products, updatedAt);
  }

  return {
    formatVersion: 1,
    tcg: game,
    version: 1,
    updatedAt,
    products: [...products.values()].sort((left, right) =>
      right.releaseDate?.localeCompare(left.releaseDate ?? '') || left.name.localeCompare(right.name),
    ),
  };
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function existingPackUpdatedAt(outDir: string, entry: SealedManifestEntry): Promise<string | undefined> {
  try {
    const pack = JSON.parse(await readFile(resolve(outDir, entry.file), 'utf8')) as SealedCatalogPack;
    return pack.updatedAt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writePack(
  outDir: string,
  pack: SealedCatalogPack,
  existing?: SealedManifestEntry,
): Promise<SealedManifestEntry> {
  let contents: string | undefined;
  if (existing) {
    const previousUpdatedAt = await existingPackUpdatedAt(outDir, existing);
    if (previousUpdatedAt) {
      pack.version = existing.version;
      pack.updatedAt = previousUpdatedAt;
      const comparison = JSON.stringify(pack);
      if (sha256(comparison) === existing.sha256) contents = comparison;
    }
  }
  if (!contents) {
    pack.version = existing ? existing.version + 1 : 1;
    contents = JSON.stringify(pack);
  }
  const digest = sha256(contents);
  const file = `${pack.tcg}.sealed.v${pack.version}.${digest.slice(0, 16)}.pack.json`;
  await writeFile(resolve(outDir, file), contents);
  return {
    version: pack.version,
    productCount: pack.products.length,
    bytes: Buffer.byteLength(contents),
    compressedBytes: gzipSync(contents, { level: 9 }).byteLength,
    sha256: digest,
    file,
  };
}

async function syncOutputs(outDir: string, manifest: CatalogManifest): Promise<void> {
  const destinations = [
    resolve(REPO_ROOT, 'frontend/public/catalog'),
    resolve(REPO_ROOT, 'mobile-apps/ios/TCGer/TCGer/Resources/Catalogs'),
  ];
  const currentSealedFiles = new Set(
    Object.values(manifest.games).flatMap((entry) => entry?.sealedProducts?.file ?? []),
  );
  for (const destination of destinations) {
    await mkdir(destination, { recursive: true });
    for (const filename of await readdir(destination)) {
      if (filename.includes('.sealed.') && filename.endsWith('.pack.json') && !currentSealedFiles.has(filename)) {
        await unlink(resolve(destination, filename));
      }
    }
    await copyFile(resolve(outDir, 'manifest.json'), resolve(destination, 'manifest.json'));
    for (const filename of currentSealedFiles) {
      await copyFile(resolve(outDir, filename), resolve(destination, filename));
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    printUsage();
    return;
  }
  await mkdir(options.outDir, { recursive: true });
  const manifestPath = resolve(options.outDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as CatalogManifest;
  if (manifest.formatVersion !== 1 || !manifest.games) {
    throw new Error('Build the card catalog manifest before sealed-product packs.');
  }

  const generatedAt = new Date().toISOString();
  for (const game of options.games) {
    const gameEntry = manifest.games[game];
    if (!gameEntry) {
      if (options.games.length === 1) {
        throw new Error(`The card catalog manifest has no ${game} entry.`);
      }
      console.log(`Skipping ${game}: the card catalog manifest has no entry.`);
      continue;
    }
    console.log(`Building ${game} sealed-product catalog...`);
    const pack = await buildPack(game, generatedAt, options.maxGroups);
    gameEntry.sealedProducts = await writePack(
      options.outDir,
      pack,
      gameEntry.sealedProducts,
    );
    console.log(JSON.stringify({ game, ...gameEntry.sealedProducts }));
    manifest.generatedAt = generatedAt;
    // Persist each completed game. A later provider failure must not discard
    // several minutes of already-built, content-addressed packs.
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (options.sync) {
    await syncOutputs(options.outDir, manifest);
    console.log('Synced sealed-product packs to web and iOS resources.');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
