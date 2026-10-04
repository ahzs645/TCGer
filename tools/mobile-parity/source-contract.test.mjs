import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectSourceRegistrations, compileSourceContract, parseSourceRegistrations } from "./source-contract.mjs";

const definitions = {
  schemaVersion: 3,
  platforms: ["web"],
  controls: [],
  features: [{ id: "cards.search", title: "Search", policy: "track", web: { sources: ["frontend/src/search.tsx"], registration: "frontend/src/search.tsx" } }],
};
const declaration = { id: "cards.search", platform: "web", status: "implemented" };
const source = (value = declaration) => `// @tcger-feature ${JSON.stringify(value)}\nexport const component = true;\n`;
const registrations = (value) => parseSourceRegistrations(source(value), "frontend/src/search.tsx").registrations;

test("support is compiled from implementation source, leaving definitions untouched", () => {
  const before = structuredClone(definitions);
  const compiled = compileSourceContract(definitions, registrations({ ...declaration, modes: ["local"], requires: ["installed-catalog"] }));
  assert.deepEqual(compiled.errors, []);
  assert.deepEqual(compiled.manifest.features[0].web, {
    sources: ["frontend/src/search.tsx"], status: "implemented",
    implementation: { path: "frontend/src/search.tsx", line: 1 }, modes: ["local"], requires: ["installed-catalog"],
  });
  assert.deepEqual(definitions, before);
});

test("missing, duplicate, unknown, and moved registrations are rejected", () => {
  assert.match(compileSourceContract(definitions, []).errors.join("\n"), /missing web source registration/);
  assert.match(compileSourceContract(definitions, [...registrations(), ...registrations()]).errors.join("\n"), /duplicate registration/);
  assert.match(compileSourceContract(definitions, registrations({ ...declaration, id: "cards.other" })).errors.join("\n"), /unregistered feature/);
  const moved = registrations().map((entry) => ({ ...entry, file: "frontend/src/moved.tsx" }));
  assert.match(compileSourceContract(definitions, moved).errors.join("\n"), /registration expected in/);
  assert.match(compileSourceContract(definitions, registrations({ ...declaration, platform: "ios" })).errors.join("\n"), /undeclared platform/);
});

test("partial and unsupported declarations must explain the limitation", () => {
  for (const status of ["partial", "planned", "unavailable", "not_applicable", "waived"]) {
    assert.match(parseSourceRegistrations(source({ ...declaration, status }), "source.ts").errors.join("\n"), /requires a limitation/);
  }
  const parsed = parseSourceRegistrations(source({ ...declaration, status: "partial", limitation: "Exact printing correction requires manual review" }), "source.ts");
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.registrations[0].limitation, "Exact printing correction requires manual review");
});

test("typos, invalid mode lists, and malformed source metadata fail with line locations", () => {
  for (const value of [{ ...declaration, stats: "implemented" }, { ...declaration, status: "complete" }, { ...declaration, modes: ["offline"] }, { ...declaration, requires: [] }, { ...declaration, modes: ["server", "server"] }]) {
    const parsed = parseSourceRegistrations(`import x from "x";\n${source(value)}`, "feature.ts");
    assert.equal(parsed.registrations.length, 0);
    assert.match(parsed.errors.join("\n"), /feature.ts:2:/);
  }
  assert.match(parseSourceRegistrations("// @tcger-feature\n", "feature.ts").errors.join("\n"), /invalid @tcger-feature declaration/);
});

test("support cannot also be maintained manually in product definitions", () => {
  for (const key of ["status", "modes", "requires", "limitation", "waiver", "implementation"]) {
    const manual = structuredClone(definitions);
    manual.features[0].web[key] = "manual";
    assert.match(compileSourceContract(manual, registrations()).errors.join("\n"), /belongs in source/);
  }
});

test("another platform cannot register support from the wrong application's source", () => {
  const crossPlatform = structuredClone(definitions);
  crossPlatform.platforms = ["ios"];
  crossPlatform.features[0].ios = crossPlatform.features[0].web;
  delete crossPlatform.features[0].web;
  assert.match(compileSourceContract(crossPlatform, registrations({ ...declaration, platform: "ios" })).errors.join("\n"), /own application source/);
});

test("scanner ignores generated artifacts and test fixtures but finds new application declarations", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tcger-source-contract-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ["frontend/src/search.tsx", "frontend/src/search.test.ts", "frontend/src/generated/example.ts", "mobile-apps/ios/TCGer/TCGer/Resources/example.swift"]) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source());
  }
  const collected = collectSourceRegistrations(root);
  assert.deepEqual(collected.errors, []);
  assert.deepEqual(collected.registrations.map((entry) => entry.file), ["frontend/src/search.tsx"]);
});
