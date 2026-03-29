import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { cardSnapshotValidator, binderDetailValidator, binderSummaryValidator, entryValidator, tagInputValidator, tagSummaryValidator } from "./validators";
import { ConvexError, v } from "convex/values";
import { now, requireBinderForUser, toIso, validateColorHex } from "./domain";

type ReaderCtx = QueryCtx | MutationCtx;

export const addEntryArgs = {
  binderId: v.id("binders"),
  card: cardSnapshotValidator,
  quantity: v.optional(v.number()),
  condition: v.optional(v.string()),
  language: v.optional(v.string()),
  notes: v.optional(v.string()),
  price: v.optional(v.number()),
  acquisitionPrice: v.optional(v.number()),
  serialNumber: v.optional(v.string()),
  acquiredAt: v.optional(v.string()),
  isFoil: v.optional(v.boolean()),
  isSigned: v.optional(v.boolean()),
  isAltered: v.optional(v.boolean()),
  tagIds: v.optional(v.array(v.id("tags"))),
  newTags: v.optional(v.array(tagInputValidator))
};

export const updateEntryArgs = {
  entryId: v.id("collectionEntries"),
  binderId: v.optional(v.id("binders")),
  quantity: v.optional(v.number()),
  condition: v.optional(v.string()),
  language: v.optional(v.string()),
  notes: v.optional(v.string()),
  price: v.optional(v.number()),
  acquisitionPrice: v.optional(v.number()),
  serialNumber: v.optional(v.string()),
  acquiredAt: v.optional(v.string()),
  isFoil: v.optional(v.boolean()),
  isSigned: v.optional(v.boolean()),
  isAltered: v.optional(v.boolean()),
  tagIds: v.optional(v.array(v.id("tags"))),
  newTags: v.optional(v.array(tagInputValidator))
};

export async function upsertCard(
  ctx: MutationCtx,
  snapshot: {
    tcg: "yugioh" | "magic" | "pokemon";
    externalId: string;
    name: string;
    setCode?: string;
    setName?: string;
    rarity?: string;
    collectorNumber?: string;
    releasedAt?: string;
    imageUrl?: string;
    imageUrlSmall?: string;
  }
): Promise<Id<"cards">> {
  const existing = await ctx.db
    .query("cards")
    .withIndex("by_tcg_external", (q) =>
      q.eq("tcg", snapshot.tcg).eq("externalId", snapshot.externalId)
    )
    .unique();
  const timestamp = now();

  if (existing) {
    await ctx.db.patch(existing._id, {
      name: snapshot.name,
      setCode: snapshot.setCode,
      setName: snapshot.setName,
      rarity: snapshot.rarity,
      collectorNumber: snapshot.collectorNumber,
      releasedAt: snapshot.releasedAt,
      imageUrl: snapshot.imageUrl,
      imageUrlSmall: snapshot.imageUrlSmall,
      updatedAt: timestamp
    });
    return existing._id;
  }

  return await ctx.db.insert("cards", {
    tcg: snapshot.tcg,
    externalId: snapshot.externalId,
    name: snapshot.name,
    setCode: snapshot.setCode,
    setName: snapshot.setName,
    rarity: snapshot.rarity,
    collectorNumber: snapshot.collectorNumber,
    releasedAt: snapshot.releasedAt,
    imageUrl: snapshot.imageUrl,
    imageUrlSmall: snapshot.imageUrlSmall,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

async function ensureTag(
  ctx: MutationCtx,
  userId: Id<"users">,
  input: { label: string; colorHex: string }
): Promise<Id<"tags">> {
  const label = input.label.trim();
  if (!label) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Tag label is required"
    });
  }
  const colorHex = validateColorHex(input.colorHex) ?? "64748b";
  const existing = await ctx.db
    .query("tags")
    .withIndex("by_user_label", (q) => q.eq("userId", userId).eq("label", label))
    .unique();

  const timestamp = now();
  if (existing) {
    await ctx.db.patch(existing._id, { colorHex, updatedAt: timestamp });
    return existing._id;
  }

  return await ctx.db.insert("tags", {
    userId,
    label,
    colorHex,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

async function replaceEntryTags(
  ctx: MutationCtx,
  entryId: Id<"collectionEntries">,
  userId: Id<"users">,
  tagIds: Id<"tags">[] | undefined,
  newTags: Array<{ label: string; colorHex: string }> | undefined
): Promise<void> {
  if (tagIds === undefined && newTags === undefined) {
    return;
  }

  const current = await ctx.db
    .query("collectionEntryTags")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .collect();
  await Promise.all(current.map((assignment) => ctx.db.delete(assignment._id)));

  const normalizedIds = new Set<Id<"tags">>(tagIds ?? []);
  for (const tag of newTags ?? []) {
    normalizedIds.add(await ensureTag(ctx, userId, tag));
  }

  const timestamp = now();
  await Promise.all(
    Array.from(normalizedIds).map(async (tagId) => {
      const tag = await ctx.db.get(tagId);
      if (!tag || tag.userId !== userId) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "One or more tags do not belong to the current user"
        });
      }
      await ctx.db.insert("collectionEntryTags", { entryId, tagId, assignedAt: timestamp });
    })
  );
}

async function hydrateTags(ctx: ReaderCtx, entryId: Id<"collectionEntries">) {
  const assignments = await ctx.db
    .query("collectionEntryTags")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .collect();
  const tags = await Promise.all(assignments.map((assignment) => ctx.db.get(assignment.tagId)));
  return tags
    .filter((tag): tag is Doc<"tags"> => tag !== null)
    .map((tag) => ({
      id: tag._id,
      label: tag.label,
      colorHex: tag.colorHex,
      createdAt: toIso(tag.createdAt),
      updatedAt: toIso(tag.updatedAt)
    }));
}

async function hydrateEntry(ctx: ReaderCtx, entry: Doc<"collectionEntries">) {
  const card = await ctx.db.get(entry.cardId);
  if (!card) {
    throw new ConvexError({
      code: "INVARIANT",
      message: "Card document is missing for collection entry"
    });
  }
  const tags = await hydrateTags(ctx, entry._id);
  return {
    id: entry._id,
    userId: entry.userId,
    binderId: entry.binderId,
    cardId: entry.cardId,
    card: {
      id: card._id,
      tcg: card.tcg,
      externalId: card.externalId,
      name: card.name,
      setCode: card.setCode,
      setName: card.setName,
      rarity: card.rarity,
      collectorNumber: card.collectorNumber,
      releasedAt: card.releasedAt,
      imageUrl: card.imageUrl,
      imageUrlSmall: card.imageUrlSmall
    },
    quantity: entry.quantity,
    condition: entry.condition,
    language: entry.language,
    notes: entry.notes,
    price: entry.price,
    acquisitionPrice: entry.acquisitionPrice,
    serialNumber: entry.serialNumber,
    acquiredAt: entry.acquiredAt,
    isFoil: entry.isFoil,
    isSigned: entry.isSigned,
    isAltered: entry.isAltered,
    imageUrls: entry.imageUrls,
    tags,
    createdAt: toIso(entry.createdAt),
    updatedAt: toIso(entry.updatedAt)
  };
}

export async function hydrateBinderSummary(ctx: ReaderCtx, binder: Doc<"binders">) {
  const entries = await ctx.db
    .query("collectionEntries")
    .withIndex("by_binder", (q) => q.eq("binderId", binder._id))
    .collect();

  return {
    id: binder._id,
    userId: binder.userId,
    kind: binder.kind,
    name: binder.name,
    description: binder.description,
    colorHex: binder.colorHex,
    entryCount: entries.length,
    createdAt: toIso(binder.createdAt),
    updatedAt: toIso(binder.updatedAt)
  };
}

export async function hydrateBinderDetail(ctx: ReaderCtx, binder: Doc<"binders">) {
  const entries = await ctx.db
    .query("collectionEntries")
    .withIndex("by_binder", (q) => q.eq("binderId", binder._id))
    .collect();
  const hydratedEntries = await Promise.all(entries.map((entry) => hydrateEntry(ctx, entry)));
  const summary = await hydrateBinderSummary(ctx, binder);
  return {
    ...summary,
    entries: hydratedEntries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  };
}

export async function addEntryForViewer(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: {
    binderId: Id<"binders">;
    card: {
      tcg: "yugioh" | "magic" | "pokemon";
      externalId: string;
      name: string;
      setCode?: string;
      setName?: string;
      rarity?: string;
      collectorNumber?: string;
      releasedAt?: string;
      imageUrl?: string;
      imageUrlSmall?: string;
    };
    quantity?: number;
    condition?: string;
    language?: string;
    notes?: string;
    price?: number;
    acquisitionPrice?: number;
    serialNumber?: string;
    acquiredAt?: string;
    isFoil?: boolean;
    isSigned?: boolean;
    isAltered?: boolean;
    tagIds?: Id<"tags">[];
    newTags?: Array<{ label: string; colorHex: string }>;
  }
) {
  await requireBinderForUser(ctx, args.binderId, userId);
  const timestamp = now();
  const cardId = await upsertCard(ctx, args.card);
  const quantity = args.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "quantity must be a positive integer"
    });
  }

  const entryId = await ctx.db.insert("collectionEntries", {
    userId,
    binderId: args.binderId,
    cardId,
    quantity,
    condition: args.condition,
    language: args.language,
    notes: args.notes,
    price: args.price,
    acquisitionPrice: args.acquisitionPrice,
    serialNumber: args.serialNumber,
    acquiredAt: args.acquiredAt,
    isFoil: args.isFoil,
    isSigned: args.isSigned,
    isAltered: args.isAltered,
    imageUrls: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });

  await replaceEntryTags(ctx, entryId, userId, args.tagIds, args.newTags);
  const entry = await ctx.db.get(entryId);
  if (!entry) {
    throw new ConvexError({
      code: "INVARIANT",
      message: "Collection entry was not created"
    });
  }
  return await hydrateEntry(ctx, entry);
}

export async function updateEntryForViewer(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: {
    entryId: Id<"collectionEntries">;
    binderId?: Id<"binders">;
    quantity?: number;
    condition?: string;
    language?: string;
    notes?: string;
    price?: number;
    acquisitionPrice?: number;
    serialNumber?: string;
    acquiredAt?: string;
    isFoil?: boolean;
    isSigned?: boolean;
    isAltered?: boolean;
    tagIds?: Id<"tags">[];
    newTags?: Array<{ label: string; colorHex: string }>;
  }
) {
  const entry = await ctx.db.get(args.entryId);
  if (!entry || entry.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Collection entry not found"
    });
  }

  if (args.binderId) {
    await requireBinderForUser(ctx, args.binderId, userId);
  }
  if (args.quantity !== undefined && (!Number.isInteger(args.quantity) || args.quantity < 1)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "quantity must be a positive integer"
    });
  }

  await ctx.db.patch(entry._id, {
    binderId: args.binderId ?? entry.binderId,
    quantity: args.quantity ?? entry.quantity,
    condition: args.condition ?? entry.condition,
    language: args.language ?? entry.language,
    notes: args.notes ?? entry.notes,
    price: args.price ?? entry.price,
    acquisitionPrice: args.acquisitionPrice ?? entry.acquisitionPrice,
    serialNumber: args.serialNumber ?? entry.serialNumber,
    acquiredAt: args.acquiredAt ?? entry.acquiredAt,
    isFoil: args.isFoil ?? entry.isFoil,
    isSigned: args.isSigned ?? entry.isSigned,
    isAltered: args.isAltered ?? entry.isAltered,
    updatedAt: now()
  });

  await replaceEntryTags(ctx, entry._id, userId, args.tagIds, args.newTags);
  const updated = await ctx.db.get(entry._id);
  if (!updated) {
    throw new ConvexError({
      code: "INVARIANT",
      message: "Collection entry disappeared during update"
    });
  }
  return await hydrateEntry(ctx, updated);
}

export async function removeEntryForViewer(
  ctx: MutationCtx,
  userId: Id<"users">,
  entryId: Id<"collectionEntries">
) {
  const entry = await ctx.db.get(entryId);
  if (!entry || entry.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Collection entry not found"
    });
  }
  const assignments = await ctx.db
    .query("collectionEntryTags")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .collect();
  await Promise.all(assignments.map((assignment) => ctx.db.delete(assignment._id)));
  await ctx.db.delete(entryId);
}
