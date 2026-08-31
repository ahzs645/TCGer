import { z } from 'zod';
import { pokemonFormatLegalitySchema, pokedexEntrySchema } from './pokemon';

// ---------------------------------------------------------------------------
// Core enums & primitives
// ---------------------------------------------------------------------------

export const TCG_CODES = [
  'yugioh',
  'magic',
  'pokemon',
  'onepiece',
  'lorcana',
  'dragonball'
] as const;
export const tcgCodeSchema = z.enum(TCG_CODES);
export type TcgCode = z.infer<typeof tcgCodeSchema>;

/**
 * Stable game identifier used by generic catalog, collection, and package
 * surfaces. Built-in provider APIs still use `TcgCode`; installed game
 * packages use this open, validated identifier instead of requiring a client
 * release for every new game.
 */
export const gameIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export type GameId = z.infer<typeof gameIdSchema>;

/**
 * Finish codes are deliberately open-ended. Providers already expose more
 * finishes than the legacy normal/reverse/holo set, and new
 * finishes should not require an API contract release.
 */
export const pokemonFinishTypeSchema = z.string().min(1);
export type PokemonFinishType = z.infer<typeof pokemonFinishTypeSchema>;

/**
 * Physical printing classification, shared across games. This is intentionally
 * open-ended: games use different names for replica, memorabilia, oversized,
 * demo, and other non-standard printings.
 */
export const printingKindSchema = z.string().min(1);
export type PrintingKind = z.infer<typeof printingKindSchema>;

// ---------------------------------------------------------------------------
// Pokemon-specific schemas
// ---------------------------------------------------------------------------

export const pokemonVariantFlagsSchema = z.object({
  normal: z.boolean().optional(),
  reverse: z.boolean().optional(),
  holo: z.boolean().optional(),
  firstEdition: z.boolean().optional()
});
export type PokemonVariantFlags = z.infer<typeof pokemonVariantFlagsSchema>;

export const pokemonWorldChampionshipPrintSchema = z.object({
  year: z.number().int().min(2004),
  playerName: z.string().min(1),
  deckName: z.string().optional(),
  originalCollectorNumber: z.string().optional(),
  printedSignature: z.boolean().optional(),
  cardBack: z.string().optional(),
  borderStyle: z.string().optional(),
  stamp: z.string().optional(),
  sourceProductId: z.string().optional(),
  sourceUrl: z.string().optional()
});
export type PokemonWorldChampionshipPrint = z.infer<
  typeof pokemonWorldChampionshipPrintSchema
>;

export const pokemonPrintMetadataSchema = z.object({
  tcgdexId: z.string().optional(),
  tcgdexImage: z.string().optional(),
  variants: pokemonVariantFlagsSchema.optional(),
  finishes: z.array(pokemonFinishTypeSchema).optional(),
  category: z.string().optional(),
  regulationMark: z.string().optional(),
  language: z.string().optional(),
  formatLegality: pokemonFormatLegalitySchema.optional(),
  dexEntries: z.array(pokedexEntrySchema).optional(),
  region: z.string().optional(),
  worldChampionship: pokemonWorldChampionshipPrintSchema.optional()
});
export type PokemonPrintMetadata = z.infer<typeof pokemonPrintMetadataSchema>;

export const cardProvenanceSchema = z.object({
  source: z.string().min(1),
  sourceId: z.string().optional(),
  fetchedAt: z.string().optional(),
  schemaVersion: z.string().optional()
});
export type CardProvenance = z.infer<typeof cardProvenanceSchema>;

export const cardLegalityPeriodSchema = z.object({
  format: z.string().min(1),
  rotation: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  legal: z.boolean()
});
export type CardLegalityPeriod = z.infer<typeof cardLegalityPeriodSchema>;

export const pokemonEvolutionSchema = z.object({
  evolvesFrom: z.string().optional(),
  evolvesTo: z.array(z.string()).optional()
});
export type PokemonEvolution = z.infer<typeof pokemonEvolutionSchema>;

export const cardFunctionalIdentitySchema = z.object({
  key: z.string().min(1),
  normalizedRules: z.string().nullish()
});
export type CardFunctionalIdentity = z.infer<typeof cardFunctionalIdentitySchema>;

export const pokemonFunctionalAttackSchema = z.object({
  name: z.string(),
  printedName: z.string().optional(),
  searchAliases: z.array(z.string()).optional(),
  cost: z.array(z.string()).optional(),
  text: z.string().nullish(),
  damage: z.string().nullish(),
  convertedEnergyCost: z.number().optional()
});
export type PokemonFunctionalAttack = z.infer<typeof pokemonFunctionalAttackSchema>;

export const pokemonFunctionalAbilitySchema = z.object({
  name: z.string(),
  text: z.string().nullish(),
  type: z.string().optional()
});
export type PokemonFunctionalAbility = z.infer<typeof pokemonFunctionalAbilitySchema>;

export const pokemonFunctionalGroupSchema = z.object({
  functionalKey: z.string(),
  name: z.string(),
  supertype: z.string().optional(),
  subtypes: z.array(z.string()).optional(),
  hp: z.string().optional(),
  regulationMark: z.string().optional(),
  category: z.string().optional(),
  normalizedRules: z.string().nullish(),
  attacks: z.array(pokemonFunctionalAttackSchema).optional(),
  abilities: z.array(pokemonFunctionalAbilitySchema).optional(),
  rules: z.array(z.string()).nullish()
});
export type PokemonFunctionalGroup = z.infer<typeof pokemonFunctionalGroupSchema>;

// ---------------------------------------------------------------------------
// Card schemas
// ---------------------------------------------------------------------------

export const cardSchema = z.object({
  id: z.string(),
  tcg: tcgCodeSchema,
  /** Provider-level identifier shared by every printing of this card. */
  baseExternalId: z.string().optional(),
  /** Stable, game-qualified identifier for one exact printing/variant. */
  printingKey: z.string().optional(),
  /** Provider artwork/image identifier when a printing has alternate art. */
  artworkId: z.string().optional(),
  /** Illustrator/artist credit as printed by the card provider. */
  artist: z.string().optional(),
  /** Cross-game physical classification such as replica or oversized. */
  printingKind: printingKindSchema.optional(),
  /** Whether this physical printing may be used in sanctioned play. */
  sanctionedPlayLegal: z.boolean().optional(),
  /** Known exact printing that this special printing reproduces. */
  originalPrintingKey: z.string().optional(),
  name: z.string(),
  setCode: z.string().optional(),
  setName: z.string().optional(),
  rarity: z.string().optional(),
  collectorNumber: z.string().optional(),
  releasedAt: z.string().optional(),
  imageUrl: z.string().optional(),
  imageUrlSmall: z.string().optional(),
  setSymbolUrl: z.string().optional(),
  setLogoUrl: z.string().optional(),
  regulationMark: z.string().optional(),
  language: z.string().optional(),
  supertype: z.string().optional(),
  formatLegality: pokemonFormatLegalitySchema.optional(),
  dexEntries: z.array(pokedexEntrySchema).optional(),
  region: z.string().optional(),
  pokemonPrint: pokemonPrintMetadataSchema.optional(),
  attributes: z.record(z.unknown()).optional(),
  provenance: cardProvenanceSchema.optional(),
  legalityPeriods: z.array(cardLegalityPeriodSchema).optional(),
  evolution: pokemonEvolutionSchema.optional(),
  functionalIdentity: cardFunctionalIdentitySchema.optional()
});
export type Card = z.infer<typeof cardSchema>;

// ---------------------------------------------------------------------------
// Card search / prints response schemas
// ---------------------------------------------------------------------------

export const searchCardsResponseSchema = z.object({
  cards: z.array(cardSchema),
  total: z.number()
});
export type SearchCardsResponse = z.infer<typeof searchCardsResponseSchema>;

export const discoverCardsQuerySchema = z.object({
  tcg: z.union([tcgCodeSchema, z.literal('all')]).optional().default('all'),
  count: z.coerce.number().int().min(1).max(24).optional().default(1)
});
export type DiscoverCardsQuery = z.infer<typeof discoverCardsQuerySchema>;

export const discoverCardsResponseSchema = z.object({
  cards: z.array(cardSchema),
  total: z.number(),
  sampledFrom: z.object({
    tcg: tcgCodeSchema,
    setCode: z.string(),
    setName: z.string().optional()
  }).optional()
});
export type DiscoverCardsResponse = z.infer<typeof discoverCardsResponseSchema>;

export const simpleCardPrintsResultSchema = z.object({
  mode: z.literal('simple'),
  prints: z.array(cardSchema),
  total: z.number()
});

export const pokemonFunctionalCardPrintsResultSchema = z.object({
  mode: z.literal('pokemon-functional'),
  prints: z.array(cardSchema),
  total: z.number(),
  functionalGroup: pokemonFunctionalGroupSchema
});

export const cardPrintsResponseSchema = z.discriminatedUnion('mode', [
  simpleCardPrintsResultSchema,
  pokemonFunctionalCardPrintsResultSchema
]);
export type CardPrintsResponse = z.infer<typeof cardPrintsResponseSchema>;

// ---------------------------------------------------------------------------
// Request validation schemas (used by backend routes)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Set schemas
// ---------------------------------------------------------------------------

export const tcgSetSchema = z.object({
  code: z.string(),
  name: z.string(),
  tcg: tcgCodeSchema,
  releaseDate: z.string().optional(),
  totalCards: z.number().optional(),
  standardCards: z.number().optional(),
  /** Cross-game set classification such as expansion or memorabilia. */
  setType: z.string().optional(),
  /** Useful for annual products that do not have a reliable release date. */
  releaseYear: z.number().int().optional(),
  iconUrl: z.string().optional(),
  iconFallbackUrl: z.string().optional(),
  logoUrl: z.string().optional()
});
export type TcgSet = z.infer<typeof tcgSetSchema>;

// ---------------------------------------------------------------------------
// Request validation schemas (used by backend routes)
// ---------------------------------------------------------------------------

export const searchQuerySchema = z.object({
  query: z.string().min(1, 'query parameter is required'),
  tcg: z.string().optional()
});
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;

export const cardParamsSchema = z.object({
  tcg: z.string(),
  cardId: z.string()
});
export type CardParamsInput = z.infer<typeof cardParamsSchema>;

/** Upper bound on results from an exhaustive name search, per game. */
export const EXHAUSTIVE_SEARCH_MAX_LIMIT = 1000;
export const EXHAUSTIVE_SEARCH_DEFAULT_LIMIT = 500;

/**
 * Exhaustive name search ("every Darkrai"). Unlike {@link searchQuerySchema}
 * this pages through the provider instead of returning a preview page.
 */
export const exhaustiveSearchQuerySchema = z.object({
  query: z.string().min(1, 'query parameter is required'),
  tcg: z.string().optional(),
  /**
   * `prints` returns every printing of every matching card; `cards` collapses
   * them to one entry per distinct card.
   */
  unique: z.enum(['prints', 'cards']).default('prints'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(EXHAUSTIVE_SEARCH_MAX_LIMIT)
    .default(EXHAUSTIVE_SEARCH_DEFAULT_LIMIT)
});
export type ExhaustiveSearchQueryInput = z.infer<typeof exhaustiveSearchQuerySchema>;

/** Exhaustive artist lookup used by art-first collection guides. */
export const artistSearchQuerySchema = z.object({
  artist: z.string().trim().min(1, 'artist parameter is required'),
  tcg: tcgCodeSchema.default('pokemon'),
  unique: z.enum(['prints', 'cards']).default('prints'),
  limit: z.coerce.number().int().min(1).max(1000).default(500)
});
export type ArtistSearchQueryInput = z.infer<typeof artistSearchQuerySchema>;

/** Exact canonical collection-tag lookup used by system collection guides. */
export const collectionTagSearchQuerySchema = z.object({
  tag: z.string().trim().min(1, 'tag parameter is required'),
  tcg: tcgCodeSchema,
  limit: z.coerce.number().int().min(1).max(5000).default(2000)
});
export type CollectionTagSearchQueryInput = z.infer<typeof collectionTagSearchQuerySchema>;
