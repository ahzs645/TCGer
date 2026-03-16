import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const createSealedInventorySchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
  purchasePrice: z.number().optional(),
  purchaseDate: z.string().datetime().optional(),
  notes: z.string().optional()
});
export type CreateSealedInventoryInput = z.infer<typeof createSealedInventorySchema>;

export const updateSealedInventorySchema = z.object({
  quantity: z.number().int().positive().optional(),
  purchasePrice: z.number().optional(),
  purchaseDate: z.string().datetime().optional(),
  notes: z.string().optional()
}).refine(data => Object.values(data).some(v => v !== undefined), {
  message: 'At least one field must be provided'
});
export type UpdateSealedInventoryInput = z.infer<typeof updateSealedInventorySchema>;

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
