import { v } from "convex/values";

export const collectionMutationKindValidator = v.union(
  v.literal("add"),
  v.literal("update"),
  v.literal("remove"),
  v.literal("move"),
  v.literal("bulk"),
  v.literal("import"),
  v.literal("undo")
);

export const collectionEntryAuditSnapshotValidator = v.object({
  id: v.id("collectionEntries"),
  userId: v.id("users"),
  binderId: v.id("binders"),
  cardId: v.id("cards"),
  quantity: v.number(),
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
  imageUrls: v.optional(v.array(v.string())),
  imageStorageIds: v.optional(v.array(v.id("_storage"))),
  tagIds: v.array(v.id("tags"))
});

export const collectionMutationAuditEntryValidator = v.object({
  id: v.id("collectionMutationAudits"),
  operationKind: collectionMutationKindValidator,
  actorId: v.string(),
  affectedCopies: v.number(),
  binderId: v.optional(v.id("binders")),
  cardName: v.optional(v.string()),
  summary: v.string(),
  sourceAuditId: v.optional(v.id("collectionMutationAudits")),
  canUndo: v.boolean(),
  createdAt: v.string()
});
