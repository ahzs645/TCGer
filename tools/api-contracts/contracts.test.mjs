import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root, loadContracts, validateContracts, apiContractImpact } from "./contracts.mjs";
import { assertRequest, assertResponse } from "./match.mjs";
const registry = loadContracts();
const definitions = JSON.parse(fs.readFileSync(path.join(root, "mobile-parity/features.definitions.json")));
test("contract bindings cover real product features and all consumer surfaces", () => assert.deepEqual(validateContracts(registry, definitions), []));
test("unknown features, providers, operations and duplicate IDs cannot silently lose coverage", () => {
  const bad = structuredClone(registry);
  bad.interactions[0].featureId = "missing.feature";
  bad.interactions[0].providers = ["unknown"];
  bad.interactions[0].operation = "unknown";
  bad.interactions.push(bad.interactions[0]);
  const errors = validateContracts(bad, definitions, { checkFiles: false }).join("\n");
  for (const pattern of [/unknown product feature/, /unknown.*provider/, /unknown operation/, /duplicate interaction/]) assert.match(errors, pattern);
});
test("provider matching accepts additive fields while rejecting changed envelopes, types and lost metadata", () => {
  const item = registry.interactions.find(item => item.id === "collections.create.success");
  assertResponse({ ...item.response.body, id: "server-id", future: true }, item.response.body, item.response.matchers);
  assert.throws(() => assertResponse({ binder: item.response.body }, item.response.body, item.response.matchers));
  assert.throws(() => assertResponse({ ...item.response.body, associatedTcg: "magic" }, item.response.body, item.response.matchers));
  assert.throws(() => assertResponse({ ...item.response.body, createdAt: "broken" }, item.response.body, item.response.matchers));
});
test("request matching checks encoded queries, authorization and exact JSON payloads", () => {
  const item = registry.interactions.find(item => item.id === "cards.search.results");
  const url = `https://contract.test${item.request.path}?${new URLSearchParams(item.request.query)}`;
  assertRequest(item, url, { headers: item.request.headers });
  assert.throws(() => assertRequest(item, url, { headers: {} }));
  assert.throws(() => assertRequest(item, url.replace("limit=1000", "limit=1"), { headers: item.request.headers }));
  const create = registry.interactions.find(item => item.id === "collections.create.success");
  const options = { method: "POST", headers: { ...create.request.headers, "Content-Type": "application/json" }, body: JSON.stringify(create.request.body) };
  assertRequest(create, "https://contract.test/collections", options);
  assert.throws(() => assertRequest(create, "https://contract.test/collections", { ...options, body: JSON.stringify({ name: create.request.body.name }) }));
});
test("API fixture and provider edits expose their affected product capabilities", () => {
  assert.equal(apiContractImpact(registry, ["mobile-parity/api-contracts/interactions.json"]).length, registry.interactions.length);
  const impact = apiContractImpact(registry, ["convex-backend/convex/bridge.ts"]);
  assert.ok(impact.length > 0);
  assert.deepEqual(impact.map(item => item.id), registry.interactions.filter(item => item.providers.includes("convex")).map(item => item.id));
  assert.ok(impact.every(item => item.surfaces.includes("convex")));
});
