import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const intakeReceiptValidator = v.object({
  operationId: v.string(),
  entryIds: v.array(v.id("collectionEntries")),
  rows: v.array(v.object({ rowId: v.string(), entryIds: v.array(v.id("collectionEntries")) })),
  openingId: v.optional(v.id("sealedOpenings")),
});
export const saleReceiptValidator = v.object({
  operationId: v.string(), transactionId: v.id("transactions"),
  copyIds: v.array(v.id("collectionEntries")), removedCopyIds: v.array(v.id("collectionEntries")),
  amount: v.number(), currency: v.string(),
});
export const acquisitionReceiptValidator = v.object({
  allocationGroupId: v.string(), totalCents: v.number(), currency: v.string(), auditId: v.id("collectionMutationAudits"),
  allocations: v.array(v.object({ collectionEntryId: v.id("collectionEntries"), allocatedCents: v.number(), acquisitionPrice: v.number(), transactionId: v.id("transactions") })),
});
type ReceiptByKind = {
  sale: Infer<typeof saleReceiptValidator>;
  intake: Infer<typeof intakeReceiptValidator>;
  acquisition: Infer<typeof acquisitionReceiptValidator>;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

export async function operationReceipt<K extends keyof ReceiptByKind>(
  ctx: MutationCtx, userId: Id<"users">, kind: K, operationId: string, payload: unknown,
) {
  if (!operationId.trim() || operationId.length > 200) throw new ConvexError({ code: "BAD_REQUEST", message: "A stable operationId of 1–200 characters is required" });
  const fingerprint = JSON.stringify(canonical(payload));
  if (new TextEncoder().encode(fingerprint).length > 500_000) throw new ConvexError({ code: "BAD_REQUEST", message: "Operation payload exceeds 500 KB; split it into smaller operations" });
  const prior = await ctx.db.query("inventoryOperationReceipts")
    .withIndex("by_user_and_operation", q => q.eq("userId", userId).eq("operationId", operationId)).unique();
  if (prior && (prior.kind !== kind || prior.requestFingerprint !== fingerprint)) {
    throw new ConvexError({ code: "CONFLICT", message: "This operationId was already committed with a different payload" });
  }
  return { prior: prior?.receipt as ReceiptByKind[K] | undefined, fingerprint };
}
