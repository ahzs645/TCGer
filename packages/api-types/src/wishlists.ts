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
  colorHex: z.string().regex(hexColorRegex, 'Invalid color value').optional(),
  matchAnyPrinting: z.boolean().optional()
});
export type CreateWishlistInput = z.infer<typeof createWishlistSchema>;

export const updateWishlistSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  colorHex: z.string().regex(hexColorRegex, 'Invalid color value').optional(),
  matchAnyPrinting: z.boolean().optional()
});
export type UpdateWishlistInput = z.infer<typeof updateWishlistSchema>;

export const addWishlistCardSchema = z.object({
  externalId: z.string().trim().min(1, 'Card ID is required'),
  baseExternalId: z.string().trim().min(1).optional(),
  printingKey: z.string().trim().min(1).optional(),
  artworkId: z.string().trim().min(1).optional(),
  artist: z.string().trim().min(1).optional(),
  printingKind: z.string().trim().min(1).optional(),
  sanctionedPlayLegal: z.boolean().optional(),
  originalPrintingKey: z.string().trim().min(1).optional(),
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

/**
 * Cards per batch request. Rule expansion can produce hundreds of cards, so
 * clients chunk large adds instead of sending one giant transaction.
 */
export const WISHLIST_CARD_BATCH_SIZE = 100;
export const WISHLIST_CARD_BATCH_MAX = 500;

export const addWishlistCardsSchema = z.object({
  cards: z
    .array(addWishlistCardSchema)
    .min(1, 'At least one card is required')
    .max(WISHLIST_CARD_BATCH_MAX, `At most ${WISHLIST_CARD_BATCH_MAX} cards per request`)
});
export type AddWishlistCardsInput = z.infer<typeof addWishlistCardsSchema>;

// ---------------------------------------------------------------------------
// Wishlist rules ("smart wishlists")
// ---------------------------------------------------------------------------

/**
 * A rule describes the cards a wishlist wants in the abstract — "every Darkrai
 * in Pokemon", "all of Prismatic Evolutions" — so the list can be re-expanded
 * later and pick up printings that did not exist when it was created.
 */
export const wishlistRuleTypeSchema = z.enum(['name', 'set', 'artist', 'tag']);
export type WishlistRuleType = z.infer<typeof wishlistRuleTypeSchema>;

export const createWishlistRuleSchema = z
  .object({
    type: wishlistRuleTypeSchema,
    /** Omitted on a name rule means "search every game". Required for set rules. */
    tcg: tcgCodeSchema.optional(),
    /** Name or artist to match. Required for name and artist rules. */
    query: z.string().trim().min(1).optional(),
    /** Provider set code. Required for set rules. */
    setCode: z.string().trim().min(1).optional(),
    setName: z.string().trim().min(1).optional(),
    /** Match every printing rather than one entry per distinct card. */
    includeAllPrintings: z.boolean().default(true),
    /** Re-expand this rule whenever the wishlist is synced. */
    autoSync: z.boolean().default(true)
  })
  .superRefine((value, ctx) => {
    if ((value.type === 'name' || value.type === 'artist' || value.type === 'tag') && !value.query) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['query'],
        message: 'query is required for a name rule'
      });
    }
    if (value.type === 'set') {
      if (!value.setCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['setCode'],
          message: 'setCode is required for a set rule'
        });
      }
      if (!value.tcg) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tcg'],
          message: 'tcg is required for a set rule'
        });
      }
    }
  });
export type CreateWishlistRuleInput = z.infer<typeof createWishlistRuleSchema>;

/** Applied by clients after they finish expanding a rule. */
export const updateWishlistRuleSchema = z.object({
  autoSync: z.boolean().optional(),
  includeAllPrintings: z.boolean().optional(),
  /** ISO timestamp of the sync that just completed. */
  lastSyncedAt: z.string().optional(),
  /** How many cards the rule matched on that sync. */
  lastMatchCount: z.number().int().min(0).optional()
});
export type UpdateWishlistRuleInput = z.infer<typeof updateWishlistRuleSchema>;

export interface WishlistRuleResponse {
  id: string;
  type: WishlistRuleType;
  tcg?: TcgCode;
  query?: string;
  setCode?: string;
  setName?: string;
  includeAllPrintings: boolean;
  autoSync: boolean;
  lastSyncedAt?: string;
  lastMatchCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** Human-readable summary of a rule, shared by the web and iOS clients. */
export function describeWishlistRule(rule: {
  type: WishlistRuleType;
  tcg?: string;
  query?: string;
  setCode?: string;
  setName?: string;
  includeAllPrintings?: boolean;
}): string {
  if (rule.type === 'set') {
    const set = rule.setName ?? rule.setCode ?? 'set';
    return `Every card in ${set}`;
  }
  if (rule.type === 'artist') {
    return `Every card illustrated by ${rule.query ?? 'this artist'}`;
  }
  if (rule.type === 'tag') {
    return `Every card in ${rule.query ?? 'this collection'}`;
  }
  const scope = rule.includeAllPrintings === false ? 'card' : 'printing';
  return `Every ${scope} named "${rule.query ?? ''}"`;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface WishlistCardResponse {
  id: string;
  externalId: string;
  baseExternalId?: string;
  printingKey?: string;
  artworkId?: string;
  artist?: string;
  printingKind?: string;
  sanctionedPlayLegal?: boolean;
  originalPrintingKey?: string;
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
  /**
   * When true, a card counts as owned if any printing of it is in the
   * collection (matched via baseExternalId); otherwise the exact printing
   * must be owned.
   */
  matchAnyPrinting?: boolean;
  cards: WishlistCardResponse[];
  /** Saved expansion rules; empty for a purely manual wishlist. */
  rules: WishlistRuleResponse[];
  /** Number of unique cards in the wishlist */
  totalCards: number;
  /** Number of unique cards that are owned */
  ownedCards: number;
  /** Completion percentage (0-100) */
  completionPercent: number;
  createdAt: string;
  updatedAt: string;
}
