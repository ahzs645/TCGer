import fs from "node:fs";
import path from "node:path";

// Only application source is scanned. Bundled output, dependencies, and tests
// cannot register implementation support on behalf of a production feature.
export const sourceRoots = [
  "frontend/app",
  "frontend/src",
  "mobile-apps/ios/TCGer/TCGer",
  "mobile-apps/android/app/src/main/java",
];
const ignoredDirectories = new Set(["node_modules", "Resources", "Assets.xcassets", "Generated", "generated"]);
const statuses = new Set(["implemented", "partial", "planned", "unavailable", "not_applicable", "waived"]);
const modes = new Set(["local", "server", "demo"]);
const properties = new Set(["id", "platform", "status", "limitation", "modes", "requires", "waiver"]);
const idPattern = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const platformRoots = { web: ["frontend/app/", "frontend/src/"], ios: ["mobile-apps/ios/TCGer/TCGer/"], android: ["mobile-apps/android/app/src/main/java/"] };

export function parseSourceRegistrations(contents, file) {
  const registrations = [];
  const errors = [];
  contents.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*\/\/\s*@tcger-feature\b(.*)$/.exec(line);
    if (!match) return;
    const location = `${file}:${index + 1}`;
    try {
      const declaration = JSON.parse(match[1]);
      if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) throw new Error("expected a JSON object");
      const localErrors = [];
      for (const key of Object.keys(declaration)) if (!properties.has(key)) localErrors.push(`unknown property ${key}`);
      if (!idPattern.test(declaration.id ?? "")) localErrors.push("invalid feature id");
      if (typeof declaration.platform !== "string") localErrors.push("platform is required");
      if (!statuses.has(declaration.status)) localErrors.push("invalid support status");
      if (declaration.limitation !== undefined && (typeof declaration.limitation !== "string" || !declaration.limitation.trim())) localErrors.push("limitation must be a non-empty string");
      if (declaration.status !== "implemented" && !declaration.limitation?.trim()) localErrors.push("non-implemented support requires a limitation explaining the gap or fallback");
      for (const key of ["modes", "requires"]) {
        if (declaration[key] !== undefined && (!Array.isArray(declaration[key]) || !declaration[key].length || declaration[key].some((value) => typeof value !== "string" || !value.trim()) || new Set(declaration[key]).size !== declaration[key].length)) localErrors.push(`${key} must be a non-empty list of unique strings`);
      }
      if (Array.isArray(declaration.modes) && declaration.modes.some((mode) => !modes.has(mode))) localErrors.push("modes must be local, server, or demo");
      if (declaration.status === "waived" && !declaration.waiver) localErrors.push("waived support requires a waiver");
      if (declaration.status !== "waived" && declaration.waiver !== undefined) localErrors.push("waiver is only valid for waived support");
      if (localErrors.length) errors.push(...localErrors.map((error) => `${location}: ${error}`));
      else registrations.push({ ...declaration, file, line: index + 1 });
    } catch (error) {
      errors.push(`${location}: invalid @tcger-feature declaration: ${error.message}`);
    }
  });
  return { registrations, errors };
}

export function collectSourceRegistrations(root) {
  const registrations = [];
  const errors = [];
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) walk(file);
      else if (entry.isFile() && /\.(ts|tsx|swift|kt)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
        const parsed = parseSourceRegistrations(fs.readFileSync(file, "utf8"), path.relative(root, file).split(path.sep).join("/"));
        registrations.push(...parsed.registrations);
        errors.push(...parsed.errors);
      }
    }
  }
  sourceRoots.forEach((directory) => walk(path.join(root, directory)));
  return { registrations, errors };
}

export function compileSourceContract(definitions, registrations) {
  const errors = [];
  if (!Array.isArray(definitions?.features) || !Array.isArray(definitions?.platforms)) return { manifest: null, errors: ["Product definitions require features and platforms arrays"] };
  const features = new Map((definitions.features ?? []).map((feature) => [feature.id, feature]));
  const byFeature = new Map();
  for (const registration of registrations) {
    const feature = features.get(registration.id);
    const location = `${registration.file}:${registration.line}`;
    if (!feature) { errors.push(`${location}: unregistered feature ${registration.id}; add its product definition`); continue; }
    if (!definitions.platforms.includes(registration.platform)) { errors.push(`${location}: undeclared platform ${registration.platform}`); continue; }
    if (platformRoots[registration.platform] && !platformRoots[registration.platform].some((root) => registration.file.startsWith(root))) errors.push(`${location}: ${registration.platform} support must be registered in its own application source`);
    const key = `${registration.platform}:${registration.id}`;
    if (byFeature.has(key)) errors.push(`${location}: duplicate registration ${key} (also ${byFeature.get(key).file}:${byFeature.get(key).line})`);
    else byFeature.set(key, registration);
  }
  const manifest = structuredClone(definitions);
  manifest.$schema = "./features.schema.json";
  for (const feature of manifest.features ?? []) {
    for (const platform of manifest.platforms ?? []) {
      const state = feature[platform];
      if (!state || typeof state !== "object") { errors.push(`${feature.id}: ${platform} definition is required`); continue; }
      if (state.status !== undefined || state.limitation !== undefined || state.modes !== undefined || state.requires !== undefined || state.waiver !== undefined || state.implementation !== undefined) errors.push(`${feature.id}: ${platform} support metadata belongs in source, not product definitions`);
      const registration = byFeature.get(`${platform}:${feature.id}`);
      if (!registration) { errors.push(`${feature.id}: missing ${platform} source registration`); continue; }
      if (state.registration !== registration.file) errors.push(`${feature.id}: ${platform} registration expected in ${state.registration}, found in ${registration.file}`);
      if (!state.sources?.includes(registration.file)) errors.push(`${feature.id}: ${platform} registration must be included in sources`);
      delete state.registration;
      state.status = registration.status;
      state.implementation = { path: registration.file, line: registration.line };
      for (const key of ["limitation", "modes", "requires", "waiver"]) if (registration[key] !== undefined) state[key] = registration[key];
    }
  }
  return { manifest, errors };
}
