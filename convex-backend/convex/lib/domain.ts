import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const HEX_COLOR = /^([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

type ReaderCtx = QueryCtx | MutationCtx;

export function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function now(): number {
  return Date.now();
}

export function requirePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} must be a positive integer`
    });
  }
  return value;
}

export function validateColorHex(colorHex: string | undefined): string | undefined {
  if (colorHex === undefined) {
    return undefined;
  }
  const trimmed = colorHex.trim();
  if (!HEX_COLOR.test(trimmed)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "colorHex must be a 3 or 6 digit hex value"
    });
  }
  return trimmed.toLowerCase();
}

// Every condition spelling the API accepts, uppercased. Kept in sync with
// KNOWN_CONDITION_VALUES in packages/api-types/src/collections.ts (this
// package cannot depend on it).
const KNOWN_CONDITIONS = new Set([
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
  "DMG"
]);

/// Trims and checks a condition against the known spellings; empty clears to
/// undefined, unknown values are rejected.
export function validateCondition(condition: string | undefined): string | undefined {
  if (condition === undefined) {
    return undefined;
  }
  const trimmed = condition.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!KNOWN_CONDITIONS.has(trimmed.toUpperCase())) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `Unknown card condition "${trimmed}"`
    });
  }
  return trimmed;
}

export async function getLibraryBinder(
  ctx: ReaderCtx,
  userId: Id<"users">
): Promise<Doc<"binders"> | null> {
  return await ctx.db
    .query("binders")
    .withIndex("by_user_kind", (q) => q.eq("userId", userId).eq("kind", "library"))
    .unique();
}

export async function requireBinderForUser(
  ctx: ReaderCtx,
  binderId: Id<"binders">,
  userId: Id<"users">
): Promise<Doc<"binders">> {
  const binder = await ctx.db.get(binderId);
  if (!binder || binder.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Binder not found"
    });
  }
  return binder;
}

export async function requireEntryForUser(
  ctx: ReaderCtx,
  entryId: Id<"collectionEntries">,
  userId: Id<"users">
): Promise<Doc<"collectionEntries">> {
  const entry = await ctx.db.get(entryId);
  if (!entry || entry.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Collection entry not found"
    });
  }
  return entry;
}
