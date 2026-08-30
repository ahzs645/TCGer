import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const productContentValidator = v.object({
  externalId: v.optional(v.string()),
  name: v.string(),
  quantity: v.optional(v.number()),
  setCode: v.optional(v.string()),
  rarity: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
});

const sealedProductResponseValidator = v.object({
  id: v.id("sealedProducts"),
  tcg: v.string(),
  name: v.string(),
  productType: v.string(),
  setCode: v.optional(v.string()),
  cardsPerPack: v.optional(v.number()),
  packsPerBox: v.optional(v.number()),
  releaseDate: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  msrp: v.optional(v.number()),
  upc: v.optional(v.string()),
  contentMode: v.optional(v.union(v.literal("fixed"), v.literal("pool"))),
  contentCount: v.optional(v.number()),
  contents: v.optional(v.array(productContentValidator)),
  contentSource: v.optional(v.string()),
  contentUpdatedAt: v.optional(v.string()),
  isCustom: v.boolean(),
});

const sealedInventoryResponseValidator = v.object({
  id: v.id("sealedInventory"),
  product: sealedProductResponseValidator,
  quantity: v.number(),
  purchasePrice: v.optional(v.number()),
  purchaseDate: v.optional(v.string()),
  notes: v.optional(v.string()),
  createdAt: v.string(),
});

const sealedOpeningResponseValidator = v.object({
  id: v.id("sealedOpenings"),
  userId: v.id("users"),
  sealedInventoryId: v.id("sealedInventory"),
  openedQuantity: v.number(),
  openedAt: v.string(),
  notes: v.optional(v.string()),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const sealedOpenedCardResponseValidator = v.object({
  id: v.id("sealedOpenedCards"),
  userId: v.id("users"),
  openingId: v.id("sealedOpenings"),
  collectionId: v.optional(v.id("collectionEntries")),
  externalId: v.string(),
  tcg: v.string(),
  cardName: v.string(),
  quantity: v.number(),
  status: v.union(v.literal("active"), v.literal("sold")),
  realizedProceeds: v.optional(v.number()),
  soldAt: v.optional(v.string()),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const sealedLedgerCardValidator = v.object({
  id: v.id("sealedOpenedCards"),
  collectionId: v.optional(v.id("collectionEntries")),
  externalId: v.string(),
  tcg: v.string(),
  cardName: v.string(),
  quantity: v.number(),
  status: v.union(v.literal("active"), v.literal("sold")),
  liveValue: v.number(),
  realizedProceeds: v.number(),
  soldAt: v.optional(v.string()),
});

const sealedOpeningLedgerValidator = v.object({
  id: v.id("sealedOpenings"),
  inventoryId: v.id("sealedInventory"),
  productName: v.string(),
  openedQuantity: v.number(),
  openedAt: v.string(),
  invested: v.number(),
  liveValue: v.number(),
  realizedProceeds: v.number(),
  profitLoss: v.number(),
  activeCopies: v.number(),
  soldCopies: v.number(),
  cards: v.array(sealedLedgerCardValidator),
});

// Legacy has no SealedProduct seed/admin writer. Mirror the maintained five-product
// catalog from iOS LocalStore and seed it idempotently when the REST catalog is read.
const bundledCatalog = [
  {
    catalogKey: "sealed-product-1",
    tcg: "pokemon",
    name: "Surging Sparks Booster Box",
    productType: "box",
    setCode: "SV",
    cardsPerPack: 10,
    packsPerBox: 36,
    releaseDate: "2024-11-08T00:00:00.000Z",
    msrp: 143.64,
    upc: "820650855221",
  },
  {
    catalogKey: "sealed-product-2",
    tcg: "pokemon",
    name: "Paldean Fates Elite Trainer Box",
    productType: "etb",
    setCode: "PAF",
    cardsPerPack: 10,
    packsPerBox: 9,
    releaseDate: "2024-01-26T00:00:00.000Z",
    msrp: 49.99,
    upc: "820650853159",
  },
  {
    catalogKey: "sealed-product-3",
    tcg: "magic",
    name: "Modern Horizons 3 Draft Booster Box",
    productType: "box",
    setCode: "MH3",
    cardsPerPack: 15,
    packsPerBox: 36,
    releaseDate: "2024-06-14T00:00:00.000Z",
    msrp: 287.64,
  },
  {
    catalogKey: "sealed-product-4",
    tcg: "yugioh",
    name: "Age of Overlord Booster Box",
    productType: "box",
    setCode: "AGOV",
    cardsPerPack: 9,
    packsPerBox: 24,
    releaseDate: "2023-10-19T00:00:00.000Z",
    msrp: 79.99,
  },
  {
    catalogKey: "sealed-product-5",
    tcg: "pokemon",
    name: "Prismatic Evolutions Booster Pack",
    productType: "booster",
    setCode: "PRE",
    cardsPerPack: 10,
    releaseDate: "2025-01-17T00:00:00.000Z",
    msrp: 5.99,
  },
] as const;

type ReaderCtx = QueryCtx | MutationCtx;

async function requireViewerBySubject(ctx: ReaderCtx, subject: string) {
  const viewer = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", subject))
    .unique();
  if (!viewer) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Viewer not provisioned",
    });
  }
  return viewer;
}

function requirePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} must be a positive integer`,
    });
  }
  return value;
}

function requireNonnegativeNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} must be a finite nonnegative number`,
    });
  }
  return value;
}

function parseIsoDate(value: string, fieldName: string): number {
  const timestamp = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ||
    !Number.isFinite(timestamp)
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} must be an ISO date-time`,
    });
  }
  return timestamp;
}

function toSealedProductResponse(product: Doc<"sealedProducts">, includeContents = false) {
  return {
    id: product._id,
    tcg: product.tcg,
    name: product.name,
    productType: product.productType,
    setCode: product.setCode,
    cardsPerPack: product.cardsPerPack,
    packsPerBox: product.packsPerBox,
    releaseDate:
      product.releaseDate === undefined
        ? undefined
        : new Date(product.releaseDate).toISOString(),
    imageUrl: product.imageUrl,
    msrp: product.msrp,
    upc: product.upc,
    contentMode: product.contentMode,
    contentCount: product.contents?.length,
    contents: includeContents ? product.contents : undefined,
    contentSource: product.contentSource,
    contentUpdatedAt: product.contentUpdatedAt === undefined
      ? undefined
      : new Date(product.contentUpdatedAt).toISOString(),
    isCustom: product.isCustom === true,
  };
}

function cleanRequiredText(value: string, fieldName: string, maxLength = 200): string {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} is required and must be at most ${maxLength} characters`,
    });
  }
  return cleaned;
}

function cleanOptionalText(value: string | undefined, maxLength = 200): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  if (cleaned.length > maxLength) {
    throw new ConvexError({ code: "BAD_REQUEST", message: `Value must be at most ${maxLength} characters` });
  }
  return cleaned;
}

function optionalPositiveInteger(value: number | undefined, fieldName: string): number | undefined {
  return value === undefined ? undefined : requirePositiveInteger(value, fieldName);
}

function optionalNonnegativeNumber(value: number | undefined, fieldName: string): number | undefined {
  return value === undefined ? undefined : requireNonnegativeNumber(value, fieldName);
}

function toSealedInventoryResponse(
  inventory: Doc<"sealedInventory">,
  product: Doc<"sealedProducts">,
) {
  return {
    id: inventory._id,
    product: toSealedProductResponse(product),
    quantity: inventory.quantity,
    purchasePrice: inventory.purchasePrice,
    purchaseDate:
      inventory.purchaseDate === undefined
        ? undefined
        : new Date(inventory.purchaseDate).toISOString(),
    notes: inventory.notes,
    createdAt: new Date(inventory.createdAt).toISOString(),
  };
}

function toSealedOpeningResponse(opening: Doc<"sealedOpenings">) {
  return {
    id: opening._id,
    userId: opening.userId,
    sealedInventoryId: opening.sealedInventoryId,
    openedQuantity: opening.openedQuantity,
    openedAt: new Date(opening.openedAt).toISOString(),
    notes: opening.notes,
    createdAt: new Date(opening.createdAt).toISOString(),
    updatedAt: new Date(opening.updatedAt).toISOString(),
  };
}

function toSealedOpenedCardResponse(card: Doc<"sealedOpenedCards">) {
  return {
    id: card._id,
    userId: card.userId,
    openingId: card.openingId,
    collectionId: card.collectionId,
    externalId: card.externalId,
    tcg: card.tcg,
    cardName: card.cardName,
    quantity: card.quantity,
    status: card.status,
    realizedProceeds: card.realizedProceeds,
    soldAt:
      card.soldAt === undefined
        ? undefined
        : new Date(card.soldAt).toISOString(),
    createdAt: new Date(card.createdAt).toISOString(),
    updatedAt: new Date(card.updatedAt).toISOString(),
  };
}

async function requireInventoryForUser(
  ctx: ReaderCtx,
  inventoryId: Id<"sealedInventory">,
  userId: Id<"users">,
) {
  const inventory = await ctx.db.get(inventoryId);
  if (!inventory || inventory.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Sealed inventory item not found",
    });
  }
  return inventory;
}

export const seedCatalog = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let inserted = 0;
    const timestamp = Date.now();
    for (const product of bundledCatalog) {
      const existing = await ctx.db
        .query("sealedProducts")
        .withIndex("by_catalog_key", (q) =>
          q.eq("catalogKey", product.catalogKey),
        )
        .unique();
      if (existing) {
        continue;
      }
      await ctx.db.insert("sealedProducts", {
        catalogKey: product.catalogKey,
        tcg: product.tcg,
        name: product.name,
        productType: product.productType,
        setCode: product.setCode,
        cardsPerPack: product.cardsPerPack,
        packsPerBox: "packsPerBox" in product ? product.packsPerBox : undefined,
        releaseDate: Date.parse(product.releaseDate),
        msrp: product.msrp,
        upc: "upc" in product ? product.upc : undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      inserted += 1;
    }
    return inserted;
  },
});

export const listProducts = internalQuery({
  args: {
    subject: v.string(),
    tcg: v.optional(v.string()),
  },
  returns: v.array(sealedProductResponseValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const [globalProducts, customProducts] = await Promise.all([
      args.tcg
        ? ctx.db
            .query("sealedProducts")
            .withIndex("by_owner_tcg_and_release_date", (q) =>
              q.eq("ownerId", undefined).eq("tcg", args.tcg!),
            )
            .order("desc")
            .take(1_000)
        : ctx.db
            .query("sealedProducts")
            .withIndex("by_owner_and_release_date", (q) => q.eq("ownerId", undefined))
            .order("desc")
            .take(1_000),
      args.tcg
        ? ctx.db
            .query("sealedProducts")
            .withIndex("by_owner_tcg_and_release_date", (q) =>
              q.eq("ownerId", viewer._id).eq("tcg", args.tcg!),
            )
            .order("desc")
            .take(1_000)
        : ctx.db
            .query("sealedProducts")
            .withIndex("by_owner_and_release_date", (q) => q.eq("ownerId", viewer._id))
            .order("desc")
            .take(1_000),
    ]);
    return [...customProducts, ...globalProducts].map((product) =>
      toSealedProductResponse(product),
    );
  },
});

export const getProduct = internalQuery({
  args: { subject: v.string(), productId: v.id("sealedProducts") },
  returns: sealedProductResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const product = await ctx.db.get(args.productId);
    if (!product || (product.ownerId !== undefined && product.ownerId !== viewer._id)) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Sealed product not found" });
    }
    return toSealedProductResponse(product, true);
  },
});

const catalogProductValidator = v.object({
  catalogKey: v.string(),
  tcg: v.string(),
  name: v.string(),
  productType: v.string(),
  setCode: v.optional(v.string()),
  cardsPerPack: v.optional(v.number()),
  packsPerBox: v.optional(v.number()),
  releaseDate: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  msrp: v.optional(v.number()),
  upc: v.optional(v.string()),
  contentMode: v.optional(v.union(v.literal("fixed"), v.literal("pool"))),
  contents: v.optional(v.array(productContentValidator)),
  contentSource: v.optional(v.string()),
  contentUpdatedAt: v.optional(v.string()),
});

export const upsertCatalogProducts = internalMutation({
  args: { subject: v.string(), products: v.array(catalogProductValidator) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    if (!viewer.isAdmin) throw new ConvexError({ code: "FORBIDDEN", message: "Admin access required" });
    if (!args.products.length || args.products.length > 100) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Import 1 to 100 sealed products per request" });
    }
    let inserted = 0;
    let updated = 0;
    const timestamp = Date.now();
    for (const product of args.products) {
      if ((product.contents?.length ?? 0) > 1_000) {
        throw new ConvexError({ code: "BAD_REQUEST", message: `${product.name} exceeds 1,000 content rows` });
      }
      const catalogKey = cleanRequiredText(product.catalogKey, "catalogKey", 200);
      const existing = await ctx.db
        .query("sealedProducts")
        .withIndex("by_catalog_key", (query) => query.eq("catalogKey", catalogKey))
        .unique();
      const values = {
        catalogKey,
        ownerId: undefined,
        isCustom: false,
        tcg: cleanRequiredText(product.tcg, "tcg", 40).toLowerCase(),
        name: cleanRequiredText(product.name, "name"),
        productType: cleanRequiredText(product.productType, "productType", 80),
        setCode: cleanOptionalText(product.setCode, 80),
        cardsPerPack: optionalPositiveInteger(product.cardsPerPack, "cardsPerPack"),
        packsPerBox: optionalPositiveInteger(product.packsPerBox, "packsPerBox"),
        releaseDate: product.releaseDate ? parseIsoDate(product.releaseDate, "releaseDate") : undefined,
        imageUrl: cleanOptionalText(product.imageUrl, 2_000),
        msrp: optionalNonnegativeNumber(product.msrp, "msrp"),
        upc: cleanOptionalText(product.upc, 80),
        contentMode: product.contentMode,
        contents: product.contents,
        contentSource: cleanOptionalText(product.contentSource, 2_000),
        contentUpdatedAt: product.contentUpdatedAt
          ? parseIsoDate(product.contentUpdatedAt, "contentUpdatedAt")
          : product.contents
            ? timestamp
            : undefined,
        updatedAt: timestamp,
      };
      if (existing) {
        if (existing.ownerId !== undefined) {
          throw new ConvexError({ code: "CONFLICT", message: `${catalogKey} belongs to a custom product` });
        }
        await ctx.db.patch(existing._id, values);
        updated += 1;
      } else {
        await ctx.db.insert("sealedProducts", { ...values, createdAt: timestamp });
        inserted += 1;
      }
    }
    return { inserted, updated };
  },
});

const customProductArgs = {
  tcg: v.string(),
  name: v.string(),
  productType: v.string(),
  setCode: v.optional(v.string()),
  cardsPerPack: v.optional(v.number()),
  packsPerBox: v.optional(v.number()),
  releaseDate: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  msrp: v.optional(v.number()),
  upc: v.optional(v.string()),
};

export const createCustomProduct = internalMutation({
  args: { subject: v.string(), ...customProductArgs },
  returns: sealedProductResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const timestamp = Date.now();
    const id = await ctx.db.insert("sealedProducts", {
      catalogKey: `custom:${viewer._id}:${crypto.randomUUID()}`,
      ownerId: viewer._id,
      isCustom: true,
      tcg: cleanRequiredText(args.tcg, "tcg", 40).toLowerCase(),
      name: cleanRequiredText(args.name, "name"),
      productType: cleanRequiredText(args.productType, "productType", 80),
      setCode: cleanOptionalText(args.setCode, 80),
      cardsPerPack: optionalPositiveInteger(args.cardsPerPack, "cardsPerPack"),
      packsPerBox: optionalPositiveInteger(args.packsPerBox, "packsPerBox"),
      releaseDate: args.releaseDate ? parseIsoDate(args.releaseDate, "releaseDate") : undefined,
      imageUrl: cleanOptionalText(args.imageUrl, 2_000),
      msrp: optionalNonnegativeNumber(args.msrp, "msrp"),
      upc: cleanOptionalText(args.upc, 80),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const product = await ctx.db.get(id);
    if (!product) throw new ConvexError({ code: "INVARIANT", message: "Custom product was not created" });
    return toSealedProductResponse(product);
  },
});

export const updateCustomProduct = internalMutation({
  args: { subject: v.string(), productId: v.id("sealedProducts"), ...customProductArgs },
  returns: sealedProductResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const product = await ctx.db.get(args.productId);
    if (!product || product.ownerId !== viewer._id || product.isCustom !== true) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Custom sealed product not found" });
    }
    await ctx.db.patch(product._id, {
      tcg: cleanRequiredText(args.tcg, "tcg", 40).toLowerCase(),
      name: cleanRequiredText(args.name, "name"),
      productType: cleanRequiredText(args.productType, "productType", 80),
      setCode: cleanOptionalText(args.setCode, 80),
      cardsPerPack: optionalPositiveInteger(args.cardsPerPack, "cardsPerPack"),
      packsPerBox: optionalPositiveInteger(args.packsPerBox, "packsPerBox"),
      releaseDate: args.releaseDate ? parseIsoDate(args.releaseDate, "releaseDate") : undefined,
      imageUrl: cleanOptionalText(args.imageUrl, 2_000),
      msrp: optionalNonnegativeNumber(args.msrp, "msrp"),
      upc: cleanOptionalText(args.upc, 80),
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get(product._id);
    if (!updated) throw new ConvexError({ code: "INVARIANT", message: "Custom product was not updated" });
    return toSealedProductResponse(updated);
  },
});

export const deleteCustomProduct = internalMutation({
  args: { subject: v.string(), productId: v.id("sealedProducts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const product = await ctx.db.get(args.productId);
    if (!product || product.ownerId !== viewer._id || product.isCustom !== true) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Custom sealed product not found" });
    }
    const inventory = await ctx.db
      .query("sealedInventory")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .first();
    if (inventory) {
      throw new ConvexError({ code: "CONFLICT", message: "Remove this product from inventory before deleting it" });
    }
    await ctx.db.delete(product._id);
    return null;
  },
});

export const listInventory = internalQuery({
  args: {
    subject: v.string(),
  },
  returns: v.array(sealedInventoryResponseValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const items = await ctx.db
      .query("sealedInventory")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .order("desc")
      .take(1_000);
    return await Promise.all(
      items.map(async (item) => {
        const product = await ctx.db.get(item.productId);
        if (!product) {
          throw new ConvexError({
            code: "INVARIANT",
            message: "Sealed inventory product is missing",
          });
        }
        return toSealedInventoryResponse(item, product);
      }),
    );
  },
});

export const addInventory = internalMutation({
  args: {
    subject: v.string(),
    productId: v.id("sealedProducts"),
    quantity: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: sealedInventoryResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const product = await ctx.db.get(args.productId);
    if (!product || (product.ownerId !== undefined && product.ownerId !== viewer._id)) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Sealed product not found",
      });
    }
    const quantity = requirePositiveInteger(args.quantity ?? 1, "quantity");
    const purchasePrice =
      args.purchasePrice === undefined
        ? undefined
        : requireNonnegativeNumber(args.purchasePrice, "purchasePrice");
    const timestamp = Date.now();
    const inventoryId = await ctx.db.insert("sealedInventory", {
      userId: viewer._id,
      productId: product._id,
      quantity,
      purchasePrice,
      purchaseDate:
        args.purchaseDate === undefined
          ? undefined
          : parseIsoDate(args.purchaseDate, "purchaseDate"),
      notes: args.notes,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const inventory = await ctx.db.get(inventoryId);
    if (!inventory) {
      throw new ConvexError({
        code: "INVARIANT",
        message: "Sealed inventory item could not be created",
      });
    }
    return toSealedInventoryResponse(inventory, product);
  },
});

export const updateInventory = internalMutation({
  args: {
    subject: v.string(),
    itemId: v.id("sealedInventory"),
    quantity: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: sealedInventoryResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const inventory = await requireInventoryForUser(
      ctx,
      args.itemId,
      viewer._id,
    );
    if (
      args.quantity === undefined &&
      args.purchasePrice === undefined &&
      args.purchaseDate === undefined &&
      args.notes === undefined
    ) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "At least one field must be provided",
      });
    }
    await ctx.db.patch(inventory._id, {
      quantity:
        args.quantity === undefined
          ? inventory.quantity
          : requirePositiveInteger(args.quantity, "quantity"),
      purchasePrice:
        args.purchasePrice === undefined
          ? inventory.purchasePrice
          : requireNonnegativeNumber(args.purchasePrice, "purchasePrice"),
      purchaseDate:
        args.purchaseDate === undefined
          ? inventory.purchaseDate
          : parseIsoDate(args.purchaseDate, "purchaseDate"),
      notes: args.notes === undefined ? inventory.notes : args.notes,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get(inventory._id);
    const product = await ctx.db.get(inventory.productId);
    if (!updated || !product) {
      throw new ConvexError({
        code: "INVARIANT",
        message: "Sealed inventory item could not be updated",
      });
    }
    return toSealedInventoryResponse(updated, product);
  },
});

export const deleteInventory = internalMutation({
  args: {
    subject: v.string(),
    itemId: v.id("sealedInventory"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const inventory = await requireInventoryForUser(
      ctx,
      args.itemId,
      viewer._id,
    );
    const opening = await ctx.db
      .query("sealedOpenings")
      .withIndex("by_sealed_inventory", (q) =>
        q.eq("sealedInventoryId", inventory._id),
      )
      .first();
    if (opening) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Inventory with opening history cannot be deleted",
      });
    }
    await ctx.db.delete(inventory._id);
    return null;
  },
});

export const createOpening = internalMutation({
  args: {
    subject: v.string(),
    inventoryId: v.id("sealedInventory"),
    openedQuantity: v.optional(v.number()),
    collectionIds: v.optional(v.array(v.id("collectionEntries"))),
    openedAt: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: sealedOpeningResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const inventory = await requireInventoryForUser(
      ctx,
      args.inventoryId,
      viewer._id,
    );
    const openedQuantity = requirePositiveInteger(
      args.openedQuantity ?? 1,
      "openedQuantity",
    );
    if (inventory.quantity < openedQuantity) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Opened quantity exceeds sealed inventory",
      });
    }

    const collectionIds = [...new Set(args.collectionIds ?? [])];
    if (collectionIds.length > 500) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "collectionIds cannot contain more than 500 items",
      });
    }
    const collections: Array<{
      entry: Doc<"collectionEntries">;
      card: Doc<"cards">;
    }> = [];
    for (const collectionId of collectionIds) {
      const entry = await ctx.db.get(collectionId);
      if (!entry || entry.userId !== viewer._id) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "One or more collection copies were not found",
        });
      }
      const existingLink = await ctx.db
        .query("sealedOpenedCards")
        .withIndex("by_collection", (q) => q.eq("collectionId", entry._id))
        .first();
      if (existingLink) {
        throw new ConvexError({
          code: "CONFLICT",
          message: "A collection copy is already linked to an opening",
        });
      }
      const card = await ctx.db.get(entry.cardId);
      if (!card) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "One or more collection copies were not found",
        });
      }
      collections.push({ entry, card });
    }

    const timestamp = Date.now();
    const openingId = await ctx.db.insert("sealedOpenings", {
      userId: viewer._id,
      sealedInventoryId: inventory._id,
      openedQuantity,
      openedAt:
        args.openedAt === undefined
          ? timestamp
          : parseIsoDate(args.openedAt, "openedAt"),
      notes: args.notes,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    for (const { entry, card } of collections) {
      await ctx.db.insert("sealedOpenedCards", {
        userId: viewer._id,
        openingId,
        collectionId: entry._id,
        externalId: card.externalId,
        tcg: card.tcg,
        cardName: card.name,
        quantity: entry.quantity,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    await ctx.db.patch(inventory._id, {
      quantity: inventory.quantity - openedQuantity,
      updatedAt: timestamp,
    });
    const opening = await ctx.db.get(openingId);
    if (!opening) {
      throw new ConvexError({
        code: "INVARIANT",
        message: "Sealed opening could not be created",
      });
    }
    return toSealedOpeningResponse(opening);
  },
});

export const recordOpenedCardSale = internalMutation({
  args: {
    subject: v.string(),
    openedCardId: v.id("sealedOpenedCards"),
    proceeds: v.number(),
    soldAt: v.optional(v.string()),
  },
  returns: sealedOpenedCardResponseValidator,
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const card = await ctx.db.get(args.openedCardId);
    if (!card || card.userId !== viewer._id) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Opened card ledger entry not found",
      });
    }
    const timestamp = Date.now();
    await ctx.db.patch(card._id, {
      status: "sold",
      realizedProceeds: requireNonnegativeNumber(args.proceeds, "proceeds"),
      soldAt:
        args.soldAt === undefined
          ? timestamp
          : parseIsoDate(args.soldAt, "soldAt"),
      updatedAt: timestamp,
    });
    const updated = await ctx.db.get(card._id);
    if (!updated) {
      throw new ConvexError({
        code: "INVARIANT",
        message: "Opened card ledger entry could not be updated",
      });
    }
    return toSealedOpenedCardResponse(updated);
  },
});

export const listOpeningLedgers = internalQuery({
  args: {
    subject: v.string(),
  },
  returns: v.array(sealedOpeningLedgerValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerBySubject(ctx, args.subject);
    const openings = await ctx.db
      .query("sealedOpenings")
      .withIndex("by_user_and_opened_at", (q) => q.eq("userId", viewer._id))
      .order("desc")
      .take(1_000);

    return await Promise.all(
      openings.map(async (opening) => {
        const inventory = await ctx.db.get(opening.sealedInventoryId);
        const product = inventory
          ? await ctx.db.get(inventory.productId)
          : null;
        if (!inventory || !product) {
          throw new ConvexError({
            code: "INVARIANT",
            message: "Sealed opening inventory is missing",
          });
        }
        const openedCards = await ctx.db
          .query("sealedOpenedCards")
          .withIndex("by_opening", (q) => q.eq("openingId", opening._id))
          .take(1_000);
        const cards = await Promise.all(
          openedCards.map(async (openedCard) => {
            const collection =
              openedCard.status === "active" && openedCard.collectionId
                ? await ctx.db.get(openedCard.collectionId)
                : null;
            const liveValue =
              collection?.price !== undefined &&
              Number.isFinite(collection.price) &&
              collection.price > 0
                ? collection.price * collection.quantity
                : 0;
            return {
              id: openedCard._id,
              collectionId: openedCard.collectionId,
              externalId: openedCard.externalId,
              tcg: openedCard.tcg,
              cardName: openedCard.cardName,
              quantity: openedCard.quantity,
              status: openedCard.status,
              liveValue,
              realizedProceeds: openedCard.realizedProceeds ?? 0,
              soldAt:
                openedCard.soldAt === undefined
                  ? undefined
                  : new Date(openedCard.soldAt).toISOString(),
            };
          }),
        );
        const invested =
          (inventory.purchasePrice ?? 0) * opening.openedQuantity;
        const liveValue = cards.reduce((sum, card) => sum + card.liveValue, 0);
        const realizedProceeds = cards.reduce(
          (sum, card) => sum + card.realizedProceeds,
          0,
        );
        return {
          id: opening._id,
          inventoryId: opening.sealedInventoryId,
          productName: product.name,
          openedQuantity: opening.openedQuantity,
          openedAt: new Date(opening.openedAt).toISOString(),
          invested,
          liveValue,
          realizedProceeds,
          profitLoss: liveValue + realizedProceeds - invested,
          activeCopies: cards
            .filter((card) => card.status === "active")
            .reduce((sum, card) => sum + card.quantity, 0),
          soldCopies: cards
            .filter((card) => card.status === "sold")
            .reduce((sum, card) => sum + card.quantity, 0),
          cards,
        };
      }),
    );
  },
});

export const simulatePackOpening = internalQuery({
  args: {
    tcg: v.string(),
    setCode: v.string(),
  },
  returns: v.object({
    cards: v.array(v.any()),
    setCode: v.string(),
    setName: v.string(),
    message: v.string(),
  }),
  handler: async (_ctx, args) => ({
    cards: [],
    setCode: args.setCode,
    setName: args.setCode,
    message: "Pack opening simulation — connect to adapter for real card data",
  }),
});
