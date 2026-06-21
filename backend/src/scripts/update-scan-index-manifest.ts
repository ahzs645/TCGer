/**
 * Generate frontend/public/scan-index/manifest.json — a tiny, versioned listing
 * of the published per-TCG embedding indexes. The browser fetches this first
 * (network-first, ~hundreds of bytes), compares each index's version against
 * its IndexedDB-cached copy, and only re-downloads the big index artifact when
 * the version changed. This is what makes index delivery static + versioned +
 * cache-invalidating with no server in the recognition path.
 *
 * Run after building/replacing any {tcg}-embeddings.json:
 *   tsx src/scripts/update-scan-index-manifest.ts
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const SCAN_INDEX_DIR = resolve(
  __dirname,
  "../../../frontend/public/scan-index",
);

const CANONICAL = /^(pokemon|magic|yugioh)-embeddings\.json$/;

interface ManifestEntry {
  tcg: string;
  file: string;
  version: number;
  model: string;
  encoder: string;
  dimension: number;
  total: number;
  bytes: number;
}

function main() {
  const files = readdirSync(SCAN_INDEX_DIR).filter((f) => CANONICAL.test(f));
  const indexes: Record<string, ManifestEntry> = {};

  for (const file of files) {
    const path = join(SCAN_INDEX_DIR, file);
    const raw = readFileSync(path, "utf8");
    const a = JSON.parse(raw);
    const tcg = file.replace(/-embeddings\.json$/, "");
    indexes[tcg] = {
      tcg,
      file,
      version: a.version ?? 1,
      model: a.model,
      encoder: a.encoder ?? (/dinov2/i.test(a.model) ? "dinov2" : "clip"),
      dimension: a.dimension,
      total: a.total ?? a.entries?.length ?? 0,
      bytes: Buffer.byteLength(raw),
    };
  }

  const manifest = {
    schema: 1,
    generatedFromCount: files.length,
    indexes,
  };
  const out = join(SCAN_INDEX_DIR, "manifest.json");
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(
    `[manifest] ${files.length} indexes → ${out}\n` +
      Object.values(indexes)
        .map(
          (e) =>
            `  ${e.tcg}: ${e.encoder} ${e.model} v${e.version} (${e.total} cards, ${(e.bytes / 1e6).toFixed(1)} MB)`,
        )
        .join("\n"),
  );
}

main();
