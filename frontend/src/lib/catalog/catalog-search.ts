import type { Card, TcgSet } from "@tcg/api-types";
import type { CatalogTcgCode } from "./catalog-types";

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
  entriesById: Map<string, Card>;
  entriesByName: Map<string, Card[]>;
}

export interface CatalogCardLookup {
  key: string;
  externalId?: string;
  name: string;
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  rarity?: string;
}

const searchIndexes = new Map<CatalogTcgCode, SearchIndex>();

export function normalizeCatalogText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

function normalizeCatalogIdentifier(value?: string): string {
  return value ? normalizeCatalogText(value).replace(/[^a-z0-9]/g, "") : "";
}

function normalizeCollectorNumber(value?: string): string {
  return normalizeCatalogIdentifier(value).replace(
    /^([a-z]*?)0+(?=\d)/,
    "$1",
  );
}

function catalogMatchScore(
  lookup: CatalogCardLookup,
  candidate: Card,
): number {
  const lookupSetCode = normalizeCatalogIdentifier(lookup.setCode);
  const candidateSetCode = normalizeCatalogIdentifier(candidate.setCode);
  const lookupSetName = normalizeCatalogText(lookup.setName ?? "");
  const candidateSetName = normalizeCatalogText(candidate.setName ?? "");
  const lookupCollector = normalizeCollectorNumber(lookup.collectorNumber);
  const candidateCollector = normalizeCollectorNumber(
    candidate.collectorNumber,
  );

  let score = 0;
  const setCodeMatches =
    Boolean(lookupSetCode) && lookupSetCode === candidateSetCode;
  const setNameMatches =
    Boolean(lookupSetName) && lookupSetName === candidateSetName;
  const collectorMatches =
    Boolean(lookupCollector) && lookupCollector === candidateCollector;

  if (setCodeMatches) score += 400;
  if (setNameMatches) score += 300;
  if (collectorMatches) score += 200;
  if (setCodeMatches && collectorMatches) score += 600;
  if (setNameMatches && collectorMatches) score += 500;
  if (
    lookup.rarity &&
    normalizeCatalogText(lookup.rarity) ===
      normalizeCatalogText(candidate.rarity ?? "")
  ) {
    score += 10;
  }
  return score;
}

/**
 * Selects a catalog printing for a persisted card without ever accepting a
 * partial-name match. Older demo records often only have a display set code,
 * so exact name is the safe final fallback when printing metadata differs.
 */
export function selectBestCatalogCardMatch(
  lookup: CatalogCardLookup,
  candidates: Card[],
): Card | undefined {
  const normalizedName = normalizeCatalogText(lookup.name);
  const exactNameCandidates = candidates.filter(
    (candidate) => normalizeCatalogText(candidate.name) === normalizedName,
  );
  if (!exactNameCandidates.length) return undefined;

  return [...exactNameCandidates].sort((left, right) => {
    const scoreDifference =
      catalogMatchScore(lookup, right) - catalogMatchScore(lookup, left);
    if (scoreDifference) return scoreDifference;
    return (
      (left.setCode ?? "").localeCompare(right.setCode ?? "") ||
      (left.collectorNumber ?? "").localeCompare(
        right.collectorNumber ?? "",
      ) ||
      left.id.localeCompare(right.id)
    );
  })[0];
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function deriveCatalogImageUrls(
  tcg: CatalogTcgCode,
  card: CatalogCard,
  set?: CatalogSet,
): CatalogImageUrls {
  const stored = {
    imageUrl: card.imageUrl ?? card.imageUrlSmall,
    imageUrlSmall: card.imageUrlSmall ?? card.imageUrl,
  };
  if (stored.imageUrl || stored.imageUrlSmall) return stored;

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
  if (card.artist !== undefined) attributes.artist = card.artist;
  return attributes;
}

export function catalogCardToCard(
  tcg: CatalogTcgCode,
  card: CatalogCard,
  set?: CatalogSet,
): Card {
  const attributes = catalogCardAttributes(card);
  return {
    id: card.id,
    tcg,
    printingKey: card.printingKey,
    printingKind: card.printingKind,
    sanctionedPlayLegal: card.sanctionedPlayLegal,
    originalPrintingKey: card.originalPrintingKey,
    name: card.name,
    setCode: card.setCode,
    setName: set?.name,
    rarity: card.rarity,
    artist: card.artist,
    collectorNumber: card.collectorNumber,
    releasedAt: set?.releasedAt,
    setSymbolUrl: set?.iconUrl,
    setLogoUrl: set?.logoUrl,
    supertype: card.type,
    pokemonPrint: card.pokemonWorldChampionship
      ? {
          finishes: ["normal"],
          category: card.type,
          worldChampionship: card.pokemonWorldChampionship,
        }
      : undefined,
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...deriveCatalogImageUrls(tcg, card, set),
  };
}

function makeSetMap(sets: CatalogSet[]): Map<string, CatalogSet> {
  return new Map(
    sets.map((set) => [normalizeCatalogText(set.code), set] as const),
  );
}

async function buildSearchIndex(tcg: CatalogTcgCode): Promise<SearchIndex | null> {
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
          card.artist,
          card.supertype,
          card.printingKind,
          card.pokemonPrint?.worldChampionship?.year?.toString(),
          card.pokemonPrint?.worldChampionship?.playerName,
          card.pokemonPrint?.worldChampionship?.deckName,
          card.pokemonPrint?.worldChampionship?.stamp,
          card.pokemonPrint?.worldChampionship
            ? "world worlds world championship wcd replica memorabilia"
            : undefined,
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

  const entriesById = new Map<string, Card>();
  const entriesByName = new Map<string, Card[]>();
  for (const entry of entries) {
    entriesById.set(entry.card.id, entry.card);
    const named = entriesByName.get(entry.normalizedName) ?? [];
    named.push(entry.card);
    entriesByName.set(entry.normalizedName, named);
  }

  const index = {
    version: installed.version,
    entries,
    entriesById,
    entriesByName,
  };
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
  tcg: CatalogTcgCode,
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

export async function searchCatalogByArtist(
  artist: string,
  tcg: CatalogTcgCode,
  limit = 1000,
): Promise<Card[]> {
  const normalizedArtist = normalizeCatalogText(artist);
  if (!normalizedArtist || limit <= 0) return [];

  const index = await buildSearchIndex(tcg);
  if (!index) return [];
  return index.entries
    .filter(
      (entry) => normalizeCatalogText(entry.card.artist ?? "") === normalizedArtist,
    )
    .slice(0, limit)
    .map((entry) => entry.card);
}

export async function matchCatalogCards(
  tcg: CatalogTcgCode,
  lookups: CatalogCardLookup[],
): Promise<Map<string, Card>> {
  const matches = new Map<string, Card>();
  if (!lookups.length) return matches;

  const index = await buildSearchIndex(tcg);
  if (!index) return matches;

  for (const lookup of lookups) {
    const directMatch = lookup.externalId
      ? index.entriesById.get(lookup.externalId)
      : undefined;
    const match =
      directMatch ??
      selectBestCatalogCardMatch(
        lookup,
        index.entriesByName.get(normalizeCatalogText(lookup.name)) ?? [],
      );
    if (match) matches.set(lookup.key, match);
  }
  return matches;
}

export async function getSets(tcg: CatalogTcgCode): Promise<TcgSet[]> {
  const installed = await getInstalledCatalog(tcg);
  if (!installed) return [];
  return installed.sets.map((set) => ({
    code: set.code,
    name: set.name,
    tcg,
    releaseDate: set.releasedAt,
    totalCards: set.count,
    standardCards: set.standardCount,
    setType: set.setType,
    releaseYear: set.releaseYear,
    iconUrl: set.iconUrl,
    iconFallbackUrl: set.iconFallbackUrl,
    logoUrl: set.logoUrl,
  }));
}

export async function getCardsInSet(
  tcg: CatalogTcgCode,
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

export function invalidateCatalogSearchIndex(tcg?: CatalogTcgCode): void {
  if (tcg) {
    searchIndexes.delete(tcg);
    return;
  }
  searchIndexes.clear();
}
