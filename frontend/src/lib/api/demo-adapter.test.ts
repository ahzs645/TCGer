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
