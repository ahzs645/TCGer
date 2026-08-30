import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

function bridgeHeaders(subject: string, username: string) {
  return {
    Authorization: "Bearer local-test-token",
    "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
    "x-tcger-user-id": subject,
    "x-tcger-user-email": `${username}@example.com`,
    "x-tcger-username": username
  };
}

const senderCard = {
  externalId: "sol-ring",
  tcg: "magic",
  name: "Sol Ring",
  quantity: 1,
  estimatedValue: 4.5
};

function utcDayOffset(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

describe("analytics and trades Convex HTTP routes", () => {
  test("aggregates live collection value, breakdown, and distribution", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "user_avery", name: "Avery" });
    await asAvery.mutation(api.users.ensureCurrent, { username: "avery" });
    const binder = await asAvery.mutation(api.binders.create, { name: "Analytics Binder" });
    await asAvery.mutation(api.collections.addToBinder, {
      binderId: binder.id,
      quantity: 2,
      price: 12.5,
      card: {
        externalId: "sol-ring",
        tcg: "magic",
        name: "Sol Ring",
        rarity: "Uncommon",
        attributes: { colors: ["Colorless"], cardType: "Artifact" }
      }
    });
    await asAvery.mutation(api.collections.addToBinder, {
      binderId: binder.id,
      price: 5,
      card: {
        externalId: "sv1-001",
        tcg: "pokemon",
        name: "Bulbasaur",
        rarity: "Common",
        attributes: { types: ["Grass"] }
      }
    });

    const headers = bridgeHeaders("user_avery", "avery");
    const [valueResponse, breakdownResponse, distributionResponse] = await Promise.all([
      t.fetch("/analytics/value?period=7d", { headers }),
      t.fetch("/analytics/value/breakdown", { headers }),
      t.fetch("/analytics/distribution?by=tcg", { headers })
    ]);
    const value = await valueResponse.json();
    const breakdown = await breakdownResponse.json();
    const distribution = await distributionResponse.json();

    expect(valueResponse.status).toBe(200);
    expect(value).toEqual({
      history: [{ date: utcDayOffset(0), value: 30 }],
      currentValue: 30,
      changePercent: 0,
      changePeriod: "7d"
    });
    expect(breakdownResponse.status).toBe(200);
    expect(breakdown.byTcg).toEqual(
      expect.arrayContaining([
        { tcg: "magic", value: 25, cardCount: 2 },
        { tcg: "pokemon", value: 5, cardCount: 1 }
      ])
    );
    expect(breakdown.byBinder).toContainEqual({
      binderId: binder.id,
      binderName: "Analytics Binder",
      value: 30,
      cardCount: 3
    });
    expect(breakdown.topCards[0]).toMatchObject({ name: "Sol Ring", value: 25 });
    expect(distributionResponse.status).toBe(200);
    expect(distribution).toEqual({
      dimension: "tcg",
      entries: [
        { label: "magic", count: 2, percentage: 66.67 },
        { label: "pokemon", count: 1, percentage: 33.33 }
      ],
      total: 3
    });

    const [magicValueResponse, pokemonRarityResponse] = await Promise.all([
      t.fetch("/analytics/value?period=7d&tcg=magic", { headers }),
      t.fetch("/analytics/distribution?by=rarity&tcg=pokemon", { headers })
    ]);
    expect(await magicValueResponse.json()).toEqual({
      history: [{ date: utcDayOffset(0), value: 25 }],
      currentValue: 25,
      changePercent: 0,
      changePeriod: "7d"
    });
    expect(await pokemonRarityResponse.json()).toEqual({
      dimension: "rarity",
      entries: [{ label: "Common", count: 1, percentage: 100 }],
      total: 1
    });
  });

  test("finds exact-printing duplicates with configurable keep count", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "duplicates_avery", name: "Avery" });
    const avery = await asAvery.mutation(api.users.ensureCurrent, {
      username: "duplicates-avery"
    });
    const tradeBinder = await asAvery.mutation(api.binders.create, {
      name: "Trade Binder"
    });
    const blackLotus = {
      externalId: "lea-black-lotus",
      tcg: "magic" as const,
      name: "Black Lotus",
      setCode: "LEA",
      setName: "Limited Edition Alpha",
      collectorNumber: "232"
    };
    await asAvery.mutation(api.collections.addToBinder, {
      binderId: avery.libraryBinderId,
      quantity: 2,
      condition: "Near Mint",
      price: 10,
      card: blackLotus
    });
    await asAvery.mutation(api.collections.addToBinder, {
      binderId: tradeBinder.id,
      quantity: 2,
      condition: "Played",
      price: 4,
      card: blackLotus
    });
    await asAvery.mutation(api.collections.addToBinder, {
      binderId: avery.libraryBinderId,
      price: 2,
      card: { externalId: "unique-card", tcg: "magic", name: "Unique Card" }
    });

    const outsider = t.withIdentity({ subject: "duplicates_outsider", name: "Outsider" });
    const outsiderUser = await outsider.mutation(api.users.ensureCurrent, {
      username: "duplicates-outsider"
    });
    await outsider.mutation(api.collections.addToBinder, {
      binderId: outsiderUser.libraryBinderId,
      quantity: 8,
      card: blackLotus
    });

    const headers = bridgeHeaders("duplicates_avery", "duplicates-avery");
    const response = await t.fetch("/analytics/duplicates?keep=1", { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      keepCount: 1,
      totalPrintings: 1,
      totalExcessCopies: 3,
      totalStoredValue: 28,
      totalExcessStoredValue: 18,
      items: [
        expect.objectContaining({
          externalId: "lea-black-lotus",
          tcg: "magic",
          name: "Black Lotus",
          quantity: 4,
          excessCopies: 3,
          storedValue: 28,
          excessStoredValue: 18,
          binders: expect.arrayContaining([
            {
              binderId: avery.libraryBinderId,
              binderName: "Library",
              quantity: 2
            },
            {
              binderId: tradeBinder.id,
              binderName: "Trade Binder",
              quantity: 2
            }
          ]),
          conditions: [
            { condition: "Near Mint", quantity: 2 },
            { condition: "Played", quantity: 2 }
          ]
        })
      ]
    });

    const keepTwo = await t.fetch("/analytics/duplicates?keep=2", { headers });
    expect(await keepTwo.json()).toMatchObject({
      keepCount: 2,
      totalPrintings: 1,
      totalExcessCopies: 2,
      totalExcessStoredValue: 8,
      items: [{ quantity: 4, excessCopies: 2, excessStoredValue: 8 }]
    });

    const pokemonOnly = await t.fetch(
      "/analytics/duplicates?keep=1&tcg=pokemon",
      { headers }
    );
    expect(await pokemonOnly.json()).toEqual({
      keepCount: 1,
      totalPrintings: 0,
      totalExcessCopies: 0,
      totalStoredValue: 0,
      totalExcessStoredValue: 0,
      items: []
    });
  });

  test("lazily creates and idempotently refreshes today's value snapshot", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "history_avery", name: "Avery" });
    const user = await asAvery.mutation(api.users.ensureCurrent, {
      username: "history-avery"
    });
    const entry = await asAvery.mutation(api.collections.addToBinder, {
      binderId: user.libraryBinderId,
      price: 12.5,
      card: {
        externalId: "history-sol-ring",
        tcg: "magic",
        name: "Sol Ring"
      }
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("cardPriceSnapshots", { userId: user.id, tcg: "magic", externalId: "history-sol-ring", source: "test", capturedAt: now, day: utcDayOffset(0), nativePrice: 12.5, nativeCurrency: "USD", matchMethod: "exact-id", matchConfidence: 1, createdAt: now });
    });
    const headers = bridgeHeaders("history_avery", "history-avery");

    const firstResponse = await t.fetch("/analytics/value?period=30d", { headers });
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toMatchObject({
      history: [{ date: utcDayOffset(0), value: 12.5 }],
      currentValue: 12.5,
      changePercent: 0,
      changePeriod: "30d"
    });
    const firstSnapshots = await t.run(async (ctx) =>
      await ctx.db
        .query("collectionValueSnapshots")
        .withIndex("by_user_and_day", (q) => q.eq("userId", user.id))
        .collect()
    );
    expect(firstSnapshots).toHaveLength(1);
    expect(firstSnapshots[0]).toMatchObject({
      day: utcDayOffset(0),
      totalValue: 12.5,
      byTcg: { magic: 12.5 }
    });

    const secondResponse = await t.fetch("/analytics/value?period=30d", { headers });
    expect(secondResponse.status).toBe(200);
    const unchangedSnapshots = await t.run(async (ctx) =>
      await ctx.db
        .query("collectionValueSnapshots")
        .withIndex("by_user_and_day", (q) => q.eq("userId", user.id))
        .collect()
    );
    expect(unchangedSnapshots).toHaveLength(1);
    expect(unchangedSnapshots[0]!.capturedAt).toBe(firstSnapshots[0]!.capturedAt);

    await t.run(async (ctx) => {
      await ctx.db.patch(entry.id, { price: 20 });
    });
    const updatedResponse = await t.fetch("/analytics/value?period=30d", { headers });
    expect(await updatedResponse.json()).toMatchObject({
      history: [{ date: utcDayOffset(0), value: 20 }],
      currentValue: 20
    });
    const updatedSnapshots = await t.run(async (ctx) =>
      await ctx.db
        .query("collectionValueSnapshots")
        .withIndex("by_user_and_day", (q) => q.eq("userId", user.id))
        .collect()
    );
    expect(updatedSnapshots).toHaveLength(1);
    expect(updatedSnapshots[0]).toMatchObject({
      totalValue: 12.5,
      byTcg: { magic: 12.5 },
      qualityStatus: "healthy",
      priceCoverage: 100
    });
  });

  test("calculates history changes and filters snapshots by requested period", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "period_avery", name: "Avery" });
    const user = await asAvery.mutation(api.users.ensureCurrent, {
      username: "period-avery"
    });
    await asAvery.mutation(api.collections.addToBinder, {
      binderId: user.libraryBinderId,
      price: 200,
      card: {
        externalId: "period-black-lotus",
        tcg: "magic",
        name: "Black Lotus"
      }
    });
    await t.run(async (ctx) => {
      for (const [daysAgo, totalValue] of [
        [40, 50],
        [20, 100],
        [5, 150]
      ] as const) {
        await ctx.db.insert("collectionValueSnapshots", {
          userId: user.id,
          day: utcDayOffset(-daysAgo),
          capturedAt: Date.now() - daysAgo * 24 * 60 * 60 * 1_000,
          totalValue,
          byTcg: { magic: totalValue }
        });
      }
    });
    const headers = bridgeHeaders("period_avery", "period-avery");

    const thirtyDayResponse = await t.fetch("/analytics/value?period=30d", {
      headers
    });
    expect(thirtyDayResponse.status).toBe(200);
    expect(await thirtyDayResponse.json()).toEqual({
      history: [
        { date: utcDayOffset(-20), value: 100 },
        { date: utcDayOffset(-5), value: 150 },
        { date: utcDayOffset(0), value: 200 }
      ],
      currentValue: 200,
      changePercent: 100,
      changePeriod: "30d"
    });

    const sevenDayResponse = await t.fetch("/analytics/value?period=7d", {
      headers
    });
    expect(sevenDayResponse.status).toBe(200);
    expect(await sevenDayResponse.json()).toEqual({
      history: [
        { date: utcDayOffset(-5), value: 150 },
        { date: utcDayOffset(0), value: 200 }
      ],
      currentValue: 200,
      changePercent: 33.33,
      changePeriod: "7d"
    });
  });

  test("serves public shared collections from Convex collection data", async () => {
    const t = createTestConvex();
    const asAvery = t.withIdentity({ subject: "user_avery", name: "Avery" });
    await asAvery.mutation(api.users.ensureCurrent, { username: "avery" });
    const binder = await asAvery.mutation(api.binders.create, {
      name: "Public Binder",
      description: "Shared cards"
    });
    await asAvery.mutation(api.collections.addToBinder, {
      binderId: binder.id,
      quantity: 2,
      card: { externalId: "dm-001", tcg: "yugioh", name: "Dark Magician" }
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(binder.id, { shareToken: "public-token", isPublic: true });
    });

    const response = await t.fetch("/public/collections/public-token", {
      headers: { "x-tcger-bridge-key": TEST_BRIDGE_SECRET }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      name: "Public Binder",
      description: "Shared cards",
      owner: "avery",
      cardCount: 2
    });
    expect(payload.cards).toEqual([
      expect.objectContaining({ name: "Dark Magician", quantity: 2 })
    ]);
  });

  test("enables, rotates, and disables an owned binder share link", async () => {
    const t = createTestConvex();
    const asOwner = t.withIdentity({ subject: "share_owner", name: "Owner" });
    await asOwner.mutation(api.users.ensureCurrent, { username: "owner" });
    const binder = await asOwner.mutation(api.binders.create, { name: "Shareable" });
    const headers = bridgeHeaders("share_owner", "owner");

    const enable = await t.fetch(`/collections/${binder.id}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: true }),
    });
    expect(enable.status).toBe(200);
    const enabled = await enable.json();
    expect(enabled).toMatchObject({ isPublic: true });
    expect(enabled.shareToken).toMatch(/^[a-f0-9]{32}$/);

    const rotate = await t.fetch(`/collections/${binder.id}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: true, rotateShareToken: true }),
    });
    const rotated = await rotate.json();
    expect(rotated.shareToken).not.toBe(enabled.shareToken);

    const disable = await t.fetch(`/collections/${binder.id}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: false }),
    });
    expect(disable.status).toBe(200);
    expect(await disable.json()).toMatchObject({ isPublic: false });
    expect((await t.fetch(`/public/collections/${rotated.shareToken}`, {
      headers: { "x-tcger-bridge-key": TEST_BRIDGE_SECRET },
    })).status).toBe(404);
  });

  test("supports trade CRUD and role-owned accept, decline, and cancel transitions", async () => {
    const t = createTestConvex();
    for (const [subject, username] of [
      ["user_sender", "sender"],
      ["user_receiver", "receiver"],
      ["user_outsider", "outsider"]
    ] as const) {
      await t
        .withIdentity({ subject, name: username })
        .mutation(api.users.ensureCurrent, { username });
    }
    const senderHeaders = bridgeHeaders("user_sender", "sender");
    const receiverHeaders = bridgeHeaders("user_receiver", "receiver");
    const outsiderHeaders = bridgeHeaders("user_outsider", "outsider");
    const [senderBinder, receiverBinder] = await t.run(async (ctx) => {
      const senderUser = await ctx.db.query("users").withIndex("by_auth_subject", (q) => q.eq("authSubject", "user_sender")).unique();
      const receiverUser = await ctx.db.query("users").withIndex("by_auth_subject", (q) => q.eq("authSubject", "user_receiver")).unique();
      return await Promise.all([
        ctx.db.query("binders").withIndex("by_user_kind", (q) => q.eq("userId", senderUser!._id).eq("kind", "library")).unique(),
        ctx.db.query("binders").withIndex("by_user_kind", (q) => q.eq("userId", receiverUser!._id).eq("kind", "library")).unique(),
      ]);
    });
    const senderEntry = await t.withIdentity({ subject: "user_sender" }).mutation(api.collections.addToBinder, { binderId: senderBinder!._id, quantity: 4, card: { externalId: "sol-ring", tcg: "magic", name: "Sol Ring" } });
    const receiverEntry = await t.withIdentity({ subject: "user_receiver" }).mutation(api.collections.addToBinder, { binderId: receiverBinder!._id, quantity: 4, card: { externalId: "sv1-001", tcg: "pokemon", name: "Bulbasaur" } });

    async function createTrade(exactCopies = false) {
      const response = await t.fetch("/trades", {
        method: "POST",
        headers: senderHeaders,
        body: JSON.stringify({
          receiverId: "user_receiver",
          message: "Interested?",
          senderCards: [{
            ...senderCard,
            ...(exactCopies ? { collectionEntryId: senderEntry.id } : {})
          }],
          receiverCards: [
            {
              externalId: "sv1-001",
              tcg: "pokemon",
              name: "Bulbasaur",
              quantity: 1,
              ...(exactCopies ? { collectionEntryId: receiverEntry.id } : {})
            }
          ]
        })
      });
      expect(response.status).toBe(201);
      return await response.json();
    }

    const acceptedTrade = await createTrade(true);
    const outsiderGet = await t.fetch(`/trades/${acceptedTrade.id}`, {
      headers: outsiderHeaders
    });
    const senderAccept = await t.fetch(`/trades/${acceptedTrade.id}/accept`, {
      method: "PATCH",
      headers: senderHeaders
    });
    const receiverAccept = await t.fetch(`/trades/${acceptedTrade.id}/accept`, {
      method: "PATCH",
      headers: receiverHeaders
    });
    expect({ status: outsiderGet.status, payload: await outsiderGet.json() }).toEqual({
      status: 404,
      payload: { error: "NOT_FOUND", message: "Trade not found" }
    });
    expect(senderAccept.status).toBe(403);
    expect(receiverAccept.status).toBe(200);
    expect(await receiverAccept.json()).toMatchObject({ status: "accepted", settlementStatus: "settled" });
    const settlement = await t.run(async (ctx) => {
      const sender = await ctx.db.query("users").withIndex("by_auth_subject", (q) => q.eq("authSubject", "user_sender")).unique();
      const receiver = await ctx.db.query("users").withIndex("by_auth_subject", (q) => q.eq("authSubject", "user_receiver")).unique();
      const cards = await ctx.db.query("cards").collect();
      const entries = await ctx.db.query("collectionEntries").collect();
      const total = (userId: string, externalId: string) => entries.filter((entry) => entry.userId === userId && cards.find((card) => card._id === entry.cardId)?.externalId === externalId).reduce((sum, entry) => sum + entry.quantity, 0);
      return {
        senderSol: total(sender!._id, "sol-ring"), senderBulbasaur: total(sender!._id, "sv1-001"),
        receiverSol: total(receiver!._id, "sol-ring"), receiverBulbasaur: total(receiver!._id, "sv1-001"),
        transactions: (await ctx.db.query("transactions").collect()).filter((row) => row.relatedTradeId === acceptedTrade.id).length,
        audits: (await ctx.db.query("collectionMutationAudits").collect()).filter((row) => row.operationKind === "trade_settlement").length,
      };
    });
    expect(settlement).toEqual({ senderSol: 3, senderBulbasaur: 1, receiverSol: 1, receiverBulbasaur: 3, transactions: 2, audits: 2 });
    const historyResponse = await t.fetch("/collections/history", {
      headers: senderHeaders
    });
    const history = await historyResponse.json();
    const settlementAudit = history.entries.find(
      (entry: { operationKind: string }) => entry.operationKind === "trade_settlement"
    );
    expect(historyResponse.status).toBe(200);
    expect(settlementAudit).toMatchObject({ canUndo: false });
    const undoSettlement = await t.fetch(
      `/collections/history/${settlementAudit.id}/undo`,
      {
        method: "POST",
        headers: senderHeaders,
        body: JSON.stringify({ idempotencyKey: "undo-settled-trade" })
      }
    );
    expect(undoSettlement.status).toBe(400);
    const deleteSettlement = await t.fetch(`/trades/${acceptedTrade.id}`, {
      method: "DELETE",
      headers: senderHeaders
    });
    expect(deleteSettlement.status).toBe(400);

    const declinedTrade = await createTrade();
    const decline = await t.fetch(`/trades/${declinedTrade.id}/decline`, {
      method: "PATCH",
      headers: receiverHeaders
    });
    expect(decline.status).toBe(200);
    expect((await decline.json()).status).toBe("declined");

    const cancelledTrade = await createTrade();
    const receiverCancel = await t.fetch(`/trades/${cancelledTrade.id}/cancel`, {
      method: "PATCH",
      headers: receiverHeaders
    });
    const senderCancel = await t.fetch(`/trades/${cancelledTrade.id}/cancel`, {
      method: "PATCH",
      headers: senderHeaders
    });
    expect(receiverCancel.status).toBe(403);
    expect(senderCancel.status).toBe(200);
    expect((await senderCancel.json()).status).toBe("cancelled");

    const deletedTrade = await createTrade();
    const receiverDelete = await t.fetch(`/trades/${deletedTrade.id}`, {
      method: "DELETE",
      headers: receiverHeaders
    });
    const senderDelete = await t.fetch(`/trades/${deletedTrade.id}`, {
      method: "DELETE",
      headers: senderHeaders
    });
    expect(receiverDelete.status).toBe(404);
    expect(senderDelete.status).toBe(204);

    const listResponse = await t.fetch("/trades", { headers: receiverHeaders });
    const trades = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(trades.map((trade: { status: string }) => trade.status)).toEqual(
      expect.arrayContaining(["accepted", "declined", "cancelled"])
    );
  });

  test("suggests reciprocal matches from Convex collections and wishlists", async () => {
    const t = createTestConvex();
    const avery = await t
      .withIdentity({ subject: "user_avery", name: "Avery" })
      .mutation(api.users.ensureCurrent, { username: "avery" });
    const jordan = await t
      .withIdentity({ subject: "user_jordan", name: "Jordan" })
      .mutation(api.users.ensureCurrent, { username: "jordan" });
    await t.withIdentity({ subject: "user_avery" }).mutation(api.collections.addToBinder, {
      binderId: avery.libraryBinderId,
      card: { externalId: "sol-ring", tcg: "magic", name: "Sol Ring" }
    });
    await t.withIdentity({ subject: "user_jordan" }).mutation(api.collections.addToBinder, {
      binderId: jordan.libraryBinderId,
      card: { externalId: "sv1-001", tcg: "pokemon", name: "Bulbasaur" }
    });
    await t.run(async (ctx) => {
      const timestamp = Date.now();
      const averyWishlist = await ctx.db.insert("wishlists", {
        userId: avery.id,
        name: "Avery wants",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      const jordanWishlist = await ctx.db.insert("wishlists", {
        userId: jordan.id,
        name: "Jordan wants",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      await ctx.db.insert("wishlistCards", {
        wishlistId: averyWishlist,
        externalId: "sv1-001",
        tcg: "pokemon",
        name: "Bulbasaur",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      await ctx.db.insert("wishlistCards", {
        wishlistId: jordanWishlist,
        externalId: "sol-ring",
        tcg: "magic",
        name: "Sol Ring",
        createdAt: timestamp,
        updatedAt: timestamp
      });
    });

    const response = await t.fetch("/trades/matches", {
      headers: bridgeHeaders("user_avery", "avery")
    });
    const matches = await response.json();

    expect(response.status).toBe(200);
    expect(matches).toContainEqual({
      userId: "user_jordan",
      username: "jordan",
      theyHave: [{ externalId: "sv1-001", tcg: "pokemon", name: "Bulbasaur" }],
      youHave: [{ externalId: "sol-ring", tcg: "magic", name: "Sol Ring" }],
      matchScore: 2
    });
  });

  test("rejects analytics and trades requests without the bridge key", async () => {
    const t = createTestConvex();
    const forgedHeaders = {
      Authorization: "Bearer forged-token",
      "x-tcger-user-id": "forged-user"
    };
    const [analytics, duplicates, trades] = await Promise.all([
      t.fetch("/analytics/value", { headers: forgedHeaders }),
      t.fetch("/analytics/duplicates", { headers: forgedHeaders }),
      t.fetch("/trades", { headers: forgedHeaders })
    ]);
    expect(analytics.status).toBe(401);
    expect(duplicates.status).toBe(401);
    expect(trades.status).toBe(401);
  });
});
