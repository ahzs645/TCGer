import { z } from 'zod';

// ---------------------------------------------------------------------------
// Core enums & primitives
// ---------------------------------------------------------------------------

export const tcgCodeSchema = z.enum(['yugioh', 'magic', 'pokemon']);
export type TcgCode = z.infer<typeof tcgCodeSchema>;

export const pokemonFinishTypeSchema = z.enum(['normal', 'reverse', 'holo', 'firstEdition']);
export type PokemonFinishType = z.infer<typeof pokemonFinishTypeSchema>;

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

export const pokemonPrintMetadataSchema = z.object({
  tcgdexId: z.string().optional(),
  tcgdexImage: z.string().optional(),
  variants: pokemonVariantFlagsSchema.optional(),
  finishes: z.array(pokemonFinishTypeSchema).optional(),
  category: z.string().optional(),
  regulationMark: z.string().optional(),
  language: z.string().optional()
});
export type PokemonPrintMetadata = z.infer<typeof pokemonPrintMetadataSchema>;

export const pokemonFunctionalAttackSchema = z.object({
  name: z.string(),
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
  pokemonPrint: pokemonPrintMetadataSchema.optional(),
  attributes: z.record(z.unknown()).optional()
});
export type Card = z.infer<typeof cardSchema>;

// ---------------------------------------------------------------------------
// Card search / prints response schemas
// ---------------------------------------------------------------------------

export const searchCardsResponseSchema = z.object({
  cards: z.array(cardSchema)
});
export type SearchCardsResponse = z.infer<typeof searchCardsResponseSchema>;

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
