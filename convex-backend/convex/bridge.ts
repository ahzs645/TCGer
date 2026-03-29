import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx
} from "./_generated/server";
import { buildViewerResponse } from "./lib/auth";
import {
  getLibraryBinder,
  now,
  requireBinderForUser,
  requireEntryForUser,
  toIso,
  validateColorHex
} from "./lib/domain";
import {
  addEntryForViewer,
  hydrateBinderDetail,
  hydrateEntry,
  removeEntryForViewer,
  replaceEntryTags,
  upsertCard
} from "./lib/library";
import {
  adminAppSettingsValidator,
  appSettingsValidator,
  binderDetailValidator,
  entryValidator,
  tagSummaryValidator,
  userPreferencesValidator,
  userProfileValidator,
  viewerValidator,
  wishlistCardValidator,
  wishlistValidator
} from "./lib/validators";

type ReaderCtx = QueryCtx | MutationCtx;

type BridgeIdentity = {
  subject: string;
  email?: string;
  name?: string;
  username?: string;
};

type CardSnapshot = {
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

const cardSnapshotInput = v.object({
  name: v.string(),
  tcg: v.union(v.literal("yugioh"), v.literal("magic"), v.literal("pokemon")),
  externalId: v.string(),
  setCode: v.optional(v.string()),
  setName: v.optional(v.string()),
  rarity: v.optional(v.string()),
  collectorNumber: v.optional(v.string()),
  releasedAt: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  imageUrlSmall: v.optional(v.string())
});

const nullableString = v.union(v.string(), v.null());
const nullableTcgCode = v.union(
  v.literal("yugioh"),
  v.literal("magic"),
  v.literal("pokemon"),
  v.null()
);

const imageMutationValidator = v.object({
  imageUrls: v.array(v.string()),
  removedUrl: v.optional(v.string()),
  removedStorageId: v.optional(v.id("_storage"))
});

const settingsKey = "singleton";
const betterAuthAdapterApi = components.betterAuth.adapter;

const settingsUpdateInput = v.object({
  publicDashboard: v.optional(v.boolean()),
  publicCollections: v.optional(v.boolean()),
  requireAuth: v.optional(v.boolean()),
  appName: v.optional(v.string()),
  scrydexApiKey: v.optional(nullableString),
  scrydexTeamId: v.optional(nullableString),
  scryfallApiBaseUrl: v.optional(nullableString),
  ygoApiBaseUrl: v.optional(nullableString),
  scrydexApiBaseUrl: v.optional(nullableString),
  tcgdexApiBaseUrl: v.optional(nullableString)
});

const wishlistCardInput = v.object({
  externalId: v.string(),
  tcg: v.union(v.literal("yugioh"), v.literal("magic"), v.literal("pokemon")),
  name: v.string(),
  setCode: v.optional(v.string()),
  setName: v.optional(v.string()),
  rarity: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  imageUrlSmall: v.optional(v.string()),
  setSymbolUrl: v.optional(v.string()),
  setLogoUrl: v.optional(v.string()),
  collectorNumber: v.optional(v.string()),
  notes: v.optional(v.string())
});

type AuthUserDoc = {
  _id: string;
  email: string;
  name: string;
  username?: string | null;
  isAdmin?: boolean | null;
  showCardNumbers?: boolean | null;
  showPricing?: boolean | null;
  enabledYugioh?: boolean | null;
  enabledMagic?: boolean | null;
  enabledPokemon?: boolean | null;
  defaultGame?: string | null;
  createdAt: number;
  updatedAt: number;
};

function conflict(message: string) {
  return new ConvexError({
    code: "CONFLICT",
    message
  });
}

function toUserProfile(viewer: Doc<"users">) {
  return {
    id: viewer.authSubject,
    email: viewer.email ?? "",
    username: viewer.username ?? null,
    isAdmin: viewer.isAdmin,
    showCardNumbers: viewer.showCardNumbers,
    showPricing: viewer.showPricing,
    createdAt: toIso(viewer.createdAt)
  };
}

function toUserPreferences(viewer: Doc<"users">) {
  return {
    showCardNumbers: viewer.showCardNumbers,
    showPricing: viewer.showPricing,
    enabledYugioh: viewer.enabledYugioh,
    enabledMagic: viewer.enabledMagic,
    enabledPokemon: viewer.enabledPokemon,
    defaultGame: viewer.defaultGame ?? null
  };
}

function toAdminAppSettings(settings: Doc<"appSettings">) {
  return {
    id: 1,
    publicDashboard: settings.publicDashboard,
    publicCollections: settings.publicCollections,
    requireAuth: settings.requireAuth,
    appName: settings.appName,
    scrydexApiKey: settings.scrydexApiKey ?? null,
    scrydexTeamId: settings.scrydexTeamId ?? null,
    scryfallApiBaseUrl: settings.scryfallApiBaseUrl ?? null,
    ygoApiBaseUrl: settings.ygoApiBaseUrl ?? null,
    scrydexApiBaseUrl: settings.scrydexApiBaseUrl ?? null,
    tcgdexApiBaseUrl: settings.tcgdexApiBaseUrl ?? null,
    updatedAt: toIso(settings.updatedAt)
  };
}

function toPublicAppSettings(settings: Doc<"appSettings">) {
  return {
    id: 1,
    publicDashboard: settings.publicDashboard,
    publicCollections: settings.publicCollections,
    requireAuth: settings.requireAuth,
    appName: settings.appName,
    updatedAt: toIso(settings.updatedAt)
  };
}

async function requireWishlistForUser(
  ctx: ReaderCtx,
  wishlistId: Id<"wishlists">,
  userId: Id<"users">
): Promise<Doc<"wishlists">> {
  const wishlist = await ctx.db.get(wishlistId);
  if (!wishlist || wishlist.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Wishlist not found"
    });
  }
  return wishlist;
}

async function buildOwnedQuantityMap(ctx: ReaderCtx, userId: Id<"users">) {
  const entries = await ctx.db
    .query("collectionEntries")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const ownedCards = await Promise.all(entries.map((entry) => ctx.db.get(entry.cardId)));
  const ownership = new Map<string, number>();

  for (const [index, card] of ownedCards.entries()) {
    if (!card) {
      continue;
    }
    const key = `${card.tcg}:${card.externalId}`;
    ownership.set(key, (ownership.get(key) ?? 0) + entries[index]!.quantity);
  }

  return ownership;
}

function toWishlistCardResponse(
  card: Doc<"wishlistCards">,
  ownership: Map<string, number>
) {
  const ownedQuantity = ownership.get(`${card.tcg}:${card.externalId}`) ?? 0;

  return {
    id: card._id,
    externalId: card.externalId,
    tcg: card.tcg,
    name: card.name,
    setCode: card.setCode,
    setName: card.setName,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    imageUrlSmall: card.imageUrlSmall,
    setSymbolUrl: card.setSymbolUrl,
    setLogoUrl: card.setLogoUrl,
    collectorNumber: card.collectorNumber,
    notes: card.notes,
    owned: ownedQuantity > 0,
    ownedQuantity,
    createdAt: toIso(card.createdAt)
  };
}

async function hydrateWishlist(
  ctx: ReaderCtx,
  wishlist: Doc<"wishlists">,
  ownership?: Map<string, number>
) {
  const ownedQuantityMap = ownership ?? (await buildOwnedQuantityMap(ctx, wishlist.userId));
  const cards = await ctx.db
    .query("wishlistCards")
    .withIndex("by_wishlist", (q) => q.eq("wishlistId", wishlist._id))
    .collect();

  const hydratedCards = cards
    .map((card) => toWishlistCardResponse(card, ownedQuantityMap))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const ownedCards = hydratedCards.filter((card) => card.owned).length;
  const totalCards = hydratedCards.length;

  return {
    id: wishlist._id,
    name: wishlist.name,
    description: wishlist.description,
    colorHex: wishlist.colorHex,
    cards: hydratedCards,
    totalCards,
    ownedCards,
    completionPercent: totalCards > 0 ? Math.round((ownedCards / totalCards) * 100) : 0,
    createdAt: toIso(wishlist.createdAt),
    updatedAt: toIso(wishlist.updatedAt)
  };
}

async function getAuthUserById(ctx: ReaderCtx, authUserId: string) {
  return (await ctx.runQuery(betterAuthAdapterApi.findOne, {
    model: "user",
    where: [{ field: "_id", operator: "eq", value: authUserId }]
  })) as AuthUserDoc | null;
}

async function findAuthUserByField(
  ctx: ReaderCtx,
  field: "email" | "username",
  value: string
) {
  return (await ctx.runQuery(betterAuthAdapterApi.findOne, {
    model: "user",
    where: [{ field, operator: "eq", value }]
  })) as AuthUserDoc | null;
}

async function patchAuthUser(
  ctx: MutationCtx,
  authUserId: string,
  update: Record<string, string | boolean | null | undefined>
) {
  const existingAuthUser = await getAuthUserById(ctx, authUserId);
  if (!existingAuthUser) {
    return null;
  }

  const nextUpdate = Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined)
  );

  if (!Object.keys(nextUpdate).length) {
    return existingAuthUser;
  }

  return (await ctx.runMutation(betterAuthAdapterApi.updateOne, {
    input: {
      model: "user",
      where: [{ field: "_id", operator: "eq", value: authUserId }],
      update: nextUpdate as never
    }
  })) as AuthUserDoc;
}

async function getAppSettingsDoc(ctx: ReaderCtx) {
  return await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", settingsKey))
    .unique();
}

async function ensureAppSettingsDoc(ctx: MutationCtx) {
  const existing = await getAppSettingsDoc(ctx);
  if (existing) {
    return existing;
  }

  const timestamp = now();
  const settingsId = await ctx.db.insert("appSettings", {
    key: settingsKey,
    publicDashboard: false,
    publicCollections: false,
    requireAuth: true,
    appName: "TCG Manager",
    createdAt: timestamp,
    updatedAt: timestamp
  });

  const created = await ctx.db.get(settingsId);
  if (!created) {
    throw new ConvexError({
      code: "INVARIANT",
      message: "App settings could not be created"
    });
  }

  return created;
}

async function ensureViewerBySubject(ctx: MutationCtx, identity: BridgeIdentity) {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
    .unique();
  const timestamp = now();
  let userId = existing?._id;

  if (existing) {
    await ctx.db.patch(existing._id, {
      email: identity.email ?? existing.email,
      name: identity.name ?? existing.name,
      username: identity.username ?? existing.username,
      updatedAt: timestamp
    });
  } else {
    userId = await ctx.db.insert("users", {
      authSubject: identity.subject,
      email: identity.email,
      name: identity.name,
      username: identity.username,
      isAdmin: false,
      showCardNumbers: true,
      showPricing: true,
      enabledYugioh: true,
      enabledMagic: true,
      enabledPokemon: true,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  if (!userId) {
    throw new ConvexError({
      code: "INVARIANT",
      message: "Viewer id was not resolved"
    });
  }

  const library = await getLibraryBinder(ctx, userId);
  if (!library) {
    await ctx.db.insert("binders", {
      userId,
      kind: "library",
      name: "Library",
      description: "Default cross-game library",
      colorHex: "0f172a",
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  const viewer = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
    .unique();

  if (!viewer) {
    throw new ConvexError({
      code: "INVARIANT",
      message: "Viewer could not be created"
    });
  }

  return viewer;
}

async function requireViewerBySubject(ctx: ReaderCtx, subject: string) {
  const viewer = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", subject))
    .unique();
  if (!viewer) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Viewer not provisioned"
    });
  }
  return viewer;
}

async function requireAdminViewerBySubject(ctx: ReaderCtx, subject: string) {
  const viewer = await requireViewerBySubject(ctx, subject);
  if (!viewer.isAdmin) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Admin access required"
    });
  }
  return viewer;
}

async function getTagIdsForEntry(ctx: ReaderCtx, entryId: Id<"collectionEntries">) {
  const assignments = await ctx.db
    .query("collectionEntryTags")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .collect();
  return assignments.map((assignment) => assignment.tagId);
}

async function getGroupEntries(
  ctx: ReaderCtx,
  userId: Id<"users">,
  binderId: Id<"binders">,
  cardId: Id<"cards">
) {
  const entries = await ctx.db
    .query("collectionEntries")
    .withIndex("by_binder", (q) => q.eq("binderId", binderId))
    .collect();
  return entries.filter((entry) => entry.userId === userId && entry.cardId === cardId);
}

function toCardSnapshot(card: Doc<"cards">): CardSnapshot {
  return {
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
  };
}

async function resolveStoredCard(ctx: ReaderCtx, cardId: string) {
  const byInternalId = (await ctx.db
    .query("cards")
    .collect())
    .find((card) => card._id === cardId);

  if (byInternalId) {
    return byInternalId;
  }

  return (
    await ctx.db
      .query("cards")
      .withIndex("by_name", (q) => q.gte("name", ""))
      .collect()
  ).find((card) => card.externalId === cardId) ?? null;
}

async function resolveCardSnapshot(
  ctx: ReaderCtx,
  args: {
    cardId?: string;
    cardData?: CardSnapshot;
  },
  missingMessage: string
) {
  if (args.cardData) {
    return args.cardData;
  }

  if (args.cardId) {
    const card = await resolveStoredCard(ctx, args.cardId);
    if (card) {
      return toCardSnapshot(card);
    }
  }

  throw new ConvexError({
    code: "BAD_REQUEST",
    message: missingMessage
  });
}

async function createCopiesForViewer(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: {
    binderId: Id<"binders">;
    card: CardSnapshot;
    quantity: number;
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
    newTags?: Array<{ label: string; colorHex?: string }>;
    imageUrls?: string[];
    imageStorageIds?: Id<"_storage">[];
  }
) {
  let firstEntry: Awaited<ReturnType<typeof addEntryForViewer>> | null = null;

  for (let index = 0; index < args.quantity; index += 1) {
    const entry = await addEntryForViewer(ctx, userId, {
      binderId: args.binderId,
      card: args.card,
      quantity: 1,
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
      tagIds: args.tagIds,
      newTags: args.newTags?.map((tag) => ({
        label: tag.label,
        colorHex: tag.colorHex ?? "64748b"
      }))
    });

    if (!firstEntry) {
      firstEntry = entry;
    }

    if ((args.imageUrls?.length ?? 0) > 0 || (args.imageStorageIds?.length ?? 0) > 0) {
      await ctx.db.patch(entry.id, {
        imageUrls: args.imageUrls,
        imageStorageIds: args.imageStorageIds
      });
    }
  }

  if (!firstEntry) {
    throw new ConvexError({
      code: "INVARIANT",
      message: "At least one collection copy must be created"
    });
  }

  return firstEntry;
}

export const ensureViewer = internalMutation({
  args: {
    subject: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    username: v.optional(v.string())
  },
  returns: viewerValidator,
  handler: async (ctx, args) => {
    const viewer = await ensureViewerBySubject(ctx, args);
    return await buildViewerResponse(ctx, viewer);
  }
});

export const libraryBinderId = internalQuery({
  args: {
    subject: v.string()
  },
  returns: v.id("binders"),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const library = await getLibraryBinder(ctx, viewer._id);
    if (!library) {
      throw new ConvexError({
        code: "INVARIANT",
        message: "Library binder not found"
      });
    }
    return library._id;
  }
});

export const listBinders = internalQuery({
  args: {
    subject: v.string()
  },
  returns: v.array(binderDetailValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const binders = await ctx.db
      .query("binders")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .collect();
    const details = await Promise.all(binders.map((binder) => hydrateBinderDetail(ctx, binder)));
    return details.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "library" ? -1 : 1;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }
});

export const getBinder = internalQuery({
  args: {
    subject: v.string(),
    binderId: v.id("binders")
  },
  returns: binderDetailValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const binder = await requireBinderForUser(ctx, args.binderId, viewer._id);
    return await hydrateBinderDetail(ctx, binder);
  }
});

export const createBinder = internalMutation({
  args: {
    subject: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    colorHex: v.optional(v.string())
  },
  returns: binderDetailValidator,
  handler: async (ctx, args) => {
    const viewer = await ensureViewerBySubject(ctx, {
      subject: args.subject
    });
    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Name is required"
      });
    }

    const timestamp = now();
    const binderId = await ctx.db.insert("binders", {
      userId: viewer._id,
      kind: "binder",
      name: trimmedName,
      description: args.description?.trim() || undefined,
      colorHex: validateColorHex(args.colorHex),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const binder = await requireBinderForUser(ctx, binderId, viewer._id);
    return await hydrateBinderDetail(ctx, binder);
  }
});

export const updateBinder = internalMutation({
  args: {
    subject: v.string(),
    binderId: v.id("binders"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    colorHex: v.optional(v.string())
  },
  returns: binderDetailValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const binder = await requireBinderForUser(ctx, args.binderId, viewer._id);
    const timestamp = now();
    await ctx.db.patch(binder._id, {
      name: args.name?.trim() || binder.name,
      description:
        args.description === undefined ? binder.description : args.description?.trim() || undefined,
      colorHex:
        args.colorHex === undefined ? binder.colorHex : validateColorHex(args.colorHex),
      updatedAt: timestamp
    });
    const updated = await requireBinderForUser(ctx, binder._id, viewer._id);
    return await hydrateBinderDetail(ctx, updated);
  }
});

export const deleteBinder = internalMutation({
  args: {
    subject: v.string(),
    binderId: v.id("binders")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const binder = await requireBinderForUser(ctx, args.binderId, viewer._id);
    if (binder.kind === "library") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "The library binder cannot be deleted"
      });
    }

    const entries = await ctx.db
      .query("collectionEntries")
      .withIndex("by_binder", (q) => q.eq("binderId", binder._id))
      .collect();

    for (const entry of entries) {
      await removeEntryForViewer(ctx, viewer._id, entry._id);
    }
    await ctx.db.delete(binder._id);
    return null;
  }
});

export const listTags = internalQuery({
  args: {
    subject: v.string()
  },
  returns: v.array(tagSummaryValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .collect();
    return tags
      .map((tag) => ({
        id: tag._id,
        label: tag.label,
        colorHex: tag.colorHex,
        createdAt: toIso(tag.createdAt),
        updatedAt: toIso(tag.updatedAt)
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }
});

export const createTag = internalMutation({
  args: {
    subject: v.string(),
    label: v.string(),
    colorHex: v.optional(v.string())
  },
  returns: tagSummaryValidator,
  handler: async (ctx, args) => {
    const viewer = await ensureViewerBySubject(ctx, {
      subject: args.subject
    });
    const label = args.label.trim();
    if (!label) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Tag label is required"
      });
    }
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_user_label", (q) => q.eq("userId", viewer._id).eq("label", label))
      .unique();
    const timestamp = now();
    const colorHex = validateColorHex(args.colorHex) ?? "64748b";
    if (existing) {
      await ctx.db.patch(existing._id, { colorHex, updatedAt: timestamp });
      return {
        id: existing._id,
        label,
        colorHex,
        createdAt: toIso(existing.createdAt),
        updatedAt: toIso(timestamp)
      };
    }
    const tagId = await ctx.db.insert("tags", {
      userId: viewer._id,
      label,
      colorHex,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return {
      id: tagId,
      label,
      colorHex,
      createdAt: toIso(timestamp),
      updatedAt: toIso(timestamp)
    };
  }
});

export const addCardToBinder = internalMutation({
  args: {
    subject: v.string(),
    binderId: v.id("binders"),
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
    newTags: v.optional(v.array(v.object({ label: v.string(), colorHex: v.optional(v.string()) }))),
    cardId: v.optional(v.string()),
    cardData: v.optional(cardSnapshotInput)
  },
  returns: entryValidator,
  handler: async (ctx, args) => {
    const viewer = await ensureViewerBySubject(ctx, {
      subject: args.subject
    });
    const card = await resolveCardSnapshot(
      ctx,
      {
        cardId: args.cardId,
        cardData: args.cardData
      },
      "cardData is required for the Convex collection bridge"
    );
    const quantity = args.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "quantity must be a positive integer"
      });
    }

    return await createCopiesForViewer(ctx, viewer._id, {
      binderId: args.binderId,
      card,
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
      tagIds: args.tagIds,
      newTags: args.newTags
    });
  }
});

export const updateEntry = internalMutation({
  args: {
    subject: v.string(),
    entryId: v.id("collectionEntries"),
    binderId: v.optional(v.id("binders")),
    quantity: v.optional(v.number()),
    condition: v.optional(nullableString),
    language: v.optional(nullableString),
    notes: v.optional(nullableString),
    price: v.optional(v.number()),
    acquisitionPrice: v.optional(v.number()),
    serialNumber: v.optional(nullableString),
    acquiredAt: v.optional(nullableString),
    isFoil: v.optional(v.boolean()),
    isSigned: v.optional(v.boolean()),
    isAltered: v.optional(v.boolean()),
    tagIds: v.optional(v.array(v.id("tags"))),
    newTags: v.optional(v.array(v.object({ label: v.string(), colorHex: v.optional(v.string()) }))),
    cardOverride: v.optional(
      v.object({
        cardId: v.string(),
        cardData: v.optional(cardSnapshotInput)
      })
    )
  },
  returns: entryValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    let entry = await requireEntryForUser(ctx, args.entryId, viewer._id);
    let nextCardId = entry.cardId;

    if (args.cardOverride) {
      const card = await resolveCardSnapshot(
        ctx,
        {
          cardId: args.cardOverride.cardId,
          cardData: args.cardOverride.cardData
        },
        "cardData is required when selecting a new print"
      );
      nextCardId = await upsertCard(ctx, card);
      const sourceGroup = await getGroupEntries(ctx, viewer._id, entry.binderId, entry.cardId);
      const timestamp = now();
      await Promise.all(
        sourceGroup.map((groupEntry) =>
          ctx.db.patch(groupEntry._id, {
            cardId: nextCardId,
            updatedAt: timestamp
          })
        )
      );
      entry = await requireEntryForUser(ctx, args.entryId, viewer._id);
    }

    if (args.binderId) {
      await requireBinderForUser(ctx, args.binderId, viewer._id);
    }
    if (args.quantity !== undefined && (!Number.isInteger(args.quantity) || args.quantity < 1)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "quantity must be a positive integer"
      });
    }

    const timestamp = now();
    const targetBinderId = args.binderId ?? entry.binderId;
    await ctx.db.patch(entry._id, {
      binderId: targetBinderId,
      quantity: 1,
      condition: args.condition === undefined ? entry.condition : args.condition ?? undefined,
      language: args.language === undefined ? entry.language : args.language ?? undefined,
      notes: args.notes === undefined ? entry.notes : args.notes ?? undefined,
      price: args.price ?? entry.price,
      acquisitionPrice: args.acquisitionPrice ?? entry.acquisitionPrice,
      serialNumber:
        args.serialNumber === undefined ? entry.serialNumber : args.serialNumber ?? undefined,
      acquiredAt:
        args.acquiredAt === undefined ? entry.acquiredAt : args.acquiredAt ?? undefined,
      isFoil: args.isFoil ?? entry.isFoil,
      isSigned: args.isSigned ?? entry.isSigned,
      isAltered: args.isAltered ?? entry.isAltered,
      updatedAt: timestamp
    });

    if (args.tagIds !== undefined || args.newTags !== undefined) {
      await replaceEntryTags(
        ctx,
        entry._id,
        viewer._id,
        args.tagIds,
        args.newTags?.map((tag) => ({
          label: tag.label,
          colorHex: tag.colorHex ?? "64748b"
        }))
      );
    }

    const refreshed = await requireEntryForUser(ctx, entry._id, viewer._id);
    const desiredQuantity = args.quantity ?? 1;
    const destinationGroup = await getGroupEntries(ctx, viewer._id, targetBinderId, nextCardId);
    const currentQuantity = destinationGroup.reduce((sum, groupEntry) => sum + groupEntry.quantity, 0);

    if (desiredQuantity > currentQuantity) {
      const tagIds = await getTagIdsForEntry(ctx, refreshed._id);
      const targetCard = await ctx.db.get(nextCardId);
      if (!targetCard) {
        throw new ConvexError({
          code: "INVARIANT",
          message: "Target card is missing"
        });
      }
      await createCopiesForViewer(ctx, viewer._id, {
        binderId: targetBinderId,
        card: toCardSnapshot(targetCard),
        quantity: desiredQuantity - currentQuantity,
        condition: refreshed.condition,
        language: refreshed.language,
        notes: refreshed.notes,
        price: refreshed.price,
        acquisitionPrice: refreshed.acquisitionPrice,
        serialNumber: refreshed.serialNumber,
        acquiredAt: refreshed.acquiredAt,
        isFoil: refreshed.isFoil,
        isSigned: refreshed.isSigned,
        isAltered: refreshed.isAltered,
        tagIds
      });
    } else if (desiredQuantity < currentQuantity) {
      let remainingToDelete = currentQuantity - desiredQuantity;
      const deletable = destinationGroup
        .filter((groupEntry) => groupEntry._id !== refreshed._id)
        .sort((left, right) => right.updatedAt - left.updatedAt);

      for (const candidate of deletable) {
        if (remainingToDelete <= 0) {
          break;
        }
        await removeEntryForViewer(ctx, viewer._id, candidate._id);
        remainingToDelete -= candidate.quantity;
      }

      if (remainingToDelete > 0) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Unable to reduce quantity to the requested amount"
        });
      }
    }

    const updated = await requireEntryForUser(ctx, entry._id, viewer._id);
    return await hydrateEntry(ctx, updated);
  }
});

export const removeEntry = internalMutation({
  args: {
    subject: v.string(),
    entryId: v.id("collectionEntries")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    await removeEntryForViewer(ctx, viewer._id, args.entryId);
    return null;
  }
});

export const attachImageToEntry = internalMutation({
  args: {
    subject: v.string(),
    entryId: v.id("collectionEntries"),
    imageUrl: v.string(),
    storageId: v.optional(v.id("_storage"))
  },
  returns: imageMutationValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const entry = await requireEntryForUser(ctx, args.entryId, viewer._id);
    const imageUrls = [...(entry.imageUrls ?? []), args.imageUrl];
    const imageStorageIds = [...(entry.imageStorageIds ?? [])];
    if (args.storageId) {
      imageStorageIds.push(args.storageId);
    }

    await ctx.db.patch(entry._id, {
      imageUrls,
      imageStorageIds: imageStorageIds.length ? imageStorageIds : undefined,
      updatedAt: now()
    });

    return {
      imageUrls
    };
  }
});

export const removeImageFromEntry = internalMutation({
  args: {
    subject: v.string(),
    entryId: v.id("collectionEntries"),
    imageIndex: v.number()
  },
  returns: imageMutationValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const entry = await requireEntryForUser(ctx, args.entryId, viewer._id);
    const imageUrls = [...(entry.imageUrls ?? [])];
    const imageStorageIds = [...(entry.imageStorageIds ?? [])];

    if (args.imageIndex < 0 || args.imageIndex >= imageUrls.length) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Image index out of range"
      });
    }

    const removedUrl = imageUrls.splice(args.imageIndex, 1)[0];
    const removedStorageId =
      args.imageIndex < imageStorageIds.length ? imageStorageIds.splice(args.imageIndex, 1)[0] : undefined;

    await ctx.db.patch(entry._id, {
      imageUrls,
      imageStorageIds: imageStorageIds.length ? imageStorageIds : undefined,
      updatedAt: now()
    });

    return {
      imageUrls,
      removedUrl,
      removedStorageId
    };
  }
});

export const listWishlists = internalQuery({
  args: {
    subject: v.string()
  },
  returns: v.array(wishlistValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const wishlists = await ctx.db
      .query("wishlists")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .collect();
    const ownership = await buildOwnedQuantityMap(ctx, viewer._id);
    const hydrated = await Promise.all(
      wishlists.map((wishlist) => hydrateWishlist(ctx, wishlist, ownership))
    );

    return hydrated.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
});

export const getWishlist = internalQuery({
  args: {
    subject: v.string(),
    wishlistId: v.id("wishlists")
  },
  returns: wishlistValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const wishlist = await requireWishlistForUser(ctx, args.wishlistId, viewer._id);
    return await hydrateWishlist(ctx, wishlist);
  }
});

export const createWishlist = internalMutation({
  args: {
    subject: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    colorHex: v.optional(v.string())
  },
  returns: wishlistValidator,
  handler: async (ctx, args) => {
    const viewer = await ensureViewerBySubject(ctx, {
      subject: args.subject
    });
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Name is required"
      });
    }

    const existing = await ctx.db
      .query("wishlists")
      .withIndex("by_user_name", (q) => q.eq("userId", viewer._id).eq("name", name))
      .unique();
    if (existing) {
      throw conflict("Wishlist name is already in use");
    }

    const timestamp = now();
    const wishlistId = await ctx.db.insert("wishlists", {
      userId: viewer._id,
      name,
      description: args.description?.trim() || undefined,
      colorHex: validateColorHex(args.colorHex),
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const wishlist = await requireWishlistForUser(ctx, wishlistId, viewer._id);
    return await hydrateWishlist(ctx, wishlist, new Map());
  }
});

export const updateWishlist = internalMutation({
  args: {
    subject: v.string(),
    wishlistId: v.id("wishlists"),
    name: v.optional(v.string()),
    description: v.optional(nullableString),
    colorHex: v.optional(nullableString)
  },
  returns: wishlistValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const wishlist = await requireWishlistForUser(ctx, args.wishlistId, viewer._id);
    const nextName = args.name?.trim();

    if (nextName !== undefined && !nextName) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Name is required"
      });
    }

    if (nextName && nextName !== wishlist.name) {
      const existing = await ctx.db
        .query("wishlists")
        .withIndex("by_user_name", (q) => q.eq("userId", viewer._id).eq("name", nextName))
        .unique();
      if (existing && existing._id !== wishlist._id) {
        throw conflict("Wishlist name is already in use");
      }
    }

    await ctx.db.patch(wishlist._id, {
      name: nextName ?? wishlist.name,
      description:
        args.description === undefined ? wishlist.description : args.description?.trim() || undefined,
      colorHex:
        args.colorHex === undefined
          ? wishlist.colorHex
          : args.colorHex === null
            ? undefined
            : validateColorHex(args.colorHex),
      updatedAt: now()
    });

    const updated = await requireWishlistForUser(ctx, wishlist._id, viewer._id);
    return await hydrateWishlist(ctx, updated);
  }
});

export const deleteWishlist = internalMutation({
  args: {
    subject: v.string(),
    wishlistId: v.id("wishlists")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const wishlist = await requireWishlistForUser(ctx, args.wishlistId, viewer._id);
    const cards = await ctx.db
      .query("wishlistCards")
      .withIndex("by_wishlist", (q) => q.eq("wishlistId", wishlist._id))
      .collect();

    await Promise.all(cards.map((card) => ctx.db.delete(card._id)));
    await ctx.db.delete(wishlist._id);
    return null;
  }
});

export const addWishlistCard = internalMutation({
  args: {
    subject: v.string(),
    wishlistId: v.id("wishlists"),
    card: wishlistCardInput
  },
  returns: wishlistCardValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const wishlist = await requireWishlistForUser(ctx, args.wishlistId, viewer._id);
    const existing = await ctx.db
      .query("wishlistCards")
      .withIndex("by_wishlist_external_tcg", (q) =>
        q.eq("wishlistId", wishlist._id).eq("externalId", args.card.externalId).eq("tcg", args.card.tcg)
      )
      .unique();

    const timestamp = now();
    const cardId =
      existing?._id ??
      (await ctx.db.insert("wishlistCards", {
        wishlistId: wishlist._id,
        externalId: args.card.externalId,
        tcg: args.card.tcg,
        name: args.card.name,
        setCode: args.card.setCode,
        setName: args.card.setName,
        rarity: args.card.rarity,
        imageUrl: args.card.imageUrl,
        imageUrlSmall: args.card.imageUrlSmall,
        setSymbolUrl: args.card.setSymbolUrl,
        setLogoUrl: args.card.setLogoUrl,
        collectorNumber: args.card.collectorNumber,
        notes: args.card.notes,
        createdAt: timestamp,
        updatedAt: timestamp
      }));

    await ctx.db.patch(wishlist._id, { updatedAt: timestamp });

    const card = await ctx.db.get(cardId);
    if (!card) {
      throw new ConvexError({
        code: "INVARIANT",
        message: "Wishlist card could not be created"
      });
    }

    return toWishlistCardResponse(card, await buildOwnedQuantityMap(ctx, viewer._id));
  }
});

export const addWishlistCards = internalMutation({
  args: {
    subject: v.string(),
    wishlistId: v.id("wishlists"),
    cards: v.array(wishlistCardInput)
  },
  returns: wishlistValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const wishlist = await requireWishlistForUser(ctx, args.wishlistId, viewer._id);
    const timestamp = now();

    for (const card of args.cards) {
      const existing = await ctx.db
        .query("wishlistCards")
        .withIndex("by_wishlist_external_tcg", (q) =>
          q.eq("wishlistId", wishlist._id).eq("externalId", card.externalId).eq("tcg", card.tcg)
        )
        .unique();

      if (existing) {
        continue;
      }

      await ctx.db.insert("wishlistCards", {
        wishlistId: wishlist._id,
        externalId: card.externalId,
        tcg: card.tcg,
        name: card.name,
        setCode: card.setCode,
        setName: card.setName,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        imageUrlSmall: card.imageUrlSmall,
        setSymbolUrl: card.setSymbolUrl,
        setLogoUrl: card.setLogoUrl,
        collectorNumber: card.collectorNumber,
        notes: card.notes,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    await ctx.db.patch(wishlist._id, { updatedAt: timestamp });
    const refreshed = await requireWishlistForUser(ctx, wishlist._id, viewer._id);
    return await hydrateWishlist(ctx, refreshed);
  }
});

export const removeWishlistCard = internalMutation({
  args: {
    subject: v.string(),
    wishlistId: v.id("wishlists"),
    cardId: v.id("wishlistCards")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const wishlist = await requireWishlistForUser(ctx, args.wishlistId, viewer._id);
    const card = await ctx.db.get(args.cardId);

    if (!card || card.wishlistId !== wishlist._id) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Wishlist card not found"
      });
    }

    await ctx.db.delete(card._id);
    await ctx.db.patch(wishlist._id, { updatedAt: now() });
    return null;
  }
});

export const getSetupRequired = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const adminUsers = await ctx.db
      .query("users")
      .withIndex("by_is_admin", (q) => q.eq("isAdmin", true))
      .collect();
    return adminUsers.length === 0;
  }
});

export const promoteViewerToAdmin = internalMutation({
  args: {
    subject: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    username: v.optional(v.string())
  },
  returns: viewerValidator,
  handler: async (ctx, args) => {
    await ensureViewerBySubject(ctx, args);
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const timestamp = now();

    await ctx.db.patch(viewer._id, {
      isAdmin: true,
      updatedAt: timestamp
    });
    await patchAuthUser(ctx, args.subject, { isAdmin: true });

    const refreshed = await requireViewerBySubject(ctx, args.subject);
    return await buildViewerResponse(ctx, refreshed);
  }
});

export const getViewerProfile = internalQuery({
  args: {
    subject: v.string()
  },
  returns: userProfileValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    return toUserProfile(viewer);
  }
});

export const updateViewerProfile = internalMutation({
  args: {
    subject: v.string(),
    email: v.optional(v.string()),
    username: v.optional(v.string())
  },
  returns: userProfileValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const authUser = await getAuthUserById(ctx, args.subject);

    if (authUser && args.email) {
      const existingUser = await findAuthUserByField(ctx, "email", args.email);
      if (existingUser && existingUser._id !== args.subject) {
        throw conflict("Email is already in use");
      }
    }

    if (authUser && args.username) {
      const existingUser = await findAuthUserByField(ctx, "username", args.username);
      if (existingUser && existingUser._id !== args.subject) {
        throw conflict("Username is already in use");
      }
    }

    if (authUser) {
      await patchAuthUser(ctx, args.subject, {
        email: args.email,
        username: args.username
      });
    }

    await ctx.db.patch(viewer._id, {
      email: args.email ?? viewer.email,
      username: args.username ?? viewer.username,
      updatedAt: now()
    });

    const refreshed = await requireViewerBySubject(ctx, args.subject);
    return toUserProfile(refreshed);
  }
});

export const getViewerPreferences = internalQuery({
  args: {
    subject: v.string()
  },
  returns: userPreferencesValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    return toUserPreferences(viewer);
  }
});

export const updateViewerPreferences = internalMutation({
  args: {
    subject: v.string(),
    showCardNumbers: v.optional(v.boolean()),
    showPricing: v.optional(v.boolean()),
    enabledYugioh: v.optional(v.boolean()),
    enabledMagic: v.optional(v.boolean()),
    enabledPokemon: v.optional(v.boolean()),
    defaultGame: v.optional(nullableTcgCode)
  },
  returns: userPreferencesValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);

    await patchAuthUser(ctx, args.subject, {
      showCardNumbers: args.showCardNumbers,
      showPricing: args.showPricing,
      enabledYugioh: args.enabledYugioh,
      enabledMagic: args.enabledMagic,
      enabledPokemon: args.enabledPokemon,
      defaultGame: args.defaultGame
    });

    await ctx.db.patch(viewer._id, {
      showCardNumbers: args.showCardNumbers ?? viewer.showCardNumbers,
      showPricing: args.showPricing ?? viewer.showPricing,
      enabledYugioh: args.enabledYugioh ?? viewer.enabledYugioh,
      enabledMagic: args.enabledMagic ?? viewer.enabledMagic,
      enabledPokemon: args.enabledPokemon ?? viewer.enabledPokemon,
      defaultGame:
        args.defaultGame === undefined ? viewer.defaultGame : args.defaultGame ?? undefined,
      updatedAt: now()
    });

    const refreshed = await requireViewerBySubject(ctx, args.subject);
    return toUserPreferences(refreshed);
  }
});

export const getSettings = internalQuery({
  args: {
    subject: v.optional(v.string())
  },
  returns: v.union(appSettingsValidator, adminAppSettingsValidator),
  handler: async (ctx, args) => {
    const settings = (await getAppSettingsDoc(ctx)) ?? {
      key: settingsKey,
      publicDashboard: false,
      publicCollections: false,
      requireAuth: true,
      appName: "TCG Manager",
      createdAt: now(),
      updatedAt: now()
    };

    if (!args.subject) {
      return toPublicAppSettings(settings as Doc<"appSettings">);
    }

    const viewer = await requireViewerBySubject(ctx, args.subject);
    return viewer.isAdmin
      ? toAdminAppSettings(settings as Doc<"appSettings">)
      : toPublicAppSettings(settings as Doc<"appSettings">);
  }
});

export const updateSettings = internalMutation({
  args: {
    subject: v.string(),
    data: settingsUpdateInput
  },
  returns: adminAppSettingsValidator,
  handler: async (ctx, args) => {
    await requireAdminViewerBySubject(ctx, args.subject);
    const settings = await ensureAppSettingsDoc(ctx);
    await ctx.db.patch(settings._id, {
      publicDashboard: args.data.publicDashboard ?? settings.publicDashboard,
      publicCollections: args.data.publicCollections ?? settings.publicCollections,
      requireAuth: args.data.requireAuth ?? settings.requireAuth,
      appName: args.data.appName ?? settings.appName,
      scrydexApiKey:
        args.data.scrydexApiKey === undefined
          ? settings.scrydexApiKey
          : args.data.scrydexApiKey ?? undefined,
      scrydexTeamId:
        args.data.scrydexTeamId === undefined
          ? settings.scrydexTeamId
          : args.data.scrydexTeamId ?? undefined,
      scryfallApiBaseUrl:
        args.data.scryfallApiBaseUrl === undefined
          ? settings.scryfallApiBaseUrl
          : args.data.scryfallApiBaseUrl ?? undefined,
      ygoApiBaseUrl:
        args.data.ygoApiBaseUrl === undefined
          ? settings.ygoApiBaseUrl
          : args.data.ygoApiBaseUrl ?? undefined,
      scrydexApiBaseUrl:
        args.data.scrydexApiBaseUrl === undefined
          ? settings.scrydexApiBaseUrl
          : args.data.scrydexApiBaseUrl ?? undefined,
      tcgdexApiBaseUrl:
        args.data.tcgdexApiBaseUrl === undefined
          ? settings.tcgdexApiBaseUrl
          : args.data.tcgdexApiBaseUrl ?? undefined,
      updatedAt: now()
    });
    const refreshed = await getAppSettingsDoc(ctx);
    if (!refreshed) {
      throw new ConvexError({
        code: "INVARIANT",
        message: "App settings could not be loaded"
      });
    }
    return toAdminAppSettings(refreshed);
  }
});
