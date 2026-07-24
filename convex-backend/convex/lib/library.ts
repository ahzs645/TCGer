import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { cardSnapshotValidator, binderDetailValidator, binderSummaryValidator, entryValidator, tagInputValidator, tagSummaryValidator } from "./validators";
import { ConvexError, v } from "convex/values";
import { now, requireBinderForUser, toIso, validateColorHex } from "./domain";
import {
  mergeRichCardMetadata,
  normalizeOptionalIdentifier,
  pickRichCardMetadata,
  type RichCardSnapshot
} from "./cardMetadata";
import {
  appendCollectionAudit,
  snapshotAuditEntries
} from "./collectionAudit";

type ReaderCtx = QueryCtx | MutationCtx;
const nullableString = v.union(v.string(), v.null());

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
  finishCode: v.optional(v.string()),
  finishLabel: v.optional(v.string()),
  edition: v.optional(v.string()),
  stamp: v.optional(v.string()),
  isSealedPromo: v.optional(v.boolean()),
  isOversized: v.optional(v.boolean()),
  isPeelOff: v.optional(v.boolean()),
  isSigned: v.optional(v.boolean()),
  isAltered: v.optional(v.boolean()),
  gradingCompany: v.optional(v.string()),
  gradingScore: v.optional(v.string()),
  certNumber: v.optional(v.string()),
  storageLocation: v.optional(v.string()),
  tagIds: v.optional(v.array(v.id("tags"))),
  newTags: v.optional(v.array(tagInputValidator))
};

const bulkAddCopyFields = {
  condition: v.optional(v.string()),
  language: v.optional(v.string()),
  notes: v.optional(v.string()),
  price: v.optional(v.number()),
  acquisitionPrice: v.optional(v.number()),
  serialNumber: v.optional(v.string()),
  acquiredAt: v.optional(v.string()),
  isFoil: v.optional(v.boolean()),
  finishCode: v.optional(v.string()),
  finishLabel: v.optional(v.string()),
  edition: v.optional(v.string()),
  stamp: v.optional(v.string()),
  isSealedPromo: v.optional(v.boolean()),
  isOversized: v.optional(v.boolean()),
  isPeelOff: v.optional(v.boolean()),
  isSigned: v.optional(v.boolean()),
  isAltered: v.optional(v.boolean()),
  gradingCompany: v.optional(v.string()),
  gradingScore: v.optional(v.string()),
  certNumber: v.optional(v.string()),
  storageLocation: v.optional(v.string()),
  tagIds: v.optional(v.array(v.id("tags"))),
  newTags: v.optional(
    v.array(v.object({ label: v.string(), colorHex: v.optional(v.string()) }))
  )
};

export const bulkAddDefaultsValidator = v.object({
  binderId: v.optional(v.id("binders")),
  quantity: v.optional(v.number()),
  ...bulkAddCopyFields
});

export const bulkAddRowValidator = v.object({
  rowId: v.string(),
  binderId: v.optional(v.id("binders")),
  quantity: v.optional(v.number()),
  card: cardSnapshotValidator,
  overrides: v.optional(v.object(bulkAddCopyFields))
});

export const bulkAddResultValidator = v.object({
  addedRows: v.number(),
  addedCopies: v.number(),
  entryIds: v.array(v.id("collectionEntries"))
});

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
  finishCode: v.optional(nullableString),
  finishLabel: v.optional(nullableString),
  edition: v.optional(nullableString),
  stamp: v.optional(nullableString),
  isSealedPromo: v.optional(v.boolean()),
  isOversized: v.optional(v.boolean()),
  isPeelOff: v.optional(v.boolean()),
  isSigned: v.optional(v.boolean()),
  isAltered: v.optional(v.boolean()),
  gradingCompany: v.optional(nullableString),
  gradingScore: v.optional(nullableString),
  certNumber: v.optional(nullableString),
  storageLocation: v.optional(nullableString),
  tagIds: v.optional(v.array(v.id("tags"))),
  newTags: v.optional(v.array(tagInputValidator))
};

export async function upsertCard(
  ctx: MutationCtx,
  snapshot: RichCardSnapshot
): Promise<Id<"cards">> {
  const timestamp = now();
  let identityId: Id<"cardIdentities"> | undefined;
  const baseExternalId = normalizeOptionalIdentifier(snapshot.baseExternalId);
  const printingKey = normalizeOptionalIdentifier(snapshot.printingKey);
  const artworkId = normalizeOptionalIdentifier(snapshot.artworkId);

  if (baseExternalId) {
    const existingIdentity = await ctx.db
      .query("cardIdentities")
      .withIndex("by_tcg_external", (q) =>
        q.eq("tcg", snapshot.tcg).eq("externalId", baseExternalId)
      )
      .unique();

    if (existingIdentity) {
      await ctx.db.patch(existingIdentity._id, {
        name: snapshot.name,
        updatedAt: timestamp
      });
      identityId = existingIdentity._id;
    } else {
      identityId = await ctx.db.insert("cardIdentities", {
        tcg: snapshot.tcg,
        externalId: baseExternalId,
        name: snapshot.name,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
  }

  const existingByPrintingKey = printingKey
    ? await ctx.db
        .query("cards")
        .withIndex("by_tcg_printing_key", (q) =>
          q.eq("tcg", snapshot.tcg).eq("printingKey", printingKey)
        )
        .unique()
    : null;
  const existing =
    existingByPrintingKey ??
    (await ctx.db
      .query("cards")
      .withIndex("by_tcg_external", (q) =>
        q.eq("tcg", snapshot.tcg).eq("externalId", snapshot.externalId)
      )
      .unique());

  if (existing) {
    await ctx.db.patch(existing._id, {
      identityId: identityId ?? existing.identityId,
      baseExternalId:
        baseExternalId ?? normalizeOptionalIdentifier(existing.baseExternalId),
      printingKey: printingKey ?? normalizeOptionalIdentifier(existing.printingKey),
      artworkId: artworkId ?? normalizeOptionalIdentifier(existing.artworkId),
      name: snapshot.name,
      setCode: snapshot.setCode ?? existing.setCode,
      setName: snapshot.setName ?? existing.setName,
      rarity: snapshot.rarity ?? existing.rarity,
      collectorNumber: snapshot.collectorNumber ?? existing.collectorNumber,
      releasedAt: snapshot.releasedAt ?? existing.releasedAt,
      imageUrl: snapshot.imageUrl ?? existing.imageUrl,
      imageUrlSmall: snapshot.imageUrlSmall ?? existing.imageUrlSmall,
      ...mergeRichCardMetadata(snapshot, existing),
      updatedAt: timestamp
    });
    return existing._id;
  }

  return await ctx.db.insert("cards", {
    tcg: snapshot.tcg,
    identityId,
    externalId: snapshot.externalId,
    baseExternalId,
    printingKey,
    artworkId,
    name: snapshot.name,
    setCode: snapshot.setCode,
    setName: snapshot.setName,
    rarity: snapshot.rarity,
    collectorNumber: snapshot.collectorNumber,
    releasedAt: snapshot.releasedAt,
    imageUrl: snapshot.imageUrl,
    imageUrlSmall: snapshot.imageUrlSmall,
    ...pickRichCardMetadata(snapshot),
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

export async function replaceEntryTags(
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

export async function hydrateEntry(ctx: ReaderCtx, entry: Doc<"collectionEntries">) {
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
      baseExternalId: card.baseExternalId,
      printingKey: card.printingKey,
      artworkId: card.artworkId,
      name: card.name,
      setCode: card.setCode,
      setName: card.setName,
      rarity: card.rarity,
      collectorNumber: card.collectorNumber,
      releasedAt: card.releasedAt,
      imageUrl: card.imageUrl,
      imageUrlSmall: card.imageUrlSmall,
      ...pickRichCardMetadata(card)
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
    finishCode: entry.finishCode,
    finishLabel: entry.finishLabel,
    edition: entry.edition,
    stamp: entry.stamp,
    isSealedPromo: entry.isSealedPromo,
    isOversized: entry.isOversized,
    isPeelOff: entry.isPeelOff,
    isSigned: entry.isSigned,
    isAltered: entry.isAltered,
    gradingCompany: entry.gradingCompany,
    gradingScore: entry.gradingScore,
    certNumber: entry.certNumber,
    storageLocation: entry.storageLocation,
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
    containerType: binder.containerType,
    imageUrl: binder.imageUrl,
    associatedTcg: binder.associatedTcg,
    associatedSetCode: binder.associatedSetCode,
    associatedSetName: binder.associatedSetName,
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
    card: RichCardSnapshot;
    quantity?: number;
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
    finishCode: args.finishCode,
    finishLabel: args.finishLabel,
    edition: args.edition,
    stamp: args.stamp,
    isSealedPromo: args.isSealedPromo,
    isOversized: args.isOversized,
    isPeelOff: args.isPeelOff,
    isSigned: args.isSigned,
    isAltered: args.isAltered,
    gradingCompany: args.gradingCompany,
    gradingScore: args.gradingScore,
    certNumber: args.certNumber,
    storageLocation: args.storageLocation,
    imageUrls: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });

  await ctx.db.patch(args.binderId, {
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

export async function bulkAddForViewer(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: {
    defaults?: {
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
      tagIds?: Id<"tags">[];
      newTags?: Array<{ label: string; colorHex?: string }>;
    };
    rows: Array<{
      rowId: string;
      binderId?: Id<"binders">;
      quantity?: number;
      card: RichCardSnapshot;
      overrides?: {
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
        tagIds?: Id<"tags">[];
        newTags?: Array<{ label: string; colorHex?: string }>;
      };
    }>;
  }
) {
  const defaults = args.defaults ?? {};
  const resolvedRows = args.rows.map((row) => ({
    ...defaults,
    ...(row.overrides ?? {}),
    rowId: row.rowId,
    binderId: row.binderId ?? defaults.binderId,
    quantity: row.quantity ?? defaults.quantity ?? 1,
    card: row.card
  }));

  const rowIds = new Set<string>();
  let totalCopies = 0;
  for (const row of resolvedRows) {
    if (!row.rowId.trim() || rowIds.has(row.rowId)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Bulk Add row IDs must be non-empty and unique"
      });
    }
    rowIds.add(row.rowId);
    if (!row.binderId) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `Row "${row.rowId}" requires a destination binder`
      });
    }
    if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 100) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `Row "${row.rowId}" quantity must be between 1 and 100`
      });
    }
    if (row.serialNumber && row.quantity !== 1) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `Row "${row.rowId}" must stage serialized copies individually`
      });
    }
    if (
      !Number.isFinite(row.price ?? 0) ||
      (row.price ?? 0) < 0 ||
      !Number.isFinite(row.acquisitionPrice ?? 0) ||
      (row.acquisitionPrice ?? 0) < 0
    ) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `Row "${row.rowId}" contains an invalid price`
      });
    }
    totalCopies += row.quantity;
  }

  if (!resolvedRows.length || resolvedRows.length > 200 || totalCopies > 500) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Bulk Add requires 1–200 rows and at most 500 physical copies"
    });
  }

  const binderIds = new Set(
    resolvedRows.map((row) => row.binderId).filter((id): id is Id<"binders"> => Boolean(id))
  );
  for (const binderId of binderIds) {
    await requireBinderForUser(ctx, binderId, userId);
  }

  const allTagIds = new Set(
    resolvedRows.flatMap((row) => row.tagIds ?? [])
  );
  for (const tagId of allTagIds) {
    const tag = await ctx.db.get(tagId);
    if (!tag || tag.userId !== userId) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "One or more tags do not belong to the current user"
      });
    }
  }

  const timestamp = now();
  const entryIds: Id<"collectionEntries">[] = [];
  for (const row of resolvedRows) {
    const cardId = await upsertCard(ctx, row.card);
    for (let index = 0; index < row.quantity; index += 1) {
      const entryId = await ctx.db.insert("collectionEntries", {
        userId,
        binderId: row.binderId!,
        cardId,
        quantity: 1,
        condition: row.condition,
        language: row.language,
        notes: row.notes,
        price: row.price,
        acquisitionPrice: row.acquisitionPrice,
        serialNumber: row.serialNumber,
        acquiredAt: row.acquiredAt,
        isFoil: row.isFoil,
        finishCode: row.finishCode,
        finishLabel: row.finishLabel,
        edition: row.edition,
        stamp: row.stamp,
        isSealedPromo: row.isSealedPromo,
        isOversized: row.isOversized,
        isPeelOff: row.isPeelOff,
        isSigned: row.isSigned,
        isAltered: row.isAltered,
        gradingCompany: row.gradingCompany,
        gradingScore: row.gradingScore,
        certNumber: row.certNumber,
        storageLocation: row.storageLocation,
        imageUrls: [],
        createdAt: timestamp,
        updatedAt: timestamp
      });
      await replaceEntryTags(
        ctx,
        entryId,
        userId,
        row.tagIds,
        row.newTags?.map((tag) => ({
          label: tag.label,
          colorHex: tag.colorHex ?? "64748b"
        }))
      );
      entryIds.push(entryId);
    }
  }

  await Promise.all(
    Array.from(binderIds).map((binderId) =>
      ctx.db.patch(binderId, { updatedAt: timestamp })
    )
  );

  const viewer = await ctx.db.get(userId);
  const after = await snapshotAuditEntries(ctx, userId, entryIds);
  await appendCollectionAudit(ctx, {
    userId,
    actorId: viewer?.authSubject ?? userId,
    operationKind: "bulk",
    summary: `Added ${entryIds.length} collection copies`,
    before: [],
    after
  });

  return {
    addedRows: resolvedRows.length,
    addedCopies: entryIds.length,
    entryIds
  };
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
    finishCode?: string | null;
    finishLabel?: string | null;
    edition?: string | null;
    stamp?: string | null;
    isSealedPromo?: boolean;
    isOversized?: boolean;
    isPeelOff?: boolean;
    isSigned?: boolean;
    isAltered?: boolean;
    gradingCompany?: string | null;
    gradingScore?: string | null;
    certNumber?: string | null;
    storageLocation?: string | null;
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
    isFoil:
      args.isFoil ??
      (args.finishCode === null ? false : entry.isFoil),
    finishCode:
      args.finishCode === undefined ? entry.finishCode : args.finishCode ?? undefined,
    finishLabel:
      args.finishLabel === undefined ? entry.finishLabel : args.finishLabel ?? undefined,
    edition: args.edition === undefined ? entry.edition : args.edition ?? undefined,
    stamp: args.stamp === undefined ? entry.stamp : args.stamp ?? undefined,
    isSealedPromo: args.isSealedPromo ?? entry.isSealedPromo,
    isOversized: args.isOversized ?? entry.isOversized,
    isPeelOff: args.isPeelOff ?? entry.isPeelOff,
    isSigned: args.isSigned ?? entry.isSigned,
    isAltered: args.isAltered ?? entry.isAltered,
    gradingCompany:
      args.gradingCompany === undefined
        ? entry.gradingCompany
        : args.gradingCompany ?? undefined,
    gradingScore:
      args.gradingScore === undefined ? entry.gradingScore : args.gradingScore ?? undefined,
    certNumber:
      args.certNumber === undefined ? entry.certNumber : args.certNumber ?? undefined,
    storageLocation:
      args.storageLocation === undefined
        ? entry.storageLocation
        : args.storageLocation ?? undefined,
    updatedAt: now()
  });

  const targetBinderId = args.binderId ?? entry.binderId;
  const touchedAt = now();
  await ctx.db.patch(targetBinderId, {
    updatedAt: touchedAt
  });
  if (entry.binderId !== targetBinderId) {
    await ctx.db.patch(entry.binderId, {
      updatedAt: touchedAt
    });
  }

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
  await ctx.db.patch(entry.binderId, {
    updatedAt: now()
  });
}
