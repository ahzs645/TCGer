import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { root, contractPath } from "./contracts.mjs";

export function fingerprint(registry) {
  const hash = createHash("sha256");
  const files = [path.relative(root, contractPath), "tools/api-contracts/match.mjs", ...Object.values({ ...registry.consumers, ...registry.providers }).flatMap(binding => [binding.test, ...binding.source])];
  for (const file of [...new Set(files)].sort()) { hash.update(file); hash.update(fs.readFileSync(path.join(root, file))); }
  return hash.digest("hex");
}
export function parseAPIJUnit(xml) {
  const targets = { web: {}, express: {}, convex: {}, android: {} };
  for (const match of xml.matchAll(/<testcase\b([^>]*)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)) {
    const attrs = match[1] ?? match[2];
    const body = match[3] ?? "";
    const name = /\bname="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const id = /\[api:([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)\]/.exec(name)?.[1];
    const target = /\b(web|express|convex|android) (consumer|provider)\b/.exec(name)?.[1];
    if (!id || !target) continue;
    const result = /<(failure|error)\b/.test(body) ? "Fail" : /<skipped\b/.test(body) ? "Skipped" : "Pass";
    targets[target][id] = mergeStatus(targets[target][id], result);
  }
  return targets;
}
function mergeStatus(a, b) {
  return [a, b].includes("Fail") ? "Fail" : [a, b].includes("Skipped") ? "Skipped" : b;
}
export function parseXCTest(tree, registry) {
  const results = {};
  const visit = node => {
    if (node.nodeType === "Test Case") {
      const item = registry.interactions.find(item => node.name === `${item.iosTest}()` || node.name === item.iosTest || node.nodeIdentifier?.endsWith(`/${item.iosTest}()`));
      if (item) results[item.id] = mergeStatus(results[item.id], node.result === "Passed" ? "Pass" : node.result === "Skipped" ? "Skipped" : "Fail");
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of tree.testNodes ?? []) visit(node);
  return results;
}
export function apiReport(registry, evidence, currentFingerprint, currentRevision) {
  const targets = [...Object.keys(registry.consumers), ...Object.keys(registry.providers)];
  const rows = registry.interactions.map(item => {
    const statuses = Object.fromEntries(targets.map(target => {
      if (!Object.hasOwn(registry.consumers, target) && !item.providers.includes(target)) return [target, "—"];
      const run = evidence[target];
      return [target, !run ? "Not run" : run.fingerprint !== currentFingerprint || (currentRevision && run.revision !== currentRevision) ? "Stale" : !run.successfulRun ? "Fail" : run.results[item.id] ?? "Not run"];
    }));
    return { id: item.id, featureId: item.featureId, statuses, compatible: Object.values(statuses).every(status => status === "Pass" || status === "—") };
  });
  const lines = ["# API contract coverage", "", "API boundary evidence only. Passing this matrix does not mark a feature's UI parity Verified.", "", "Card search is served by Express in both backend modes; Convex evidence is required for collection, import, scan-save and sealed-opening interactions.", "", "| Interaction | Product feature | Web | iOS | Android | Express | Convex | Compatible |", "|---|---|---|---|---|---|---|---|"];
  for (const row of rows) lines.push(`| ${row.id} | ${row.featureId} | ${targets.map(target => row.statuses[target]).join(" | ")} | ${row.compatible ? "Yes" : "No"} |`);
  lines.push("", "## Provider boundaries", "", ...Object.entries(registry.providers).map(([name, binding]) => `- ${name}: ${binding.limitation}`), "", "Missing, skipped, failed, or stale evidence cannot satisfy a contract. Fingerprints bind fixtures and registered source/test files; CI additionally tests one checkout revision.", "");
  return { rows, markdown: lines.join("\n"), passed: rows.every(row => row.compatible) };
}
