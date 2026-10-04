import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseJUnit, renderKotlin, renderReport, renderSwift, renderTypeScript, validateManifest } from "./parity.mjs";

const fixture = {
  schemaVersion: 3,
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
        implementation: { path: "page.tsx", line: 1 },
        tests: [{ runner: "playwright", id: "home.dashboard", path: "home.spec.ts" }],
      },
      ios: { status: "implemented", sources: ["ios.swift"], implementation: { path: "ios.swift", line: 1 } },
      android: { status: "implemented", sources: ["android.kt"], implementation: { path: "android.kt", line: 1 } },
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

test("parity features require a declared web behavioral test", () => {
  const invalid = structuredClone(fixture);
  delete invalid.features[0].web.tests;
  assert.match(validateManifest(invalid, { checkFiles: false }).join("\n"), /requires web Playwright evidence/);
});

test("rejects expired and impossible waiver dates", () => {
  const tracked = structuredClone(fixture);
  tracked.features[0].policy = "track";
  const state = tracked.features[0].android;
  state.status = "waived";
  state.limitation = "Device acceptance deferred";
  state.waiver = { reason: "Awaiting hardware", owner: "mobile", expires: "2026-10-02" };
  assert.match(validateManifest(tracked, { checkFiles: false, today: "2026-10-03" }).join("\n"), /waiver expired/);
  state.waiver.expires = "2027-02-30";
  assert.match(validateManifest(tracked, { checkFiles: false, today: "2026-10-03" }).join("\n"), /real calendar date/);
  state.waiver.expires = "2026-10-03";
  assert.deepEqual(validateManifest(tracked, { checkFiles: false, today: "2026-10-03" }), []);
});

test("support metadata is generated for every language with limitations and prerequisites", () => {
  const tracked = structuredClone(fixture);
  for (const platform of tracked.platforms) {
    tracked.features[0][platform].limitation = "Requires a $5 fixture";
    tracked.features[0][platform].modes = ["server"];
    tracked.features[0][platform].requires = ["authenticated-server"];
  }
  assert.match(renderTypeScript(tracked), /parityFeatureSupport: Readonly<Record<ParityFeatureID, ParityFeatureSupport>>/);
  assert.match(renderSwift(tracked), /var support: ParityFeatureSupport/);
  assert.match(renderKotlin(tracked), /Requires a \\\$5 fixture/);
  assert.match(renderReport(tracked), /Availability and limitations/);
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
  assert.match(renderReport(fixture, { results: resultFiles, testOnlyUnboundEvidence: true }), /\| Verified \|/);
});

test("a failure wins when several JUnit cases share one feature id", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tcger-parity-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "results.xml");
  fs.writeFileSync(file, '<testsuite><testcase name="[home.dashboard] first"/><testcase name="[home.dashboard] second"><failure/></testcase></testsuite>');
  assert.equal(parseJUnit(file).get("home.dashboard"), "Fail");
});

test("self-closing passes do not swallow the next failed or skipped test", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tcger-parity-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "results.xml");
  fs.writeFileSync(file, '<testsuite><testcase name="[home.dashboard] pass"/><testcase name="[cards.search] failure"><failure/></testcase><testcase name="[home.dashboard] skipped"><skipped/></testcase></testsuite>');
  assert.deepEqual([...parseJUnit(file)], [["home.dashboard", "Skipped"], ["cards.search", "Fail"]]);
});
