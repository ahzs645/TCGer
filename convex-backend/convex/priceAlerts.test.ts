import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

const headers = {
  Authorization: "Bearer local-test-token",
  "Content-Type": "application/json",
  "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
  "x-tcger-user-id": "alert-user",
  "x-tcger-user-email": "alert@example.com",
  "x-tcger-username": "alert-user",
};

describe("price alert evaluation", () => {
  test("triggers once on a fresh trusted threshold crossing", async () => {
    const t = createTestConvex();
    const user = await t.withIdentity({ subject: "alert-user" }).mutation(api.users.ensureCurrent, { username: "alert-user" });
    const created = await t.fetch("/alerts", { method: "POST", headers, body: JSON.stringify({ externalId: "sol-ring", tcg: "magic", cardName: "Sol Ring", targetPrice: 5, direction: "below", currency: "USD", cooldownHours: 24 }) });
    expect(created.status).toBe(201);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("cardPriceSnapshots", { userId: user.id, tcg: "magic", externalId: "sol-ring", source: "test", capturedAt: now, day: new Date(now).toISOString().slice(0, 10), nativePrice: 4.5, nativeCurrency: "USD", matchMethod: "exact-id", matchConfidence: 1, createdAt: now });
    });
    const first = await t.fetch("/alerts/evaluate", { method: "POST", headers });
    const second = await t.fetch("/alerts/evaluate", { method: "POST", headers });
    expect(await first.json()).toEqual({ evaluated: 1, triggered: 1 });
    expect(await second.json()).toEqual({ evaluated: 1, triggered: 0 });
    const notifications = await t.fetch("/notifications", { headers });
    expect(await notifications.json()).toEqual([expect.objectContaining({ type: "price_alert", title: expect.stringContaining("Sol Ring") })]);
  });

  test("does not capture portfolio history without safe quote coverage", async () => {
    const t = createTestConvex();
    const user = await t.withIdentity({ subject: "alert-user" }).mutation(api.users.ensureCurrent, { username: "alert-user" });
    await t.withIdentity({ subject: "alert-user" }).mutation(api.collections.addToBinder, { binderId: user.libraryBinderId, card: { externalId: "unpriced", tcg: "magic", name: "Unpriced" }, price: 99 });
    const response = await t.fetch("/analytics/value?period=30d", { headers });
    expect(response.status).toBe(200);
    const snapshots = await t.run(async (ctx) => await ctx.db.query("collectionValueSnapshots").withIndex("by_user_and_day", (q) => q.eq("userId", user.id)).collect());
    expect(snapshots).toHaveLength(0);
  });
});
