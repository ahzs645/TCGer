import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const binderKind = v.union(v.literal("binder"), v.literal("library"));
const tcgCode = v.union(v.literal("yugioh"), v.literal("magic"), v.literal("pokemon"));

export default defineSchema({
  users: defineTable({
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
    defaultGame: v.optional(tcgCode),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_auth_subject", ["authSubject"]),

  binders: defineTable({
    userId: v.id("users"),
    kind: binderKind,
    name: v.string(),
    description: v.optional(v.string()),
    colorHex: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_user", ["userId"])
    .index("by_user_kind", ["userId", "kind"])
    .index("by_user_name", ["userId", "name"]),

  cards: defineTable({
    tcg: tcgCode,
    externalId: v.string(),
    name: v.string(),
    setCode: v.optional(v.string()),
    setName: v.optional(v.string()),
    rarity: v.optional(v.string()),
    collectorNumber: v.optional(v.string()),
    releasedAt: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    imageUrlSmall: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_tcg_external", ["tcg", "externalId"])
    .index("by_name", ["name"]),

  tags: defineTable({
    userId: v.id("users"),
    label: v.string(),
    colorHex: v.string(),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_user", ["userId"])
    .index("by_user_label", ["userId", "label"]),

  collectionEntries: defineTable({
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
    isSigned: v.optional(v.boolean()),
    isAltered: v.optional(v.boolean()),
    imageUrls: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_user", ["userId"])
    .index("by_binder", ["binderId"])
    .index("by_user_card", ["userId", "cardId"]),

  collectionEntryTags: defineTable({
    entryId: v.id("collectionEntries"),
    tagId: v.id("tags"),
    assignedAt: v.number()
  })
    .index("by_entry", ["entryId"])
    .index("by_tag", ["tagId"])
    .index("by_entry_tag", ["entryId", "tagId"])
});
