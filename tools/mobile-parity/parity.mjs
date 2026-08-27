#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(toolDir, "../..");
export const manifestPath = path.join(rootDir, "mobile-parity/features.json");
const swiftPath = path.join(rootDir, "mobile-apps/ios/TCGer/TCGer/Generated/ParityFeatureIDs.generated.swift");
const kotlinPath = path.join(rootDir, "mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/generated/ParityFeatureIDs.generated.kt");
const typescriptPath = path.join(rootDir, "frontend/src/generated/parity.generated.ts");
const reportPath = path.join(rootDir, "mobile-parity/REPORT.md");
const validStatuses = new Set(["implemented", "partial", "planned", "unavailable", "not_applicable", "waived"]);
const idPattern = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const platformPattern = /^[a-z][a-z0-9_-]*$/;
const featureProperties = new Set(["id", "title", "policy", "flow"]);

export function loadManifest(file = manifestPath) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function lowerCamel(id) {
  const parts = id.split(".");
  return parts[0] + parts.slice(1).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}

function upperSnake(id) {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replaceAll(".", "_").toUpperCase();
}

function platformTitle(platform) {
  if (platform === "ios") return "iOS";
  return platform[0].toUpperCase() + platform.slice(1);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateGeneratedNames(items, transform, label, errors) {
  const names = new Map();
  for (const item of items) {
    const name = transform(item);
    const previous = names.get(name);
    if (previous) errors.push(`${label} ids ${previous} and ${item} generate the same symbol ${name}`);
    else names.set(name, item);
  }
}

export function validateManifest(manifest, { checkFiles = true } = {}) {
  const errors = [];
  if (manifest.schemaVersion !== 2) errors.push("schemaVersion must be 2");
  if (!Array.isArray(manifest.platforms) || manifest.platforms.length === 0) {
    errors.push("platforms must be a non-empty array");
  }

  const platforms = new Set();
  for (const platform of manifest.platforms ?? []) {
    if (typeof platform !== "string" || !platformPattern.test(platform)) {
      errors.push(`invalid platform id: ${String(platform)}`);
      continue;
    }
    if (platforms.has(platform)) errors.push(`duplicate platform id: ${platform}`);
    platforms.add(platform);
  }

  if (!Array.isArray(manifest.features) || manifest.features.length === 0) errors.push("features must be a non-empty array");
  if (!Array.isArray(manifest.controls)) errors.push("controls must be an array");

  const featureIds = new Set();
  const flowPaths = new Set();
  for (const feature of manifest.features ?? []) {
    if (!idPattern.test(feature.id ?? "")) errors.push(`invalid feature id: ${feature.id ?? "<missing>"}`);
    if (featureIds.has(feature.id)) errors.push(`duplicate feature id: ${feature.id}`);
    featureIds.add(feature.id);
    if (!isNonEmptyString(feature.title)) errors.push(`${feature.id}: title is required`);
    if (!["parity", "track"].includes(feature.policy)) errors.push(`${feature.id}: policy must be parity or track`);

    for (const key of Object.keys(feature)) {
      if (!featureProperties.has(key) && !platforms.has(key)) errors.push(`${feature.id}: undeclared platform or property ${key}`);
    }

    for (const platform of platforms) {
      const state = feature[platform];
      if (!state || typeof state !== "object" || Array.isArray(state)) {
        errors.push(`${feature.id}: ${platform} state is required`);
        continue;
      }
      if (!validStatuses.has(state.status)) errors.push(`${feature.id}: invalid ${platform} status`);
      if (!Array.isArray(state.sources) || state.sources.length === 0 || state.sources.some((source) => !isNonEmptyString(source))) {
        errors.push(`${feature.id}: ${platform} sources are required`);
      }
      for (const key of Object.keys(state)) {
        if (!["status", "sources", "tests", "waiver"].includes(key)) errors.push(`${feature.id}: unsupported ${platform} state property ${key}`);
      }
      if (state.tests !== undefined && !Array.isArray(state.tests)) {
        errors.push(`${feature.id}: ${platform} tests must be an array`);
      }
      const testKeys = new Set();
      for (const evidence of state.tests ?? []) {
        if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
          errors.push(`${feature.id}: invalid ${platform} test evidence`);
          continue;
        }
        if (!isNonEmptyString(evidence.runner)) errors.push(`${feature.id}: ${platform} test runner is required`);
        if (evidence.id !== feature.id) errors.push(`${feature.id}: ${platform} test id must match the feature id`);
        if (evidence.path !== undefined && !isNonEmptyString(evidence.path)) errors.push(`${feature.id}: invalid ${platform} test path`);
        for (const key of Object.keys(evidence)) {
          if (!["runner", "id", "path"].includes(key)) errors.push(`${feature.id}: unsupported ${platform} test property ${key}`);
        }
        const testKey = `${evidence.runner}\0${evidence.id}\0${evidence.path ?? ""}`;
        if (testKeys.has(testKey)) errors.push(`${feature.id}: duplicate ${platform} test evidence`);
        testKeys.add(testKey);
        if (checkFiles && evidence.path && !fs.existsSync(path.join(rootDir, evidence.path))) {
          errors.push(`${feature.id}: missing ${platform} test ${evidence.path}`);
        }
      }
      if (state.status === "waived") {
        if (!state.waiver || !isNonEmptyString(state.waiver.reason) || !isNonEmptyString(state.waiver.owner) || !/^\d{4}-\d{2}-\d{2}$/.test(state.waiver.expires ?? "")) {
          errors.push(`${feature.id}: ${platform} waived status requires waiver reason, owner, and YYYY-MM-DD expiry`);
        }
      } else if (state.waiver !== undefined) {
        errors.push(`${feature.id}: ${platform} waiver is only valid with waived status`);
      }
      if (checkFiles) {
        for (const source of state.sources ?? []) {
          if (isNonEmptyString(source) && !fs.existsSync(path.join(rootDir, source))) errors.push(`${feature.id}: missing ${platform} source ${source}`);
        }
      }
    }

    if (feature.policy === "parity") {
      const missing = [...platforms].filter((platform) => feature[platform]?.status !== "implemented");
      if (missing.length > 0) errors.push(`${feature.id}: parity policy requires every platform to be implemented (missing: ${missing.join(", ")})`);
      if (!isNonEmptyString(feature.flow)) errors.push(`${feature.id}: parity policy requires a shared flow`);
    }

    if (feature.flow) {
      if (!isNonEmptyString(feature.flow)) errors.push(`${feature.id}: flow must be a non-empty path`);
      if (flowPaths.has(feature.flow)) errors.push(`${feature.id}: flow is already assigned to another feature`);
      flowPaths.add(feature.flow);
      if (checkFiles) {
        const absoluteFlow = path.join(rootDir, "mobile-parity", feature.flow.replace(/^maestro\//, "maestro/"));
        if (!fs.existsSync(absoluteFlow)) {
          errors.push(`${feature.id}: missing flow mobile-parity/${feature.flow}`);
        } else {
          const flow = fs.readFileSync(absoluteFlow, "utf8");
          if (!flow.includes(`featureId: "${feature.id}"`)) errors.push(`${feature.id}: flow must declare properties.featureId`);
        }
      }
    }
  }

  const controls = new Set();
  for (const control of manifest.controls ?? []) {
    if (!idPattern.test(control)) errors.push(`invalid control id: ${control}`);
    if (controls.has(control)) errors.push(`duplicate control id: ${control}`);
    controls.add(control);
  }
  validateGeneratedNames(featureIds, lowerCamel, "feature", errors);
  validateGeneratedNames(featureIds, upperSnake, "feature", errors);
  validateGeneratedNames(controls, lowerCamel, "control", errors);
  validateGeneratedNames(controls, upperSnake, "control", errors);
  return errors;
}

export function renderSwift(manifest) {
  const features = manifest.features.map((feature) => `    case ${lowerCamel(feature.id)} = "${feature.id}"`).join("\n");
  const implemented = manifest.features.filter((feature) => feature.ios?.status === "implemented").map((feature) => `        .${lowerCamel(feature.id)},`).join("\n");
  const controls = manifest.controls.map((id) => `    static let ${lowerCamel(id)} = "${id}"`).join("\n");
  return `// Generated by tools/mobile-parity/parity.mjs. Do not edit by hand.\nimport Foundation\n\nenum ParityFeatureID: String, CaseIterable, Sendable {\n${features}\n\n    static let implemented: Set<ParityFeatureID> = [\n${implemented}\n    ]\n\n    var screenIdentifier: String { "feature.\\(rawValue)" }\n}\n\nenum ParityControlID {\n${controls}\n}\n`;
}

export function renderKotlin(manifest) {
  const features = manifest.features.map((feature) => `    const val ${upperSnake(feature.id)} = "${feature.id}"`).join("\n");
  const implemented = manifest.features.filter((feature) => feature.android?.status === "implemented").map((feature) => `        ${upperSnake(feature.id)},`).join("\n");
  const controls = manifest.controls.map((id) => `    const val ${upperSnake(id)} = "${id}"`).join("\n");
  return `// Generated by tools/mobile-parity/parity.mjs. Do not edit by hand.\npackage com.ahmadjalil.tcger.generated\n\nobject ParityFeatureIDs {\n${features}\n\n    val implemented: Set<String> = setOf(\n${implemented}\n    )\n\n    fun screen(featureId: String): String = "feature.$featureId"\n}\n\nobject ParityControlIDs {\n${controls}\n}\n`;
}

export function renderTypeScript(manifest) {
  const features = manifest.features.map((feature) => `  ${lowerCamel(feature.id)}: "${feature.id}",`).join("\n");
  const implemented = manifest.features.filter((feature) => feature.web?.status === "implemented").map((feature) => `  ParityFeatureIDs.${lowerCamel(feature.id)},`).join("\n");
  const controls = manifest.controls.map((id) => `  ${lowerCamel(id)}: "${id}",`).join("\n");
  return `// Generated by tools/mobile-parity/parity.mjs. Do not edit by hand.\n\nexport const ParityFeatureIDs = {\n${features}\n} as const;\n\nexport type ParityFeatureID = (typeof ParityFeatureIDs)[keyof typeof ParityFeatureIDs];\n\nexport const implementedParityFeatureIDs: ReadonlySet<ParityFeatureID> = new Set([\n${implemented}\n]);\n\nexport const parityScreenID = (featureID: ParityFeatureID): string => \`feature.\${featureID}\`;\n\nexport const ParityControlIDs = {\n${controls}\n} as const;\n\nexport type ParityControlID = (typeof ParityControlIDs)[keyof typeof ParityControlIDs];\n`;
}

export function parseJUnit(file) {
  if (!file || !fs.existsSync(file)) return new Map();
  const xml = fs.readFileSync(file, "utf8");
  const collected = new Map();
  for (const match of xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g)) {
    const attrs = match[1] ?? match[3] ?? "";
    const body = match[2] ?? "";
    const name = /\bname="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const id = /\[([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)\]/.exec(name)?.[1];
    if (!id) continue;
    const result = /<(failure|error)\b/.test(body) ? "Fail" : /<skipped\b/.test(body) ? "Skipped" : "Pass";
    const previous = collected.get(id) ?? [];
    previous.push(result);
    collected.set(id, previous);
  }
  return new Map([...collected].map(([id, results]) => [id, results.includes("Fail") ? "Fail" : results.includes("Skipped") ? "Skipped" : "Pass"]));
}

function statusLabel(status) {
  return status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function platformResultOptions(manifest, options) {
  const explicit = options.results ?? {};
  return Object.fromEntries(manifest.platforms.map((platform) => [platform, explicit[platform] ?? options[`${platform}Results`]]));
}

export function renderReport(manifest, options = {}) {
  const resultFiles = platformResultOptions(manifest, options);
  const results = Object.fromEntries(manifest.platforms.map((platform) => [platform, parseJUnit(resultFiles[platform])]));
  const rows = manifest.features.map((feature) => {
    const execution = Object.fromEntries(manifest.platforms.map((platform) => {
      const observed = results[platform].get(feature.id);
      const hasDeclaredTest = Boolean(feature.flow) || (feature[platform]?.tests?.length ?? 0) > 0;
      return [platform, observed ?? (hasDeclaredTest ? "Not run" : "—")];
    }));
    const executionValues = manifest.platforms.map((platform) => execution[platform]);
    const statuses = manifest.platforms.map((platform) => feature[platform].status);
    let result;
    if (executionValues.includes("Fail")) result = "Failed";
    else if (feature.policy === "parity" && statuses.some((status) => status !== "implemented")) result = "Gap";
    else if (statuses.every((status) => status === "implemented") && executionValues.every((value) => value === "Pass")) result = "Verified";
    else if (feature.policy === "parity") result = "Declared";
    else if (new Set(statuses).size === 1) result = "Aligned";
    else result = "Tracked gap";
    const platformCells = manifest.platforms.flatMap((platform) => [statusLabel(feature[platform].status), execution[platform]]);
    return `| ${feature.id} | ${feature.title} | ${feature.policy} | ${platformCells.join(" | ")} | ${result} |`;
  });
  const parityCount = manifest.features.filter((feature) => feature.policy === "parity").length;
  const trackedCount = manifest.features.length - parityCount;
  const platformSummary = manifest.platforms.map(platformTitle).join(", ");
  const declarationStatuses = ["implemented", "partial", "planned", "unavailable", "not_applicable", "waived"];
  const declarationSummaryRows = manifest.platforms.map((platform) => {
    const counts = Object.fromEntries(declarationStatuses.map((status) => [
      status,
      manifest.features.filter((feature) => feature[platform].status === status).length,
    ]));
    return `| ${platformTitle(platform)} | ${declarationStatuses.map((status) => counts[status]).join(" | ")} |`;
  });
  const platformHeaders = manifest.platforms.flatMap((platform) => [`${platformTitle(platform)} declaration`, `${platformTitle(platform)} evidence`]);
  const header = ["ID", "Feature", "Policy", ...platformHeaders, "Result"];
  const declarationSummaryHeaders = ["Platform", ...declarationStatuses.map(statusLabel)];
  return `# Cross-platform feature parity\n\nGenerated from [features.json](features.json). Do not edit this report by hand.\n\n- Platforms: ${platformSummary}.\n- ${parityCount} features are parity-required.\n- ${trackedCount} features are explicitly tracked.\n- A declaration is backed by source paths in the manifest. “Verified” additionally requires passing current JUnit evidence on every declared platform; a declared test that was not supplied is “Not run.”\n\n## Declaration summary\n\n| ${declarationSummaryHeaders.join(" | ")} |\n|${declarationSummaryHeaders.map(() => "---").join("|")}|\n${declarationSummaryRows.join("\n")}\n\n## Feature matrix\n\n| ${header.join(" | ")} |\n|${header.map(() => "---").join("|")}|\n${rows.join("\n")}\n`;
}

function expectedFiles(manifest) {
  return new Map([
    [swiftPath, renderSwift(manifest)],
    [kotlinPath, renderKotlin(manifest)],
    [typescriptPath, renderTypeScript(manifest)],
    [reportPath, renderReport(manifest)],
  ]);
}

function generate(manifest) {
  for (const [file, contents] of expectedFiles(manifest)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    console.log(`generated ${path.relative(rootDir, file)}`);
  }
}

function checkGenerated(manifest) {
  const errors = [];
  for (const [file, expected] of expectedFiles(manifest)) {
    if (!fs.existsSync(file)) errors.push(`missing generated file ${path.relative(rootDir, file)}`);
    else if (fs.readFileSync(file, "utf8") !== expected) errors.push(`stale generated file ${path.relative(rootDir, file)}; run npm run parity:generate`);
  }
  return errors;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const command = process.argv[2] ?? "check";
  const manifest = loadManifest();
  const manifestErrors = validateManifest(manifest, { checkFiles: command !== "generate-contract-only" });
  if (manifestErrors.length) {
    console.error(manifestErrors.map((error) => `- ${error}`).join("\n"));
    process.exit(1);
  }

  if (command === "generate") generate(manifest);
  else if (command === "check") {
    const errors = checkGenerated(manifest);
    if (errors.length) {
      console.error(errors.map((error) => `- ${error}`).join("\n"));
      process.exit(1);
    }
    console.log(`Parity contract valid: ${manifest.features.length} features, ${manifest.controls.length} controls across ${manifest.platforms.length} platforms.`);
  } else if (command === "report") {
    const report = renderReport(manifest, {
      results: Object.fromEntries(manifest.platforms.map((platform) => [platform, argumentValue(`--${platform}-results`)])),
    });
    const output = argumentValue("--output") ?? reportPath;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, report);
    console.log(`wrote ${path.relative(rootDir, output)}`);
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(2);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
