import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseJUnit, renderKotlin, renderReport, renderSwift, renderTypeScript, validateManifest } from "./parity.mjs";

const fixture = {
  schemaVersion: 2,
  platforms: ["web", "ios", "android"],
  features: [
    {
      id: "home.dashboard",
      title: "Dashboard",
      policy: "parity",
      flow: "maestro/flows/home.yaml",
      web: {
        status: "implemented",
        sources: ["page.tsx"],
        tests: [{ runner: "playwright", id: "home.dashboard", path: "home.spec.ts" }],
      },
      ios: { status: "implemented", sources: ["ios.swift"] },
      android: { status: "implemented", sources: ["android.kt"] },
    },
  ],
  controls: ["nav.home"],
};

test("validates a complete dynamic three-platform contract", () => {
  assert.deepEqual(validateManifest(fixture, { checkFiles: false }), []);
});

test("requires a state for every declared platform", () => {
  const invalid = structuredClone(fixture);
  delete invalid.features[0].web;
  assert.match(validateManifest(invalid, { checkFiles: false }).join("\n"), /web state is required/);
});

test("rejects parity claims with any missing implementation", () => {
  const invalid = structuredClone(fixture);
  invalid.features[0].android.status = "planned";
  assert.match(validateManifest(invalid, { checkFiles: false }).join("\n"), /every platform.*android/);
});

test("rejects undeclared platform states", () => {
  const invalid = structuredClone(fixture);
  invalid.features[0].desktop = { status: "implemented", sources: ["desktop.ts"] };
  assert.match(validateManifest(invalid, { checkFiles: false }).join("\n"), /undeclared platform or property desktop/);
});

test("requires structured matching test evidence", () => {
  const invalid = structuredClone(fixture);
  invalid.features[0].web.tests[0].id = "home.other";
  assert.match(validateManifest(invalid, { checkFiles: false }).join("\n"), /test id must match/);
});

test("requires explicit details for a temporary waiver", () => {
  const tracked = structuredClone(fixture);
  tracked.features[0].policy = "track";
  delete tracked.features[0].flow;
  tracked.features[0].android = { status: "waived", sources: ["decision.md"] };
  assert.match(validateManifest(tracked, { checkFiles: false }).join("\n"), /requires waiver reason/);
});

test("generates typed declarations for all application languages", () => {
  assert.match(renderSwift(fixture), /case homeDashboard = "home\.dashboard"/);
  assert.match(renderKotlin(fixture), /const val HOME_DASHBOARD = "home\.dashboard"/);
  const typescript = renderTypeScript(fixture);
  assert.match(typescript, /homeDashboard: "home\.dashboard"/);
  assert.match(typescript, /implementedParityFeatureIDs: ReadonlySet<ParityFeatureID>/);
  assert.match(typescript, /ParityControlIDs/);
});

test("reports three-platform declarations before test results are supplied", () => {
  const report = renderReport(fixture);
  assert.match(report, /Web declaration \| Web evidence \| iOS declaration \| iOS evidence \| Android declaration \| Android evidence/);
  assert.match(report, /\| Declared \|/);
  assert.equal((report.match(/\| Not run/g) ?? []).length, 3);
});

test("only reports verified after every platform has passing evidence", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tcger-parity-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resultFiles = {};
  for (const platform of fixture.platforms) {
    const file = path.join(directory, `${platform}.xml`);
    fs.writeFileSync(file, '<testsuite><testcase name="[home.dashboard] dashboard"/></testsuite>');
    resultFiles[platform] = file;
  }
  assert.match(renderReport(fixture, { results: resultFiles }), /\| Verified \|/);
});

test("a failure wins when several JUnit cases share one feature id", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tcger-parity-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "results.xml");
  fs.writeFileSync(file, '<testsuite><testcase name="[home.dashboard] first"/><testcase name="[home.dashboard] second"><failure/></testcase></testsuite>');
  assert.equal(parseJUnit(file).get("home.dashboard"), "Fail");
});
