import test from "node:test";
import assert from "node:assert/strict";
import { loadContracts } from "./contracts.mjs";
import { parseAPIJUnit, parseXCTest, apiReport } from "./report.mjs";
const registry = loadContracts();
test("API JUnit preserves failures and skips after self-closing cases", () => {
  const results = parseAPIJUnit('<testcase name="[api:collections.create.success] web consumer"/><testcase name="[api:collections.create.invalid] web consumer"><failure/></testcase><testcase name="[api:collections.create.success] web consumer"><skipped/></testcase>');
  assert.equal(results.web["collections.create.success"], "Skipped");
  assert.equal(results.web["collections.create.invalid"], "Fail");
});
test("XCTest requires actual test case results, not passed parent suites", () => {
  const results = parseXCTest({ testNodes: [{ nodeType: "Test Suite", name: "ServerAPIContractTests", result: "Passed", children: [{ nodeType: "Test Case", name: "testCardsSearchEmpty()", result: "Passed" }, { nodeType: "Test Case", name: "testCardsSearchResults()", result: "Skipped" }] }] }, registry);
  assert.deepEqual(results, { "cards.search.empty": "Pass", "cards.search.results": "Skipped" });
});
test("every required consumer/provider must pass with matching fixture/source evidence", () => {
  const evidence = Object.fromEntries(["web", "ios", "android", "express", "convex"].map(target => [target, { fingerprint: "current", successfulRun: true, results: Object.fromEntries(registry.interactions.map(item => [item.id, "Pass"])) }]));
  assert.equal(apiReport(registry, evidence, "current").passed, true);
  evidence.ios.fingerprint = "old";
  assert.equal(apiReport(registry, evidence, "current").passed, false);
  evidence.ios.fingerprint = "current";
  delete evidence.android.results["cards.search.empty"];
  assert.equal(apiReport(registry, evidence, "current").passed, false);
  evidence.android.results["cards.search.empty"] = "Pass";
  evidence.ios.revision = "old-revision";
  assert.equal(apiReport(registry, evidence, "current", "new-revision").passed, false);
  evidence.express.successfulRun = false;
  assert.equal(apiReport(registry, evidence, "current").passed, false);
});
