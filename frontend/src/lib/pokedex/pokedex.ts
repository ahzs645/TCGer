import { NATIONAL_POKEDEX_NAMES } from "./species-names";

export interface PokedexDexEntry {
  number: number;
  name: string;
}

export interface PokedexCardInput {
  id: string;
  cardId?: string;
  externalId?: string;
  printingKey?: string;
  name: string;
  tcg?: string;
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  rarity?: string;
  releasedAt?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  type?: string;
  category?: string;
  supertype?: string;
  dexEntries?: readonly PokedexDexEntry[];
  quantity?: number;
  copies?: readonly unknown[];
}

export interface PokedexPrinting {
  id: string;
  name: string;
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  rarity?: string;
  releasedAt?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  ownedQuantity: number;
}

export interface PokedexSpecies {
  number: number;
  name: string;
  generation: number;
  owned: boolean;
  ownedQuantity: number;
  ownedPrintings: number;
  printings: PokedexPrinting[];
}

export interface PokedexProgress {
  owned: number;
  total: number;
  percent: number;
}

export const POKEDEX_GENERATIONS = [
  { id: 1, label: "Kanto", first: 1, last: 151 },
  { id: 2, label: "Johto", first: 152, last: 251 },
  { id: 3, label: "Hoenn", first: 252, last: 386 },
  { id: 4, label: "Sinnoh", first: 387, last: 493 },
  { id: 5, label: "Unova", first: 494, last: 649 },
  { id: 6, label: "Kalos", first: 650, last: 721 },
  { id: 7, label: "Alola", first: 722, last: 809 },
  { id: 8, label: "Galar & Hisui", first: 810, last: 905 },
  { id: 9, label: "Paldea", first: 906, last: 1025 },
] as const;

export type PokedexOwnershipFilter = "all" | "owned" | "missing";

function generationFor(number: number): number {
  return (
    POKEDEX_GENERATIONS.find(
      (generation) => number >= generation.first && number <= generation.last,
    )?.id ?? POKEDEX_GENERATIONS.at(-1)!.id
  );
}

function normalize(value: string): string {
  return value
    .replace(/♀/gu, " female ")
    .replace(/♂/gu, " male ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’']/gu, "")
    .replace(/[^a-zA-Z0-9]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

const SPECIES_MATCHERS = NATIONAL_POKEDEX_NAMES.map((name, index) => ({
  number: index + 1,
  name,
  normalized: normalize(name),
}));
const SPECIES_BY_NORMALIZED_NAME = new Map(
  SPECIES_MATCHERS.map((entry) => [entry.normalized, entry] as const),
);
const MAX_SPECIES_WORDS = Math.max(
  ...SPECIES_MATCHERS.map((entry) => entry.normalized.split(" ").length),
);

function isPokemonCard(card: PokedexCardInput): boolean {
  if (card.tcg && card.tcg !== "pokemon") return false;
  const category = card.supertype ?? card.category ?? card.type;
  return !category || normalize(category) === "pokemon";
}

/**
 * Resolve every species represented on a card.
 *
 * Explicit catalog/provider metadata is authoritative. Name matching exists
 * only for old offline packs and imported collection rows that predate that
 * metadata. Token boundaries prevent short names such as Mew matching Mewtwo.
 */
export function speciesForCard(card: PokedexCardInput): PokedexDexEntry[] {
  const explicit = (card.dexEntries ?? [])
    .filter(
      (entry) =>
        Number.isInteger(entry.number) &&
        entry.number > 0 &&
        entry.number <= NATIONAL_POKEDEX_NAMES.length,
    )
    .map((entry) => ({
      number: entry.number,
      name: NATIONAL_POKEDEX_NAMES[entry.number - 1] ?? entry.name,
    }));
  if (explicit.length) {
    return Array.from(
      new Map(explicit.map((entry) => [entry.number, entry])).values(),
    );
  }

  if (!isPokemonCard(card)) return [];
  const words = normalize(card.name).split(" ").filter(Boolean);
  const matches = new Map<number, PokedexDexEntry>();
  for (let start = 0; start < words.length; start += 1) {
    for (
      let wordCount = Math.min(MAX_SPECIES_WORDS, words.length - start);
      wordCount > 0;
      wordCount -= 1
    ) {
      const candidate = words.slice(start, start + wordCount).join(" ");
      const match = SPECIES_BY_NORMALIZED_NAME.get(candidate);
      if (match) {
        matches.set(match.number, { number: match.number, name: match.name });
        break;
      }
    }
  }
  return Array.from(matches.values());
}

function cardKeys(card: PokedexCardInput): string[] {
  return [card.id, card.cardId, card.externalId, card.printingKey]
    .filter((value): value is string => Boolean(value))
    .map(normalize);
}

function copyCount(card: PokedexCardInput): number {
  if (Number.isFinite(card.quantity) && (card.quantity ?? 0) > 0) {
    return Math.floor(card.quantity!);
  }
  if (card.copies?.length) return card.copies.length;
  return 1;
}

function printingFromCard(
  card: PokedexCardInput,
  ownedQuantity = 0,
): PokedexPrinting {
  return {
    id: card.externalId ?? card.cardId ?? card.id,
    name: card.name,
    setCode: card.setCode,
    setName: card.setName,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
    releasedAt: card.releasedAt,
    imageUrl: card.imageUrl,
    imageUrlSmall: card.imageUrlSmall,
    ownedQuantity,
  };
}

function comparePrintings(
  left: PokedexPrinting,
  right: PokedexPrinting,
): number {
  return (
    Number(right.ownedQuantity > 0) - Number(left.ownedQuantity > 0) ||
    (right.releasedAt ?? "").localeCompare(left.releasedAt ?? "") ||
    (left.setName ?? left.setCode ?? "").localeCompare(
      right.setName ?? right.setCode ?? "",
    ) ||
    (left.collectorNumber ?? "").localeCompare(
      right.collectorNumber ?? "",
      undefined,
      { numeric: true },
    )
  );
}

/** Build a complete National Pokédex from catalog printings and owned rows. */
export function buildPokedex(
  catalogCards: readonly PokedexCardInput[],
  collectionCards: readonly PokedexCardInput[],
): PokedexSpecies[] {
  const printingsBySpecies = new Map<number, Map<string, PokedexPrinting>>();
  const printingAliases = new Map<number, Map<string, string>>();

  for (const card of catalogCards) {
    for (const species of speciesForCard(card)) {
      const printings = printingsBySpecies.get(species.number) ?? new Map();
      const aliases = printingAliases.get(species.number) ?? new Map();
      const keys = cardKeys(card);
      const primaryKey = keys[0] ?? normalize(card.id);
      if (!printings.has(primaryKey)) {
        printings.set(primaryKey, printingFromCard(card));
      }
      for (const key of keys) aliases.set(key, primaryKey);
      printingsBySpecies.set(species.number, printings);
      printingAliases.set(species.number, aliases);
    }
  }

  for (const card of collectionCards) {
    for (const species of speciesForCard(card)) {
      const printings = printingsBySpecies.get(species.number) ?? new Map();
      const aliases = printingAliases.get(species.number) ?? new Map();
      const keys = cardKeys(card);
      const existingKey = keys.flatMap((key) => aliases.get(key) ?? []).at(0);
      const primaryKey = existingKey ?? keys[0] ?? normalize(card.id);
      const existing = printings.get(primaryKey);
      const ownedQuantity = copyCount(card);
      printings.set(
        primaryKey,
        existing
          ? {
              ...existing,
              imageUrl: existing.imageUrl ?? card.imageUrl,
              imageUrlSmall: existing.imageUrlSmall ?? card.imageUrlSmall,
              ownedQuantity: existing.ownedQuantity + ownedQuantity,
            }
          : printingFromCard(card, ownedQuantity),
      );
      for (const key of keys) aliases.set(key, primaryKey);
      printingsBySpecies.set(species.number, printings);
      printingAliases.set(species.number, aliases);
    }
  }

  return NATIONAL_POKEDEX_NAMES.map((name, index) => {
    const number = index + 1;
    const printings = Array.from(
      printingsBySpecies.get(number)?.values() ?? [],
    ).sort(comparePrintings);
    const ownedPrintings = printings.filter(
      (printing) => printing.ownedQuantity > 0,
    ).length;
    const ownedQuantity = printings.reduce(
      (total, printing) => total + printing.ownedQuantity,
      0,
    );
    return {
      number,
      name,
      generation: generationFor(number),
      owned: ownedQuantity > 0,
      ownedQuantity,
      ownedPrintings,
      printings,
    };
  });
}

export function filterPokedex(
  species: readonly PokedexSpecies[],
  options: {
    generation?: number | "all";
    ownership?: PokedexOwnershipFilter;
    query?: string;
  },
): PokedexSpecies[] {
  const query = normalize(options.query ?? "");
  const numericQuery = (options.query ?? "")
    .trim()
    .replace(/^#/u, "")
    .replace(/^0+(?=\d)/u, "");
  return species.filter((entry) => {
    if (
      options.generation !== undefined &&
      options.generation !== "all" &&
      entry.generation !== options.generation
    ) {
      return false;
    }
    if (options.ownership === "owned" && !entry.owned) return false;
    if (options.ownership === "missing" && entry.owned) return false;
    if (
      query &&
      !normalize(entry.name).includes(query) &&
      !(
        /^\d+$/u.test(numericQuery) &&
        String(entry.number).includes(numericQuery)
      )
    ) {
      return false;
    }
    return true;
  });
}

export function pokedexProgress(
  species: readonly PokedexSpecies[],
): PokedexProgress {
  const owned = species.filter((entry) => entry.owned).length;
  const total = species.length;
  return {
    owned,
    total,
    percent: total ? (owned / total) * 100 : 0,
  };
}
