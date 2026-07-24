import type { Card, TcgCode, TcgSet } from "@tcg/api-types";

import {
  type CatalogCard,
  type CatalogSet,
  getCatalogCards,
  getCatalogCardsForSet,
  getInstalledCatalog,
} from "./catalog-db";

interface CatalogImageUrls {
  imageUrl?: string;
  imageUrlSmall?: string;
}

interface SearchIndexEntry {
  card: Card;
  normalizedName: string;
  normalizedWords: string[];
  normalizedDetails: string;
}

interface SearchIndex {
  version: number;
  entries: SearchIndexEntry[];
}

const searchIndexes = new Map<TcgCode, SearchIndex>();

export function normalizeCatalogText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function deriveCatalogImageUrls(
  tcg: TcgCode,
  card: CatalogCard,
  set?: CatalogSet,
): CatalogImageUrls {
  if (tcg === "pokemon" && set?.serie && card.setCode && card.collectorNumber) {
    const root = `https://assets.tcgdex.net/en/${encodePathSegment(
      set.serie,
    )}/${encodePathSegment(card.setCode)}/${encodePathSegment(
      card.collectorNumber,
    )}`;
    return {
      imageUrl: `${root}/high.webp`,
      imageUrlSmall: `${root}/low.webp`,
    };
  }

  if (tcg === "magic" && card.id.length >= 2) {
    const suffix = `${encodePathSegment(card.id[0])}/${encodePathSegment(
      card.id[1],
    )}/${encodePathSegment(card.id)}.jpg`;
    return {
      imageUrl: `https://cards.scryfall.io/normal/front/${suffix}`,
      imageUrlSmall: `https://cards.scryfall.io/small/front/${suffix}`,
    };
  }

  if (tcg === "yugioh" && card.konamiId !== undefined) {
    return {
      imageUrl: `https://images.ygoprodeck.com/images/cards/${card.konamiId}.jpg`,
      imageUrlSmall: `https://images.ygoprodeck.com/images/cards_small/${card.konamiId}.jpg`,
    };
  }

  return {};
}

function catalogCardAttributes(card: CatalogCard): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  if (card.type !== undefined) attributes.type = card.type;
  if (card.types !== undefined) attributes.types = card.types;
  if (card.hp !== undefined) attributes.hp = card.hp;
  if (card.manaCost !== undefined) attributes.manaCost = card.manaCost;
  if (card.colors !== undefined) attributes.colors = card.colors;
  if (card.race !== undefined) attributes.race = card.race;
  if (card.atk !== undefined) attributes.atk = card.atk;
  if (card.def !== undefined) attributes.def = card.def;
  if (card.level !== undefined) attributes.level = card.level;
  if (card.konamiId !== undefined) attributes.konamiId = card.konamiId;
  return attributes;
}

export function catalogCardToCard(
  tcg: TcgCode,
  card: CatalogCard,
  set?: CatalogSet,
): Card {
  const attributes = catalogCardAttributes(card);
  return {
    id: card.id,
    tcg,
    name: card.name,
    setCode: card.setCode,
    setName: set?.name,
    rarity: card.rarity,
    collectorNumber: card.collectorNumber,
    releasedAt: set?.releasedAt,
    supertype: card.type,
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...deriveCatalogImageUrls(tcg, card, set),
  };
}

function makeSetMap(sets: CatalogSet[]): Map<string, CatalogSet> {
  return new Map(
    sets.map((set) => [normalizeCatalogText(set.code), set] as const),
  );
}

async function buildSearchIndex(tcg: TcgCode): Promise<SearchIndex | null> {
  const installed = await getInstalledCatalog(tcg);
  if (!installed) return null;

  const cached = searchIndexes.get(tcg);
  if (cached?.version === installed.version) return cached;

  const setMap = makeSetMap(installed.sets);
  const catalogCards = await getCatalogCards(tcg);
  const entries = catalogCards.map((catalogCard): SearchIndexEntry => {
    const set = catalogCard.setCode
      ? setMap.get(normalizeCatalogText(catalogCard.setCode))
      : undefined;
    const card = catalogCardToCard(tcg, catalogCard, set);
    const normalizedName = normalizeCatalogText(card.name);
    return {
      card,
      normalizedName,
      normalizedWords: normalizedName.split(/[\s\p{P}]+/u).filter(Boolean),
      normalizedDetails: normalizeCatalogText(
        [
          card.setName,
          card.setCode,
          card.collectorNumber,
          card.rarity,
          card.supertype,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" "),
      ),
    };
  });
  entries.sort(
    (left, right) =>
      left.normalizedName.localeCompare(right.normalizedName) ||
      (left.card.setCode ?? "").localeCompare(right.card.setCode ?? "") ||
      left.card.id.localeCompare(right.card.id),
  );

  const index = { version: installed.version, entries };
  searchIndexes.set(tcg, index);
  return index;
}

function rankEntry(entry: SearchIndexEntry, query: string): number | null {
  if (entry.normalizedName === query) return 0;
  if (entry.normalizedName.startsWith(query)) return 1;
  if (entry.normalizedWords.some((word) => word.startsWith(query))) return 2;
  if (entry.normalizedDetails.startsWith(query)) return 3;
  if (
    entry.normalizedName.includes(query) ||
    entry.normalizedDetails.includes(query)
  ) {
    return 4;
  }
  return null;
}

export async function searchCatalog(
  query: string,
  tcg: TcgCode,
  limit = 100,
): Promise<Card[]> {
  const normalizedQuery = normalizeCatalogText(query);
  if (!normalizedQuery || limit <= 0) return [];

  const index = await buildSearchIndex(tcg);
  if (!index) return [];

  const ranked: Card[][] = [[], [], [], [], []];
  for (const entry of index.entries) {
    const rank = rankEntry(entry, normalizedQuery);
    if (rank !== null && ranked[rank].length < limit) {
      ranked[rank].push(entry.card);
    }
  }
  return ranked.flat().slice(0, limit);
}

export async function getSets(tcg: TcgCode): Promise<TcgSet[]> {
  const installed = await getInstalledCatalog(tcg);
  if (!installed) return [];
  return installed.sets.map((set) => ({
    code: set.code,
    name: set.name,
    tcg,
    releaseDate: set.releasedAt,
    totalCards: set.count,
  }));
}

export async function getCardsInSet(
  tcg: TcgCode,
  setCode: string,
): Promise<Card[]> {
  const installed = await getInstalledCatalog(tcg);
  if (!installed) return [];

  const normalizedCode = normalizeCatalogText(setCode);
  const set = installed.sets.find(
    (entry) => normalizeCatalogText(entry.code) === normalizedCode,
  );
  const catalogCards = await getCatalogCardsForSet(tcg, set?.code ?? setCode);
  return catalogCards.map((card) => catalogCardToCard(tcg, card, set));
}

export function invalidateCatalogSearchIndex(tcg?: TcgCode): void {
  if (tcg) {
    searchIndexes.delete(tcg);
    return;
  }
  searchIndexes.clear();
}
