/**
 * Build artwork fingerprint database from card images.
 *
 * Two modes:
 *   Local:    CARD_SCAN_DATA_DIR=/tmp/tcger-server-pokemon npm run build:artwork -- --tcg pokemon
 *   API:      CARD_SCAN_DATA_DIR=/var/lib/tcger-card-scan POKEMON_API_BASE_URL=http://tcger-tcgdex:4040 \
 *             npm run build:artwork -- --tcg pokemon --from-api
 *
 * Local mode reads images from {dataDir}/images/{setCode}/*.png
 * API mode fetches card list + images from the TCGdex/Scryfall/YGO API
 * Both output artwork-fingerprints.json to {dataDir}/
 */

import { readdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  computeArtworkFingerprint,
  computeHsvHistogram,
  fingerprintToBase64,
  type ArtworkBuildEntry,
  buildArtworkDatabase,
} from '../modules/card-scan/artwork-matcher';

// ---------- API card fetching (mirrors hash-builder.service.ts patterns) ----------

interface ApiCard {
  externalId: string;
  name: string;
  setCode: string | null;
  imageUrl: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPokemonCardsFromApi(apiBaseUrl: string): Promise<ApiCard[]> {
  const cards: ApiCard[] = [];
  let page = 1;
  const pageSize = 250;
  let hasMore = true;

  console.error(`[build-artwork] fetching Pokemon cards from ${apiBaseUrl}...`);

  while (hasMore) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const url = `${apiBaseUrl}/cards?${params}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[build-artwork] API error at page ${page}: ${response.status}`);
      break;
    }

    const data = (await response.json()) as {
      data: Array<{ id: string; name: string; image?: string }>;
      totalCount: number;
    };

    for (const card of data.data) {
      const imageUrl = card.image ? `${card.image}/high.webp` : null;
      if (!imageUrl) continue;

      cards.push({
        externalId: card.id,
        name: card.name,
        setCode: card.id.split('-')[0] ?? null,
        imageUrl,
      });
    }

    hasMore = page * pageSize < data.totalCount;
    page++;
    console.error(`[build-artwork] fetched ${cards.length}/${data.totalCount} cards...`);
  }

  return cards;
}

async function fetchPokemonTcgApiCards(apiBaseUrl: string): Promise<ApiCard[]> {
  const cards: ApiCard[] = [];
  let page = 1;
  const pageSize = 250;
  let hasMore = true;

  console.error(`[build-artwork] fetching Pokemon cards from pokemon-tcg-api at ${apiBaseUrl}...`);

  while (hasMore) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const url = `${apiBaseUrl}/cards?${params}`;

    const response = await fetch(url);
    if (!response.ok) break;

    const data = (await response.json()) as {
      data: Array<{
        id: string;
        name: string;
        set: { id: string };
        images: { large?: string; small?: string };
      }>;
      totalCount: number;
    };

    for (const card of data.data) {
      const imageUrl = card.images.large ?? card.images.small;
      if (!imageUrl) continue;
      cards.push({
        externalId: card.id,
        name: card.name,
        setCode: card.set?.id ?? null,
        imageUrl,
      });
    }

    hasMore = page * pageSize < data.totalCount;
    page++;
    console.error(`[build-artwork] fetched ${cards.length}/${data.totalCount} cards...`);
  }

  return cards;
}

async function buildFromApi(tcg: string, dataDir: string, gridSize = 8): Promise<void> {
  const apiBaseUrl =
    tcg === 'pokemon'
      ? process.env.POKEMON_API_BASE_URL ?? process.env.TCGDEX_API_BASE_URL
      : null;

  if (!apiBaseUrl) {
    throw new Error(`No API base URL configured for ${tcg}. Set POKEMON_API_BASE_URL`);
  }

  // Detect whether this is TCGdex or pokemon-tcg-api
  const isTcgdex = apiBaseUrl.includes('tcgdex') || apiBaseUrl.includes('4040');
  const cards = isTcgdex
    ? await fetchPokemonCardsFromApi(apiBaseUrl)
    : await fetchPokemonTcgApiCards(apiBaseUrl);

  console.error(`[build-artwork] ${cards.length} cards to process`);

  // Also load hashes.json for name enrichment if available
  const nameMap = new Map<string, string>();
  try {
    const hashesPath = path.join(dataDir, 'hashes.json');
    const hashesRaw = await readFile(hashesPath, 'utf-8');
    const hashesData = JSON.parse(hashesRaw);
    for (const entry of hashesData.entries ?? []) {
      nameMap.set(entry.externalId, entry.name);
    }
    console.error(`[build-artwork] enriched with ${nameMap.size} names from hashes.json`);
  } catch { /* no hashes.json, use API names */ }

  // Process in batches: download image → compute fingerprint → accumulate
  const entries: Array<{
    externalId: string;
    name: string;
    setCode: string | null;
    fingerprint: string;
  }> = [];

  let processed = 0;
  let errors = 0;

  for (const card of cards) {
    try {
      await sleep(50); // rate limit
      const response = await fetch(card.imageUrl);
      if (!response.ok) { errors++; continue; }

      const imageBuffer = Buffer.from(await response.arrayBuffer());
      // Compute HSV on artwork region only (same crop as fingerprint) for consistency
      const imgMeta = await (await import('sharp')).default(imageBuffer).metadata();
      const iw = imgMeta.width ?? 0, ih = imgMeta.height ?? 0;
      const artCropBuf = iw > 0 && ih > 0
        ? await (await import('sharp')).default(imageBuffer)
            .extract({ left: Math.round(iw * 0.05), top: Math.round(ih * 0.08), width: Math.round(iw * 0.90), height: Math.round(ih * 0.47) })
            .toBuffer()
        : imageBuffer;
      const [fp, hsv] = await Promise.all([
        computeArtworkFingerprint(imageBuffer, tcg, gridSize),
        computeHsvHistogram(artCropBuf),
      ]);

      entries.push({
        externalId: card.externalId,
        name: nameMap.get(card.externalId) ?? card.name,
        setCode: card.setCode,
        fingerprint: fingerprintToBase64(fp),
        hsvHist: fingerprintToBase64(hsv),
      });

      processed++;
      if (processed % 500 === 0) {
        console.error(`[build-artwork] processed ${processed}/${cards.length} (${errors} errors)`);
      }
    } catch {
      errors++;
    }
  }

  const output = {
    version: 1,
    tcg,
    gridSize,
    dimensions: gridSize * gridSize * 3,
    total: entries.length,
    entries,
  };

  const suffix = gridSize === 8 ? '' : `-${gridSize}x${gridSize}`;
  const outputPath = path.join(dataDir, `artwork-fingerprints${suffix}.json`);
  await writeFile(outputPath, JSON.stringify(output));
  console.error(`[build-artwork] done: ${entries.length} fingerprints (${gridSize}x${gridSize}) → ${outputPath} (${errors} errors)`);
}

// ---------- Local file mode ----------

async function buildFromLocalFiles(tcg: string, dataDir: string, gridSize = 8): Promise<void> {
  const imagesDir = path.join(dataDir, 'images');
  console.error(`[build-artwork] scanning ${imagesDir} for ${tcg} card images...`);

  const entries: ArtworkBuildEntry[] = [];
  const setDirs = readdirSync(imagesDir).filter((d) => {
    try { return statSync(path.join(imagesDir, d)).isDirectory(); } catch { return false; }
  });

  for (const setCode of setDirs) {
    const setDir = path.join(imagesDir, setCode);
    const files = readdirSync(setDir).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
    for (const file of files) {
      const externalId = `${setCode}-${path.parse(file).name}`;
      entries.push({ externalId, name: externalId, setCode, imagePath: path.join(setDir, file) });
    }
  }

  // Enrich names
  try {
    const hashesPath = path.join(dataDir, 'hashes.json');
    const hashesRaw = await readFile(hashesPath, 'utf-8');
    const hashesData = JSON.parse(hashesRaw);
    const nameMap = new Map<string, string>();
    for (const entry of hashesData.entries ?? []) nameMap.set(entry.externalId, entry.name);
    for (const entry of entries) {
      const name = nameMap.get(entry.externalId);
      if (name) entry.name = name;
    }
  } catch { /* no hashes.json */ }

  console.error(`[build-artwork] found ${entries.length} card images across ${setDirs.length} sets`);
  const count = await buildArtworkDatabase(entries, tcg, dataDir, gridSize);
  console.error(`[build-artwork] done — ${count} fingerprints built`);
}

// ---------- main ----------

async function main(): Promise<void> {
  const dataDir = process.env.CARD_SCAN_DATA_DIR;
  if (!dataDir) throw new Error('CARD_SCAN_DATA_DIR is required');

  const args = process.argv.slice(2);
  let tcg = 'pokemon';
  let fromApi = false;

  let gridSize = 8;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tcg' && args[i + 1]) tcg = args[i + 1]!;
    if (args[i] === '--from-api') fromApi = true;
    if (args[i] === '--grid-size' && args[i + 1]) gridSize = Number.parseInt(args[i + 1]!, 10);
  }

  console.error(`[build-artwork] grid size: ${gridSize}x${gridSize} (${gridSize * gridSize * 3} dimensions)`);

  if (fromApi) {
    await buildFromApi(tcg, dataDir, gridSize);
  } else {
    await buildFromLocalFiles(tcg, dataDir, gridSize);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
