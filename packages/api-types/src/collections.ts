import { z } from "zod";
import { tcgCodeSchema, type TcgCode } from "./cards";
import {
  cardFunctionalIdentitySchema,
  cardLegalityPeriodSchema,
  cardProvenanceSchema,
  pokemonEvolutionSchema,
  pokemonPrintMetadataSchema,
} from "./cards";
import { pokemonFormatLegalitySchema, pokedexEntrySchema } from "./pokemon";
import type {
  CardFunctionalIdentity,
  CardLegalityPeriod,
  CardProvenance,
  PokemonEvolution,
  PokemonPrintMetadata,
} from "./cards";
import type { PokedexEntry, PokemonFormatLegality } from "./pokemon";

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

const hexColorRegex = /^([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

// Every condition spelling the API accepts, uppercased: canonical grading
// terms plus the abbreviations and legacy spellings existing clients and
// CSV imports write. Matching is case-insensitive on the trimmed value.
export const KNOWN_CONDITION_VALUES = [
  "GEM MINT",
  "GM",
  "MINT",
  "M",
  "NEAR MINT",
  "NM",
  "EXCELLENT",
  "EX",
  "VERY GOOD",
  "VG",
  "GOOD",
  "GD",
  "G",
  "LIGHTLY PLAYED",
  "LIGHT PLAYED",
  "LP",
  "MODERATE PLAY",
  "MODERATELY PLAYED",
  "MP",
  "PLAYED",
  "PL",
  "HEAVY PLAY",
  "HEAVILY PLAYED",
  "HP",
  "POOR",
  "PO",
  "PR",
  "DAMAGED",
  "DMG",
] as const;

const knownConditionSet = new Set<string>(KNOWN_CONDITION_VALUES);

export function isKnownCondition(value: string): boolean {
  return knownConditionSet.has(value.trim().toUpperCase());
}

export const conditionValueSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isKnownCondition, {
    message: "Unknown card condition",
  });
// Update payloads may clear a condition with null or an empty string.
export const clearableConditionValueSchema = z.union([
  conditionValueSchema,
  z.literal(""),
  z.null(),
]);

export const tagPayloadSchema = z.object({
  label: z.string().min(1, "Label is required"),
  colorHex: z.string().regex(hexColorRegex, "Invalid color value").optional(),
});
export type TagPayload = z.infer<typeof tagPayloadSchema>;

export const cardDataPayloadSchema = z.object({
  name: z.string(),
  tcg: tcgCodeSchema,
  externalId: z.string().trim().min(1),
  baseExternalId: z.string().trim().min(1).optional(),
  printingKey: z.string().trim().min(1).optional(),
  artworkId: z.string().trim().min(1).optional(),
  printingKind: z.string().trim().min(1).optional(),
  sanctionedPlayLegal: z.boolean().optional(),
  originalPrintingKey: z.string().trim().min(1).optional(),
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
});
export type CardDataPayload = z.infer<typeof cardDataPayloadSchema>;

// ---------------------------------------------------------------------------
// Binder request schemas
// ---------------------------------------------------------------------------

const binderPresentationSchema = z.object({
  containerType: z.string().trim().min(1).max(40).optional(),
  imageUrl: z.string().url().optional(),
  associatedTcg: tcgCodeSchema.optional(),
  associatedSetCode: z.string().trim().min(1).max(80).optional(),
  associatedSetName: z.string().trim().min(1).max(200).optional(),
});

export const createBinderSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    colorHex: z.string().regex(hexColorRegex, "Invalid color value").optional(),
    defaultCondition: conditionValueSchema.optional(),
  })
  .merge(binderPresentationSchema);
export type CreateBinderInput = z.infer<typeof createBinderSchema>;

export const updateBinderSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  colorHex: z.string().regex(hexColorRegex, "Invalid color value").optional(),
  defaultCondition: clearableConditionValueSchema.optional(),
  containerType: z.string().trim().min(1).max(40).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  associatedTcg: tcgCodeSchema.nullable().optional(),
  associatedSetCode: z.string().trim().min(1).max(80).nullable().optional(),
  associatedSetName: z.string().trim().min(1).max(200).nullable().optional(),
});
export type UpdateBinderInput = z.infer<typeof updateBinderSchema>;

// ---------------------------------------------------------------------------
// Persistent binder pages
// ---------------------------------------------------------------------------

const normalizedCoordinateSchema = z.number().finite().min(0).max(1);

export const binderPagePointSchema = z.object({
  x: normalizedCoordinateSchema,
  y: normalizedCoordinateSchema,
});
export type BinderPagePoint = z.infer<typeof binderPagePointSchema>;

export const binderPageQuadSchema = z.object({
  topLeft: binderPagePointSchema,
  topRight: binderPagePointSchema,
  bottomRight: binderPagePointSchema,
  bottomLeft: binderPagePointSchema,
});
export type BinderPageQuad = z.infer<typeof binderPageQuadSchema>;

export const binderPagePlacementSchema = z.object({
  slotIndex: z.number().int().min(0).max(99),
  cardId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  tcg: tcgCodeSchema,
  setCode: z.string().trim().min(1).optional(),
  confidence: z.number().finite().min(0).max(1),
  status: z.enum(["matched", "uncertain"]),
  quad: binderPageQuadSchema,
});
export type BinderPagePlacement = z.infer<typeof binderPagePlacementSchema>;

export const upsertBinderPageSchema = z.object({
  pageNumber: z.number().int().min(1).max(10000),
  capturedAt: z.string().datetime().optional(),
  placements: z.array(binderPagePlacementSchema).max(100),
});
export type UpsertBinderPageInput = z.infer<typeof upsertBinderPageSchema>;

export interface BinderPage {
  id: string;
  binderId: string;
  pageNumber: number;
  revision: number;
  capturedAt: string;
  imageUrl?: string;
  placements: BinderPagePlacement[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Card-in-collection request schemas
// ---------------------------------------------------------------------------

export const addCardSchema = z.object({
  cardId: z.string().min(1, "Card ID is required"),
  quantity: z.number().int().positive().default(1),
  condition: conditionValueSchema.optional(),
  language: z.string().optional(),
  notes: z.string().optional(),
  price: z.number().optional(),
  acquisitionPrice: z.number().optional(),
  serialNumber: z.string().optional(),
  acquiredAt: z.string().datetime().optional(),
  isFoil: z.boolean().optional(),
  finishCode: z.string().min(1).optional(),
  finishLabel: z.string().min(1).optional(),
  edition: z.string().min(1).optional(),
  stamp: z.string().min(1).optional(),
  isSealedPromo: z.boolean().optional(),
  isOversized: z.boolean().optional(),
  isPeelOff: z.boolean().optional(),
  isSigned: z.boolean().optional(),
  isAltered: z.boolean().optional(),
  gradingCompany: z.string().trim().min(1).optional(),
  gradingScore: z.string().trim().min(1).optional(),
  certNumber: z.string().trim().min(1).optional(),
  storageLocation: z.string().trim().min(1).optional(),
  tags: z.array(z.string()).optional(),
  newTags: z.array(tagPayloadSchema).optional(),
  cardData: cardDataPayloadSchema.optional(),
});
export type AddCardInput = z.infer<typeof addCardSchema>;

export const addLibraryCardSchema = addCardSchema.extend({
  binderId: z.string().optional(),
});
export type AddLibraryCardInput = z.infer<typeof addLibraryCardSchema>;

export const cardOverrideSchema = z.object({
  cardId: z.string().min(1, "Card ID is required"),
  cardData: cardDataPayloadSchema.optional(),
});

export const updateCardSchema = z
  .object({
    condition: clearableConditionValueSchema.optional(),
    language: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    serialNumber: z.string().nullable().optional(),
    acquiredAt: z.string().datetime().nullable().optional(),
    isFoil: z.boolean().optional(),
    finishCode: z.string().min(1).nullable().optional(),
    finishLabel: z.string().min(1).nullable().optional(),
    edition: z.string().min(1).nullable().optional(),
    stamp: z.string().min(1).nullable().optional(),
    isSealedPromo: z.boolean().optional(),
    isOversized: z.boolean().optional(),
    isPeelOff: z.boolean().optional(),
    isSigned: z.boolean().optional(),
    isAltered: z.boolean().optional(),
    gradingCompany: z.string().trim().min(1).nullable().optional(),
    gradingScore: z.string().trim().min(1).nullable().optional(),
    certNumber: z.string().trim().min(1).nullable().optional(),
    storageLocation: z.string().trim().min(1).nullable().optional(),
    quantity: z.number().int().min(1).optional(),
    tags: z.array(z.string()).optional(),
    newTags: z.array(tagPayloadSchema).optional(),
    targetBinderId: z.string().min(1).optional(),
    /**
     * What `targetBinderId` moves: the addressed copy, or the whole grouped
     * card. Defaults to `copy`, which is what the endpoint has always done.
     *
     * It has to be explicit because the grouped response reports a card's id as
     * its first copy's id, so "move this card" and "move this copy" are
     * otherwise the same request on the wire — the collection table means the
     * card, the sandbox means the copy, and the server could not tell them
     * apart.
     */
    scope: z.enum(["card", "copy"]).optional(),
    cardOverride: cardOverrideSchema.optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });
export type UpdateCardInput = z.infer<typeof updateCardSchema>;

// ---------------------------------------------------------------------------
// Immutable collection mutation history
// ---------------------------------------------------------------------------

export const collectionMutationKindSchema = z.enum([
  "add",
  "update",
  "remove",
  "move",
  "bulk",
  "import",
  "undo",
]);
export type CollectionMutationKind = z.infer<
  typeof collectionMutationKindSchema
>;

export const collectionMutationHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CollectionMutationHistoryQuery = z.infer<
  typeof collectionMutationHistoryQuerySchema
>;

export const undoCollectionMutationSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
});
export type UndoCollectionMutationInput = z.infer<
  typeof undoCollectionMutationSchema
>;

export interface CollectionMutationAuditEntry {
  id: string;
  operationKind: CollectionMutationKind;
  actorId: string;
  affectedCopies: number;
  binderId?: string;
  cardName?: string;
  summary: string;
  sourceAuditId?: string;
  canUndo: boolean;
  createdAt: string;
}

export interface CollectionMutationHistoryResponse {
  entries: CollectionMutationAuditEntry[];
}

export interface UndoCollectionMutationResult {
  audit: CollectionMutationAuditEntry;
}

// ---------------------------------------------------------------------------
// Transactional bulk add
// ---------------------------------------------------------------------------

export const bulkAddCopyFieldsSchema = z.object({
  condition: conditionValueSchema.optional(),
  language: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
  price: z.number().finite().nonnegative().optional(),
  acquisitionPrice: z.number().finite().nonnegative().optional(),
  serialNumber: z.string().trim().min(1).optional(),
  acquiredAt: z.string().datetime().optional(),
  isFoil: z.boolean().optional(),
  finishCode: z.string().trim().min(1).optional(),
  finishLabel: z.string().trim().min(1).optional(),
  edition: z.string().trim().min(1).optional(),
  stamp: z.string().trim().min(1).optional(),
  isSealedPromo: z.boolean().optional(),
  isOversized: z.boolean().optional(),
  isPeelOff: z.boolean().optional(),
  isSigned: z.boolean().optional(),
  isAltered: z.boolean().optional(),
  gradingCompany: z.string().trim().min(1).optional(),
  gradingScore: z.string().trim().min(1).optional(),
  certNumber: z.string().trim().min(1).optional(),
  storageLocation: z.string().trim().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  newTags: z.array(tagPayloadSchema).optional(),
});
export type BulkAddCopyFields = z.infer<typeof bulkAddCopyFieldsSchema>;

export const bulkAddDefaultsSchema = bulkAddCopyFieldsSchema.extend({
  binderId: z.string().min(1).optional(),
  quantity: z.number().int().min(1).max(100).optional(),
});
export type BulkAddDefaults = z.infer<typeof bulkAddDefaultsSchema>;

export const bulkAddRowSchema = z.object({
  rowId: z.string().trim().min(1).max(100),
  cardId: z.string().trim().min(1),
  cardData: cardDataPayloadSchema,
  binderId: z.string().min(1).optional(),
  quantity: z.number().int().min(1).max(100).optional(),
  overrides: bulkAddCopyFieldsSchema.optional(),
});
export type BulkAddRow = z.infer<typeof bulkAddRowSchema>;

export const bulkAddRequestSchema = z
  .object({
    defaults: bulkAddDefaultsSchema.optional(),
    rows: z.array(bulkAddRowSchema).min(1).max(200),
  })
  .superRefine((request, context) => {
    const rowIds = new Set<string>();
    let totalCopies = 0;
    for (const [index, row] of request.rows.entries()) {
      if (rowIds.has(row.rowId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "rowId"],
          message: "Row IDs must be unique",
        });
      }
      rowIds.add(row.rowId);
      const quantity = row.quantity ?? request.defaults?.quantity ?? 1;
      totalCopies += quantity;
      const serialNumber =
        row.overrides?.serialNumber ?? request.defaults?.serialNumber;
      if (serialNumber && quantity !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "quantity"],
          message: "Serialized copies must be staged as individual rows",
        });
      }
      if (!row.binderId && !request.defaults?.binderId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "binderId"],
          message: "A destination binder is required",
        });
      }
    }
    if (totalCopies > 500) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rows"],
        message: "Bulk Add is limited to 500 physical copies per transaction",
      });
    }
  });
export type BulkAddRequest = z.infer<typeof bulkAddRequestSchema>;

export interface BulkAddIssue {
  rowId?: string;
  field?: string;
  message: string;
}

export interface BulkAddPreviewRow {
  rowId: string;
  valid: boolean;
  cardId: string;
  name: string;
  tcg: TcgCode;
  setCode?: string;
  rarity?: string;
  binderId: string;
  binderName?: string;
  quantity: number;
  condition?: string;
  language?: string;
  finishCode?: string;
  edition?: string;
}

export interface BulkAddPreview {
  valid: boolean;
  rows: BulkAddPreviewRow[];
  issues: BulkAddIssue[];
  totalRows: number;
  totalCopies: number;
}

export interface BulkAddResult {
  addedRows: number;
  addedCopies: number;
  entryIds: string[];
}

// ---------------------------------------------------------------------------
// Bulk collection import
// ---------------------------------------------------------------------------

export const collectionImportOptionsSchema = z.object({
  defaultBinderId: z.string().optional(),
  createMissingBinders: z.boolean().default(false),
});
export type CollectionImportOptions = z.infer<
  typeof collectionImportOptionsSchema
>;

export const collectionImportSourceFormatSchema = z.enum([
  "auto",
  "csv",
  "json",
  "cardmarket-text",
  "pdf",
]);
export type CollectionImportSourceFormat = z.infer<
  typeof collectionImportSourceFormatSchema
>;

export const collectionImportResolutionSchema = z.object({
  externalId: z.string().min(1),
  baseExternalId: z.string().optional(),
  printingKey: z.string().optional(),
  artworkId: z.string().optional(),
  collectorNumber: z.string().optional(),
  setCode: z.string().optional(),
  setName: z.string().optional(),
  rarity: z.string().optional(),
  cardName: z.string().optional(),
});
export type CollectionImportResolution = z.infer<
  typeof collectionImportResolutionSchema
>;

export const collectionImportRequestSchema = z
  .object({
    csv: z.string().min(1).max(1_000_000).optional(),
    content: z.string().min(1).max(1_000_000).optional(),
    format: collectionImportSourceFormatSchema.optional(),
    fileName: z.string().max(255).optional(),
    resolutions: z.record(collectionImportResolutionSchema).optional(),
    options: collectionImportOptionsSchema.optional(),
  })
  .refine((input) => Boolean(input.csv || input.content), {
    message: "CSV or import source content is required",
  });
export type CollectionImportRequest = z.infer<
  typeof collectionImportRequestSchema
>;

export interface CollectionImportIssue {
  row: number;
  field?: string;
  message: string;
}

export interface CollectionImportPreviewRow {
  row: number;
  tcg: TcgCode;
  externalId: string;
  baseExternalId?: string;
  printingKey?: string;
  artworkId?: string;
  cardName: string;
  collectorNumber?: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  binderName?: string;
  quantity: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
  serialNumber?: string;
  acquiredAt?: string;
  isFoil: boolean;
  finishCode?: string;
  finishLabel?: string;
  edition?: string;
  stamp?: string;
  isSealedPromo: boolean;
  isOversized: boolean;
  isPeelOff: boolean;
  isSigned: boolean;
  isAltered: boolean;
  tags: string[];
}

export interface CollectionImportPreview {
  valid: boolean;
  rows: CollectionImportPreviewRow[];
  issues: CollectionImportIssue[];
  sourceRows: number;
  totalCopies: number;
  format?: Exclude<CollectionImportSourceFormat, "auto">;
  failures?: CollectionImportFailure[];
  ambiguities?: CollectionImportAmbiguity[];
}

export interface CollectionImportFailure {
  sourceRow: number;
  code: string;
  message: string;
  original?: string;
  field?: string;
}

export interface CollectionImportAmbiguity {
  sourceRow: number;
  code: "PRINTING_RESOLUTION_REQUIRED";
  message: string;
  query: {
    tcg: TcgCode;
    name: string;
    collectorNumber?: string;
    setCode?: string;
    rarity?: string;
  };
}

export interface CollectionImportResult extends CollectionImportPreview {
  importedRows: number;
  importedCopies: number;
  createdBinders: string[];
}

// ---------------------------------------------------------------------------
// Tag request schemas
// ---------------------------------------------------------------------------

export const exportFormatSchema = z.enum(["json", "csv"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

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
  isFoil?: boolean;
  finishCode?: string;
  finishLabel?: string;
  edition?: string;
  stamp?: string;
  isSealedPromo?: boolean;
  isOversized?: boolean;
  isPeelOff?: boolean;
  isSigned?: boolean;
  isAltered?: boolean;
  gradingCompany?: string;
  gradingScore?: string;
  certNumber?: string;
  storageLocation?: string;
  imageUrls?: string[];
  tags: CollectionTag[];
}

export interface CollectionCard {
  id: string;
  cardId: string;
  externalId?: string;
  baseExternalId?: string;
  printingKey?: string;
  artworkId?: string;
  printingKind?: string;
  sanctionedPlayLegal?: boolean;
  originalPrintingKey?: string;
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
  priceHistory?: Array<
    | {
        price: number;
        recordedAt: string;
      }
    | number
  >;
  copies: CollectionCardCopy[];
}

export interface Binder {
  id: string;
  name: string;
  description?: string;
  colorHex?: string;
  defaultCondition?: string;
  containerType?: string;
  imageUrl?: string;
  associatedTcg?: TcgCode;
  associatedSetCode?: string;
  associatedSetName?: string;
  cards: CollectionCard[];
  createdAt: string;
  updatedAt: string;
}

export interface CollectionTagResponse extends CollectionTag {
  createdAt: string;
  updatedAt: string;
}
