import { z } from "zod";
import { addCardSchema } from "./collections";

export const inventoryIntakeSchema = z.object({
  operationId: z.string().trim().min(1).max(200),
  source: z.enum(["scanner", "physical-opening"]),
  rows: z.array(addCardSchema.extend({ rowId: z.string().trim().min(1).max(200), quantity: z.number().int().min(1).max(100).optional() })).min(1).max(200),
  sealedInventoryId: z.string().min(1).optional(),
  openedQuantity: z.number().int().min(1).max(500).optional(),
  openedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
}).superRefine((value, ctx) => {
  if (new Set(value.rows.map(row => row.rowId)).size !== value.rows.length) ctx.addIssue({ code: "custom", path: ["rows"], message: "rowId must be unique" });
  if (value.rows.reduce((sum, row) => sum + (row.quantity ?? 1), 0) > 500) ctx.addIssue({ code: "custom", path: ["rows"], message: "An intake may contain at most 500 physical copies" });
  if (value.source !== "physical-opening" && (value.sealedInventoryId || value.openedQuantity)) ctx.addIssue({ code: "custom", message: "Only reviewed physical openings may decrement sealed stock" });
  if (value.openedQuantity !== undefined && !value.sealedInventoryId) ctx.addIssue({ code: "custom", message: "openedQuantity requires sealedInventoryId" });
  for (const [index, row] of value.rows.entries()) if ((row.serialNumber || row.certNumber) && (row.quantity ?? 1) > 1) ctx.addIssue({ code: "custom", path: ["rows", index], message: "Serialized or certified copies must be entered individually" });
});
export type InventoryIntakeInput = z.infer<typeof inventoryIntakeSchema>;
export interface InventoryIntakeReceipt {
  operationId: string;
  entryIds: string[];
  rows: Array<{ rowId: string; entryIds: string[] }>;
  openingId?: string;
}

export const inventorySaleSchema = z.object({
  operationId: z.string().trim().min(1).max(200),
  collectionId: z.string().min(1),
  copyIds: z.array(z.string().min(1)).min(1).max(500),
  amount: z.number().finite().positive(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase()),
  removeFromInventory: z.boolean(),
  platform: z.string().optional(),
  costBasis: z.number().finite().nonnegative().optional(),
  fees: z.number().finite().nonnegative().optional(),
  shippingCost: z.number().finite().nonnegative().optional(),
  acquiredAt: z.string().datetime().optional(),
  notes: z.string().optional(),
  date: z.string().datetime().optional(),
}).refine(value => new Set(value.copyIds).size === value.copyIds.length, { path: ["copyIds"], message: "A physical copy may only appear once in a sale" });
export type InventorySaleInput = z.infer<typeof inventorySaleSchema>;
export interface InventorySaleReceipt {
  operationId: string;
  transactionId: string;
  copyIds: string[];
  removedCopyIds: string[];
  amount: number;
  currency: string;
}
