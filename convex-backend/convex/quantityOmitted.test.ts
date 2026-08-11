import { describe, expect, test } from "vitest";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

/**
 * Regression: a PATCH that does not mention `quantity` must not change it.
 *
 * `bridge.ts` reads `args.quantity ?? 1`, so an omitted quantity is
 * indistinguishable from "set it to 1" — and the branch below it deletes copies
 * to reach the requested figure. The collection sandbox's `buildUpdatePayload()`
 * only ever sends the fields the user actually edited and never sends
 * `quantity`, so editing a condition on a multi-copy card takes this path.
 *
 * Every pre-existing PATCH test passes an explicit quantity, which is why this
 * was never caught.
 */
describe("PATCH /collections/:binderId/cards/:cardId with no quantity", () => {
  test("editing a copy field leaves the other copies alone", async () => {
    const t = createTestConvex();
    const headers = {
      Authorization: "Bearer local-test-token",
      "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
      "x-tcger-user-id": "user_quantity",
      "x-tcger-user-email": "quantity@example.com",
      "x-tcger-username": "quantity",
    };

    const binder = await (
      await t.fetch("/collections", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Quantity Binder", colorHex: "22c55e" }),
      })
    ).json();

    // Three copies of one card, the shape a collector actually has.
    const added = await (
      await t.fetch(`/collections/${binder.id}/cards`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          quantity: 3,
          cardData: {
            tcg: "magic",
            externalId: "counterspell",
            name: "Counterspell",
            setCode: "MH2",
            setName: "Modern Horizons 2",
            collectorNumber: "267",
          },
        }),
      })
    ).json();

    expect(added.quantity).toBe(3);
    expect(added.copies).toHaveLength(3);

    // Exactly what the sandbox sends when you change one copy's condition:
    // the edited field and nothing else.
    const patch = await t.fetch(
      `/collections/${binder.id}/cards/${added.copies[0].id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ condition: "Lightly Played" }),
      },
    );
    expect(patch.status).toBe(200);

    const after = await (
      await t.fetch(`/collections/${binder.id}`, { headers })
    ).json();
    const card = after.cards.find(
      (entry: { externalId?: string }) => entry.externalId === "counterspell",
    );

    expect(card?.quantity).toBe(3);
    expect(card?.copies).toHaveLength(3);
  });
});
