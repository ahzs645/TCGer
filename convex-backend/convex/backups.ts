import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id, TableNames } from "./_generated/dataModel";
import {
  normalizePortableBackup,
  type PortableBackup,
} from "../../packages/api-types/src/portable-backup";
import { hydrateEntry, replaceEntryTags, upsertCard } from "./lib/library";
import type { TcgCode } from "./lib/validators";

const MAX_ROWS = 1500;
const fail = (message: string): never => {
  throw new ConvexError({ code: "BAD_REQUEST", message });
};
const clean = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (_key, item) => (item === null ? undefined : item)),
  );
const iso = (value: number) => new Date(value).toISOString();
const date = (value: unknown, fallback = Date.now()) => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : fallback;
  if (!Number.isFinite(parsed)) fail("Invalid backup date");
  return parsed;
};
const pick = (row: Record<string, any>, fields: string[]) =>
  clean(
    Object.fromEntries(
      fields
        .filter((field) => row[field] != null)
        .map((field) => [field, row[field]]),
    ),
  );
async function viewer(ctx: QueryCtx | MutationCtx, subject: string) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", subject))
    .unique();
  if (!user) fail("Sign in before transferring a backup");
  return user!;
}
function bounded<T>(rows: T[]): T[] {
  if (rows.length > MAX_ROWS)
    fail(
      "This backup exceeds the 1,500-row atomic transfer limit. No data was changed. Export individual binders as CSV for a larger collection.",
    );
  return rows;
}

/** No secrets or other users' rows are included in the portable export. */
export async function snapshot(
  ctx: QueryCtx | MutationCtx,
  subject: string,
): Promise<PortableBackup> {
  const user = await viewer(ctx, subject);
  const binders = bounded(
    await ctx.db
      .query("binders")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_ROWS + 1),
  );
  const entries = bounded(
    await ctx.db
      .query("collectionEntries")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_ROWS + 1),
  );
  const hydrated = await Promise.all(
    entries.map((entry) => hydrateEntry(ctx, entry)),
  );
  const lists = bounded(
    await ctx.db
      .query("wishlists")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_ROWS + 1),
  );
  const inventory = bounded(
    await ctx.db
      .query("sealedInventory")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_ROWS + 1),
  );
  const state = await ctx.db
    .query("backupStates")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .unique();
  const transactions = bounded(
    await ctx.db
      .query("transactions")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
      .take(MAX_ROWS + 1),
  );
  const codes = bounded(
    await ctx.db
      .query("onlineCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_ROWS + 1),
  );
  const pages = (
    await Promise.all(
      binders.map((binder) =>
        ctx.db
          .query("binderPages")
          .withIndex("by_binder", (q) => q.eq("binderId", binder._id))
          .take(MAX_ROWS + 1),
      ),
    )
  ).flat();
  bounded(pages);
  const decks = bounded(
    await ctx.db
      .query("decks")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_ROWS + 1),
  );
  const deckCards = (
    await Promise.all(
      decks.map((deck) =>
        ctx.db
          .query("deckCards")
          .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
          .take(MAX_ROWS + 1),
      ),
    )
  ).flat();
  bounded(deckCards);
  const openings = bounded(
    await ctx.db
      .query("sealedOpenings")
      .withIndex("by_user_and_opened_at", (q) => q.eq("userId", user._id))
      .take(MAX_ROWS + 1),
  );
  const openedCards = bounded(
    await ctx.db
      .query("sealedOpenedCards")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_ROWS + 1),
  );
  const alerts = bounded(
    await ctx.db
      .query("priceAlerts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(MAX_ROWS + 1),
  );
  const prefs = pick(user, [
    "showPricing",
    "showCardNumbers",
    "enabledPokemon",
    "enabledMagic",
    "enabledYugioh",
    "enabledOnepiece",
    "enabledLorcana",
    "enabledDragonball",
    "defaultGame",
    "focusedSetOrder",
    "setCompletionMode",
  ]);
  const portable = (row: Record<string, any>) => {
    const { _id, _creationTime, userId, ...fields } = row;
    return { ...fields, id: _id };
  };
  return normalizePortableBackup(
    clean({
      format: "com.tcger.portable-backup",
      formatVersion: 2,
      exportedAt: iso(Date.now()),
      binders: binders.map((binder) => ({
        ...portable(binder),
        colorHex: binder.colorHex ?? "315DA8",
        cards: hydrated
          .filter((entry) => entry.binderId === binder._id)
          .map((entry) => ({
            id: entry.id,
            card: { ...entry.card, id: entry.card.externalId },
            quantity: entry.quantity,
            condition: entry.condition,
            price: entry.price,
            acquisitionPrice: entry.acquisitionPrice,
            details: pick(entry, [
              "language",
              "notes",
              "serialNumber",
              "acquiredAt",
              "isFoil",
              "finishCode",
              "finishLabel",
              "edition",
              "stamp",
              "isSealedPromo",
              "isOversized",
              "isPeelOff",
              "isSigned",
              "isAltered",
              "gradingCompany",
              "gradingScore",
              "certNumber",
              "storageLocation",
              "imageUrls",
              "tags",
            ]),
          })),
      })),
      wishlists: await Promise.all(
        lists.map(async (list) => ({
          ...portable(list),
          colorHex: list.colorHex ?? "315DA8",
          matchAnyPrinting: list.matchAnyPrinting ?? false,
          cards: bounded(
            await ctx.db
              .query("wishlistCards")
              .withIndex("by_wishlist", (q) => q.eq("wishlistId", list._id))
              .take(MAX_ROWS + 1),
          ).map((card) => ({
            id: card._id,
            card: { ...portable(card), id: card.externalId },
            desiredQuantity: card.desiredQuantity ?? 1,
            notes: card.notes,
          })),
          rules: bounded(
            await ctx.db
              .query("wishlistRules")
              .withIndex("by_wishlist", (q) => q.eq("wishlistId", list._id))
              .take(MAX_ROWS + 1),
          ).map((rule) => ({
            ...portable(rule),
            lastSyncedAt: rule.lastSyncedAt
              ? iso(rule.lastSyncedAt)
              : undefined,
            createdAt: iso(rule.createdAt),
            updatedAt: iso(rule.updatedAt),
          })),
        })),
      ),
      sealedInventory: await Promise.all(
        inventory.map(async (item) => {
          const product = (await ctx.db.get(item.productId))!;
          return {
            ...portable(item),
            productId: String(product._id),
            productName: product.name,
            product: {
              ...portable(product),
              releaseDate: product.releaseDate
                ? iso(product.releaseDate)
                : undefined,
            },
            purchaseDate: item.purchaseDate
              ? iso(item.purchaseDate)
              : undefined,
          };
        }),
      ),
      sections: {
        retainedStorageId: state?.sectionsStorageId,
        copyImageStorageIds: Object.fromEntries(
          entries
            .filter((entry) => entry.imageStorageIds?.length)
            .map((entry) => [entry._id, entry.imageStorageIds]),
        ),
        transactions: transactions.map((item) => ({
          ...portable(item),
          date: iso(item.date),
          acquiredAt: item.acquiredAt ? iso(item.acquiredAt) : undefined,
        })),
        onlineCodes: codes.map((item) => ({
          ...portable(item),
          capturedAt: iso(item.capturedAt),
          redeemedAt: item.redeemedAt ? iso(item.redeemedAt) : undefined,
          createdAt: iso(item.createdAt),
          updatedAt: iso(item.updatedAt),
        })),
        binderPages: pages.map((item) => ({
          ...portable(item),
          capturedAt: iso(item.capturedAt),
          createdAt: iso(item.createdAt),
          updatedAt: iso(item.updatedAt),
        })),
        preferences: prefs,
        hosted: {
          decks: decks.map(portable),
          deckCards: deckCards.map(portable),
          sealedOpenings: openings.map(portable),
          sealedOpenedCards: openedCards.map(portable),
          priceAlerts: alerts.map(portable),
        },
      },
    }),
  );
}
export const exportData = internalQuery({
  args: { subject: v.string() },
  returns: v.string(),
  handler: async (ctx, args) =>
    JSON.stringify(await snapshot(ctx, args.subject)),
});
export const recovery = internalQuery({
  args: { subject: v.string() },
  returns: v.union(v.id("_storage"), v.null()),
  handler: async (ctx, args) => {
    const user = await viewer(ctx, args.subject);
    return (
      (
        await ctx.db
          .query("backupStates")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .unique()
      )?.recoveryStorageId ?? null
    );
  },
});

export const importData = internalMutation({
  args: {
    subject: v.string(),
    document: v.string(),
    sectionsStorageId: v.id("_storage"),
    recoveryStorageId: v.id("_storage"),
    replace: v.optional(v.boolean()),
    expectedSnapshot: v.string(),
  },
  returns: v.object({
    importedCopies: v.number(),
    importedBinders: v.number(),
  }),
  handler: async (ctx, args) => {
    const backup = normalizePortableBackup(JSON.parse(args.document));
    const user = await viewer(ctx, args.subject);
    const now = Date.now();
    const current = await snapshot(ctx, args.subject);
    const expected = normalizePortableBackup(JSON.parse(args.expectedSnapshot));
    if (
      JSON.stringify({ ...current, exportedAt: "" }) !==
      JSON.stringify({ ...expected, exportedAt: "" })
    )
      fail(
        "Your collection changed while the backup was being prepared. Retry the import to include those changes in its recovery point.",
      );
    let writes = backup.binders.reduce(
      (n, binder) =>
        n +
        binder.cards.reduce(
          (sum, card) =>
            sum + card.quantity * (2 + (card.details.tags?.length ?? 0)),
          2,
        ),
      0,
    );
    writes += backup.wishlists.reduce(
      (n, list) => n + list.cards.length * 2 + list.rules.length * 2 + 2,
      0,
    );
    writes += backup.sealedInventory.length * 4;
    if (writes > 5500)
      fail("Backup is too large for one atomic import. No data was changed.");
    if (args.replace) {
      const ownedBinders = bounded(
        await ctx.db
          .query("binders")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .take(MAX_ROWS + 1),
      );
      const ownedLists = bounded(
        await ctx.db
          .query("wishlists")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .take(MAX_ROWS + 1),
      );
      const ownedDecks = bounded(
        await ctx.db
          .query("decks")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .take(MAX_ROWS + 1),
      );
      for (const binder of ownedBinders)
        for (const row of bounded(
          await ctx.db
            .query("binderPages")
            .withIndex("by_binder", (q) => q.eq("binderId", binder._id))
            .take(MAX_ROWS + 1),
        ))
          await ctx.db.delete(row._id);
      for (const list of ownedLists) {
        for (const row of bounded(
          await ctx.db
            .query("wishlistCards")
            .withIndex("by_wishlist", (q) => q.eq("wishlistId", list._id))
            .take(MAX_ROWS + 1),
        ))
          await ctx.db.delete(row._id);
        for (const row of bounded(
          await ctx.db
            .query("wishlistRules")
            .withIndex("by_wishlist", (q) => q.eq("wishlistId", list._id))
            .take(MAX_ROWS + 1),
        ))
          await ctx.db.delete(row._id);
      }
      for (const deck of ownedDecks)
        for (const row of bounded(
          await ctx.db
            .query("deckCards")
            .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
            .take(MAX_ROWS + 1),
        ))
          await ctx.db.delete(row._id);
      const rows = [
        ...bounded(
          await ctx.db
            .query("onlineCodes")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .take(MAX_ROWS + 1),
        ),
        ...bounded(
          await ctx.db
            .query("transactions")
            .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
            .take(MAX_ROWS + 1),
        ),
        ...bounded(
          await ctx.db
            .query("sealedOpenedCards")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .take(MAX_ROWS + 1),
        ),
        ...bounded(
          await ctx.db
            .query("sealedOpenings")
            .withIndex("by_user_and_opened_at", (q) => q.eq("userId", user._id))
            .take(MAX_ROWS + 1),
        ),
        ...bounded(
          await ctx.db
            .query("sealedInventory")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .take(MAX_ROWS + 1),
        ),
        ...bounded(
          await ctx.db
            .query("priceAlerts")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .take(MAX_ROWS + 1),
        ),
      ];
      for (const row of rows) await ctx.db.delete(row._id);
      for (const list of ownedLists)
        if (!backup.wishlists.some((item) => item.id === list._id))
          await ctx.db.delete(list._id);
      for (const deck of ownedDecks)
        if (
          !((backup.sections.hosted as any)?.decks ?? []).some(
            (item: any) => item.id === deck._id,
          )
        )
          await ctx.db.delete(deck._id);
      for (const binder of ownedBinders)
        if (
          !backup.binders.some((item) => item.id === binder._id) &&
          binder.kind !== "library"
        ) {
          const container = await ctx.db
            .query("storageContainers")
            .withIndex("by_binder", (q) => q.eq("binderId", binder._id))
            .first();
          const share = await ctx.db
            .query("binderShareLinks")
            .withIndex("by_binder", (q) => q.eq("binderId", binder._id))
            .first();
          if (!container && !share) await ctx.db.delete(binder._id);
        }
    }
    const mapped = new Map<string, string>();
    async function resolve<T extends TableNames>(
      table: T,
      source: string,
    ): Promise<Id<T> | null> {
      const key = `${table}:${source}`;
      const cached = mapped.get(key);
      if (cached) return cached as Id<T>;
      const direct = ctx.db.normalizeId(table, source);
      if (direct) {
        const row = (await ctx.db.get(direct)) as any;
        if (
          row?.userId === user._id ||
          row?.ownerId === user._id ||
          (row?.wishlistId &&
            ((await ctx.db.get(row.wishlistId)) as any)?.userId === user._id) ||
          (row?.deckId &&
            ((await ctx.db.get(row.deckId)) as any)?.userId === user._id)
        ) {
          mapped.set(key, direct);
          return direct;
        }
      }
      const prior = await ctx.db
        .query("backupMappings")
        .withIndex("by_user_source", (q) =>
          q.eq("userId", user._id).eq("source", key),
        )
        .unique();
      if (!prior) return null;
      const id = ctx.db.normalizeId(table, prior.target);
      if (!id || !(await ctx.db.get(id))) return null;
      mapped.set(key, id);
      return id;
    }
    async function save<T extends TableNames>(
      table: T,
      source: string,
      fields: any,
    ): Promise<Id<T>> {
      const library =
        table === "binders" && fields.kind === "library"
          ? await ctx.db
              .query("binders")
              .withIndex("by_user_kind", (q) =>
                q.eq("userId", user._id).eq("kind", "library"),
              )
              .first()
          : null;
      const prior =
        (library?._id as Id<T> | undefined) ?? (await resolve(table, source));
      if (prior) {
        await ctx.db.replace(prior, clean(fields));
        mapped.set(`${table}:${source}`, prior);
        return prior;
      }
      const id = await ctx.db.insert(table, clean(fields));
      const key = `${table}:${source}`;
      const mapping = await ctx.db
        .query("backupMappings")
        .withIndex("by_user_source", (q) =>
          q.eq("userId", user._id).eq("source", key),
        )
        .unique();
      if (mapping) await ctx.db.patch(mapping._id, { target: id });
      else
        await ctx.db.insert("backupMappings", {
          userId: user._id,
          source: key,
          target: id,
        });
      mapped.set(key, id);
      return id;
    }
    const importedEntries = new Set<string>();
    for (const binder of backup.binders) {
      const binderId = await save("binders", binder.id!, {
        userId: user._id,
        kind:
          binder.id === "__library__" || binder.kind === "library"
            ? "library"
            : "binder",
        ...pick(binder, [
          "name",
          "description",
          "colorHex",
          "defaultCondition",
          "containerType",
          "imageUrl",
          "associatedTcg",
          "associatedSetCode",
          "associatedSetName",
        ]),
        createdAt: now,
        updatedAt: now,
      });
      for (const owned of binder.cards) {
        const cardId = await upsertCard(ctx, {
          ...pick(owned.card, [
            "setCode",
            "setName",
            "rarity",
            "collectorNumber",
            "imageUrl",
          ]),
          externalId: owned.card.id,
          tcg: owned.card.tcg,
          name: owned.card.name,
        });
        for (let copy = 0; copy < owned.quantity; copy++) {
          const source = copy === 0 ? owned.id! : `${owned.id}:${copy}`;
          const id = await save("collectionEntries", source, {
            userId: user._id,
            binderId,
            cardId,
            quantity: 1,
            ...pick(owned, ["condition", "price", "acquisitionPrice"]),
            ...pick(owned.details, [
              "language",
              "notes",
              "serialNumber",
              "acquiredAt",
              "isFoil",
              "finishCode",
              "finishLabel",
              "edition",
              "stamp",
              "isSealedPromo",
              "isOversized",
              "isPeelOff",
              "isSigned",
              "isAltered",
              "gradingCompany",
              "gradingScore",
              "certNumber",
              "storageLocation",
              "imageUrls",
            ]),
            imageStorageIds: (
              backup.sections._importedCopyImages as
                | Record<string, Id<"_storage">[]>
                | undefined
            )?.[owned.id!],
            createdAt: now,
            updatedAt: now,
          });
          importedEntries.add(id);
          await replaceEntryTags(
            ctx,
            id,
            user._id,
            [],
            owned.details.tags?.map((tag) => ({
              label: tag.label,
              colorHex: tag.colorHex,
            })) ?? [],
          );
        }
      }
    }
    for (const list of backup.wishlists) {
      const wishlistId = await save("wishlists", list.id!, {
        userId: user._id,
        ...pick(list, ["name", "description", "colorHex", "matchAnyPrinting", "excludedCardKeys"]),
        createdAt: now,
        updatedAt: now,
      });
      for (const [i, card] of list.cards.entries())
        await save(
          "wishlistCards",
          card.id ?? `${list.id}:${card.card.tcg}:${card.card.id}:${i}`,
          {
            wishlistId,
            externalId: card.card.id,
            ...pick(card.card, [
              "tcg",
              "name",
              "setCode",
              "setName",
              "rarity",
              "collectorNumber",
              "imageUrl",
            ]),
            desiredQuantity: card.desiredQuantity,
            notes: card.notes,
            createdAt: now,
            updatedAt: now,
          },
        );
      for (const [i, rule] of list.rules.entries())
        await save(
          "wishlistRules",
          typeof rule.id === "string" ? rule.id : `${list.id}:rule:${i}`,
          {
            wishlistId,
            ...pick(rule, [
              "type",
              "tcg",
              "query",
              "setCode",
              "setName",
              "lastMatchCount",
            ]),
            includeAllPrintings: rule.includeAllPrintings ?? true,
            autoSync: rule.autoSync ?? true,
            lastSyncedAt: rule.lastSyncedAt
              ? date(rule.lastSyncedAt)
              : undefined,
            createdAt: now,
            updatedAt: now,
          },
        );
    }
    for (const item of backup.sealedInventory) {
      const product = item.product ?? {};
      // Imported products are private to the viewer; backups cannot mutate the shared catalog.
      const productId = await save("sealedProducts", item.productId, {
        ownerId: user._id,
        catalogKey: `backup:${user._id}:${item.productId}`,
        isCustom: true,
        tcg: product.tcg ?? "pokemon",
        name: item.productName,
        productType: product.productType ?? "other",
        ...pick(product, [
          "setCode",
          "cardsPerPack",
          "packsPerBox",
          "imageUrl",
          "msrp",
          "upc",
          "contentMode",
          "contents",
          "contentSource",
        ]),
        releaseDate: product.releaseDate
          ? date(product.releaseDate)
          : undefined,
        createdAt: now,
        updatedAt: now,
      });
      await save("sealedInventory", item.id!, {
        userId: user._id,
        productId,
        quantity: item.quantity,
        purchasePrice: item.purchasePrice,
        purchaseDate: item.purchaseDate ? date(item.purchaseDate) : undefined,
        notes: item.notes,
        createdAt: now,
        updatedAt: now,
      });
    }
    const array = (name: string): Record<string, any>[] => {
      const value = backup.sections[name];
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.length > MAX_ROWS)
        fail(`Invalid or oversized ${name} section`);
      return value as Record<string, any>[];
    };
    for (const [i, item] of array("transactions").entries()) {
      if (
        !Number.isFinite(item.amount) ||
        item.amount <= 0 ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1
      )
        fail("Invalid transaction in backup");
      await save("transactions", item.id ?? `transaction:${i}`, {
        userId: user._id,
        ...pick(item, [
          "type",
          "cardId",
          "externalId",
          "tcg",
          "cardName",
          "quantity",
          "amount",
          "currency",
          "platform",
          "sourceUrl",
          "costBasis",
          "fees",
          "shippingCost",
          "notes",
        ]),
        collectionEntryId: item.collectionEntryId
          ? ((await resolve("collectionEntries", item.collectionEntryId)) ??
            undefined)
          : undefined,
        acquiredAt: item.acquiredAt ? date(item.acquiredAt) : undefined,
        date: date(item.date),
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const item of array("onlineCodes"))
      if (
        !["unused", "redeemed", "invalid", "traded"].includes(item.status) ||
        !["camera", "manual", "import"].includes(item.source)
      )
        fail("Invalid online code in backup");
    for (const [i, item] of array("onlineCodes").entries())
      await save("onlineCodes", item.id ?? `code:${i}`, {
        userId: user._id,
        ...pick(item, [
          "tcg",
          "code",
          "status",
          "source",
          "productName",
          "notes",
        ]),
        normalizedCode: String(item.code)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, ""),
        capturedAt: date(item.capturedAt),
        redeemedAt: item.redeemedAt ? date(item.redeemedAt) : undefined,
        createdAt: now,
        updatedAt: now,
      });
    for (const [i, item] of array("binderPages").entries()) {
      const binderId = await resolve("binders", item.binderId);
      if (!binderId) fail("Binder page references a missing binder");
      // Storage IDs are injected by the authenticated HTTP action, never accepted from the document.
      await save("binderPages", item.id ?? `page:${i}`, {
        userId: user._id,
        binderId,
        pageNumber: item.pageNumber,
        revision: item.revision ?? 1,
        capturedAt: date(item.capturedAt),
        placements: item.placements ?? [],
        imageStorageId: item._importedImageStorageId,
        createdAt: now,
        updatedAt: now,
      });
    }
    const hosted = (backup.sections.hosted ?? {}) as Record<string, any>;
    for (const item of hosted.decks ?? [])
      await save("decks", item.id, {
        userId: user._id,
        ...pick(item, ["name", "description", "tcg", "format", "colorHex", "rules"]),
        isPublic: false,
        createdAt: now,
        updatedAt: now,
      });
    for (const item of hosted.deckCards ?? []) {
      const deckId = await resolve("decks", item.deckId);
      if (!deckId) fail("Deck card references a missing deck");
      await save("deckCards", item.id, {
        deckId,
        ...pick(item, [
          "externalId",
          "tcg",
          "name",
          "quantity",
          "zone",
          "isCommander",
          "isSideboard",
          "imageUrl",
          "imageUrlSmall",
          "setCode",
          "setName",
          "cardData",
        ]),
      });
    }
    for (const item of hosted.sealedOpenings ?? []) {
      const sealedInventoryId = await resolve(
        "sealedInventory",
        item.sealedInventoryId,
      );
      if (!sealedInventoryId)
        fail("Opening references missing sealed inventory");
      await save("sealedOpenings", item.id, {
        userId: user._id,
        sealedInventoryId,
        ...pick(item, ["openedQuantity", "openedAt", "notes"]),
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const item of hosted.sealedOpenedCards ?? []) {
      const openingId = await resolve("sealedOpenings", item.openingId);
      if (!openingId) fail("Opening card references a missing opening");
      await save("sealedOpenedCards", item.id, {
        userId: user._id,
        openingId,
        collectionId: item.collectionId
          ? ((await resolve("collectionEntries", item.collectionId)) ??
            undefined)
          : undefined,
        ...pick(item, [
          "externalId",
          "tcg",
          "cardName",
          "quantity",
          "status",
          "realizedProceeds",
          "soldAt",
        ]),
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const item of hosted.priceAlerts ?? [])
      await save("priceAlerts", item.id, {
        userId: user._id,
        ...pick(item, [
          "tcg",
          "externalId",
          "finishCode",
          "cardName",
          "imageUrl",
          "direction",
          "threshold",
          "currency",
          "cooldownHours",
        ]),
        enabled: item.enabled ?? false,
        createdAt: date(item.createdAt, now),
        updatedAt: now,
      });
    const preferences = backup.sections.preferences;
    if (preferences && typeof preferences === "object")
      await ctx.db.patch(
        user._id,
        pick(preferences, [
          "showPricing",
          "showCardNumbers",
          "enabledPokemon",
          "enabledMagic",
          "enabledYugioh",
          "enabledOnepiece",
          "enabledLorcana",
          "enabledDragonball",
          "defaultGame",
          "focusedSetOrder",
          "setCompletionMode",
        ]),
      );
    if (args.replace) {
      const current = bounded(
        await ctx.db
          .query("collectionEntries")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .take(MAX_ROWS + 1),
      );
      for (const entry of current)
        if (!importedEntries.has(entry._id)) {
          await replaceEntryTags(ctx, entry._id, user._id, [], []);
          await ctx.db.delete(entry._id);
        }
    }
    const allTransactions = bounded(
      await ctx.db
        .query("transactions")
        .withIndex("by_user_and_date", (q) => q.eq("userId", user._id))
        .take(MAX_ROWS + 1),
    );
    const existingSummary = await ctx.db
      .query("financeSummaries")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    const summary = {
      userId: user._id,
      totalSpent: allTransactions
        .filter((t) => t.type === "purchase")
        .reduce((n, t) => n + t.amount, 0),
      totalEarned: allTransactions
        .filter((t) => t.type === "sale")
        .reduce((n, t) => n + t.amount, 0),
      transactionCount: allTransactions.length,
      updatedAt: now,
    };
    if (existingSummary) await ctx.db.patch(existingSummary._id, summary);
    else await ctx.db.insert("financeSummaries", summary);
    const state = await ctx.db
      .query("backupStates")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    const fields = {
      userId: user._id,
      sectionsStorageId: args.sectionsStorageId,
      recoveryStorageId: args.recoveryStorageId,
      updatedAt: now,
    };
    if (state) {
      await ctx.db.patch(state._id, fields);
      if (state.sectionsStorageId !== args.sectionsStorageId)
        await ctx.storage.delete(state.sectionsStorageId);
      if (state.recoveryStorageId !== args.recoveryStorageId)
        await ctx.storage.delete(state.recoveryStorageId);
    } else await ctx.db.insert("backupStates", fields);
    return {
      importedCopies: importedEntries.size,
      importedBinders: backup.binders.length,
    };
  },
});
