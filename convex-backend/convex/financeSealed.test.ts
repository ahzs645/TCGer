import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

function bridgeHeaders(subject: string) {
  return {
    Authorization: "Bearer local-test-token",
    "Content-Type": "application/json",
    "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
    "x-tcger-user-id": subject,
    "x-tcger-user-email": `${subject}@example.com`,
    "x-tcger-username": subject,
  };
}

describe("finance and sealed Convex HTTP routes", () => {
  test("creates, lists, summarizes, and deletes normalized transactions", async () => {
    const t = createTestConvex();
    const headers = bridgeHeaders("finance_avery");

    const inputs = [
      {
        type: "purchase",
        cardName: "Pikachu",
        tcg: "pokemon",
        quantity: 2,
        amount: 10.1,
        currency: "CAD",
        date: "2026-07-15T12:34:56.000Z",
      },
      {
        type: "sale",
        cardName: "Charizard",
        amount: 4.25,
        date: "2026-07-16T12:34:56.000Z",
      },
      {
        type: "trade",
        amount: 99,
        date: "2026-07-17T12:34:56.000Z",
      },
    ];

    const created = [];
    for (const input of inputs) {
      const response = await t.fetch("/finance/transactions", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(201);
      created.push(await response.json());
    }

    expect(created[0]).toMatchObject({
      type: "purchase",
      amount: 10.1,
      quantity: 2,
      currency: "CAD",
      date: "2026-07-15T12:34:56.000Z",
    });
    expect(typeof created[0].amount).toBe("number");

    const listResponse = await t.fetch("/finance/transactions", { headers });
    expect(listResponse.status).toBe(200);
    const transactions = await listResponse.json();
    expect(
      transactions.map((transaction: { type: string }) => transaction.type),
    ).toEqual(["trade", "sale", "purchase"]);

    const summaryResponse = await t.fetch("/finance/summary", { headers });
    expect(summaryResponse.status).toBe(200);
    expect(await summaryResponse.json()).toEqual({
      totalSpent: 10.1,
      totalEarned: 4.25,
      profitLoss: -5.85,
      transactionCount: 3,
    });

    const currencySummaryResponse = await t.fetch(
      "/finance/summary/by-currency",
      { headers },
    );
    expect(currencySummaryResponse.status).toBe(200);
    expect(await currencySummaryResponse.json()).toEqual({
      byCurrency: [
        {
          currency: "CAD",
          totalSpent: 10.1,
          totalEarned: 0,
          profitLoss: -10.1,
        },
        {
          currency: "USD",
          totalSpent: 0,
          totalEarned: 4.25,
          profitLoss: 4.25,
        },
      ],
      transactionCount: 3,
    });

    const deleteResponse = await t.fetch(
      `/finance/transactions/${created[2].id}`,
      {
        method: "DELETE",
        headers,
      },
    );
    expect(deleteResponse.status).toBe(204);
    expect(
      await (await t.fetch("/finance/transactions", { headers })).json(),
    ).toHaveLength(2);
    expect(
      await (await t.fetch("/finance/summary", { headers })).json(),
    ).toEqual({
      totalSpent: 10.1,
      totalEarned: 4.25,
      profitLoss: -5.85,
      transactionCount: 2,
    });
  });

  test("enforces transaction ownership", async () => {
    const t = createTestConvex();
    const ownerHeaders = bridgeHeaders("finance_owner");
    const otherHeaders = bridgeHeaders("finance_other");
    const createdResponse = await t.fetch("/finance/transactions", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ type: "purchase", amount: 12.34 }),
    });
    const transaction = await createdResponse.json();

    const forbiddenDelete = await t.fetch(
      `/finance/transactions/${transaction.id}`,
      {
        method: "DELETE",
        headers: otherHeaders,
      },
    );
    const forbiddenDeleteBody = await forbiddenDelete.json();
    expect({
      status: forbiddenDelete.status,
      body: forbiddenDeleteBody,
    }).toMatchObject({
      status: 404,
      body: {
        error: "NOT_FOUND",
        message: "Transaction not found",
      },
    });
    expect(
      await (
        await t.fetch("/finance/transactions", { headers: ownerHeaders })
      ).json(),
    ).toHaveLength(1);
  });

  test.each([0, -10])(
    "rejects non-positive transaction amount %s",
    async (amount) => {
      const t = createTestConvex();
      const response = await t.fetch("/finance/transactions", {
        method: "POST",
        headers: bridgeHeaders(`finance_invalid_${Math.abs(amount)}`),
        body: JSON.stringify({ type: "purchase", amount }),
      });
      expect(response.status).toBe(400);
    },
  );

  test("seeds and filters the catalog, then adds, updates, and deletes inventory", async () => {
    const t = createTestConvex();
    const headers = bridgeHeaders("sealed_inventory_owner");

    const productsResponse = await t.fetch("/sealed/products", { headers });
    expect(productsResponse.status).toBe(200);
    const products = await productsResponse.json();
    expect(products).toHaveLength(5);
    expect(products[0]).toMatchObject({
      name: "Prismatic Evolutions Booster Pack",
      msrp: 5.99,
      releaseDate: "2025-01-17T00:00:00.000Z",
    });
    expect(typeof products[0].msrp).toBe("number");

    const magicResponse = await t.fetch("/sealed/products?tcg=magic", {
      headers,
    });
    expect(
      (await magicResponse.json()).map(
        (product: { tcg: string }) => product.tcg,
      ),
    ).toEqual(["magic"]);

    const addResponse = await t.fetch("/sealed/inventory", {
      method: "POST",
      headers,
      body: JSON.stringify({
        productId: products[0].id,
        quantity: 3,
        purchasePrice: 42.5,
        purchaseDate: "2026-06-15T00:00:00.000Z",
        notes: "First case",
      }),
    });
    expect(addResponse.status).toBe(201);
    const inventory = await addResponse.json();
    expect(inventory).toMatchObject({
      quantity: 3,
      purchasePrice: 42.5,
      purchaseDate: "2026-06-15T00:00:00.000Z",
      product: { id: products[0].id, msrp: 5.99 },
    });
    expect(typeof inventory.purchasePrice).toBe("number");
    expect(new Date(inventory.createdAt).toISOString()).toBe(
      inventory.createdAt,
    );

    const updateResponse = await t.fetch(`/sealed/inventory/${inventory.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ quantity: 4, purchasePrice: 40.25 }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      quantity: 4,
      purchasePrice: 40.25,
    });

    const listResponse = await t.fetch("/sealed/inventory", { headers });
    expect((await listResponse.json())[0]).toMatchObject({
      id: inventory.id,
      quantity: 4,
    });

    const deleteResponse = await t.fetch(`/sealed/inventory/${inventory.id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleteResponse.status).toBe(204);
    expect(
      await (await t.fetch("/sealed/inventory", { headers })).json(),
    ).toEqual([]);

    const simulationResponse = await t.fetch("/sealed/open-pack", {
      method: "POST",
      headers,
      body: JSON.stringify({ tcg: "pokemon", setCode: "PRE" }),
    });
    expect(simulationResponse.status).toBe(200);
    expect(await simulationResponse.json()).toMatchObject({
      cards: [],
      setCode: "PRE",
      setName: "PRE",
    });
  });

  test("creates an opening ledger, records a sale, and enforces sealed ownership", async () => {
    const t = createTestConvex();
    const ownerHeaders = bridgeHeaders("sealed_ledger_owner");
    const otherHeaders = bridgeHeaders("sealed_ledger_other");
    const products = await (
      await t.fetch("/sealed/products", { headers: ownerHeaders })
    ).json();
    const addResponse = await t.fetch("/sealed/inventory", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        productId: products[0].id,
        quantity: 2,
        purchasePrice: 100,
      }),
    });
    const inventory = await addResponse.json();

    const collectionId = await t.run(async (ctx) => {
      const viewer = await ctx.db
        .query("users")
        .withIndex("by_auth_subject", (q) =>
          q.eq("authSubject", "sealed_ledger_owner"),
        )
        .unique();
      if (!viewer) throw new Error("Test viewer missing");
      const binder = await ctx.db
        .query("binders")
        .withIndex("by_user_kind", (q) =>
          q.eq("userId", viewer._id).eq("kind", "library"),
        )
        .unique();
      if (!binder) throw new Error("Test library missing");
      const timestamp = Date.now();
      const cardId = await ctx.db.insert("cards", {
        tcg: "pokemon",
        externalId: "opened-pikachu",
        name: "Opened Pikachu",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return await ctx.db.insert("collectionEntries", {
        userId: viewer._id,
        binderId: binder._id,
        cardId,
        quantity: 2,
        price: 25,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    const otherPatch = await t.fetch(`/sealed/inventory/${inventory.id}`, {
      method: "PATCH",
      headers: otherHeaders,
      body: JSON.stringify({ quantity: 1 }),
    });
    const otherPatchBody = await otherPatch.json();
    expect({ status: otherPatch.status, body: otherPatchBody }).toMatchObject({
      status: 404,
      body: { error: "NOT_FOUND" },
    });

    const otherOpening = await t.fetch(
      `/sealed/inventory/${inventory.id}/open`,
      {
        method: "POST",
        headers: otherHeaders,
        body: JSON.stringify({ openedQuantity: 1, collectionIds: [] }),
      },
    );
    expect(otherOpening.status).toBe(404);

    const openingResponse = await t.fetch(
      `/sealed/inventory/${inventory.id}/open`,
      {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({
          openedQuantity: 1,
          collectionIds: [collectionId],
          openedAt: "2026-07-20T10:00:00.000Z",
          notes: "Opening night",
        }),
      },
    );
    expect(openingResponse.status).toBe(201);
    expect(await openingResponse.json()).toMatchObject({
      sealedInventoryId: inventory.id,
      openedQuantity: 1,
      openedAt: "2026-07-20T10:00:00.000Z",
    });

    const ledgersResponse = await t.fetch("/sealed/openings", {
      headers: ownerHeaders,
    });
    expect(ledgersResponse.status).toBe(200);
    const ledgers = await ledgersResponse.json();
    expect(ledgers[0]).toMatchObject({
      inventoryId: inventory.id,
      openedQuantity: 1,
      invested: 100,
      liveValue: 50,
      realizedProceeds: 0,
      profitLoss: -50,
      activeCopies: 2,
      soldCopies: 0,
      cards: [
        {
          collectionId,
          quantity: 2,
          status: "active",
          liveValue: 50,
          realizedProceeds: 0,
        },
      ],
    });

    const openedCardId = ledgers[0].cards[0].id as Id<"sealedOpenedCards">;
    const otherSale = await t.fetch(
      `/sealed/openings/cards/${openedCardId}/sale`,
      {
        method: "PATCH",
        headers: otherHeaders,
        body: JSON.stringify({ proceeds: 75 }),
      },
    );
    expect(otherSale.status).toBe(404);

    const saleResponse = await t.fetch(
      `/sealed/openings/cards/${openedCardId}/sale`,
      {
        method: "PATCH",
        headers: ownerHeaders,
        body: JSON.stringify({
          proceeds: 75,
          soldAt: "2026-07-21T10:00:00.000Z",
        }),
      },
    );
    expect(saleResponse.status).toBe(200);
    expect(await saleResponse.json()).toMatchObject({
      status: "sold",
      realizedProceeds: 75,
      soldAt: "2026-07-21T10:00:00.000Z",
    });

    const soldLedger = (
      await (
        await t.fetch("/sealed/openings", { headers: ownerHeaders })
      ).json()
    )[0];
    expect(soldLedger).toMatchObject({
      liveValue: 0,
      realizedProceeds: 75,
      profitLoss: -25,
      activeCopies: 0,
      soldCopies: 2,
    });

    const deleteWithHistory = await t.fetch(
      `/sealed/inventory/${inventory.id}`,
      {
        method: "DELETE",
        headers: ownerHeaders,
      },
    );
    expect(deleteWithHistory.status).toBe(409);
  });

  test("requires the bridge key for finance and sealed routes", async () => {
    const t = createTestConvex();
    const forgedHeaders = {
      Authorization: "Bearer local-test-token",
      "x-tcger-user-id": "forged_user",
    };
    const financeResponse = await t.fetch("/finance/transactions", {
      headers: forgedHeaders,
    });
    const sealedResponse = await t.fetch("/sealed/products", {
      headers: forgedHeaders,
    });
    expect(financeResponse.status).toBe(401);
    expect(sealedResponse.status).toBe(401);
  });
});
