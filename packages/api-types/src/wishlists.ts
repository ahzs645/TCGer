import { z } from 'zod';
import { tcgCodeSchema, type TcgCode } from './cards';
import {
  cardFunctionalIdentitySchema,
  cardLegalityPeriodSchema,
  cardProvenanceSchema,
  pokemonEvolutionSchema,
  pokemonPrintMetadataSchema
} from './cards';
import { pokemonFormatLegalitySchema, pokedexEntrySchema } from './pokemon';
import type {
  CardFunctionalIdentity,
  CardLegalityPeriod,
  CardProvenance,
  PokemonEvolution,
  PokemonPrintMetadata
} from './cards';
import type { PokedexEntry, PokemonFormatLegality } from './pokemon';

// ---------------------------------------------------------------------------
// Request validation schemas
// ---------------------------------------------------------------------------

const hexColorRegex = /^([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export const createWishlistSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  colorHex: z.string().regex(hexColorRegex, 'Invalid color value').optional()
});
export type CreateWishlistInput = z.infer<typeof createWishlistSchema>;

export const updateWishlistSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  colorHex: z.string().regex(hexColorRegex, 'Invalid color value').optional()
});
export type UpdateWishlistInput = z.infer<typeof updateWishlistSchema>;

export const addWishlistCardSchema = z.object({
  externalId: z.string().trim().min(1, 'Card ID is required'),
  baseExternalId: z.string().trim().min(1).optional(),
  printingKey: z.string().trim().min(1).optional(),
  artworkId: z.string().trim().min(1).optional(),
  tcg: tcgCodeSchema,
  name: z.string().min(1, 'Card name is required'),
  setCode: z.string().optional(),
  setName: z.string().optional(),
  rarity: z.string().optional(),
  imageUrl: z.string().optional(),
  imageUrlSmall: z.string().optional(),
  setSymbolUrl: z.string().optional(),
  setLogoUrl: z.string().optional(),
  collectorNumber: z.string().optional(),
  releasedAt: z.string().optional(),
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
  functionalIdentity: cardFunctionalIdentitySchema.optional(),
  notes: z.string().optional()
});
export type AddWishlistCardInput = z.infer<typeof addWishlistCardSchema>;

export const addWishlistCardsSchema = z.object({
  cards: z.array(addWishlistCardSchema).min(1, 'At least one card is required')
});
export type AddWishlistCardsInput = z.infer<typeof addWishlistCardsSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface WishlistCardResponse {
  id: string;
  externalId: string;
  baseExternalId?: string;
  printingKey?: string;
  artworkId?: string;
  tcg: TcgCode;
  name: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  setSymbolUrl?: string;
  setLogoUrl?: string;
  collectorNumber?: string;
  releasedAt?: string;
  regulationMark?: string;
  language?: string;
  supertype?: string;
  formatLegality?: PokemonFormatLegality;
  dexEntries?: PokedexEntry[];
  region?: string;
  pokemonPrint?: PokemonPrintMetadata;
  attributes?: Record<string, unknown>;
  provenance?: CardProvenance;
  legalityPeriods?: CardLegalityPeriod[];
  evolution?: PokemonEvolution;
  functionalIdentity?: CardFunctionalIdentity;
  notes?: string;
  /** Whether this card exists in any of the user's collection binders */
  owned: boolean;
  /** Total quantity owned across all binders */
  ownedQuantity: number;
  createdAt: string;
}

export interface WishlistResponse {
  id: string;
  name: string;
  description?: string;
  colorHex?: string;
  cards: WishlistCardResponse[];
  /** Number of unique cards in the wishlist */
  totalCards: number;
  /** Number of unique cards that are owned */
  ownedCards: number;
  /** Completion percentage (0-100) */
  completionPercent: number;
  createdAt: string;
  updatedAt: string;
}
