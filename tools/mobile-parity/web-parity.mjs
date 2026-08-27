#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(toolDir, "../..");

// Compatibility bridge until the existing Playwright titles carry explicit
// feature tags. Explicit IDs in test names always take precedence.
const titleFeatureMappings = [
  [/^demo card search keeps its shared card surface$/i, "cards.search"],
  [/^demo collection remains usable across viewports$/i, "collections.browse"],
  [/^demo dashboard shows achievement progress$/i, "home.dashboard"],
  [/^desktop modal overlays keep the scrollbar gutter stable$/i, "settings.browse"],
  [/^followed guides keep wishlist navigation inside demo mode$/i, "wishlists.browse"],
  [/^demo public binder links render read-only and respect privacy$/i, "collections.browse"],
];

function decodeXml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function attribute(attrs, name) {
  return decodeXml(new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? "");
}

export function parseJUnit(xml) {
  const cases = [];
  for (const match of xml.matchAll(/<testcase\b([^>]*)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)) {
    const attrs = match[1] ?? match[2] ?? "";
    const body = match[3] ?? "";
    cases.push({
      name: attribute(attrs, "name"),
      classname: attribute(attrs, "classname"),
      time: Number(attribute(attrs, "time")) || 0,
      status: /<(failure|error)\b/.test(body) ? "Fail" : /<skipped\b/.test(body) ? "Skipped" : "Pass",
    });
  }
  return cases;
}

function explicitFeatureIds(value, knownIds) {
  const ids = new Set();
  const patterns = [
    /\[feature:([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)\]/g,
    /@feature:([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)/g,
    /featureId=([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)/g,
    /\[([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)\]/g,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) if (knownIds.has(match[1])) ids.add(match[1]);
  }
  return [...ids];
}

export function featureIdsForCase(testCase, knownIds) {
  const explicit = explicitFeatureIds(`${testCase.classname} ${testCase.name}`, knownIds);
  if (explicit.length) return explicit;
  return titleFeatureMappings
    .filter(([pattern, id]) => knownIds.has(id) && pattern.test(testCase.name))
    .map(([, id]) => id);
}

function aggregateStatus(cases) {
  if (cases.some((testCase) => testCase.status === "Fail")) return "Fail";
  if (cases.some((testCase) => testCase.status === "Pass")) return "Pass";
  return "Skipped";
}

export function normalizePlaywrightJUnit(xml, manifest) {
  const knownIds = new Set(manifest.features.map((feature) => feature.id));
  const rawCases = parseJUnit(xml);
  const byFeature = new Map();
  for (const testCase of rawCases) {
    for (const id of featureIdsForCase(testCase, knownIds)) {
      if (!byFeature.has(id)) byFeature.set(id, []);
      byFeature.get(id).push(testCase);
    }
  }
  const features = [...byFeature].sort(([left], [right]) => left.localeCompare(right)).map(([id, cases]) => ({
    id,
    status: aggregateStatus(cases),
    rawCases: cases.length,
    durationSeconds: cases.reduce((total, testCase) => total + testCase.time, 0),
  }));
  const failures = features.filter((feature) => feature.status === "Fail").length;
  const skipped = features.filter((feature) => feature.status === "Skipped").length;
  const testcases = features.map((feature) => {
    const body = feature.status === "Fail"
      ? `<failure message="One or more mapped Playwright cases failed"/>`
      : feature.status === "Skipped" ? `<skipped/>` : "";
    return `    <testcase classname="web.playwright.parity" name="[${escapeXml(feature.id)}] Web Playwright parity" time="${feature.durationSeconds.toFixed(3)}">${body}</testcase>`;
  }).join("\n");
  const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${features.length}" failures="${failures}" skipped="${skipped}">\n  <testsuite name="TCGer Web Playwright Parity" tests="${features.length}" failures="${failures}" skipped="${skipped}">\n${testcases}\n  </testsuite>\n</testsuites>\n`;
  return { junit, summary: { rawTestCases: rawCases.length, mappedFeatureCount: features.length, features } };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(path.join(rootDir, "mobile-parity/features.json"), "utf8"));
}

function main() {
  const command = process.argv[2];
  if (command === "normalize") {
    const input = argumentValue("--input");
    const output = argumentValue("--output");
    if (!input || !output) throw new Error("normalize requires --input and --output");
    const normalized = normalizePlaywrightJUnit(fs.readFileSync(input, "utf8"), loadManifest());
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, normalized.junit);
    const summary = argumentValue("--summary");
    if (summary) fs.writeFileSync(summary, `${JSON.stringify(normalized.summary, null, 2)}\n`);
    console.log(`normalized ${normalized.summary.rawTestCases} Playwright cases into ${normalized.summary.mappedFeatureCount} parity feature cases`);
  } else {
    console.error("Usage: web-parity.mjs normalize --input <playwright-junit> --output <parity-junit> [--summary <json>]");
    process.exit(2);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
