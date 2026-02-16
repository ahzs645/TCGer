import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(projectRoot, "..");

const sourceSpec = path.join(repoRoot, "docs", "openapi.yaml");
const outputDir = path.join(projectRoot, "public", "api");
const outputSpec = path.join(outputDir, "openapi.yaml");

await mkdir(outputDir, { recursive: true });
await copyFile(sourceSpec, outputSpec);

console.log(`Synced OpenAPI spec: ${sourceSpec} -> ${outputSpec}`);
