import { z } from "zod";

export const storageContainerKindSchema = z.enum(["binder", "box", "case", "other"]);
export type StorageContainerKind = z.infer<typeof storageContainerKindSchema>;

export const createStorageContainerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: storageContainerKindSchema,
  binderId: z.string().optional(),
  order: z.number().int().nonnegative().optional(),
  isUnsorted: z.boolean().optional(),
  locked: z.boolean().optional(),
});
export type CreateStorageContainerInput = z.infer<typeof createStorageContainerSchema>;

export const createStorageCompartmentSchema = z.object({
  containerId: z.string(),
  label: z.string().trim().min(1).max(120),
  order: z.number().int().nonnegative(),
  pageNumber: z.number().int().positive().optional(),
  rows: z.number().int().positive(),
  columns: z.number().int().positive(),
  capacity: z.number().int().positive(),
  locked: z.boolean().optional(),
});
export type CreateStorageCompartmentInput = z.infer<typeof createStorageCompartmentSchema>;

export const updateStorageContainerSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  order: z.number().int().nonnegative().optional(),
  locked: z.boolean().optional(),
});
export const updateStorageCompartmentSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  order: z.number().int().nonnegative().optional(),
  pageNumber: z.number().int().positive().optional(),
  locked: z.boolean().optional(),
});

export const placeCollectionEntrySchema = z.object({
  compartmentId: z.string(),
  collectionEntryId: z.string(),
  slotIndex: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  allowDuplicateStacking: z.boolean().optional(),
});
export type PlaceCollectionEntryInput = z.infer<typeof placeCollectionEntrySchema>;

export interface StoragePlacement {
  id: string;
  collectionEntryId: string;
  slotIndex: number;
  quantity: number;
  stackKey?: string;
}

export interface StorageCompartment {
  id: string;
  label: string;
  order: number;
  pageNumber?: number;
  rows: number;
  columns: number;
  capacity: number;
  locked: boolean;
  placements: StoragePlacement[];
}

export interface StorageContainer {
  id: string;
  binderId?: string;
  name: string;
  kind: StorageContainerKind;
  order: number;
  isUnsorted: boolean;
  locked: boolean;
  compartments: StorageCompartment[];
}

export const storageAuditSourceSchema = z.enum([
  "manual",
  "latest-binder-scan",
  "import",
]);
export type StorageAuditSource = z.infer<typeof storageAuditSourceSchema>;

export const storageAuditObservationSchema = z.object({
  compartmentId: z.string(),
  slotIndex: z.number().int().nonnegative(),
  collectionEntryId: z.string().optional(),
  externalId: z.string().trim().min(1).optional(),
  tcg: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  quantity: z.number().int().positive().optional(),
});
export type StorageAuditObservation = z.infer<
  typeof storageAuditObservationSchema
>;

export const previewStorageAuditSchema = z.object({
  containerId: z.string(),
  compartmentId: z.string().optional(),
  source: storageAuditSourceSchema.default("manual"),
  observations: z.array(storageAuditObservationSchema).max(2_000).optional(),
});
export type PreviewStorageAuditInput = z.infer<
  typeof previewStorageAuditSchema
>;

export type StorageAuditItemStatus =
  | "correct"
  | "missing"
  | "wrong"
  | "extra";

export interface StorageAuditItem {
  compartmentId: string;
  compartmentLabel: string;
  slotIndex: number;
  status: StorageAuditItemStatus;
  expectedCollectionEntryId?: string;
  expectedExternalId?: string;
  expectedName?: string;
  observedCollectionEntryId?: string;
  observedExternalId?: string;
  observedName?: string;
  expectedQuantity: number;
  observedQuantity: number;
}

export interface StorageAuditPreview {
  valid: boolean;
  source: StorageAuditSource;
  containerId: string;
  containerName: string;
  capturedAt: string;
  scanRevision?: number;
  summary: Record<StorageAuditItemStatus, number>;
  items: StorageAuditItem[];
  issues: string[];
}

export interface StorageAuditResponse extends StorageAuditPreview {
  id: string;
  status: "reviewed" | "applied";
  createdAt: string;
}
