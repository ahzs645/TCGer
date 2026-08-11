import { describe, expect, test } from "vitest";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

/**
 * Ground truth for `DELETE /collections/:binderId/cards/:cardId` when the id is
 * the *card-level* one from the grouped response.
 *
 * That is the only id the quantity stepper has: `card-preview.tsx` reads
 * `existingEntry?.id` off the grouped card and calls `removeCollectionCard`
 * with it once the user steps the quantity down to 0, then reports "Card
 * removed from binder."
 *
 * Before the fix this removed exactly one `collectionEntries` row, so a 3-copy
 * card came back with 2 copies on the next refresh while every client had
 * already dropped it from its local state.
 */
describe("DELETE with a card-level id on a multi-copy card", () => {
  test("removes every copy of the card, not just the first", async () => {
    const t = createTestConvex();
    const headers = {
      Authorization: "Bearer local-test-token",
      "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
      "x-tcger-user-id": "user_remove",
      "x-tcger-user-email": "remove@example.com",
      "x-tcger-username": "remove",
    };

    const binder = await (
      await t.fetch("/collections", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Remove Binder", colorHex: "ef4444" }),
      })
    ).json();

    const added = await (
      await t.fetch(`/collections/${binder.id}/cards`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          quantity: 3,
          cardData: {
            tcg: "magic",
            externalId: "brainstorm",
            name: "Brainstorm",
            setCode: "ICE",
            setName: "Ice Age",
            collectorNumber: "61",
          },
        }),
      })
    ).json();

    expect(added.quantity).toBe(3);
    expect(added.copies).toHaveLength(3);

    // The id the stepper actually sends.
    const cardLevelId = added.id;
    const res = await t.fetch(
      `/collections/${binder.id}/cards/${cardLevelId}`,
      { method: "DELETE", headers },
    );
    expect(res.status).toBeLessThan(300);

    const after = await (
      await t.fetch(`/collections/${binder.id}`, { headers })
    ).json();
    const card = after.cards.find(
      (entry: { externalId?: string }) => entry.externalId === "brainstorm",
    );

    expect(card).toBeUndefined();
    expect(
      after.cards.filter(
        (entry: { externalId?: string }) => entry.externalId === "brainstorm",
      ),
    ).toHaveLength(0);
  });
});
