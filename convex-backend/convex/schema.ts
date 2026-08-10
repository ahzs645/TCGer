import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { richCardMetadataFields } from "./lib/cardMetadata";
import {
  collectionEntryAuditSnapshotValidator,
  collectionMutationKindValidator
} from "./lib/auditValidators";

const binderKind = v.union(v.literal("binder"), v.literal("library"));
const tcgCode = v.union(
  v.literal("yugioh"),
  v.literal("magic"),
  v.literal("pokemon"),
  v.literal("onepiece"),
  v.literal("lorcana"),
  v.literal("dragonball")
);

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
    enabledOnepiece: v.optional(v.boolean()),
    enabledLorcana: v.optional(v.boolean()),
    enabledDragonball: v.optional(v.boolean()),
    defaultGame: v.optional(tcgCode),
    focusedSetOrder: v.optional(v.array(v.string())),
    setCompletionMode: v.optional(v.union(v.literal("standard"), v.literal("master"))),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_auth_subject", ["authSubject"])
    .index("by_is_admin", ["isAdmin"]),

  appSettings: defineTable({
    key: v.string(),
    publicDashboard: v.boolean(),
    publicCollections: v.boolean(),
    requireAuth: v.boolean(),
    appName: v.string(),
    scrydexApiKey: v.optional(v.string()),
    scrydexTeamId: v.optional(v.string()),
    scryfallApiBaseUrl: v.optional(v.string()),
    ygoApiBaseUrl: v.optional(v.string()),
    scrydexApiBaseUrl: v.optional(v.string()),
    tcgdexApiBaseUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_key", ["key"]),

  binders: defineTable({
    userId: v.id("users"),
    kind: binderKind,
    name: v.string(),
    description: v.optional(v.string()),
    colorHex: v.optional(v.string()),
    defaultCondition: v.optional(v.string()),
    containerType: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    associatedTcg: v.optional(tcgCode),
    associatedSetCode: v.optional(v.string()),
    associatedSetName: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_user", ["userId"])
    .index("by_user_kind", ["userId", "kind"])
    .index("by_user_name", ["userId", "name"])
    .index("by_share_token", ["shareToken"]),

  binderPages: defineTable({
    userId: v.id("users"),
    binderId: v.id("binders"),
    pageNumber: v.number(),
    revision: v.number(),
    capturedAt: v.number(),
    placements: v.array(v.object({
      slotIndex: v.number(),
      cardId: v.string(),
      name: v.string(),
      tcg: tcgCode,
      setCode: v.optional(v.string()),
      confidence: v.number(),
      status: v.union(v.literal("matched"), v.literal("uncertain")),
      quad: v.object({
        topLeft: v.object({ x: v.number(), y: v.number() }),
        topRight: v.object({ x: v.number(), y: v.number() }),
        bottomRight: v.object({ x: v.number(), y: v.number() }),
        bottomLeft: v.object({ x: v.number(), y: v.number() })
      })
    })),
    imageStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_binder", ["binderId"])
    .index("by_binder_and_page_number", ["binderId", "pageNumber"]),

  cardIdentities: defineTable({
    tcg: tcgCode,
    externalId: v.string(),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_tcg_external", ["tcg", "externalId"])
    .index("by_name", ["name"]),

  cards: defineTable({
    tcg: tcgCode,
    identityId: v.optional(v.id("cardIdentities")),
    externalId: v.string(),
    baseExternalId: v.optional(v.string()),
    printingKey: v.optional(v.string()),
    artworkId: v.optional(v.string()),
    name: v.string(),
    setCode: v.optional(v.string()),
    setName: v.optional(v.string()),
    rarity: v.optional(v.string()),
    collectorNumber: v.optional(v.string()),
    releasedAt: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    imageUrlSmall: v.optional(v.string()),
    ...richCardMetadataFields,
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_tcg_external", ["tcg", "externalId"])
    .index("by_external_id", ["externalId"])
    .index("by_identity", ["identityId"])
    .index("by_tcg_base_external", ["tcg", "baseExternalId"])
    .index("by_tcg_printing_key", ["tcg", "printingKey"])
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

  wishlists: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    colorHex: v.optional(v.string()),
    matchAnyPrinting: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_user", ["userId"])
    .index("by_user_name", ["userId", "name"]),

  wishlistCards: defineTable({
    wishlistId: v.id("wishlists"),
    externalId: v.string(),
    tcg: tcgCode,
    name: v.string(),
    baseExternalId: v.optional(v.string()),
    printingKey: v.optional(v.string()),
    artworkId: v.optional(v.string()),
    setCode: v.optional(v.string()),
    setName: v.optional(v.string()),
    rarity: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    imageUrlSmall: v.optional(v.string()),
    collectorNumber: v.optional(v.string()),
    releasedAt: v.optional(v.string()),
    ...richCardMetadataFields,
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_wishlist", ["wishlistId"])
    .index("by_wishlist_external_tcg", ["wishlistId", "externalId", "tcg"]),

  wishlistRules: defineTable({
    wishlistId: v.id("wishlists"),
    type: v.union(v.literal("name"), v.literal("set")),
    tcg: v.optional(tcgCode),
    query: v.optional(v.string()),
    setCode: v.optional(v.string()),
    setName: v.optional(v.string()),
    includeAllPrintings: v.boolean(),
    autoSync: v.boolean(),
    lastSyncedAt: v.optional(v.number()),
    lastMatchCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_wishlist", ["wishlistId"]),

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
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_user", ["userId"])
    .index("by_binder", ["binderId"])
    .index("by_binder_and_card", ["binderId", "cardId"])
    .index("by_user_card", ["userId", "cardId"]),

  collectionEntryTags: defineTable({
    entryId: v.id("collectionEntries"),
    tagId: v.id("tags"),
    assignedAt: v.number()
  })
    .index("by_entry", ["entryId"])
    .index("by_tag", ["tagId"])
    .index("by_entry_tag", ["entryId", "tagId"]),

  collectionMutationAudits: defineTable({
    userId: v.id("users"),
    actorId: v.string(),
    operationKind: collectionMutationKindValidator,
    binderId: v.optional(v.id("binders")),
    cardName: v.optional(v.string()),
    affectedCopies: v.number(),
    summary: v.string(),
    beforeState: v.array(collectionEntryAuditSnapshotValidator),
    afterState: v.array(collectionEntryAuditSnapshotValidator),
    sourceAuditId: v.optional(v.id("collectionMutationAudits")),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number()
  })
    .index("by_user", ["userId"])
    .index("by_user_and_operation_kind", ["userId", "operationKind"])
    .index("by_source_audit", ["sourceAuditId"])
    .index("by_user_and_idempotency_key", ["userId", "idempotencyKey"]),

  // Decks (convex-native)
  decks: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    tcg: tcgCode,
    format: v.optional(v.string()),
    colorHex: v.optional(v.string()),
    isPublic: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_user", ["userId"])
    .index("by_user_and_name", ["userId", "name"]),

  deckCards: defineTable({
    deckId: v.id("decks"),
    externalId: v.string(),
    tcg: v.string(),
    name: v.string(),
    quantity: v.number(),
    zone: v.union(v.literal("main"), v.literal("extra"), v.literal("side")),
    isCommander: v.boolean(),
    isSideboard: v.boolean(),
    imageUrl: v.optional(v.string()),
    imageUrlSmall: v.optional(v.string()),
    setCode: v.optional(v.string()),
    setName: v.optional(v.string()),
    cardData: v.optional(v.record(v.string(), v.any()))
  })
    .index("by_deck", ["deckId"])
    .index("by_deck_and_external_id_and_zone", ["deckId", "externalId", "zone"]),

  // Finance + Sealed (convex-native)
  transactions: defineTable({
    userId: v.id("users"),
    type: v.union(v.literal("purchase"), v.literal("sale"), v.literal("trade")),
    cardId: v.optional(v.string()),
    externalId: v.optional(v.string()),
    tcg: v.optional(v.string()),
    cardName: v.optional(v.string()),
    quantity: v.number(),
    amount: v.number(),
    currency: v.string(),
    platform: v.optional(v.string()),
    notes: v.optional(v.string()),
    date: v.number(),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_user_and_date", ["userId", "date"]),

  financeSummaries: defineTable({
    userId: v.id("users"),
    totalSpent: v.number(),
    totalEarned: v.number(),
    transactionCount: v.number(),
    updatedAt: v.number()
  }).index("by_user", ["userId"]),

  sealedProducts: defineTable({
    catalogKey: v.string(),
    tcg: v.string(),
    name: v.string(),
    productType: v.string(),
    setCode: v.optional(v.string()),
    cardsPerPack: v.optional(v.number()),
    packsPerBox: v.optional(v.number()),
    releaseDate: v.optional(v.number()),
    imageUrl: v.optional(v.string()),
    msrp: v.optional(v.number()),
    upc: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_catalog_key", ["catalogKey"])
    .index("by_release_date", ["releaseDate"])
    .index("by_tcg_and_release_date", ["tcg", "releaseDate"]),

  sealedInventory: defineTable({
    userId: v.id("users"),
    productId: v.id("sealedProducts"),
    quantity: v.number(),
    purchasePrice: v.optional(v.number()),
    purchaseDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_user", ["userId"])
    .index("by_product", ["productId"]),

  sealedOpenings: defineTable({
    userId: v.id("users"),
    sealedInventoryId: v.id("sealedInventory"),
    openedQuantity: v.number(),
    openedAt: v.number(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_user_and_opened_at", ["userId", "openedAt"])
    .index("by_sealed_inventory", ["sealedInventoryId"]),

  sealedOpenedCards: defineTable({
    userId: v.id("users"),
    openingId: v.id("sealedOpenings"),
    collectionId: v.optional(v.id("collectionEntries")),
    externalId: v.string(),
    tcg: v.string(),
    cardName: v.string(),
    quantity: v.number(),
    status: v.union(v.literal("active"), v.literal("sold")),
    realizedProceeds: v.optional(v.number()),
    soldAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_user", ["userId"])
    .index("by_opening", ["openingId"])
    .index("by_collection", ["collectionId"]),

  // Analytics + Trades (convex-native)
  trades: defineTable({
    senderId: v.id("users"),
    receiverId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("cancelled")
    ),
    message: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_sender", ["senderId"])
    .index("by_receiver", ["receiverId"]),

  tradeCards: defineTable({
    tradeId: v.id("trades"),
    side: v.union(v.literal("sender"), v.literal("receiver")),
    externalId: v.string(),
    tcg: tcgCode,
    name: v.string(),
    quantity: v.number(),
    imageUrl: v.optional(v.string()),
    estimatedValue: v.optional(v.number())
  }).index("by_trade", ["tradeId"]),

  // Analytics history (convex-native)
  // `day` is the UTC calendar day formatted as YYYY-MM-DD.
  collectionValueSnapshots: defineTable({
    userId: v.id("users"),
    day: v.string(),
    capturedAt: v.number(),
    totalValue: v.number(),
    byTcg: v.record(v.string(), v.number())
  }).index("by_user_and_day", ["userId", "day"])
});
