import { v } from "convex/values";

export const tcgCodeValidator = v.union(
  v.literal("yugioh"),
  v.literal("magic"),
  v.literal("pokemon")
);

export const binderKindValidator = v.union(
  v.literal("binder"),
  v.literal("library")
);

export const tagInputValidator = v.object({
  label: v.string(),
  colorHex: v.string()
});

export const cardSnapshotValidator = v.object({
  tcg: tcgCodeValidator,
  externalId: v.string(),
  name: v.string(),
  setCode: v.optional(v.string()),
  setName: v.optional(v.string()),
  rarity: v.optional(v.string()),
  collectorNumber: v.optional(v.string()),
  releasedAt: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  imageUrlSmall: v.optional(v.string())
});

export const cardSummaryValidator = v.object({
  id: v.id("cards"),
  tcg: tcgCodeValidator,
  externalId: v.string(),
  name: v.string(),
  setCode: v.optional(v.string()),
  setName: v.optional(v.string()),
  rarity: v.optional(v.string()),
  collectorNumber: v.optional(v.string()),
  releasedAt: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  imageUrlSmall: v.optional(v.string())
});

export const tagSummaryValidator = v.object({
  id: v.id("tags"),
  label: v.string(),
  colorHex: v.string(),
  createdAt: v.string(),
  updatedAt: v.string()
});

export const entryValidator = v.object({
  id: v.id("collectionEntries"),
  userId: v.id("users"),
  binderId: v.id("binders"),
  cardId: v.id("cards"),
  card: cardSummaryValidator,
  quantity: v.number(),
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
  imageUrls: v.optional(v.array(v.string())),
  tags: v.array(tagSummaryValidator),
  createdAt: v.string(),
  updatedAt: v.string()
});

export const binderSummaryValidator = v.object({
  id: v.id("binders"),
  userId: v.id("users"),
  kind: binderKindValidator,
  name: v.string(),
  description: v.optional(v.string()),
  colorHex: v.optional(v.string()),
  entryCount: v.number(),
  createdAt: v.string(),
  updatedAt: v.string()
});

export const binderDetailValidator = v.object({
  id: v.id("binders"),
  userId: v.id("users"),
  kind: binderKindValidator,
  name: v.string(),
  description: v.optional(v.string()),
  colorHex: v.optional(v.string()),
  entryCount: v.number(),
  entries: v.array(entryValidator),
  createdAt: v.string(),
  updatedAt: v.string()
});

export const viewerValidator = v.object({
  id: v.id("users"),
  authSubject: v.string(),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  username: v.optional(v.string()),
  isAdmin: v.boolean(),
  showCardNumbers: v.boolean(),
  showPricing: v.boolean(),
  enabledYugioh: v.boolean(),
  enabledMagic: v.boolean(),
  enabledPokemon: v.boolean(),
  defaultGame: v.optional(tcgCodeValidator),
  libraryBinderId: v.id("binders"),
  createdAt: v.string(),
  updatedAt: v.string()
});
