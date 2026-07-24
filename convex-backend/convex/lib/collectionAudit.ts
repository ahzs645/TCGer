import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type ReaderCtx = QueryCtx | MutationCtx;
type AuditSnapshot = Doc<"collectionMutationAudits">["beforeState"][number];
type AuditKind = Doc<"collectionMutationAudits">["operationKind"];

async function tagIdsForEntry(
  ctx: ReaderCtx,
  entryId: Id<"collectionEntries">
): Promise<Id<"tags">[]> {
  const assignments = await ctx.db
    .query("collectionEntryTags")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .collect();
  return assignments.map((assignment) => assignment.tagId).sort();
}

export async function snapshotAuditEntries(
  ctx: ReaderCtx,
  userId: Id<"users">,
  entryIds: Id<"collectionEntries">[]
): Promise<AuditSnapshot[]> {
  const uniqueIds = Array.from(new Set(entryIds));
  const entries = await Promise.all(uniqueIds.map((entryId) => ctx.db.get(entryId)));
  const owned = entries.filter(
    (entry): entry is Doc<"collectionEntries"> =>
      entry !== null && entry.userId === userId
  );
  const snapshots = await Promise.all(
    owned.map(async (entry) => ({
      id: entry._id,
      userId: entry.userId,
      binderId: entry.binderId,
      cardId: entry.cardId,
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
      imageStorageIds: entry.imageStorageIds,
      tagIds: await tagIdsForEntry(ctx, entry._id)
    }))
  );
  return snapshots.sort((left, right) => left.id.localeCompare(right.id));
}

export async function appendCollectionAudit(
  ctx: MutationCtx,
  input: {
    userId: Id<"users">;
    actorId: string;
    operationKind: AuditKind;
    binderId?: Id<"binders">;
    cardName?: string;
    summary: string;
    before: AuditSnapshot[];
    after: AuditSnapshot[];
    sourceAuditId?: Id<"collectionMutationAudits">;
    idempotencyKey?: string;
  }
) {
  const beforeCopies = input.before.reduce(
    (total, entry) => total + entry.quantity,
    0
  );
  const afterCopies = input.after.reduce(
    (total, entry) => total + entry.quantity,
    0
  );
  return await ctx.db.insert("collectionMutationAudits", {
    userId: input.userId,
    actorId: input.actorId,
    operationKind: input.operationKind,
    binderId: input.binderId,
    cardName: input.cardName,
    affectedCopies: Math.max(beforeCopies, afterCopies),
    summary: input.summary,
    beforeState: input.before,
    afterState: input.after,
    sourceAuditId: input.sourceAuditId,
    idempotencyKey: input.idempotencyKey,
    createdAt: Date.now()
  });
}

function comparable(entries: AuditSnapshot[]) {
  return JSON.stringify(
    [...entries]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        binderId: entry.binderId,
        cardId: entry.cardId,
        quantity: entry.quantity,
        condition: entry.condition ?? null,
        language: entry.language ?? null,
        notes: entry.notes ?? null,
        price: entry.price ?? null,
        acquisitionPrice: entry.acquisitionPrice ?? null,
        serialNumber: entry.serialNumber ?? null,
        acquiredAt: entry.acquiredAt ?? null,
        isFoil: entry.isFoil ?? null,
        finishCode: entry.finishCode ?? null,
        finishLabel: entry.finishLabel ?? null,
        edition: entry.edition ?? null,
        stamp: entry.stamp ?? null,
        isSealedPromo: entry.isSealedPromo ?? null,
        isOversized: entry.isOversized ?? null,
        isPeelOff: entry.isPeelOff ?? null,
        isSigned: entry.isSigned ?? null,
        isAltered: entry.isAltered ?? null,
        gradingCompany: entry.gradingCompany ?? null,
        gradingScore: entry.gradingScore ?? null,
        certNumber: entry.certNumber ?? null,
        storageLocation: entry.storageLocation ?? null,
        imageUrls: entry.imageUrls ?? [],
        imageStorageIds: entry.imageStorageIds ?? [],
        tagIds: [...entry.tagIds].sort()
      }))
  );
}

async function replaceTags(
  ctx: MutationCtx,
  entryId: Id<"collectionEntries">,
  userId: Id<"users">,
  tagIds: Id<"tags">[]
) {
  const current = await ctx.db
    .query("collectionEntryTags")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .collect();
  await Promise.all(current.map((assignment) => ctx.db.delete(assignment._id)));
  for (const tagId of tagIds) {
    const tag = await ctx.db.get(tagId);
    if (!tag || tag.userId !== userId) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Undo cannot restore a tag that no longer exists"
      });
    }
    await ctx.db.insert("collectionEntryTags", {
      entryId,
      tagId,
      assignedAt: Date.now()
    });
  }
}

async function deleteEntry(
  ctx: MutationCtx,
  userId: Id<"users">,
  entryId: Id<"collectionEntries">
) {
  const entry = await ctx.db.get(entryId);
  if (!entry || entry.userId !== userId) return;
  const assignments = await ctx.db
    .query("collectionEntryTags")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .collect();
  await Promise.all(assignments.map((assignment) => ctx.db.delete(assignment._id)));
  await ctx.db.delete(entryId);
}

async function validateSnapshotReferences(
  ctx: MutationCtx,
  userId: Id<"users">,
  snapshots: AuditSnapshot[]
) {
  for (const snapshot of snapshots) {
    const [binder, card] = await Promise.all([
      ctx.db.get(snapshot.binderId),
      ctx.db.get(snapshot.cardId)
    ]);
    if (!binder || binder.userId !== userId || !card) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Undo cannot restore a card or binder that no longer exists"
      });
    }
  }
}

async function restoreSnapshots(
  ctx: MutationCtx,
  userId: Id<"users">,
  before: AuditSnapshot[],
  current: AuditSnapshot[]
) {
  await validateSnapshotReferences(ctx, userId, before);
  const beforeIds = new Set(before.map((entry) => entry.id));
  for (const entry of current) {
    if (!beforeIds.has(entry.id)) {
      await deleteEntry(ctx, userId, entry.id);
    }
  }

  const restoredIds: Id<"collectionEntries">[] = [];
  for (const snapshot of before) {
    const existing = await ctx.db.get(snapshot.id);
    const value = {
      userId,
      binderId: snapshot.binderId,
      cardId: snapshot.cardId,
      quantity: snapshot.quantity,
      condition: snapshot.condition,
      language: snapshot.language,
      notes: snapshot.notes,
      price: snapshot.price,
      acquisitionPrice: snapshot.acquisitionPrice,
      serialNumber: snapshot.serialNumber,
      acquiredAt: snapshot.acquiredAt,
      isFoil: snapshot.isFoil,
      finishCode: snapshot.finishCode,
      finishLabel: snapshot.finishLabel,
      edition: snapshot.edition,
      stamp: snapshot.stamp,
      isSealedPromo: snapshot.isSealedPromo,
      isOversized: snapshot.isOversized,
      isPeelOff: snapshot.isPeelOff,
      isSigned: snapshot.isSigned,
      isAltered: snapshot.isAltered,
      gradingCompany: snapshot.gradingCompany,
      gradingScore: snapshot.gradingScore,
      certNumber: snapshot.certNumber,
      storageLocation: snapshot.storageLocation,
      imageUrls: snapshot.imageUrls,
      imageStorageIds: snapshot.imageStorageIds,
      updatedAt: Date.now()
    };
    let restoredId: Id<"collectionEntries">;
    if (existing && existing.userId === userId) {
      await ctx.db.patch(existing._id, value);
      restoredId = existing._id;
    } else {
      restoredId = await ctx.db.insert("collectionEntries", {
        ...value,
        createdAt: Date.now()
      });
    }
    await replaceTags(ctx, restoredId, userId, snapshot.tagIds);
    restoredIds.push(restoredId);
  }
  return await snapshotAuditEntries(ctx, userId, restoredIds);
}

export async function undoAuditedCollectionMutation(
  ctx: MutationCtx,
  input: {
    userId: Id<"users">;
    actorId: string;
    auditId: Id<"collectionMutationAudits">;
    idempotencyKey: string;
  }
) {
  const idempotent = await ctx.db
    .query("collectionMutationAudits")
    .withIndex("by_user_and_idempotency_key", (q) =>
      q.eq("userId", input.userId).eq("idempotencyKey", input.idempotencyKey)
    )
    .unique();
  if (idempotent) {
    if (idempotent.sourceAuditId !== input.auditId) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "This idempotency key was already used for another undo"
      });
    }
    return idempotent;
  }

  const source = await ctx.db.get(input.auditId);
  if (!source || source.userId !== input.userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Collection history entry not found"
    });
  }
  if (source.operationKind === "undo") {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Undo records cannot be undone"
    });
  }
  const previousUndo = await ctx.db
    .query("collectionMutationAudits")
    .withIndex("by_source_audit", (q) => q.eq("sourceAuditId", source._id))
    .unique();
  if (previousUndo) {
    throw new ConvexError({
      code: "CONFLICT",
      message: "This mutation has already been undone"
    });
  }

  const affectedIds = Array.from(
    new Set([
      ...source.beforeState.map((entry) => entry.id),
      ...source.afterState.map((entry) => entry.id)
    ])
  );
  const current = await snapshotAuditEntries(ctx, input.userId, affectedIds);
  if (comparable(current) !== comparable(source.afterState)) {
    throw new ConvexError({
      code: "CONFLICT",
      message: "Undo was not applied because the affected collection copies have changed"
    });
  }

  const restored = await restoreSnapshots(
    ctx,
    input.userId,
    source.beforeState,
    current
  );
  const undoId = await appendCollectionAudit(ctx, {
    userId: input.userId,
    actorId: input.actorId,
    operationKind: "undo",
    binderId: source.binderId,
    cardName: source.cardName,
    summary: `Undid: ${source.summary}`,
    before: current,
    after: restored,
    sourceAuditId: source._id,
    idempotencyKey: input.idempotencyKey
  });
  const undo = await ctx.db.get(undoId);
  if (!undo) {
    throw new ConvexError({
      code: "INVARIANT",
      message: "Undo audit record could not be created"
    });
  }
  return undo;
}
