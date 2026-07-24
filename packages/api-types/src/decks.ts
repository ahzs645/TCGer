import { z } from 'zod';
import { tcgCodeSchema } from './cards';

export const yugiohDeckZoneSchema = z.enum(['main', 'extra', 'side']);
export type YugiohDeckZone = z.infer<typeof yugiohDeckZoneSchema>;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const createDeckSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  tcg: tcgCodeSchema,
  format: z.string().optional(),
  colorHex: z.string().optional(),
  isPublic: z.boolean().optional()
});
export type CreateDeckInput = z.infer<typeof createDeckSchema>;

export const updateDeckSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  format: z.string().optional(),
  colorHex: z.string().optional(),
  isPublic: z.boolean().optional()
}).refine(data => Object.values(data).some(v => v !== undefined), {
  message: 'At least one field must be provided'
});
export type UpdateDeckInput = z.infer<typeof updateDeckSchema>;

export const addDeckCardSchema = z.object({
  externalId: z.string().min(1),
  tcg: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  zone: yugiohDeckZoneSchema.optional(),
  isCommander: z.boolean().optional(),
  isSideboard: z.boolean().optional(),
  imageUrl: z.string().optional(),
  imageUrlSmall: z.string().optional(),
  setCode: z.string().optional(),
  setName: z.string().optional(),
  cardData: z.record(z.unknown()).optional()
});
export type AddDeckCardInput = z.infer<typeof addDeckCardSchema>;

export const updateDeckCardSchema = z.object({
  quantity: z.number().int().positive().optional(),
  zone: yugiohDeckZoneSchema.optional(),
  isCommander: z.boolean().optional(),
  isSideboard: z.boolean().optional()
}).refine(data => Object.values(data).some(v => v !== undefined), {
  message: 'At least one field must be provided'
});
export type UpdateDeckCardInput = z.infer<typeof updateDeckCardSchema>;

export const importDeckSchema = z.object({
  source: z.enum(['text', 'moxfield', 'archidekt', 'mtggoldfish', 'arena', 'ygoprodeck', 'ydk']),
  data: z.string().min(1),
  name: z.string().optional(),
  tcg: tcgCodeSchema.optional(),
  format: z.string().optional()
});
export type ImportDeckInput = z.infer<typeof importDeckSchema>;

export const validateDeckSchema = z.object({
  format: z.string().optional(),
  banlist: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('classical'),
      name: z.string().min(1),
      effectiveDate: z.string().optional(),
      cards: z.record(z.string())
    }),
    z.object({
      type: z.literal('genesys'),
      name: z.string().min(1),
      effectiveDate: z.string().optional(),
      maxPoints: z.number().nonnegative(),
      cards: z.record(z.number())
    })
  ]).optional()
});
export type ValidateDeckInput = z.infer<typeof validateDeckSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface DeckCardResponse {
  id: string;
  externalId: string;
  tcg: string;
  name: string;
  quantity: number;
  zone: YugiohDeckZone;
  isCommander: boolean;
  isSideboard: boolean;
  imageUrl?: string;
  imageUrlSmall?: string;
  setCode?: string;
  setName?: string;
  cardData?: Record<string, unknown>;
}

export interface DeckResponse {
  id: string;
  name: string;
  description?: string;
  tcg: string;
  format?: string;
  colorHex?: string;
  isPublic: boolean;
  cards: DeckCardResponse[];
  cardCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeckAnalysis {
  totalCards: number;
  mainDeckCount: number;
  extraDeckCount: number;
  sideboardCount: number;
  manaCurve: Record<number, number>;
  colorDistribution: Record<string, number>;
  typeDistribution: Record<string, number>;
  rarityDistribution: Record<string, number>;
  averageCmc: number;
}

export interface DeckValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  format?: string;
  points?: number;
  violations?: Array<{
    externalId?: string;
    name?: string;
    zone?: YugiohDeckZone;
    message: string;
  }>;
}

export interface DeckOwnershipResult {
  owned: Array<{ externalId: string; quantity: number }>;
  missing: Array<{
    externalId: string;
    name: string;
    quantity: number;
    zone: YugiohDeckZone;
  }>;
  missingCount: number;
}

export interface YdkExportResult {
  content: string;
  skipped: Array<{ externalId: string; name: string; reason: string }>;
}

export interface DeckImportResult {
  deck: DeckResponse;
  importedCount: number;
  skippedCount: number;
  skippedCards: string[];
}
