import { afterEach, describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import { createTestConvex } from "./test.setup";

afterEach(() => {
  vi.useRealTimers();
});

describe("account deletion", () => {
  test("removes user-owned data while preserving shared catalog data", async () => {
    vi.useFakeTimers();
    const t = createTestConvex();

    const seeded = await t.run(async (ctx) => {
      const timestamp = Date.now();
      const userId = await ctx.db.insert("users", {
        authSubject: "delete-me",
        email: "delete@example.com",
        isAdmin: false,
        showCardNumbers: true,
        showPricing: true,
        enabledYugioh: true,
        enabledMagic: true,
        enabledPokemon: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const otherUserId = await ctx.db.insert("users", {
        authSubject: "keep-me",
        email: "keep@example.com",
        isAdmin: false,
        showCardNumbers: true,
        showPricing: true,
        enabledYugioh: true,
        enabledMagic: true,
        enabledPokemon: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const cardId = await ctx.db.insert("cards", {
        tcg: "pokemon",
        externalId: "shared-card",
        name: "Shared Card",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const binderId = await ctx.db.insert("binders", {
        userId,
        kind: "library",
        name: "Library",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const entryId = await ctx.db.insert("collectionEntries", {
        userId,
        binderId,
        cardId,
        quantity: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const tagId = await ctx.db.insert("tags", {
        userId,
        label: "Favorite",
        colorHex: "ff0000",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("collectionEntryTags", {
        entryId,
        tagId,
        assignedAt: timestamp,
      });
      const wishlistId = await ctx.db.insert("wishlists", {
        userId,
        name: "Want",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("wishlistCards", {
        wishlistId,
        externalId: "wanted-card",
        tcg: "pokemon",
        name: "Wanted Card",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const deckId = await ctx.db.insert("decks", {
        userId,
        name: "Deck",
        tcg: "pokemon",
        isPublic: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("deckCards", {
        deckId,
        externalId: "deck-card",
        tcg: "pokemon",
        name: "Deck Card",
        quantity: 1,
        zone: "main",
        isCommander: false,
        isSideboard: false,
      });
      await ctx.db.insert("transactions", {
        userId,
        type: "purchase",
        quantity: 1,
        amount: 10,
        currency: "CAD",
        date: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("financeSummaries", {
        userId,
        totalSpent: 10,
        totalEarned: 0,
        transactionCount: 1,
        updatedAt: timestamp,
      });
      const tradeId = await ctx.db.insert("trades", {
        senderId: userId,
        receiverId: otherUserId,
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("tradeCards", {
        tradeId,
        side: "sender",
        externalId: "trade-card",
        tcg: "pokemon",
        name: "Trade Card",
        quantity: 1,
      });
      await ctx.db.insert("collectionMutationAudits", {
        userId,
        actorId: "delete-me",
        operationKind: "add",
        affectedCopies: 1,
        summary: "Added a card",
        beforeState: [],
        afterState: [],
        createdAt: timestamp,
      });
      await ctx.db.insert("collectionValueSnapshots", {
        userId,
        day: "2026-08-10",
        capturedAt: timestamp,
        totalValue: 10,
        byTcg: { pokemon: 10 },
      });

      return {
        userId,
        otherUserId,
        cardId,
        binderId,
        entryId,
        tagId,
        wishlistId,
        deckId,
        tradeId,
      };
    });

    await t.mutation(internal.accountDeletion.request, {
      authSubject: "delete-me",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const remaining = await t.run(async (ctx) => ({
      user: await ctx.db.get(seeded.userId),
      otherUser: await ctx.db.get(seeded.otherUserId),
      sharedCard: await ctx.db.get(seeded.cardId),
      binder: await ctx.db.get(seeded.binderId),
      entry: await ctx.db.get(seeded.entryId),
      tag: await ctx.db.get(seeded.tagId),
      wishlist: await ctx.db.get(seeded.wishlistId),
      deck: await ctx.db.get(seeded.deckId),
      trade: await ctx.db.get(seeded.tradeId),
    }));

    expect(remaining).toMatchObject({
      user: null,
      binder: null,
      entry: null,
      tag: null,
      wishlist: null,
      deck: null,
      trade: null,
    });
    expect(remaining.otherUser).not.toBeNull();
    expect(remaining.sharedCard).not.toBeNull();
  });
});
