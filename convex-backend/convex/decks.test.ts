import { describe, expect, test } from "vitest";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

function bridgeHeaders(subject: string) {
  return {
    Authorization: "Bearer local-test-token",
    "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
    "x-tcger-user-id": subject,
    "x-tcger-user-email": `${subject}@example.com`,
    "x-tcger-username": subject,
  };
}

describe("Convex-native decks REST routes", () => {
  test("creates, lists, gets, updates, isolates, and deletes decks", async () => {
    const t = createTestConvex();
    const headersA = bridgeHeaders("user_avery");
    const headersB = bridgeHeaders("user_jordan");

    const unauthorized = await t.fetch("/decks", {
      headers: {
        Authorization: "Bearer local-test-token",
        "x-tcger-user-id": "user_avery",
      },
    });
    expect(unauthorized.status).toBe(401);

    const createResponse = await t.fetch("/decks", {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        name: "Friday Night Modern",
        description: "Weekly local deck",
        tcg: "magic",
        format: "modern",
        colorHex: "3b82f6",
      }),
    });
    const created = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created).toMatchObject({
      name: "Friday Night Modern",
      description: "Weekly local deck",
      tcg: "magic",
      format: "modern",
      colorHex: "3b82f6",
      isPublic: false,
      cards: [],
      cardCount: 0,
    });
    expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(created.updatedAt))).toBe(false);

    const listResponse = await t.fetch("/decks", { headers: headersA });
    const listed = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);

    const getResponse = await t.fetch(`/decks/${created.id}`, {
      headers: headersA,
    });
    expect(getResponse.status).toBe(200);
    expect((await getResponse.json()).name).toBe("Friday Night Modern");

    const updateResponse = await t.fetch(`/decks/${created.id}`, {
      method: "PATCH",
      headers: headersA,
      body: JSON.stringify({ name: "Modern League", isPublic: true }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      id: created.id,
      name: "Modern League",
      isPublic: true,
    });

    const otherUserRead = await t.fetch(`/decks/${created.id}`, {
      headers: headersB,
    });
    expect(otherUserRead.status).toBe(404);

    const otherUserUpdate = await t.fetch(`/decks/${created.id}`, {
      method: "PATCH",
      headers: headersB,
      body: JSON.stringify({ name: "Stolen Deck" }),
    });
    expect(otherUserUpdate.status).toBe(404);

    const deleteResponse = await t.fetch(`/decks/${created.id}`, {
      method: "DELETE",
      headers: headersA,
    });
    expect(deleteResponse.status).toBe(204);
    expect(
      (await t.fetch(`/decks/${created.id}`, { headers: headersA })).status,
    ).toBe(404);
  });

  test("adds, upserts, moves, merges, and removes deck cards across zones", async () => {
    const t = createTestConvex();
    const headers = bridgeHeaders("user_yugi");
    const createResponse = await t.fetch("/decks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Fusion Test",
        tcg: "yugioh",
        format: "tcg",
      }),
    });
    const deck = await createResponse.json();

    const extraResponse = await t.fetch(`/decks/${deck.id}/cards`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        externalId: "fusion-dragon",
        tcg: "yugioh",
        name: "Fusion Dragon",
        quantity: 1,
        cardData: { type: "Fusion Monster", level: 8, rarity: "Ultra Rare" },
      }),
    });
    const extraCard = await extraResponse.json();
    expect(extraResponse.status).toBe(201);
    expect(extraCard).toMatchObject({
      zone: "extra",
      quantity: 1,
      isSideboard: false,
    });

    const upsertResponse = await t.fetch(`/decks/${deck.id}/cards`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        externalId: "fusion-dragon",
        tcg: "yugioh",
        name: "Fusion Dragon",
        quantity: 2,
        zone: "extra",
      }),
    });
    expect(await upsertResponse.json()).toMatchObject({
      id: extraCard.id,
      quantity: 3,
    });

    const sideResponse = await t.fetch(`/decks/${deck.id}/cards`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        externalId: "fusion-dragon",
        tcg: "yugioh",
        name: "Fusion Dragon",
        zone: "side",
      }),
    });
    const sideCard = await sideResponse.json();
    expect(sideCard).toMatchObject({
      zone: "side",
      quantity: 1,
      isSideboard: true,
    });

    const mergeResponse = await t.fetch(
      `/decks/${deck.id}/cards/${extraCard.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ zone: "side", quantity: 2 }),
      },
    );
    expect(await mergeResponse.json()).toMatchObject({
      id: sideCard.id,
      zone: "side",
      quantity: 3,
      isSideboard: true,
    });

    const mainResponse = await t.fetch(`/decks/${deck.id}/cards`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        externalId: "46986414",
        tcg: "yugioh",
        name: "Dark Magician",
        quantity: 1,
        zone: "main",
      }),
    });
    const mainCard = await mainResponse.json();
    const updateMainResponse = await t.fetch(
      `/decks/${deck.id}/cards/${mainCard.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ quantity: 2, isCommander: true }),
      },
    );
    expect(await updateMainResponse.json()).toMatchObject({
      quantity: 2,
      zone: "main",
      isCommander: true,
    });

    const analysisResponse = await t.fetch(`/decks/${deck.id}/analysis`, {
      headers,
    });
    expect(await analysisResponse.json()).toMatchObject({
      totalCards: 5,
      mainDeckCount: 2,
      extraDeckCount: 0,
      sideboardCount: 3,
    });

    const ownershipResponse = await t.fetch(`/decks/${deck.id}/ownership`, {
      headers,
    });
    expect(await ownershipResponse.json()).toMatchObject({
      missingCount: 5,
      owned: [],
    });

    const validationResponse = await t.fetch(`/decks/${deck.id}/validate`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    expect(await validationResponse.json()).toMatchObject({
      valid: false,
      format: "tcg",
    });

    const ydkResponse = await t.fetch(`/decks/${deck.id}/ydk`, { headers });
    const ydk = await ydkResponse.json();
    expect(ydk.content).toContain("#main\n46986414\n46986414");
    expect(ydk.skipped).toEqual([
      expect.objectContaining({
        externalId: "fusion-dragon",
        name: "Fusion Dragon",
      }),
    ]);

    const removeResponse = await t.fetch(
      `/decks/${deck.id}/cards/${sideCard.id}`,
      {
        method: "DELETE",
        headers,
      },
    );
    expect(removeResponse.status).toBe(204);
    const refreshed = await (
      await t.fetch(`/decks/${deck.id}`, { headers })
    ).json();
    expect(refreshed.cards).toHaveLength(1);
    expect(refreshed.cardCount).toBe(2);
  });

  test("imports a plain-text deck through the legacy REST surface", async () => {
    const t = createTestConvex();
    const headers = bridgeHeaders("user_importer");
    const response = await t.fetch("/decks/import", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "text",
        data: "2 Lightning Bolt\nSideboard\n1 Negate",
        name: "Imported Modern",
        tcg: "magic",
        format: "modern",
      }),
    });
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result).toMatchObject({
      importedCount: 2,
      skippedCount: 0,
      skippedCards: [],
    });
    expect(result.deck).toMatchObject({
      name: "Imported Modern",
      tcg: "magic",
      format: "modern",
      cardCount: 3,
    });
    expect(result.deck.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Lightning Bolt",
          quantity: 2,
          zone: "main",
        }),
        expect.objectContaining({ name: "Negate", quantity: 1, zone: "side" }),
      ]),
    );
  });
});
