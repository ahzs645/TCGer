import type { Card, TcgSet } from '@tcg/api-types';
import { canonicalizePokemonRarity } from './pokemon-normalization';

const DEFAULT_CATALOG_URL = 'https://tcgcsv.com/tcgplayer/3/2282/products';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

interface TcgCsvExtendedData {
  name?: string;
  value?: string;
}

export interface TcgCsvWorldChampionshipProduct {
  productId: number;
  name: string;
  cleanName?: string;
  imageUrl?: string;
  url?: string;
  modifiedOn?: string;
  extendedData?: TcgCsvExtendedData[];
}

interface TcgCsvProductsResponse {
  success?: boolean;
  results?: TcgCsvWorldChampionshipProduct[];
}

export interface PokemonWorldChampionshipCatalog {
  cards: Card[];
  sets: TcgSet[];
}

interface ParsedProductName {
  cardName: string;
  year: number;
  playerName: string;
  stamp?: string;
}

let cachedCatalog: { expiresAt: number; value: PokemonWorldChampionshipCatalog } | undefined;
let catalogRequest: Promise<PokemonWorldChampionshipCatalog> | undefined;

function normalizedLookup(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(value: string): string {
  return normalizedLookup(value).replace(/\s+/g, '-');
}

function extendedDataMap(product: TcgCsvWorldChampionshipProduct): Map<string, string> {
  return new Map(
    (product.extendedData ?? [])
      .filter((entry): entry is Required<TcgCsvExtendedData> => Boolean(entry.name && entry.value))
      .map((entry) => [entry.name.toLowerCase(), entry.value.trim()])
  );
}

function parseCardProductName(name: string): ParsedProductName | undefined {
  if (/^code card\b/i.test(name)) {
    return undefined;
  }

  const stampMatch = name.match(/\s+\[([^\]]+)]$/);
  const stamp = stampMatch?.[1]?.toLowerCase().replace(/\s+/g, '-');
  const withoutStamp = stampMatch ? name.slice(0, stampMatch.index).trim() : name.trim();
  // TCGCSV currently has one trailing "a" typo after the player parenthesis.
  const match = withoutStamp.match(/^(.*?)\s+-\s+(20\d{2})\s+\(([^)]+)\)a?$/);
  if (!match) {
    return undefined;
  }

  return {
    cardName: match[1].trim(),
    year: Number(match[2]),
    playerName: match[3].trim(),
    stamp
  };
}

function buildDeckNameMap(products: TcgCsvWorldChampionshipProduct[]): Map<string, string> {
  const decks = new Map<string, string>();
  for (const product of products) {
    const match = product.name.match(
      /^(20\d{2}) World Championships? Deck:\s*(.*?)\s*\(([^)]+)\)$/i
    );
    if (!match) {
      continue;
    }
    const year = Number(match[1]);
    const playerName = match[2].trim();
    decks.set(`${year}:${normalizedLookup(playerName)}`, match[3].trim());
  }

  // The 2025 sealed product spelling differs from its card product spelling.
  const yuyaDeck = decks.get('2025:yuyu okita');
  if (yuyaDeck) {
    decks.set('2025:yuya okita', yuyaDeck);
  }
  return decks;
}

function highResolutionImage(url: string | undefined): string | undefined {
  return url?.replace(/_200w(?=\.[a-z]+$)/i, '_in_1000x1000');
}

function inferSupertype(data: Map<string, string>): string | undefined {
  const cardType = data.get('card type') ?? '';
  if (data.has('hp') || data.has('stage')) {
    return 'Pokémon';
  }
  if (/energy/i.test(cardType)) {
    return 'Energy';
  }
  if (cardType) {
    return 'Trainer';
  }
  return undefined;
}

export function parsePokemonWorldChampionshipCatalog(
  products: TcgCsvWorldChampionshipProduct[]
): PokemonWorldChampionshipCatalog {
  const deckNames = buildDeckNameMap(products);
  const cards: Card[] = [];

  for (const product of products) {
    const parsed = parseCardProductName(product.name);
    if (!parsed) {
      continue;
    }

    const data = extendedDataMap(product);
    const productId = String(product.productId);
    const setCode = `wcd${parsed.year}`;
    const deckName = deckNames.get(`${parsed.year}:${normalizedLookup(parsed.playerName)}`);
    const collectorNumber = data.get('number');
    const cardType = data.get('card type');
    const stage = data.get('stage');
    const supertype = inferSupertype(data);
    const sourceRarity = data.get('rarity');
    const rarity = sourceRarity?.toLowerCase() === 'none'
      ? undefined
      : canonicalizePokemonRarity(sourceRarity, parsed.cardName, { noneMeansPromo: false });
    const imageUrl = highResolutionImage(product.imageUrl);

    cards.push({
      id: `wcd-${productId}`,
      tcg: 'pokemon',
      printingKey: `pokemon:wcd:${parsed.year}:${slug(parsed.playerName)}:${productId}`,
      printingKind: 'replica',
      sanctionedPlayLegal: false,
      name: parsed.cardName,
      setCode,
      setName: `World Championship Decks ${parsed.year}`,
      rarity,
      collectorNumber,
      imageUrl,
      imageUrlSmall: product.imageUrl,
      supertype,
      pokemonPrint: {
        finishes: ['normal'],
        category: supertype,
        worldChampionship: {
          year: parsed.year,
          playerName: parsed.playerName,
          deckName,
          originalCollectorNumber: collectorNumber,
          printedSignature: true,
          cardBack: 'world-championship',
          stamp: parsed.stamp,
          sourceProductId: productId,
          sourceUrl: product.url
        }
      },
      attributes: {
        cardType,
        hp: data.get('hp'),
        stage,
        originalRarity: sourceRarity,
        sourceName: product.name
      },
      provenance: {
        source: 'tcgcsv',
        sourceId: productId,
        fetchedAt: product.modifiedOn,
        schemaVersion: 'tcgplayer-group-2282'
      }
    });
  }

  cards.sort((a, b) => {
    const yearA = a.pokemonPrint?.worldChampionship?.year ?? 0;
    const yearB = b.pokemonPrint?.worldChampionship?.year ?? 0;
    return yearB - yearA
      || a.name.localeCompare(b.name)
      || (a.pokemonPrint?.worldChampionship?.playerName ?? '').localeCompare(
        b.pokemonPrint?.worldChampionship?.playerName ?? ''
      );
  });

  const counts = new Map<number, number>();
  for (const card of cards) {
    const year = card.pokemonPrint?.worldChampionship?.year;
    if (year) {
      counts.set(year, (counts.get(year) ?? 0) + 1);
    }
  }
  const sets = [...counts.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, count]): TcgSet => ({
      code: `wcd${year}`,
      name: `World Championship Decks ${year}`,
      tcg: 'pokemon',
      totalCards: count,
      standardCards: count,
      setType: 'memorabilia',
      releaseYear: year
    }));

  return { cards, sets };
}

export function searchPokemonWorldChampionshipCatalog(
  catalog: PokemonWorldChampionshipCatalog,
  query: string,
  limit = 20
): Card[] {
  const terms = normalizedLookup(query).split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return [];
  }

  return catalog.cards.filter((card) => {
    const worlds = card.pokemonPrint?.worldChampionship;
    const haystack = normalizedLookup([
      card.name,
      card.setName,
      card.setCode,
      worlds?.year,
      worlds?.playerName,
      worlds?.deckName,
      worlds?.stamp,
      'world worlds world championship wcd replica memorabilia'
    ].filter(Boolean).join(' '));
    return terms.every((term) => haystack.includes(term));
  }).slice(0, limit);
}

export function cardsByWorldChampionshipName(
  catalog: PokemonWorldChampionshipCatalog,
  name: string
): Card[] {
  const query = normalizedLookup(name);
  return catalog.cards.filter((card) => normalizedLookup(card.name).includes(query));
}

export async function getPokemonWorldChampionshipCatalog(): Promise<PokemonWorldChampionshipCatalog> {
  const now = Date.now();
  if (cachedCatalog && cachedCatalog.expiresAt > now) {
    return cachedCatalog.value;
  }
  if (catalogRequest) {
    return catalogRequest;
  }

  catalogRequest = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        process.env.POKEMON_WORLD_CHAMPIONSHIP_CATALOG_URL ?? DEFAULT_CATALOG_URL,
        {
          signal: controller.signal,
          headers: { 'User-Agent': 'TCGer catalog importer (https://github.com/ahmadjalil/TCGer)' }
        }
      );
      if (!response.ok) {
        throw new Error(`World Championship catalog fetch failed: ${response.status}`);
      }
      const payload = await response.json() as TcgCsvProductsResponse;
      const value = parsePokemonWorldChampionshipCatalog(payload.results ?? []);
      cachedCatalog = { expiresAt: Date.now() + CACHE_TTL_MS, value };
      return value;
    } finally {
      clearTimeout(timeout);
      catalogRequest = undefined;
    }
  })();

  return catalogRequest;
}

export async function safePokemonWorldChampionshipCatalog(): Promise<PokemonWorldChampionshipCatalog> {
  try {
    return await getPokemonWorldChampionshipCatalog();
  } catch (error) {
    console.error('Pokemon World Championship catalog unavailable', error);
    return { cards: [], sets: [] };
  }
}
