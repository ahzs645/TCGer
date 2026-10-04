import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const contractPath = path.join(root, "mobile-parity/api-contracts/interactions.json");
export const swiftFixture = path.join(root, "mobile-apps/ios/TCGer/TCGerTests/ApiContracts.generated.json");
export const loadContracts = () => JSON.parse(fs.readFileSync(contractPath, "utf8"));

export function validateContracts(registry, definitions, { checkFiles = true } = {}) {
  const errors = [];
  const features = new Set(definitions.features.map(item => item.id));
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const nonempty = value => typeof value === "string" && value.trim().length > 0;
  check(registry.schemaVersion === 1, "API schemaVersion must be 1");
  check(JSON.stringify(Object.keys(registry.consumers ?? {}).sort()) === JSON.stringify([...definitions.platforms].sort()), "API consumers must match all feature platforms");
  check(JSON.stringify(Object.keys(registry.providers ?? {}).sort()) === '["convex","express"]', "API providers must declare express and convex");
  for (const [name, binding] of Object.entries({ ...registry.consumers, ...registry.providers })) {
    check(nonempty(binding.test), `${name}: test path required`);
    check(Array.isArray(binding.source) && binding.source.length > 0, `${name}: source paths required`);
    for (const file of [...(binding.source ?? []), binding.test].filter(Boolean)) {
      check(nonempty(file) && !path.isAbsolute(file) && !file.split("/").includes(".."), `${name}: invalid repository path`);
      if (checkFiles) check(fs.existsSync(path.join(root, file)), `${name}: missing ${file}`);
    }
  }
  check(Array.isArray(registry.interactions) && registry.interactions.length > 0, "API interactions required");
  const ids = new Set();
  const iosTests = new Set();
  const operations = { listBinders: ["GET", "/collections"], createBinder: ["POST", "/collections"], searchCards: ["GET", "/cards/search/all"], updateBinder: ["PATCH", "/collections/contract-binder"], deleteBinder: ["DELETE", "/collections/contract-binder"], importBackup: ["POST", "/backups"], addCopy: ["POST", "/collections/contract-binder/cards"], updateCopy: ["PATCH", "/collections/contract-binder/cards/contract-copy"], removeCopy: ["DELETE", "/collections/contract-binder/cards/contract-copy"], openSealed: ["POST", "/sealed/inventory/contract-inventory/open"] };
  for (const item of registry.interactions ?? []) {
    check(nonempty(item.id) && /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(item.id), "Invalid API interaction ID");
    check(!ids.has(item.id), `${item.id}: duplicate interaction`); ids.add(item.id);
    check(features.has(item.featureId), `${item.id}: unknown product feature ${item.featureId}`);
    check(nonempty(item.iosTest) && /^test[A-Z][a-zA-Z0-9]*$/.test(item.iosTest) && !iosTests.has(item.iosTest), `${item.id}: unique iOS test method required`); iosTests.add(item.iosTest);
    const operation = operations[item.operation];
    check(Boolean(operation), `${item.id}: unknown operation`);
    check(item.request?.method === operation?.[0] && item.request?.path === operation?.[1], `${item.id}: incorrect operation endpoint`);
    check(nonempty(item.request?.headers?.Authorization), `${item.id}: authorization fixture required`);
    check(Number.isInteger(item.response?.status) && item.response.status >= 200 && item.response.status <= 599 && Object.hasOwn(item.response, "body"), `${item.id}: response status/body required`);
    check(Array.isArray(item.providers) && item.providers.length > 0 && new Set(item.providers).size === item.providers.length && item.providers.every(name => Object.hasOwn(registry.providers ?? {}, name)), `${item.id}: unknown/duplicate provider`);
    for (const [pointer, matcher] of Object.entries(item.response?.matchers ?? {})) {
      check(["nonempty-string", "iso-date-time"].includes(matcher), `${item.id}: unknown matcher ${matcher}`);
      const value = pointer.split("/").slice(1).reduce((value, key) => value?.[key], item.response.body);
      check(typeof value === "string", `${item.id}: matcher must point to a string fixture field: ${pointer}`);
    }
    if (checkFiles && nonempty(registry.consumers?.ios?.test)) {
      const source = fs.readFileSync(path.join(root, registry.consumers.ios.test), "utf8");
      check(source.includes(`func ${item.iosTest}(`) && source.includes(`verify("${item.id}")`), `${item.id}: missing iOS executable test binding`);
    }
  }
  return errors;
}

export function apiContractImpact(registry, changedFiles) {
  const changed = new Set(changedFiles);
  const fixtureChanged = changed.has("mobile-parity/api-contracts/interactions.json");
  const touched = Object.entries({ ...registry.consumers, ...registry.providers })
    .filter(([, binding]) => [binding.test, ...binding.source].some(file => changed.has(file)))
    .map(([name]) => name);
  return registry.interactions.filter(item => fixtureChanged || touched.some(name => Object.hasOwn(registry.consumers, name) || item.providers.includes(name)))
    .map(item => ({ id: item.id, featureId: item.featureId, surfaces: fixtureChanged ? [...Object.keys(registry.consumers), ...item.providers] : touched.filter(name => Object.hasOwn(registry.consumers, name) || item.providers.includes(name)) }));
}

export function main(command) {
  const registry = loadContracts();
  const definitions = JSON.parse(fs.readFileSync(path.join(root, "mobile-parity/features.definitions.json"), "utf8"));
  const errors = validateContracts(registry, definitions);
  if (errors.length) throw new Error(errors.join("\n"));
  if (command === "generate") fs.writeFileSync(swiftFixture, fs.readFileSync(contractPath));
  else if (command === "check") {
    if (!fs.existsSync(swiftFixture) || !fs.readFileSync(swiftFixture).equals(fs.readFileSync(contractPath))) throw new Error("iOS API fixture is stale; run npm run api-contracts:generate");
  } else throw new Error("Usage: contracts.mjs generate|check");
  console.log(`API contracts valid: ${registry.interactions.length} interactions, ${new Set(registry.interactions.map(item => item.featureId)).size} features, 3 consumers and 2 providers.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
