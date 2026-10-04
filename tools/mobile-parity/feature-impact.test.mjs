import assert from "node:assert/strict";
import test from "node:test";
import { featureImpact, renderFeatureImpact } from "./feature-impact.mjs";

const manifest = {
  platforms: ["web", "ios"],
  features: [{ id: "cards.search", title: "Search", policy: "track", flow: "maestro/flows/search.yaml", web: { status: "partial", sources: ["frontend/src/search.tsx"], tests: [{ path: "frontend/tests/search.spec.ts" }] }, ios: { status: "implemented", sources: ["mobile-apps/ios/TCGer/TCGer/Search.swift"] } }],
};

test("source and platform test changes identify the affected feature without claiming verification", () => {
  const impact = featureImpact(manifest, ["frontend/src/search.tsx", "frontend/tests/search.spec.ts", "frontend/src/new-page.tsx"]);
  assert.equal(impact.affected.length, 1);
  assert.equal(impact.affected[0].platform, "web");
  assert.deepEqual(impact.affected[0].paths, ["frontend/src/search.tsx", "frontend/tests/search.spec.ts"]);
  assert.deepEqual(impact.unregisteredSources, ["frontend/src/new-page.tsx"]);
  assert.match(renderFeatureImpact(impact), /not behavioral verification/);
});

test("shared native flow and definition changes require review of all affected platforms", () => {
  assert.equal(featureImpact(manifest, ["mobile-parity/maestro/flows/search.yaml"]).affected.length, 2);
  assert.equal(featureImpact(manifest, ["mobile-parity/features.definitions.json"]).affected.length, 2);
  assert.deepEqual(featureImpact(manifest, ["docs/example.md"]).affected, []);
});
