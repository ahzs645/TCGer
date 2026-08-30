import { z } from 'zod';

import { tcgCodeSchema } from './cards';

export const catalogCorrectionTargetTypeSchema = z.enum(['identity', 'printing']);
export const catalogCorrectionActionSchema = z.enum(['upsert', 'remove']);

export const catalogCorrectionPatchSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  printedName: z.string().trim().min(1).max(300).nullable().optional(),
  searchAliases: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  setCode: z.string().trim().min(1).max(100).nullable().optional(),
  setName: z.string().trim().min(1).max(300).nullable().optional(),
  rarity: z.string().trim().min(1).max(120).nullable().optional(),
  collectorNumber: z.string().trim().min(1).max(100).nullable().optional(),
  releasedAt: z.string().trim().min(1).max(40).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  imageUrlSmall: z.string().url().nullable().optional(),
  language: z.string().trim().min(1).max(40).nullable().optional(),
  artist: z.string().trim().min(1).max(300).nullable().optional(),
  attributes: z.record(z.unknown()).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, {
  message: 'At least one corrected field is required',
});

export const createCatalogCorrectionSchema = z.object({
  tcg: tcgCodeSchema,
  targetType: catalogCorrectionTargetTypeSchema,
  targetKey: z.string().trim().min(1).max(300),
  patch: catalogCorrectionPatchSchema,
  reason: z.string().trim().min(3).max(1000),
});

export type CatalogCorrectionTargetType = z.infer<typeof catalogCorrectionTargetTypeSchema>;
export type CatalogCorrectionAction = z.infer<typeof catalogCorrectionActionSchema>;
export type CatalogCorrectionPatch = z.infer<typeof catalogCorrectionPatchSchema>;
export type CreateCatalogCorrectionInput = z.infer<typeof createCatalogCorrectionSchema>;

export interface CatalogCorrection {
  id: string;
  tcg: z.infer<typeof tcgCodeSchema>;
  targetType: CatalogCorrectionTargetType;
  targetKey: string;
  revision: number;
  action: CatalogCorrectionAction;
  patch?: CatalogCorrectionPatch;
  reason: string;
  createdBy: string;
  createdByLabel?: string;
  createdAt: string;
}

export interface CatalogCorrectionTarget {
  tcg: z.infer<typeof tcgCodeSchema>;
  externalId?: string;
  baseExternalId?: string;
  printingKey?: string;
  attributes?: Record<string, unknown>;
}

function applyPatch<T extends CatalogCorrectionTarget>(
  card: T,
  patch: CatalogCorrectionPatch,
): T {
  const next = { ...card } as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'attributes') continue;
    next[key] = value === null ? undefined : value;
  }
  if (patch.attributes) {
    const attributes = { ...(card.attributes ?? {}) };
    for (const [key, value] of Object.entries(patch.attributes)) {
      if (value === null) delete attributes[key];
      else attributes[key] = value;
    }
    next.attributes = attributes;
  }
  return next as T;
}

/** Applies identity-level corrections first and exact-printing corrections last. */
export function applyCatalogCorrections<T extends CatalogCorrectionTarget>(
  card: T,
  corrections: readonly CatalogCorrection[],
): T {
  const identityKey = card.baseExternalId ?? card.externalId;
  const printingKey = card.printingKey ?? card.externalId;
  let corrected = card;
  for (const correction of corrections) {
    if (correction.tcg !== card.tcg || correction.action !== 'upsert' || !correction.patch) continue;
    if (correction.targetType === 'identity' && identityKey === correction.targetKey) {
      corrected = applyPatch(corrected, correction.patch);
    }
  }
  for (const correction of corrections) {
    if (correction.tcg !== card.tcg || correction.action !== 'upsert' || !correction.patch) continue;
    if (correction.targetType === 'printing' && printingKey === correction.targetKey) {
      corrected = applyPatch(corrected, correction.patch);
    }
  }
  return corrected;
}
