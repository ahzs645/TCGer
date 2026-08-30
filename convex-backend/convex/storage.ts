import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { reconcileStorageAudit, type AuditCandidate } from "./lib/storageAudit";

type ReaderCtx = QueryCtx | MutationCtx;

const kindValidator = v.union(
  v.literal("binder"),
  v.literal("box"),
  v.literal("case"),
  v.literal("other"),
);
const placementValidator = v.object({
  id: v.id("storagePlacements"),
  collectionEntryId: v.id("collectionEntries"),
  slotIndex: v.number(),
  quantity: v.number(),
  stackKey: v.optional(v.string()),
});
const compartmentValidator = v.object({
  id: v.id("storageCompartments"),
  label: v.string(),
  order: v.number(),
  pageNumber: v.optional(v.number()),
  rows: v.number(),
  columns: v.number(),
  capacity: v.number(),
  locked: v.boolean(),
  placements: v.array(placementValidator),
});
const containerValidator = v.object({
  id: v.id("storageContainers"),
  binderId: v.optional(v.id("binders")),
  name: v.string(),
  kind: kindValidator,
  order: v.number(),
  isUnsorted: v.boolean(),
  locked: v.boolean(),
  compartments: v.array(compartmentValidator),
});
const auditSourceValidator = v.union(v.literal("manual"), v.literal("latest-binder-scan"), v.literal("import"));
const auditObservationValidator = v.object({
  compartmentId: v.id("storageCompartments"),
  slotIndex: v.number(),
  collectionEntryId: v.optional(v.id("collectionEntries")),
  externalId: v.optional(v.string()),
  tcg: v.optional(v.string()),
  name: v.optional(v.string()),
  quantity: v.optional(v.number()),
});
const auditItemValidator = v.object({
  compartmentId: v.id("storageCompartments"), compartmentLabel: v.string(), slotIndex: v.number(),
  status: v.union(v.literal("correct"), v.literal("missing"), v.literal("wrong"), v.literal("extra")),
  expectedCollectionEntryId: v.optional(v.id("collectionEntries")), expectedExternalId: v.optional(v.string()), expectedName: v.optional(v.string()),
  observedCollectionEntryId: v.optional(v.id("collectionEntries")), observedExternalId: v.optional(v.string()), observedName: v.optional(v.string()),
  expectedQuantity: v.number(), observedQuantity: v.number(),
});
const auditPreviewValidator = v.object({
  valid: v.boolean(), source: auditSourceValidator, containerId: v.id("storageContainers"), containerName: v.string(),
  capturedAt: v.string(), scanRevision: v.optional(v.number()),
  summary: v.object({ correct: v.number(), missing: v.number(), wrong: v.number(), extra: v.number() }),
  items: v.array(auditItemValidator), issues: v.array(v.string()),
});
const auditResponseValidator = v.object({
  id: v.id("storageAudits"), status: v.literal("reviewed"), createdAt: v.string(),
  valid: v.boolean(), source: auditSourceValidator, containerId: v.id("storageContainers"), containerName: v.string(),
  capturedAt: v.string(), scanRevision: v.optional(v.number()),
  summary: v.object({ correct: v.number(), missing: v.number(), wrong: v.number(), extra: v.number() }),
  items: v.array(auditItemValidator), issues: v.array(v.string()),
});

async function viewer(ctx: ReaderCtx, subject: string) {
  const user = await ctx.db.query("users").withIndex("by_auth_subject", q => q.eq("authSubject", subject)).unique();
  if (!user) throw new ConvexError({ code: "UNAUTHORIZED", message: "Viewer not provisioned" });
  return user;
}

async function ownedContainer(ctx: ReaderCtx, id: Id<"storageContainers">, userId: Id<"users">) {
  const row = await ctx.db.get(id);
  if (!row || row.userId !== userId) throw new ConvexError({ code: "NOT_FOUND", message: "Storage container not found" });
  return row;
}

async function ownedCompartment(ctx: ReaderCtx, id: Id<"storageCompartments">, userId: Id<"users">) {
  const row = await ctx.db.get(id);
  if (!row || row.userId !== userId) throw new ConvexError({ code: "NOT_FOUND", message: "Storage compartment not found" });
  return row;
}

async function hydrate(ctx: ReaderCtx, container: Doc<"storageContainers">) {
  const compartments = await ctx.db.query("storageCompartments")
    .withIndex("by_container_and_order", q => q.eq("containerId", container._id)).take(1000);
  return {
    id: container._id, binderId: container.binderId, name: container.name, kind: container.kind,
    order: container.order, isUnsorted: container.isUnsorted, locked: container.locked,
    compartments: await Promise.all(compartments.map(async compartment => ({
      id: compartment._id, label: compartment.label, order: compartment.order,
      pageNumber: compartment.pageNumber, rows: compartment.rows, columns: compartment.columns,
      capacity: compartment.capacity, locked: compartment.locked,
      placements: (await ctx.db.query("storagePlacements")
        .withIndex("by_compartment_and_slot", q => q.eq("compartmentId", compartment._id)).take(1000))
        .map(row => ({ id: row._id, collectionEntryId: row.collectionEntryId, slotIndex: row.slotIndex, quantity: row.quantity, stackKey: row.stackKey })),
    }))),
  };
}

export const list = internalQuery({
  args: { subject: v.string() }, returns: v.array(containerValidator),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const rows = await ctx.db.query("storageContainers").withIndex("by_user_and_order", q => q.eq("userId", user._id)).take(1000);
    return await Promise.all(rows.map(row => hydrate(ctx, row)));
  },
});

export const createContainer = internalMutation({
  args: { subject: v.string(), name: v.string(), kind: kindValidator, binderId: v.optional(v.id("binders")), order: v.optional(v.number()), isUnsorted: v.optional(v.boolean()), locked: v.optional(v.boolean()) },
  returns: containerValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const name = args.name.trim();
    if (!name) throw new ConvexError({ code: "BAD_REQUEST", message: "name is required" });
    if (args.binderId) {
      const binder = await ctx.db.get(args.binderId);
      if (!binder || binder.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Binder not found" });
    }
    if (args.isUnsorted) {
      const prior = await ctx.db.query("storageContainers").withIndex("by_user_and_unsorted", q => q.eq("userId", user._id).eq("isUnsorted", true)).unique();
      if (prior) throw new ConvexError({ code: "CONFLICT", message: "An Unsorted container already exists" });
    }
    const now = Date.now();
    const id = await ctx.db.insert("storageContainers", { userId: user._id, binderId: args.binderId, name, kind: args.kind, order: args.order ?? now, isUnsorted: args.isUnsorted ?? false, locked: args.locked ?? false, createdAt: now, updatedAt: now });
    return await hydrate(ctx, (await ctx.db.get(id))!);
  },
});

export const createCompartment = internalMutation({
  args: { subject: v.string(), containerId: v.id("storageContainers"), label: v.string(), order: v.number(), pageNumber: v.optional(v.number()), rows: v.number(), columns: v.number(), capacity: v.number(), locked: v.optional(v.boolean()) },
  returns: compartmentValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const container = await ownedContainer(ctx, args.containerId, user._id);
    if (container.locked) throw new ConvexError({ code: "CONFLICT", message: "Container is locked" });
    for (const [field, value] of [["rows", args.rows], ["columns", args.columns], ["capacity", args.capacity]] as const) {
      if (!Number.isInteger(value) || value < 1) throw new ConvexError({ code: "BAD_REQUEST", message: `${field} must be a positive integer` });
    }
    if (args.capacity > args.rows * args.columns) throw new ConvexError({ code: "BAD_REQUEST", message: "capacity cannot exceed rows × columns" });
    if (args.pageNumber !== undefined) {
      const duplicate = await ctx.db.query("storageCompartments").withIndex("by_container_and_page", q => q.eq("containerId", container._id).eq("pageNumber", args.pageNumber)).unique();
      if (duplicate) throw new ConvexError({ code: "CONFLICT", message: "Page number already exists" });
    }
    const now = Date.now();
    const id = await ctx.db.insert("storageCompartments", { userId: user._id, containerId: container._id, label: args.label.trim(), order: args.order, pageNumber: args.pageNumber, rows: args.rows, columns: args.columns, capacity: args.capacity, locked: args.locked ?? false, createdAt: now, updatedAt: now });
    return { id, label: args.label.trim(), order: args.order, pageNumber: args.pageNumber, rows: args.rows, columns: args.columns, capacity: args.capacity, locked: args.locked ?? false, placements: [] };
  },
});

export const updateContainer = internalMutation({
  args: { subject: v.string(), containerId: v.id("storageContainers"), name: v.optional(v.string()), order: v.optional(v.number()), locked: v.optional(v.boolean()) },
  returns: containerValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const container = await ownedContainer(ctx, args.containerId, user._id);
    const name = args.name?.trim();
    if (args.name !== undefined && !name) throw new ConvexError({ code: "BAD_REQUEST", message: "name is required" });
    await ctx.db.patch(container._id, { name: name ?? container.name, order: args.order ?? container.order, locked: args.locked ?? container.locked, updatedAt: Date.now() });
    return await hydrate(ctx, (await ctx.db.get(container._id))!);
  },
});

export const updateCompartment = internalMutation({
  args: { subject: v.string(), compartmentId: v.id("storageCompartments"), label: v.optional(v.string()), order: v.optional(v.number()), pageNumber: v.optional(v.number()), locked: v.optional(v.boolean()) },
  returns: compartmentValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const compartment = await ownedCompartment(ctx, args.compartmentId, user._id);
    const container = await ownedContainer(ctx, compartment.containerId, user._id);
    if (container.locked) throw new ConvexError({ code: "CONFLICT", message: "Container is locked" });
    const label = args.label?.trim();
    if (args.label !== undefined && !label) throw new ConvexError({ code: "BAD_REQUEST", message: "label is required" });
    if (args.pageNumber !== undefined && args.pageNumber !== compartment.pageNumber) {
      const duplicate = await ctx.db.query("storageCompartments").withIndex("by_container_and_page", q => q.eq("containerId", container._id).eq("pageNumber", args.pageNumber)).unique();
      if (duplicate) throw new ConvexError({ code: "CONFLICT", message: "Page number already exists" });
    }
    await ctx.db.patch(compartment._id, { label: label ?? compartment.label, order: args.order ?? compartment.order, pageNumber: args.pageNumber ?? compartment.pageNumber, locked: args.locked ?? compartment.locked, updatedAt: Date.now() });
    const placements = await ctx.db.query("storagePlacements").withIndex("by_compartment_and_slot", q => q.eq("compartmentId", compartment._id)).take(1000);
    const updated = (await ctx.db.get(compartment._id))!;
    return { id: updated._id, label: updated.label, order: updated.order, pageNumber: updated.pageNumber, rows: updated.rows, columns: updated.columns, capacity: updated.capacity, locked: updated.locked, placements: placements.map(row => ({ id: row._id, collectionEntryId: row.collectionEntryId, slotIndex: row.slotIndex, quantity: row.quantity, stackKey: row.stackKey })) };
  },
});

export const place = internalMutation({
  args: { subject: v.string(), compartmentId: v.id("storageCompartments"), collectionEntryId: v.id("collectionEntries"), slotIndex: v.number(), quantity: v.number(), allowDuplicateStacking: v.optional(v.boolean()) },
  returns: placementValidator,
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const compartment = await ownedCompartment(ctx, args.compartmentId, user._id);
    const container = await ownedContainer(ctx, compartment.containerId, user._id);
    const entry = await ctx.db.get(args.collectionEntryId);
    if (!entry || entry.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Collection entry not found" });
    if (container.locked || compartment.locked) throw new ConvexError({ code: "CONFLICT", message: "Storage location is locked" });
    if (!Number.isInteger(args.slotIndex) || args.slotIndex < 0 || args.slotIndex >= compartment.capacity) throw new ConvexError({ code: "BAD_REQUEST", message: "slotIndex is outside the compartment capacity" });
    if (!Number.isInteger(args.quantity) || args.quantity < 1) throw new ConvexError({ code: "BAD_REQUEST", message: "quantity must be a positive integer" });
    const alreadyPlaced = await ctx.db.query("storagePlacements").withIndex("by_user_and_entry", q => q.eq("userId", user._id).eq("collectionEntryId", entry._id)).take(1000);
    if (alreadyPlaced.reduce((sum, row) => sum + row.quantity, 0) + args.quantity > entry.quantity) throw new ConvexError({ code: "CONFLICT", message: "Placement exceeds the owned quantity" });
    const occupants = await ctx.db.query("storagePlacements").withIndex("by_compartment_and_slot", q => q.eq("compartmentId", compartment._id).eq("slotIndex", args.slotIndex)).take(100);
    const card = await ctx.db.get(entry.cardId);
    const stackKey = card ? `${card.tcg}:${card.printingKey ?? card.externalId}` : undefined;
    if (occupants.length && (!args.allowDuplicateStacking || occupants.some(row => row.stackKey !== stackKey))) throw new ConvexError({ code: "CONFLICT", message: "Slot is occupied by a different printing" });
    const now = Date.now();
    const id = await ctx.db.insert("storagePlacements", { userId: user._id, containerId: container._id, compartmentId: compartment._id, collectionEntryId: entry._id, slotIndex: args.slotIndex, quantity: args.quantity, stackKey, createdAt: now, updatedAt: now });
    return { id, collectionEntryId: entry._id, slotIndex: args.slotIndex, quantity: args.quantity, stackKey };
  },
});

export const removePlacement = internalMutation({
  args: { subject: v.string(), placementId: v.id("storagePlacements") }, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    const placement = await ctx.db.get(args.placementId);
    if (!placement || placement.userId !== user._id) throw new ConvexError({ code: "NOT_FOUND", message: "Placement not found" });
    const compartment = await ownedCompartment(ctx, placement.compartmentId, user._id);
    const container = await ownedContainer(ctx, placement.containerId, user._id);
    if (container.locked || compartment.locked) throw new ConvexError({ code: "CONFLICT", message: "Storage location is locked" });
    await ctx.db.delete(placement._id);
    return null;
  },
});

async function buildAudit(
  ctx: ReaderCtx,
  args: {
    subject: string;
    containerId: Id<"storageContainers">;
    compartmentId?: Id<"storageCompartments">;
    source: "manual" | "latest-binder-scan" | "import";
    observations?: Array<{ compartmentId: Id<"storageCompartments">; slotIndex: number; collectionEntryId?: Id<"collectionEntries">; externalId?: string; tcg?: string; name?: string; quantity?: number }>;
  },
) {
  const user = await viewer(ctx, args.subject);
  const container = await ownedContainer(ctx, args.containerId, user._id);
  const compartments = args.compartmentId
    ? [await ownedCompartment(ctx, args.compartmentId, user._id)]
    : await ctx.db.query("storageCompartments").withIndex("by_container_and_order", q => q.eq("containerId", container._id)).take(1000);
  if (compartments.some((row) => row.containerId !== container._id)) {
    throw new ConvexError({ code: "BAD_REQUEST", message: "Compartment does not belong to this container" });
  }
  const compartmentById = new Map(compartments.map((row) => [String(row._id), row]));
  const expected: AuditCandidate[] = [];
  for (const compartment of compartments) {
    const placements = await ctx.db.query("storagePlacements").withIndex("by_compartment_and_slot", q => q.eq("compartmentId", compartment._id)).take(1000);
    for (const placement of placements) {
      const entry = await ctx.db.get(placement.collectionEntryId);
      const card = entry ? await ctx.db.get(entry.cardId) : null;
      expected.push({ compartmentId: String(compartment._id), compartmentLabel: compartment.label, slotIndex: placement.slotIndex, collectionEntryId: String(placement.collectionEntryId), tcg: card?.tcg, externalId: card?.externalId, name: card?.name, quantity: placement.quantity });
    }
  }
  const issues: string[] = [];
  let scanRevision: number | undefined;
  let rawObserved = args.observations ?? [];
  if (args.source === "latest-binder-scan") {
    if (!container.binderId) issues.push("This storage container is not linked to a binder scan.");
    const pages = [];
    if (container.binderId) {
      for (const compartment of compartments) {
        if (compartment.pageNumber === undefined) {
          issues.push(`${compartment.label} has no binder page number.`);
          continue;
        }
        const page = await ctx.db.query("binderPages").withIndex("by_binder_and_page_number", q => q.eq("binderId", container.binderId!).eq("pageNumber", compartment.pageNumber!)).unique();
        if (!page) {
          issues.push(`No saved scan exists for ${compartment.label}.`);
          continue;
        }
        pages.push({ compartment, page });
        scanRevision = Math.max(scanRevision ?? 0, page.revision);
      }
    }
    rawObserved = pages.flatMap(({ compartment, page }) => page.placements.flatMap((placement) => {
      if (placement.status === "uncertain") {
        issues.push(`${compartment.label} slot ${placement.slotIndex + 1} has an uncertain scan match.`);
        return [];
      }
      return [{ compartmentId: compartment._id, slotIndex: placement.slotIndex, tcg: placement.tcg, externalId: placement.cardId, name: placement.name, quantity: 1 }];
    }));
  }
  const observed: AuditCandidate[] = [];
  if (rawObserved.length > 2_000) {
    throw new ConvexError({ code: "BAD_REQUEST", message: "Physical audits support at most 2,000 observations" });
  }
  for (const row of rawObserved) {
    const compartment = compartmentById.get(String(row.compartmentId));
    if (!compartment) {
      issues.push(`Observation references a compartment outside ${container.name}.`);
      continue;
    }
    if (!Number.isInteger(row.slotIndex) || row.slotIndex < 0 || row.slotIndex >= compartment.capacity) {
      issues.push(`Slot ${row.slotIndex + 1} is outside ${compartment.label}.`);
      continue;
    }
    let externalId = row.externalId;
    let tcg = row.tcg;
    let name = row.name;
    if (row.collectionEntryId) {
      const entry = await ctx.db.get(row.collectionEntryId);
      if (!entry || entry.userId !== user._id) {
        issues.push(`Observation at ${compartment.label} slot ${row.slotIndex + 1} is not an owned copy.`);
        continue;
      }
      const card = await ctx.db.get(entry.cardId);
      externalId = card?.externalId;
      tcg = card?.tcg;
      name = card?.name;
    }
    if (!externalId && !row.collectionEntryId) {
      issues.push(`Observation at ${compartment.label} slot ${row.slotIndex + 1} needs a card identity.`);
      continue;
    }
    if (!tcg) {
      issues.push(`Observation at ${compartment.label} slot ${row.slotIndex + 1} needs a game identity.`);
      continue;
    }
    const quantity = row.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      issues.push(`Observation at ${compartment.label} slot ${row.slotIndex + 1} needs a positive whole-number quantity.`);
      continue;
    }
    observed.push({ compartmentId: String(compartment._id), compartmentLabel: compartment.label, slotIndex: row.slotIndex, collectionEntryId: row.collectionEntryId ? String(row.collectionEntryId) : undefined, tcg, externalId, name, quantity });
  }
  const result = reconcileStorageAudit(expected, observed);
  return {
    valid: issues.length === 0, source: args.source, containerId: container._id, containerName: container.name,
    capturedAt: new Date().toISOString(), scanRevision, summary: result.summary,
    items: result.items.map((item) => ({ ...item, compartmentId: item.compartmentId as Id<"storageCompartments">, expectedCollectionEntryId: item.expectedCollectionEntryId as Id<"collectionEntries"> | undefined, observedCollectionEntryId: item.observedCollectionEntryId as Id<"collectionEntries"> | undefined })),
    issues,
  };
}

export const previewAudit = internalQuery({
  args: { subject: v.string(), containerId: v.id("storageContainers"), compartmentId: v.optional(v.id("storageCompartments")), source: auditSourceValidator, observations: v.optional(v.array(auditObservationValidator)) },
  returns: auditPreviewValidator,
  handler: buildAudit,
});

export const commitAudit = internalMutation({
  args: { subject: v.string(), containerId: v.id("storageContainers"), compartmentId: v.optional(v.id("storageCompartments")), source: auditSourceValidator, observations: v.optional(v.array(auditObservationValidator)) },
  returns: auditResponseValidator,
  handler: async (ctx, args) => {
    const preview = await buildAudit(ctx, args);
    if (!preview.valid) throw new ConvexError({ code: "BAD_REQUEST", message: preview.issues.join(" ") });
    const user = await viewer(ctx, args.subject);
    const now = Date.now();
    const id = await ctx.db.insert("storageAudits", {
      userId: user._id, containerId: args.containerId, compartmentId: args.compartmentId, source: args.source,
      status: "reviewed", capturedAt: Date.parse(preview.capturedAt), scanRevision: preview.scanRevision,
      correctCount: preview.summary.correct, missingCount: preview.summary.missing, wrongCount: preview.summary.wrong, extraCount: preview.summary.extra,
      createdAt: now, updatedAt: now,
    });
    for (const item of preview.items) {
      await ctx.db.insert("storageAuditItems", {
        auditId: id, compartmentId: item.compartmentId, slotIndex: item.slotIndex, status: item.status,
        expectedCollectionEntryId: item.expectedCollectionEntryId, expectedExternalId: item.expectedExternalId, expectedName: item.expectedName,
        observedCollectionEntryId: item.observedCollectionEntryId, observedExternalId: item.observedExternalId, observedName: item.observedName,
        expectedQuantity: item.expectedQuantity, observedQuantity: item.observedQuantity,
      });
    }
    return { ...preview, id, status: "reviewed" as const, createdAt: new Date(now).toISOString() };
  },
});
