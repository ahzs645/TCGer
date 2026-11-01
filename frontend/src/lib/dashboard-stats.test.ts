import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardStats, type DashboardCard } from "./dashboard-stats";

test("owned community games are included without a built-in bucket and colliding external IDs remain distinct", () => {
  const stats = buildDashboardStats(
    [
      {
        cardId: "shared-id",
        tcg: "pokemon",
        name: "Pokémon card",
        quantity: 2,
        price: 3,
        binderId: "binder",
        updatedAt: "2026-01-01",
      },
      {
        cardId: "shared-id",
        tcg: "community-game",
        name: "Community card",
        quantity: 1,
        price: 5,
        binderId: "binder",
        updatedAt: "2026-01-02",
      },
    ] as DashboardCard[],
    true,
  );
  assert.equal(stats.totalCopies, 3);
  assert.equal(stats.totalValue, 11);
  assert.deepEqual(stats.byGame["community-game"], { copies: 1, value: 5 });
  assert.equal(stats.recentActivity.length, 2);
  assert.equal(new Set(stats.recentActivity.map((item) => item.id)).size, 2);
});
