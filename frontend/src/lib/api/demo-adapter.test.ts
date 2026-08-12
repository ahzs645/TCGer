import assert from "node:assert/strict";
import test from "node:test";

import { handleDemoRequest } from "./demo-adapter";
import { useDemoStore } from "@/stores/demo-store";
import { systemGuideDefinitions } from "@/lib/guides/system-guides.generated";

test("returns only supported data sources for the demo settings screen", async () => {
  const response = await handleDemoRequest("GET", "/settings/source-defaults");
  const sources = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(sources).sort(), [
    "pokemon",
    "scryfall",
    "tcgdex",
    "yugioh",
  ]);
});

test("keeps general settings separate from source defaults", async () => {
  const response = await handleDemoRequest("GET", "/settings");
  const settings = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(settings.appName, "TCGer Demo");
  assert.equal("scryfall" in settings, false);
});

test("validates demo source connectivity requests", async () => {
  const valid = await handleDemoRequest("POST", "/settings/test-source", {
    source: "scryfall",
  });
  const invalid = await handleDemoRequest("POST", "/settings/test-source", {
    source: "unknown",
  });

  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { ok: true, latencyMs: 0 });
  assert.equal(invalid.status, 400);
});

test("lists collection guides and follows one idempotently", async () => {
  useDemoStore.setState({ initialized: true, wishlists: [] });
  const list = await handleDemoRequest("GET", "/guides");
  const guides = (await list.json()) as Array<{
    slug: string;
    followed: boolean;
  }>;
  assert.equal(guides.length, systemGuideDefinitions.length);
  assert.ok(guides.some((guide) => guide.slug === "pokemon-delta-species"));
  assert.ok(guides.some((guide) => guide.slug === "magic-showcase"));
  assert.ok(guides.some((guide) => guide.slug === "yugioh-ghost-rares"));

  const first = await handleDemoRequest(
    "POST",
    "/guides/pokemon-clay-art/follow",
    {},
  );
  assert.equal(first.status, 201);
  const followed = (await first.json()) as {
    wishlistId: string;
    guide: { followed: boolean };
  };
  assert.equal(followed.guide.followed, true);

  const second = await handleDemoRequest(
    "POST",
    "/guides/pokemon-clay-art/follow",
    {},
  );
  const repeated = (await second.json()) as {
    wishlistId: string;
    created: boolean;
  };
  assert.equal(second.status, 200);
  assert.equal(repeated.created, false);
  assert.equal(repeated.wishlistId, followed.wishlistId);
});

test("searches curated cards across every collection guide", async () => {
  const response = await handleDemoRequest(
    "GET",
    "/guides/cards?query=Connected%20Art&category=story",
  );
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    total: number;
    results: Array<{
      card: { id: string; name: string };
      matchedGuides: Array<{ groupLabel?: string }>;
    }>;
  };
  assert.equal(payload.total, 9);
  assert.equal(payload.results[0]?.card.id, "swsh12.5gg-GG26");
  assert.equal(
    payload.results[0]?.matchedGuides[0]?.groupLabel,
    "Crown Zenith nine-card scene",
  );
});

test("seeds analytics, price movers, and the finance ledger", async () => {
  useDemoStore.setState({ initialized: false });
  useDemoStore.getState().init();

  const historyResponse = await handleDemoRequest(
    "GET",
    "/analytics/value?period=30d",
  );
  const history = (await historyResponse.json()) as {
    history: Array<{ date: string; value: number }>;
    currentValue: number;
  };
  assert.equal(historyResponse.status, 200);
  assert.ok(history.history.length > 1);
  assert.ok(history.currentValue > 0);

  const breakdownResponse = await handleDemoRequest(
    "GET",
    "/analytics/value/breakdown",
  );
  const breakdown = (await breakdownResponse.json()) as {
    byTcg: Array<{ tcg: string; value: number; cardCount: number }>;
    topCards: Array<{ name: string }>;
  };
  assert.ok(breakdown.byTcg.length >= 3);
  assert.ok(breakdown.topCards.length > 0);

  const filteredGame = breakdown.byTcg[0]!.tcg;
  const filteredHistoryResponse = await handleDemoRequest(
    "GET",
    `/analytics/value?period=30d&tcg=${filteredGame}`,
  );
  const filteredHistory = (await filteredHistoryResponse.json()) as {
    currentValue: number;
  };
  assert.equal(filteredHistory.currentValue, breakdown.byTcg[0]!.value);

  const filteredRarityResponse = await handleDemoRequest(
    "GET",
    `/analytics/distribution?by=rarity&tcg=${filteredGame}`,
  );
  const filteredRarity = (await filteredRarityResponse.json()) as {
    entries: Array<{ count: number }>;
    total: number;
  };
  assert.equal(filteredRarity.total, breakdown.byTcg[0]!.cardCount);
  assert.equal(
    filteredRarity.entries.reduce((sum, entry) => sum + entry.count, 0),
    breakdown.byTcg[0]!.cardCount,
  );

  const moversResponse = await handleDemoRequest(
    "GET",
    "/prices/analytics/movers?period=30",
  );
  const movers = (await moversResponse.json()) as {
    gainers: unknown[];
    losers: unknown[];
  };
  assert.ok(movers.gainers.length > 0);
  assert.ok(movers.losers.length > 0);

  const transactionsResponse = await handleDemoRequest(
    "GET",
    "/finance/transactions",
  );
  const transactions = (await transactionsResponse.json()) as Array<{
    type: string;
  }>;
  assert.deepEqual(
    new Set(transactions.map((transaction) => transaction.type)),
    new Set(["purchase", "sale", "trade"]),
  );

  const currencySummaryResponse = await handleDemoRequest(
    "GET",
    "/finance/summary/by-currency",
  );
  const currencySummary = (await currencySummaryResponse.json()) as {
    byCurrency: Array<{ currency: string }>;
    transactionCount: number;
  };
  assert.equal(currencySummary.transactionCount, transactions.length);
  assert.deepEqual(
    currencySummary.byCurrency.map((entry) => entry.currency),
    ["USD"],
  );

  const invalidTransactionResponse = await handleDemoRequest(
    "POST",
    "/finance/transactions",
    { type: "purchase", amount: 0 },
  );
  assert.equal(invalidTransactionResponse.status, 400);
});
