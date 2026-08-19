import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const createSealedInventorySchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
  purchasePrice: z.number().finite().nonnegative().optional(),
  purchaseDate: z.string().datetime().optional(),
  notes: z.string().optional()
});
export type CreateSealedInventoryInput = z.infer<typeof createSealedInventorySchema>;

export const updateSealedInventorySchema = z.object({
  quantity: z.number().int().positive().optional(),
  purchasePrice: z.number().finite().nonnegative().nullable().optional(),
  purchaseDate: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional()
}).refine(data => Object.values(data).some(v => v !== undefined), {
  message: 'At least one field must be provided'
});
export type UpdateSealedInventoryInput = z.infer<typeof updateSealedInventorySchema>;

export const createSealedOpeningSchema = z.object({
  openedQuantity: z.number().int().positive().default(1),
  collectionIds: z.array(z.string().uuid()).max(500).default([]),
  openedAt: z.string().datetime().optional(),
  notes: z.string().max(2_000).optional()
});
export type CreateSealedOpeningInput = z.infer<typeof createSealedOpeningSchema>;

export const recordOpenedCardSaleSchema = z.object({
  proceeds: z.number().finite().nonnegative(),
  soldAt: z.string().datetime().optional()
});
export type RecordOpenedCardSaleInput = z.infer<typeof recordOpenedCardSaleSchema>;

export const customSealedProductSchema = z.object({
  tcg: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  productType: z.string().trim().min(1).max(80),
  setCode: z.string().trim().min(1).max(80).optional(),
  cardsPerPack: z.number().int().positive().optional(),
  packsPerBox: z.number().int().positive().optional(),
  releaseDate: z.string().datetime().optional(),
  imageUrl: z.string().url().optional(),
  msrp: z.number().finite().nonnegative().optional(),
  upc: z.string().trim().min(1).max(80).optional(),
});
export type CustomSealedProductInput = z.infer<typeof customSealedProductSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface SealedProductResponse {
  id: string;
  tcg: string;
  name: string;
  productType: string;
  setCode?: string;
  cardsPerPack?: number;
  packsPerBox?: number;
  releaseDate?: string;
  imageUrl?: string;
  msrp?: number;
  upc?: string;
  isCustom: boolean;
}

export interface SealedInventoryResponse {
  id: string;
  product: SealedProductResponse;
  quantity: number;
  purchasePrice?: number;
  purchaseDate?: string;
  notes?: string;
  createdAt: string;
}

export interface PackOpeningResult {
  cards: Array<{
    externalId: string;
    tcg: string;
    name: string;
    rarity?: string;
    imageUrl?: string;
  }>;
  setCode: string;
  setName?: string;
}

export interface SealedLedgerCard {
  id: string;
  collectionId?: string;
  externalId: string;
  tcg: string;
  cardName: string;
  quantity: number;
  status: 'active' | 'sold';
  liveValue: number;
  realizedProceeds: number;
  soldAt?: string;
}

export interface SealedOpeningLedger {
  id: string;
  inventoryId: string;
  productName: string;
  openedQuantity: number;
  openedAt: string;
  invested: number;
  liveValue: number;
  realizedProceeds: number;
  profitLoss: number;
  activeCopies: number;
  soldCopies: number;
  cards: SealedLedgerCard[];
}
