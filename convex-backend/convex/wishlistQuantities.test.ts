import { describe, expect, test } from "vitest";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

function headers(subject = "wishlist-quantity-user") {
  return {
    Authorization: "Bearer local-test-token",
    "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
    "x-tcger-user-id": subject,
    "x-tcger-user-email": `${subject}@example.com`,
    "x-tcger-username": subject
  };
}

describe("wishlist desired quantities", () => {
  test("derives missing copies and copy-based completion for exact printings", async () => {
    const t = createTestConvex();
    const requestHeaders = headers();

    const ownedResponse = await t.fetch("/collections/cards", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        quantity: 2,
        cardData: {
          tcg: "magic",
          externalId: "sol-ring-cmm",
          baseExternalId: "sol-ring",
          name: "Sol Ring"
        }
      })
    });
    expect(ownedResponse.status).toBe(201);

    const wishlistResponse = await t.fetch("/wishlists", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ name: "Commander Needs" })
    });
    const wishlist = await wishlistResponse.json();

    const addResponse = await t.fetch(`/wishlists/${wishlist.id}/cards`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        tcg: "magic",
        externalId: "sol-ring-cmm",
        baseExternalId: "sol-ring",
        name: "Sol Ring",
        desiredQuantity: 4
      })
    });
    const added = await addResponse.json();

    expect(addResponse.status).toBe(201);
    expect(added).toMatchObject({
      desiredQuantity: 4,
      owned: true,
      ownedQuantity: 2,
      missingQuantity: 2
    });

    const detail = await (
      await t.fetch(`/wishlists/${wishlist.id}`, { headers: requestHeaders })
    ).json();
    expect(detail).toMatchObject({
      totalCards: 1,
      ownedCards: 1,
      totalDesiredQuantity: 4,
      ownedDesiredQuantity: 2,
      missingQuantity: 2,
      completionPercent: 50
    });

    const updateResponse = await t.fetch(
      `/wishlists/${wishlist.id}/cards/${added.id}`,
      {
        method: "PATCH",
        headers: requestHeaders,
        body: JSON.stringify({ desiredQuantity: 2 })
      }
    );
    const updated = await updateResponse.json();
    expect(updateResponse.status).toBe(200);
    expect(updated).toMatchObject({
      desiredQuantity: 2,
      owned: true,
      ownedQuantity: 2,
      missingQuantity: 0
    });
  });

  test("validates 1..99 and preserves any-printing ownership", async () => {
    const t = createTestConvex();
    const requestHeaders = headers("wishlist-any-printing-user");

    await t.fetch("/collections/cards", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        quantity: 2,
        cardData: {
          tcg: "pokemon",
          externalId: "pikachu-promo",
          baseExternalId: "pikachu",
          name: "Pikachu"
        }
      })
    });

    const wishlist = await (
      await t.fetch("/wishlists", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ name: "Any Pikachu", matchAnyPrinting: true })
      })
    ).json();

    const addResponse = await t.fetch(`/wishlists/${wishlist.id}/cards`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        tcg: "pokemon",
        externalId: "pikachu-holo",
        baseExternalId: "pikachu",
        name: "Pikachu",
        desiredQuantity: 3
      })
    });
    const card = await addResponse.json();
    expect(card).toMatchObject({
      desiredQuantity: 3,
      ownedQuantity: 2,
      missingQuantity: 1,
      owned: true
    });

    for (const invalidQuantity of [0, 100, 1.5]) {
      const invalidResponse = await t.fetch(
        `/wishlists/${wishlist.id}/cards/${card.id}`,
        {
          method: "PATCH",
          headers: requestHeaders,
          body: JSON.stringify({ desiredQuantity: invalidQuantity })
        }
      );
      expect(invalidResponse.status).toBe(400);
      expect(await invalidResponse.json()).toMatchObject({
        error: "BAD_REQUEST"
      });
    }
  });
});
