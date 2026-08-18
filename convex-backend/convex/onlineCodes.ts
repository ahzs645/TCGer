import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { tcgCodeValidator, type TcgCode } from "./lib/validators";

export const onlineCodeStatusValidator = v.union(
  v.literal("unused"),
  v.literal("redeemed"),
  v.literal("invalid"),
  v.literal("traded"),
);

export const onlineCodeSourceValidator = v.union(
  v.literal("camera"),
  v.literal("manual"),
  v.literal("import"),
);

const onlineCodeResponseValidator = v.object({
  id: v.id("onlineCodes"),
  tcg: tcgCodeValidator,
  code: v.string(),
  status: onlineCodeStatusValidator,
  source: onlineCodeSourceValidator,
  productName: v.optional(v.string()),
  notes: v.optional(v.string()),
  capturedAt: v.string(),
  redeemedAt: v.optional(v.string()),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const bulkResultValidator = v.object({
  created: v.number(),
  duplicates: v.number(),
  items: v.array(onlineCodeResponseValidator),
});

type ReaderCtx = QueryCtx | MutationCtx;
type OnlineCodeStatus = "unused" | "redeemed" | "invalid" | "traded";

async function requireViewerBySubject(ctx: ReaderCtx, subject: string) {
  const viewer = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (query) => query.eq("authSubject", subject))
    .unique();
  if (!viewer) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Viewer not provisioned",
    });
  }
  return viewer;
}

function normalizeCode(value: string): string {
  return value.trim().replace(/\s+/gu, "").toLocaleUpperCase("en-US");
}

function cleanCode(value: string): string {
  const code = value.trim();
  const normalized = normalizeCode(code);
  if (normalized.length < 4 || code.length > 512) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Each code must contain 4 to 512 characters",
    });
  }
  return code;
}

function cleanOptionalText(
  value: string | undefined,
  fieldName: string,
  maxLength: number,
): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  if (cleaned.length > maxLength) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} must be at most ${maxLength} characters`,
    });
  }
  return cleaned;
}

function toResponse(code: Doc<"onlineCodes">) {
  return {
    id: code._id,
    tcg: code.tcg,
    code: code.code,
    status: code.status,
    source: code.source,
    productName: code.productName,
    notes: code.notes,
    capturedAt: new Date(code.capturedAt).toISOString(),
    redeemedAt:
      code.redeemedAt === undefined
        ? undefined
        : new Date(code.redeemedAt).toISOString(),
    createdAt: new Date(code.createdAt).toISOString(),
    updatedAt: new Date(code.updatedAt).toISOString(),
  };
}

async function requireOwnedCode(
  ctx: ReaderCtx,
  codeId: Id<"onlineCodes">,
  userId: Id<"users">,
) {
  const code = await ctx.db.get(codeId);
  if (!code || code.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Online code not found",
    });
  }
  return code;
}

export const list = internalQuery({
  args: {
    subject: v.string(),
    tcg: v.optional(tcgCodeValidator),
    status: v.optional(onlineCodeStatusValidator),
  },
  returns: v.array(onlineCodeResponseValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    let rows: Doc<"onlineCodes">[];

    if (args.tcg && args.status) {
      rows = await ctx.db
        .query("onlineCodes")
        .withIndex("by_user_tcg_and_status", (query) =>
          query
            .eq("userId", viewer._id)
            .eq("tcg", args.tcg as TcgCode)
            .eq("status", args.status as OnlineCodeStatus),
        )
        .order("desc")
        .take(500);
    } else if (args.tcg) {
      rows = await ctx.db
        .query("onlineCodes")
        .withIndex("by_user_and_tcg", (query) =>
          query.eq("userId", viewer._id).eq("tcg", args.tcg as TcgCode),
        )
        .order("desc")
        .take(500);
    } else if (args.status) {
      rows = await ctx.db
        .query("onlineCodes")
        .withIndex("by_user_and_status", (query) =>
          query
            .eq("userId", viewer._id)
            .eq("status", args.status as OnlineCodeStatus),
        )
        .order("desc")
        .take(500);
    } else {
      rows = await ctx.db
        .query("onlineCodes")
        .withIndex("by_user", (query) => query.eq("userId", viewer._id))
        .order("desc")
        .take(500);
    }

    return rows.map(toResponse);
  },
});

export const createBatch = internalMutation({
  args: {
    subject: v.string(),
    tcg: tcgCodeValidator,
    codes: v.array(
      v.object({
        code: v.string(),
        capturedAt: v.optional(v.number()),
      }),
    ),
    source: onlineCodeSourceValidator,
    productName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: bulkResultValidator,
  handler: async (ctx, args) => {
    if (args.codes.length < 1 || args.codes.length > 250) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "A batch must contain 1 to 250 codes",
      });
    }

    const viewer = await requireViewerBySubject(ctx, args.subject);
    const productName = cleanOptionalText(args.productName, "productName", 120);
    const notes = cleanOptionalText(args.notes, "notes", 2_000);
    const now = Date.now();
    const items: ReturnType<typeof toResponse>[] = [];
    const seenInBatch = new Set<string>();
    let duplicates = 0;

    for (const input of args.codes) {
      const code = cleanCode(input.code);
      const normalizedCode = normalizeCode(code);
      if (seenInBatch.has(normalizedCode)) {
        duplicates += 1;
        continue;
      }
      seenInBatch.add(normalizedCode);

      const existing = await ctx.db
        .query("onlineCodes")
        .withIndex("by_user_tcg_and_normalized_code", (query) =>
          query
            .eq("userId", viewer._id)
            .eq("tcg", args.tcg)
            .eq("normalizedCode", normalizedCode),
        )
        .unique();
      if (existing) {
        duplicates += 1;
        continue;
      }

      const capturedAt = input.capturedAt ?? now;
      if (
        !Number.isFinite(capturedAt) ||
        capturedAt < 0 ||
        capturedAt > now + 300_000
      ) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "capturedAt must be a valid timestamp",
        });
      }

      const id = await ctx.db.insert("onlineCodes", {
        userId: viewer._id,
        tcg: args.tcg,
        code,
        normalizedCode,
        status: "unused",
        source: args.source,
        productName,
        notes,
        capturedAt,
        createdAt: now,
        updatedAt: now,
      });
      const created = await ctx.db.get(id);
      if (created) items.push(toResponse(created));
    }

    return { created: items.length, duplicates, items };
  },
});

export const update = internalMutation({
  args: {
    subject: v.string(),
    codeId: v.id("onlineCodes"),
    status: v.optional(onlineCodeStatusValidator),
    productName: v.optional(v.string()),
    notes: v.optional(v.string()),
    clearProductName: v.optional(v.boolean()),
    clearNotes: v.optional(v.boolean()),
  },
  returns: onlineCodeResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const current = await requireOwnedCode(ctx, args.codeId, viewer._id);
    const now = Date.now();
    const patch: Partial<Doc<"onlineCodes">> = { updatedAt: now };

    if (args.status !== undefined) {
      patch.status = args.status;
      patch.redeemedAt =
        args.status === "redeemed" ? (current.redeemedAt ?? now) : undefined;
    }
    if (args.clearProductName) {
      patch.productName = undefined;
    } else if (args.productName !== undefined) {
      patch.productName = cleanOptionalText(
        args.productName,
        "productName",
        120,
      );
    }
    if (args.clearNotes) {
      patch.notes = undefined;
    } else if (args.notes !== undefined) {
      patch.notes = cleanOptionalText(args.notes, "notes", 2_000);
    }

    await ctx.db.patch(current._id, patch);
    return toResponse((await ctx.db.get(current._id))!);
  },
});

export const remove = internalMutation({
  args: { subject: v.string(), codeId: v.id("onlineCodes") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const code = await requireOwnedCode(ctx, args.codeId, viewer._id);
    await ctx.db.delete(code._id);
    return null;
  },
});
