import { describe, expect, test } from "vitest";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

describe("wishlist exclusions", () => {
  test("removal survives repeated batches, is scoped to a list and game, and manual add restores it", async () => {
    const t = createTestConvex();
    const headers = {
      Authorization: "Bearer local-test-token",
      "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
      "x-tcger-user-id": "exclusions",
      "x-tcger-user-email": "exclusions@example.com",
      "x-tcger-username": "exclusions",
    };
    const request = async (path: string, method: string, body?: unknown) => {
      const response = await t.fetch(path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(response.status).toBeLessThan(300);
      return response.status === 204 ? null : response.json();
    };
    const list = await request("/wishlists", "POST", { name: "Darkrai" });
    const other = await request("/wishlists", "POST", { name: "Other" });
    const card = {
      tcg: "pokemon",
      externalId: "base5-83",
      name: "Dark Raichu",
    };
    const added = await request(`/wishlists/${list.id}/cards`, "POST", card);
    await request(`/wishlists/${list.id}/cards/${added.id}`, "DELETE");
    for (let i = 0; i < 2; i++) {
      const synced = await request(
        `/wishlists/${list.id}/cards/batch`,
        "POST",
        { cards: [card, { ...card, tcg: "magic" }] },
      );
      expect(synced.cards.map((c: any) => c.tcg)).toEqual(["magic"]);
      expect(synced.excludedCardKeys).toEqual(["pokemon:base5-83"]);
    }
    const separate = await request(
      `/wishlists/${other.id}/cards/batch`,
      "POST",
      { cards: [card] },
    );
    expect(separate.cards).toHaveLength(1);
    await request(`/wishlists/${list.id}/cards`, "POST", card);
    const restored = await request(`/wishlists/${list.id}`, "GET");
    expect(restored.cards).toHaveLength(2);
    expect(restored.excludedCardKeys).toEqual([]);
  });
});
