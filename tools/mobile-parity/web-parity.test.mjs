import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlaywrightJUnit, parseJUnit } from "./web-parity.mjs";

const manifest = {
  features: [
    { id: "home.dashboard" },
    { id: "cards.search" },
    { id: "settings.browse" },
  ],
};

test("normalizes explicit Playwright feature tags into parity-readable JUnit names", () => {
  const raw = `<?xml version="1.0"?><testsuite>
    <testcase classname="demo.spec.ts" name="[feature:home.dashboard] renders" time="1.2"/>
    <testcase classname="demo.spec.ts" name="@feature:home.dashboard mobile" time="0.8"><skipped/></testcase>
    <testcase classname="demo.spec.ts" name="featureId=cards.search searches" time="2"><failure message="bad"/></testcase>
  </testsuite>`;

  const normalized = normalizePlaywrightJUnit(raw, manifest);
  const cases = parseJUnit(normalized.junit);

  assert.equal(normalized.summary.mappedFeatureCount, 2);
  assert.deepEqual(cases.map(({ name, status }) => [name, status]), [
    ["[cards.search] Web Playwright parity", "Fail"],
    ["[home.dashboard] Web Playwright parity", "Pass"],
  ]);
});

test("maps current untagged demo titles without treating unrelated tests as parity evidence", () => {
  const raw = `<testsuite>
    <testcase classname="demo" name="demo card search keeps its shared card surface"/>
    <testcase classname="demo" name="an unrelated regression"/>
  </testsuite>`;

  const normalized = normalizePlaywrightJUnit(raw, manifest);

  assert.equal(normalized.summary.rawTestCases, 2);
  assert.deepEqual(normalized.summary.features.map((feature) => feature.id), ["cards.search"]);
});
