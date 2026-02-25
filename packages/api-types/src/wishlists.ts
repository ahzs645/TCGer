import { z } from 'zod';
import type { TcgCode } from './cards';

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
  externalId: z.string().min(1, 'Card ID is required'),
  tcg: z.string().min(1, 'TCG is required'),
  name: z.string().min(1, 'Card name is required'),
  setCode: z.string().optional(),
  setName: z.string().optional(),
  rarity: z.string().optional(),
  imageUrl: z.string().optional(),
  imageUrlSmall: z.string().optional(),
  setSymbolUrl: z.string().optional(),
  setLogoUrl: z.string().optional(),
  collectorNumber: z.string().optional(),
  notes: z.string().optional()
});
export type AddWishlistCardInput = z.infer<typeof addWishlistCardSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface WishlistCardResponse {
  id: string;
  externalId: string;
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
