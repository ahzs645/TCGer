import { z } from 'zod';
import type { TcgCode } from './cards';

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

const hexColorRegex = /^([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export const tagPayloadSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  colorHex: z.string().regex(hexColorRegex, 'Invalid color value').optional()
});
export type TagPayload = z.infer<typeof tagPayloadSchema>;

export const cardDataPayloadSchema = z.object({
  name: z.string(),
  tcg: z.string(),
  externalId: z.string(),
  setCode: z.string().optional(),
  setName: z.string().optional(),
  rarity: z.string().optional(),
  imageUrl: z.string().optional(),
  imageUrlSmall: z.string().optional()
});
export type CardDataPayload = z.infer<typeof cardDataPayloadSchema>;

// ---------------------------------------------------------------------------
// Binder request schemas
// ---------------------------------------------------------------------------

export const createBinderSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  colorHex: z.string().regex(hexColorRegex, 'Invalid color value').optional()
});
export type CreateBinderInput = z.infer<typeof createBinderSchema>;

export const updateBinderSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  colorHex: z.string().regex(hexColorRegex, 'Invalid color value').optional()
});
export type UpdateBinderInput = z.infer<typeof updateBinderSchema>;

// ---------------------------------------------------------------------------
// Card-in-collection request schemas
// ---------------------------------------------------------------------------

export const addCardSchema = z.object({
  cardId: z.string().min(1, 'Card ID is required'),
  quantity: z.number().int().positive().default(1),
  condition: z.string().optional(),
  language: z.string().optional(),
  notes: z.string().optional(),
  price: z.number().optional(),
  acquisitionPrice: z.number().optional(),
  serialNumber: z.string().optional(),
  acquiredAt: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
  newTags: z.array(tagPayloadSchema).optional(),
  cardData: cardDataPayloadSchema.optional()
});
export type AddCardInput = z.infer<typeof addCardSchema>;

export const addLibraryCardSchema = addCardSchema.extend({
  binderId: z.string().optional()
});
export type AddLibraryCardInput = z.infer<typeof addLibraryCardSchema>;

export const cardOverrideSchema = z.object({
  cardId: z.string().min(1, 'Card ID is required'),
  cardData: cardDataPayloadSchema.optional()
});

export const updateCardSchema = z
  .object({
    condition: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    serialNumber: z.string().nullable().optional(),
    acquiredAt: z.string().datetime().nullable().optional(),
    quantity: z.number().int().min(1).optional(),
    tags: z.array(z.string()).optional(),
    newTags: z.array(tagPayloadSchema).optional(),
    targetBinderId: z.string().min(1).optional(),
    cardOverride: cardOverrideSchema.optional()
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'At least one field must be provided' }
  );
export type UpdateCardInput = z.infer<typeof updateCardSchema>;

// ---------------------------------------------------------------------------
// Tag request schemas
// ---------------------------------------------------------------------------

export const createTagSchema = tagPayloadSchema;
export type CreateTagInput = z.infer<typeof createTagSchema>;

// ---------------------------------------------------------------------------
// Response types (plain interfaces — no runtime validation needed on client)
// ---------------------------------------------------------------------------

export interface CollectionTag {
  id: string;
  label: string;
  colorHex: string;
}

export interface CollectionCardCopy {
  id: string;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
  serialNumber?: string;
  acquiredAt?: string;
  tags: CollectionTag[];
}

export interface CollectionCard {
  id: string;
  cardId: string;
  externalId?: string;
  name: string;
  tcg: TcgCode;
  setCode?: string;
  setName?: string;
  rarity?: string;
  collectorNumber?: string;
  releasedAt?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  setSymbolUrl?: string;
  setLogoUrl?: string;
  regulationMark?: string;
  languageCode?: string;
  attributes?: Record<string, unknown>;
  quantity: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
  serialNumber?: string;
  acquiredAt?: string;
  binderId?: string;
  binderName?: string;
  binderColorHex?: string;
  conditionSummary?: string;
  priceHistory?: Array<{
    price: number;
    recordedAt: string;
  } | number>;
  copies: CollectionCardCopy[];
}

export interface Binder {
  id: string;
  name: string;
  description?: string;
  colorHex?: string;
  cards: CollectionCard[];
  createdAt: string;
  updatedAt: string;
}

export interface CollectionTagResponse extends CollectionTag {
  createdAt: string;
  updatedAt: string;
}
