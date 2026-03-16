import { z } from 'zod';

// ---------------------------------------------------------------------------
// Pokemon Card Format (tournament legality)
// ---------------------------------------------------------------------------

export const pokemonCardFormatSchema = z.enum(['Standard', 'Expanded', 'Unlimited']);
export type PokemonCardFormat = z.infer<typeof pokemonCardFormatSchema>;

export const pokemonFormatLegalitySchema = z.object({
  standard: z.boolean().optional(),
  expanded: z.boolean().optional()
});
export type PokemonFormatLegality = z.infer<typeof pokemonFormatLegalitySchema>;

// ---------------------------------------------------------------------------
// Pokemon Card Language
// ---------------------------------------------------------------------------

export const pokemonCardLanguageSchema = z.enum([
  'English',
  'Japanese',
  'French',
  'German',
  'Italian',
  'Spanish',
  'Portuguese',
  'Korean',
  'Chinese (S)',
  'Chinese (T)',
  'Dutch',
  'Polish',
  'Russian',
  'Indonesian',
  'Thai',
  'Spanish (MX)'
]);
export type PokemonCardLanguage = z.infer<typeof pokemonCardLanguageSchema>;

/** ISO-style language codes mapped to display names */
export const POKEMON_LANGUAGE_CODES: Record<string, PokemonCardLanguage> = {
  EN: 'English',
  JP: 'Japanese',
  FR: 'French',
  DE: 'German',
  IT: 'Italian',
  ES: 'Spanish',
  PT: 'Portuguese',
  KO: 'Korean',
  'ZH-S': 'Chinese (S)',
  'ZH-T': 'Chinese (T)',
  NL: 'Dutch',
  PL: 'Polish',
  RU: 'Russian',
  ID: 'Indonesian',
  TH: 'Thai'
};

/** Reverse lookup: display name -> code */
export const POKEMON_LANGUAGE_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(POKEMON_LANGUAGE_CODES).map(([code, name]) => [name, code])
);

// ---------------------------------------------------------------------------
// Regulation Mark
// ---------------------------------------------------------------------------

export const pokemonRegulationMarkSchema = z.enum([
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'
]);
export type PokemonRegulationMark = z.infer<typeof pokemonRegulationMarkSchema>;

// ---------------------------------------------------------------------------
// Card Supertype
// ---------------------------------------------------------------------------

export const pokemonCardSupertypeSchema = z.enum(['Pokémon', 'Trainer', 'Energy']);
export type PokemonCardSupertype = z.infer<typeof pokemonCardSupertypeSchema>;

// ---------------------------------------------------------------------------
// Energy Type
// ---------------------------------------------------------------------------

export const pokemonEnergyTypeSchema = z.enum([
  'Grass', 'Fire', 'Water', 'Lightning', 'Psychic',
  'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless'
]);
export type PokemonEnergyType = z.infer<typeof pokemonEnergyTypeSchema>;

/** Single-letter energy symbol codes (used in attack costs) */
export const ENERGY_TYPE_CODES: Record<string, PokemonEnergyType> = {
  G: 'Grass',
  R: 'Fire',
  W: 'Water',
  L: 'Lightning',
  P: 'Psychic',
  F: 'Fighting',
  D: 'Darkness',
  M: 'Metal',
  Y: 'Fairy',
  N: 'Dragon',
  C: 'Colorless'
};

/** Reverse lookup: energy type name -> code */
export const ENERGY_TYPE_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(ENERGY_TYPE_CODES).map(([code, name]) => [name, code])
);

// ---------------------------------------------------------------------------
// TCG Region
// ---------------------------------------------------------------------------

export const pokemonTcgRegionSchema = z.enum([
  'International',
  'Japan',
  'China',
  'Taiwan & Hong Kong',
  'Korea',
  'Thailand',
  'Indonesia'
]);
export type PokemonTcgRegion = z.infer<typeof pokemonTcgRegionSchema>;

// ---------------------------------------------------------------------------
// Pokedex Entry
// ---------------------------------------------------------------------------

export const pokedexEntrySchema = z.object({
  number: z.number().int().positive(),
  name: z.string()
});
export type PokedexEntry = z.infer<typeof pokedexEntrySchema>;

// ---------------------------------------------------------------------------
// Card Number Parsing Utilities
// ---------------------------------------------------------------------------

export interface CardNumberParts {
  /** The original raw card number string */
  raw: string;
  /** Non-numeric prefix (e.g., "TG" from "TG15/TG30") */
  prefix: string | null;
  /** The numeric portion */
  number: number | null;
  /** Non-numeric suffix */
  suffix: string | null;
  /** Number of leading zeros */
  leadingZeros: number;
}

export interface CardNumberInfo {
  /** The original card number string */
  cardNumber: string;
  /** Left part (before the /) */
  left: CardNumberParts;
  /** Right part (after the /), null if no slash */
  right: CardNumberParts | null;
  /** Whether the left number exceeds the right (secret rare indicator) */
  isSecretRare: boolean;
}

/**
 * Parse a single card number part into its components.
 * E.g., "TG15" -> { prefix: "TG", number: 15, suffix: null, leadingZeros: 0 }
 */
export function parseCardNumberPart(value: string): CardNumberParts {
  const trimmed = value.trim();
  if (!trimmed) {
    return { raw: trimmed, prefix: null, number: null, suffix: null, leadingZeros: 0 };
  }

  const match = trimmed.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/);
  if (!match) {
    return { raw: trimmed, prefix: trimmed, number: null, suffix: null, leadingZeros: 0 };
  }

  const [, prefix, digits, suffix] = match;
  const leadingZeros = digits.length - digits.replace(/^0+/, '').length;

  return {
    raw: trimmed,
    prefix: prefix || null,
    number: parseInt(digits, 10),
    suffix: suffix || null,
    leadingZeros
  };
}

/**
 * Parse a Pokemon TCG card number (e.g., "123/456", "TG15/TG30", "SWSH001").
 */
export function parseCardNumber(cardNumber: string): CardNumberInfo {
  const trimmed = cardNumber.trim();
  const slashCount = (trimmed.match(/\//g) || []).length;

  if (slashCount > 1) {
    // Invalid format, treat the whole thing as the left part
    const left = parseCardNumberPart(trimmed);
    return { cardNumber: trimmed, left, right: null, isSecretRare: false };
  }

  if (slashCount === 0) {
    const left = parseCardNumberPart(trimmed);
    return { cardNumber: trimmed, left, right: null, isSecretRare: false };
  }

  const [leftStr, rightStr] = trimmed.split('/');
  const left = parseCardNumberPart(leftStr);
  const right = parseCardNumberPart(rightStr);

  const isSecretRare =
    left.number !== null && right.number !== null && left.number > right.number;

  return { cardNumber: trimmed, left, right, isSecretRare };
}

/**
 * Compare two card numbers for sorting. Handles numeric comparison
 * with prefix/suffix awareness so "2" < "10" (not string comparison).
 */
export function compareCardNumbers(a: string, b: string): number {
  const parsedA = parseCardNumber(a);
  const parsedB = parseCardNumber(b);

  // Compare prefixes first
  const prefixA = parsedA.left.prefix ?? '';
  const prefixB = parsedB.left.prefix ?? '';
  if (prefixA !== prefixB) {
    return prefixA.localeCompare(prefixB);
  }

  // Compare numeric values
  const numA = parsedA.left.number ?? 0;
  const numB = parsedB.left.number ?? 0;
  if (numA !== numB) {
    return numA - numB;
  }

  // Compare suffixes
  const suffixA = parsedA.left.suffix ?? '';
  const suffixB = parsedB.left.suffix ?? '';
  return suffixA.localeCompare(suffixB);
}

/**
 * Check if two card numbers are compatible (same set structure).
 * They are compatible if their right parts match and left parts share the same prefix/suffix.
 */
export function areCardNumbersCompatible(a: string, b: string): boolean {
  const parsedA = parseCardNumber(a);
  const parsedB = parseCardNumber(b);

  if (parsedA.left.prefix !== parsedB.left.prefix) return false;
  if (parsedA.left.suffix !== parsedB.left.suffix) return false;

  if (!parsedA.right && !parsedB.right) return true;
  if (!parsedA.right || !parsedB.right) return false;

  return (
    parsedA.right.prefix === parsedB.right.prefix &&
    parsedA.right.number === parsedB.right.number &&
    parsedA.right.suffix === parsedB.right.suffix
  );
}

/**
 * Expand a card number range (e.g., "001/100" to "005/100") into all numbers.
 */
export function expandCardNumberRange(
  startNumber: string,
  endNumber: string
): string[] {
  const parsedStart = parseCardNumber(startNumber);
  const parsedEnd = parseCardNumber(endNumber);

  const startNum = parsedStart.left.number;
  const endNum = parsedEnd.left.number;

  if (startNum === null || endNum === null || startNum > endNum) {
    return [];
  }

  const prefix = parsedStart.left.prefix ?? '';
  const suffix = parsedStart.left.suffix ?? '';
  const zeros = parsedStart.left.leadingZeros + String(startNum).length;
  const rightPart = parsedStart.right ? `/${parsedStart.right.raw}` : '';

  const result: string[] = [];
  for (let i = startNum; i <= endNum; i++) {
    const padded = String(i).padStart(zeros, '0');
    result.push(`${prefix}${padded}${suffix}${rightPart}`);
  }

  return result;
}
