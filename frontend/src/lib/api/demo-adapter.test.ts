import assert from "node:assert/strict";
import test from "node:test";

import { handleDemoRequest } from "./demo-adapter";

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
