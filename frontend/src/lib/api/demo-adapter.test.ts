import assert from "node:assert/strict";
import test from "node:test";

import { handleDemoRequest } from "./demo-adapter";
import { useDemoStore } from "@/stores/demo-store";
import { systemGuideDefinitions } from "@/lib/guides/system-guides.generated";

test("previews, commits, records, and undoes a demo CSV import", async () => {
  useDemoStore.getState().init();
  useDemoStore.setState({ collectionHistory: [] });
  const binder = useDemoStore.getState().binders[0];
  assert.ok(binder);
  const copies = () =>
    useDemoStore
      .getState()
      .binders.reduce(
        (sum, entry) =>
          sum +
          entry.cards.reduce((cardSum, card) => cardSum + card.quantity, 0),
        0,
      );
  const beforeCopies = copies();
  const csv = [
    "tcg,external_id,card_name,set_code,set_name,rarity,quantity,condition,price",
    'pokemon,demo-import-001,"Imported, Demo Card",sv-test,Demo Set,Rare,2,Near Mint,4.25',
    'pokemon,demo-import-001,"Imported, Demo Card",sv-test,Demo Set,Rare,1,Near Mint,4.25',
  ].join("\n");
  const request = {
    content: csv,
    fileName: "demo.csv",
    format: "csv",
    options: { defaultBinderId: binder.id, createMissingBinders: false },
  };

  const previewResponse = await handleDemoRequest(
    "POST",
    "/collections/import/preview",
    request,
  );
  const preview = (await previewResponse.json()) as {
    valid: boolean;
    totalCopies: number;
    rows: Array<{ cardName: string }>;
  };
  assert.equal(previewResponse.status, 200);
  assert.equal(preview.valid, true);
  assert.equal(preview.totalCopies, 3);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0]?.cardName, "Imported, Demo Card");
  assert.equal(copies(), beforeCopies);

  const commitResponse = await handleDemoRequest(
    "POST",
    "/collections/import/commit",
    request,
  );
  const committed = (await commitResponse.json()) as {
    importedCopies: number;
  };
  assert.equal(commitResponse.status, 200);
  assert.equal(committed.importedCopies, 3);
  assert.equal(copies(), beforeCopies + 3);

  const historyResponse = await handleDemoRequest(
    "GET",
    "/collections/history?limit=10",
  );
  const history = (await historyResponse.json()) as {
    entries: Array<{ id: string; operationKind: string; canUndo: boolean }>;
  };
  assert.equal(history.entries[0]?.operationKind, "import");
  assert.equal(history.entries[0]?.canUndo, true);

  const undoResponse = await handleDemoRequest(
    "POST",
    `/collections/history/${history.entries[0]!.id}/undo`,
    { idempotencyKey: "demo-test-undo-key" },
  );
  assert.equal(undoResponse.status, 200);
  assert.equal(copies(), beforeCopies);

  const afterUndo = (await (
    await handleDemoRequest("GET", "/collections/history")
  ).json()) as {
    entries: Array<{ operationKind: string; canUndo: boolean }>;
  };
  assert.equal(afterUndo.entries[0]?.operationKind, "undo");
  assert.equal(afterUndo.entries[1]?.canUndo, false);
});

test("demo import template is valid CSV and unsupported formats are explicit", async () => {
  const template = await handleDemoRequest(
    "GET",
    "/collections/import/template",
  );
  const headers = (await template.text()).trim().split(",");
  assert.equal(template.status, 200);
  assert.equal(
    headers.filter((header) => header === "collector_number").length,
    1,
  );

  const unsupported = await handleDemoRequest(
    "POST",
    "/collections/import/preview",
    { content: "[]", format: "json" },
  );
  const payload = (await unsupported.json()) as {
    valid: boolean;
    issues: Array<{ message: string }>;
  };
  assert.equal(unsupported.status, 422);
  assert.equal(payload.valid, false);
  assert.match(
    payload.issues[0]?.message ?? "",
    /offline demo imports TCGer CSV/i,
  );
});

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

test("hides server-only price sources when the demo has no server", async () => {
  const response = await handleDemoRequest("GET", "/prices/sources");
  const catalog = (await response.json()) as {
    sources: Array<{ id: string; requiresServer: boolean }>;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(catalog.sources, [
    {
      id: "automatic",
      label: "Saved catalog prices",
      description: "Use the prices included with the offline demo catalog.",
      games: [],
      requiresServer: false,
    },
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

test("persists demo tags and settings without echoing unsupported fields", async () => {
  useDemoStore.setState({ tags: [] });
  const beforeSettings = useDemoStore.getState().settings;

  const invalidTag = await handleDemoRequest("POST", "/collections/tags", {
    label: "   ",
  });
  assert.equal(invalidTag.status, 400);
  assert.deepEqual(useDemoStore.getState().tags, []);

  const created = await handleDemoRequest("POST", "/collections/tags", {
    label: " Illustration Rare ",
    colorHex: "aabbcc",
  });
  const tag = (await created.json()) as { id: string; label: string };
  assert.equal(created.status, 201);
  assert.equal(tag.label, "Illustration Rare");

  const listed = await handleDemoRequest("GET", "/collections/tags");
  assert.deepEqual(await listed.json(), [
    { ...useDemoStore.getState().tags[0], colorHex: "aabbcc" },
  ]);

  const updated = await handleDemoRequest("PATCH", "/settings", {
    appName: "Persistent Demo",
    scryfallApiBaseUrl: "https://catalog.example.test",
    unsupportedSetting: "must-not-echo",
  });
  const settings = (await updated.json()) as Record<string, unknown>;
  assert.equal(settings.appName, "Persistent Demo");
  assert.equal(settings.scryfallApiBaseUrl, "https://catalog.example.test");
  assert.equal("unsupportedSetting" in settings, false);

  const reread = await handleDemoRequest("GET", "/settings");
  assert.deepEqual(await reread.json(), useDemoStore.getState().settings);
  useDemoStore.setState({ tags: [], settings: beforeSettings });
});

test("creates and updates every binder metadata field exposed by the web UI", async () => {
  const createdResponse = await handleDemoRequest("POST", "/collections", {
    name: "Metadata Binder",
    description: "Created description",
    colorHex: "112233",
    defaultCondition: "Near Mint",
    containerType: "binder",
    imageUrl: "https://example.com/created.jpg",
    associatedTcg: "pokemon",
    associatedSetCode: "sv3pt5",
    associatedSetName: "151",
  });
  assert.equal(createdResponse.status, 200);
  const created = (await createdResponse.json()) as { id: string };

  const patchedResponse = await handleDemoRequest(
    "PATCH",
    `/collections/${created.id}`,
    {
      name: "Updated Binder",
      description: "Updated description",
      colorHex: "AABBCC",
      defaultCondition: null,
      containerType: "zip-binder",
      imageUrl: "https://example.com/updated.jpg",
      associatedTcg: "magic",
      associatedSetCode: "mh2",
      associatedSetName: "Modern Horizons 2",
      isPublic: true,
      rotateShareToken: true,
    },
  );
  assert.equal(patchedResponse.status, 200);
  const binder = (await patchedResponse.json()) as Record<string, unknown>;
  assert.equal(binder.name, "Updated Binder");
  assert.equal(binder.description, "Updated description");
  assert.equal(binder.colorHex, "AABBCC");
  assert.equal(binder.defaultCondition, undefined);
  assert.equal(binder.containerType, "zip-binder");
  assert.equal(binder.imageUrl, "https://example.com/updated.jpg");
  assert.equal(binder.associatedTcg, "magic");
  assert.equal(binder.associatedSetCode, "mh2");
  assert.equal(binder.associatedSetName, "Modern Horizons 2");
  assert.equal(binder.isPublic, true);
  assert.match(String(binder.shareToken), /^demo-share-/);

  const missing = await handleDemoRequest(
    "PATCH",
    "/collections/not-a-real-binder",
    { description: "must not report success" },
  );
  assert.equal(missing.status, 404);
});

test("reports demo health capabilities and meaningful seeded print options", async () => {
  const health = await handleDemoRequest("GET", "/health");
  const healthPayload = (await health.json()) as {
    status: string;
    features: Record<string, boolean>;
  };
  assert.equal(health.status, 200);
  assert.equal(healthPayload.status, "ok");
  assert.equal(healthPayload.features.decks, true);
  assert.equal(healthPayload.features.notifications, false);

  const prints = await handleDemoRequest(
    "GET",
    "/cards/pokemon/pkm-001/prints",
  );
  const printPayload = (await prints.json()) as {
    mode: string;
    total: number;
    prints: Array<{ id: string; name: string }>;
  };
  assert.equal(prints.status, 200);
  assert.equal(printPayload.mode, "simple");
  assert.equal(printPayload.total, printPayload.prints.length);
  assert.ok(printPayload.prints.length > 0);
  assert.ok(printPayload.prints.every((card) => card.name === "Charizard ex"));
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

  const linkedPurchaseResponse = await handleDemoRequest(
    "POST",
    "/finance/transactions",
    {
      type: "purchase",
      collectionEntryId: "demo-copy-darkrai",
      cardId: "demo-card-darkrai",
      externalId: "dp24",
      cardName: "Darkrai",
      tcg: "pokemon",
      quantity: 1,
      amount: 18.5,
      currency: "CAD",
      sourceUrl: "https://example.com/receipt/42",
      date: "2026-08-01T12:00:00.000Z",
    },
  );
  assert.equal(linkedPurchaseResponse.status, 201);
  const linkedPurchase = (await linkedPurchaseResponse.json()) as {
    id: string;
    collectionEntryId: string;
    amount: number;
    sourceUrl?: string;
  };
  assert.equal(linkedPurchase.collectionEntryId, "demo-copy-darkrai");

  const filteredTransactionsResponse = await handleDemoRequest(
    "GET",
    "/finance/transactions?collectionEntryId=demo-copy-darkrai",
  );
  const filteredTransactions =
    (await filteredTransactionsResponse.json()) as Array<{
      id: string;
    }>;
  assert.deepEqual(
    filteredTransactions.map((entry) => entry.id),
    [linkedPurchase.id],
  );

  const updatedPurchaseResponse = await handleDemoRequest(
    "PATCH",
    `/finance/transactions/${linkedPurchase.id}`,
    { amount: 20, currency: "USD", sourceUrl: null },
  );
  assert.equal(updatedPurchaseResponse.status, 200);
  const updatedPurchase = (await updatedPurchaseResponse.json()) as {
    amount: number;
    currency: string;
    sourceUrl?: string;
  };
  assert.equal(updatedPurchase.amount, 20);
  assert.equal(updatedPurchase.currency, "USD");
  assert.equal(updatedPurchase.sourceUrl, undefined);

  const invalidTransactionResponse = await handleDemoRequest(
    "POST",
    "/finance/transactions",
    { type: "purchase", amount: 0 },
  );
  assert.equal(invalidTransactionResponse.status, 400);
});
