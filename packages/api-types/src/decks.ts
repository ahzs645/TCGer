import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const createDeckSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  tcg: z.enum(['magic', 'yugioh', 'pokemon']),
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
  isCommander: z.boolean().optional(),
  isSideboard: z.boolean().optional()
}).refine(data => Object.values(data).some(v => v !== undefined), {
  message: 'At least one field must be provided'
});
export type UpdateDeckCardInput = z.infer<typeof updateDeckCardSchema>;

export const importDeckSchema = z.object({
  source: z.enum(['text', 'moxfield', 'archidekt', 'mtggoldfish', 'arena', 'ygoprodeck']),
  data: z.string().min(1),
  name: z.string().optional(),
  tcg: z.enum(['magic', 'yugioh', 'pokemon']).optional(),
  format: z.string().optional()
});
export type ImportDeckInput = z.infer<typeof importDeckSchema>;

export const validateDeckSchema = z.object({
  format: z.string().optional()
});

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface DeckCardResponse {
  id: string;
  externalId: string;
  tcg: string;
  name: string;
  quantity: number;
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
}

export interface DeckImportResult {
  deck: DeckResponse;
  importedCount: number;
  skippedCount: number;
  skippedCards: string[];
}
