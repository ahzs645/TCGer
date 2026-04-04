/**
 * Hash Database Builder
 *
 * Downloads card images from external APIs (Scryfall, YGO, Pokemon TCG),
 * computes RGB pHashes, and stores them in the card_hashes table.
 *
 * This is the missing piece from the Moss Machine project — they read
 * from pre-built phash_cards_{gid}.db files but never published the
 * builder. This module fills that gap for TCGer.
 *
 * Both iOS and web clients can consume the same hash database:
 *   - Web: server-side matching via POST /cards/scan
 *   - iOS: download hashes via GET /cards/hashes, match client-side
 */

import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  computeCardFeatureHashes,
  flattenCardFeatureHashes,
  hasCompleteCardFeatureHashes,
} from './feature-hashes';
import { CardHashLibraryWriter } from './hash-library';
import { computeRGBHash } from './phash';
import { preprocessCardImage } from './preprocess';
import {
  countCardHashes,
  getAllCardHashes,
  getCardHashStoreMode,
  type CardHashRecord,
  upsertCardHashes,
} from './hash-store';

// ---------- types ----------

interface HashBuildProgress {
  tcg: string;
  total: number;
  processed: number;
  errors: number;
  skipped: number;
  storeMode: string;
}

interface CardImageEntry {
  externalId: string;
  name: string;
  setCode: string | null;
  setName: string | null;
  rarity: string | null;
  imageUrl: string;
}

interface HashBuildOptions {
  limit?: number;
  setCode?: string;
  force?: boolean;
  concurrency?: number;
  upsertBatchSize?: number;
  libraryDir?: string;
}

type HashBuildResult =
  | { status: 'processed'; record: CardHashRecord; imageBuffer: Buffer; contentType: string | null }
  | { status: 'error' };

const DEFAULT_HASH_BUILD_CONCURRENCY = parsePositiveInteger(
  process.env.CARD_HASH_BUILD_CONCURRENCY,
  6
);
const DEFAULT_HASH_UPSERT_BATCH_SIZE = parsePositiveInteger(
  process.env.CARD_HASH_BUILD_UPSERT_BATCH_SIZE,
  250
);

// ---------- rate limiting ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isLocalUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.svc') ||
      hostname.endsWith('.svc.cluster.local') ||
      /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
      /^192\.168\.\d+\.\d+$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(hostname)
    );
  } catch {
    return false;
  }
}

// ---------- public API ----------

/**
 * Build (or rebuild) the hash database for a given TCG.
 * Fetches card lists from external APIs, downloads images, computes hashes.
 */
export async function buildHashDatabase(
  tcg: 'magic' | 'pokemon' | 'yugioh',
  options: HashBuildOptions = {}
): Promise<HashBuildProgress> {
  const progress: HashBuildProgress = {
    tcg,
    total: 0,
    processed: 0,
    errors: 0,
    skipped: 0,
    storeMode: getCardHashStoreMode(),
  };

  logger.info({ tcg, options }, 'Starting hash database build');

  let cards: CardImageEntry[];

  switch (tcg) {
    case 'magic':
      cards = await fetchMagicCards(options.setCode, options.limit);
      break;
    case 'pokemon':
      cards = await fetchPokemonCards(options.setCode, options.limit);
      break;
    case 'yugioh':
      cards = await fetchYugiohCards(options.limit);
      break;
    default:
      throw new Error(`Unsupported TCG: ${tcg}`);
  }

  progress.total = cards.length;
  logger.info({ tcg, total: cards.length }, 'Fetched card list');

  const existingRecords = options.force
    ? new Map<string, CardHashRecord>()
    : new Map(
        (await getAllCardHashes({ tcg })).map((record) => [record.externalId, record])
      );
  const pendingUpserts: CardHashRecord[] = [];
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_HASH_BUILD_CONCURRENCY);
  const upsertBatchSize = Math.max(1, options.upsertBatchSize ?? DEFAULT_HASH_UPSERT_BATCH_SIZE);
  const libraryWriter = options.libraryDir
    ? new CardHashLibraryWriter(options.libraryDir, tcg, Boolean(options.force))
    : null;

  if (libraryWriter) {
    await libraryWriter.init();
  }

  for (let index = 0; index < cards.length; index += concurrency) {
    const chunk = cards.slice(index, index + concurrency);
    const pendingCards: CardImageEntry[] = [];

    for (const card of chunk) {
      const existingRecord = existingRecords.get(card.externalId);
      if (existingRecord && hasCompleteCardFeatureHashes(existingRecord)) {
        progress.skipped++;
        continue;
      }
      pendingCards.push(card);
    }

    const results = await Promise.all(
      pendingCards.map((card) => buildHashRecord(tcg, card))
    );

    for (const result of results) {
      if (result.status === 'error') {
        progress.errors++;
        continue;
      }

      pendingUpserts.push(result.record);
      existingRecords.set(result.record.externalId, result.record);
      if (libraryWriter) {
        await libraryWriter.writeRecord(result.record, result.imageBuffer, result.contentType);
      }

      progress.processed++;

      if (progress.processed % 50 === 0) {
        logger.info(
          { tcg, processed: progress.processed, total: progress.total },
          'Hash build progress'
        );
      }

      if (pendingUpserts.length >= upsertBatchSize) {
        await upsertCardHashes(pendingUpserts.splice(0, pendingUpserts.length));
      }
    }
  }

  if (pendingUpserts.length) {
    await upsertCardHashes(pendingUpserts);
  }

  if (libraryWriter) {
    const library = await libraryWriter.persist();
    logger.info({ tcg, library }, 'Card hash library updated');
  }

  logger.info(progress, 'Hash database build complete');
  return progress;
}

async function buildHashRecord(
  tcg: 'magic' | 'pokemon' | 'yugioh',
  card: CardImageEntry
): Promise<HashBuildResult> {
  try {
    // External image hosts need throttling; in-cluster cache services do not.
    const delayMs = isLocalUrl(card.imageUrl) ? 0 : tcg === 'magic' ? 100 : 200;
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    const imageResponse = await fetch(card.imageUrl);
    if (!imageResponse.ok) {
      logger.warn({ card: card.name, status: imageResponse.status }, 'Failed to download image');
      return { status: 'error' };
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const processedImage = await preprocessCardImage(imageBuffer);
    const hash = await computeRGBHash(processedImage);
    const featureHashes = await computeCardFeatureHashes(tcg, processedImage);

    return {
      status: 'processed',
      imageBuffer,
      contentType: imageResponse.headers.get('content-type'),
      record: {
        tcg,
        externalId: card.externalId,
        name: card.name,
        setCode: card.setCode,
        setName: card.setName,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        rHash: hash.r,
        gHash: hash.g,
        bHash: hash.b,
        ...flattenCardFeatureHashes(featureHashes),
        hashSize: 16,
      },
    };
  } catch (err) {
    logger.error({ card: card.name, err }, 'Error processing card');
    return { status: 'error' };
  }
}

/**
 * Get current hash database stats.
 */
export async function getHashDatabaseStats() {
  const [magic, pokemon, yugioh, total] = await Promise.all([
    countCardHashes({ tcg: 'magic' }),
    countCardHashes({ tcg: 'pokemon' }),
    countCardHashes({ tcg: 'yugioh' }),
    countCardHashes(),
  ]);

  return { magic, pokemon, yugioh, total, storeMode: getCardHashStoreMode() };
}

// ---------- TCG-specific card fetchers ----------

/**
 * Fetch Magic cards from Scryfall.
 * Uses the /cards/search endpoint or bulk data for full builds.
 */
async function fetchMagicCards(
  setCode?: string,
  limit?: number
): Promise<CardImageEntry[]> {
  const apiRoot = env.SCRYFALL_API_BASE_URL.replace(/\/+$/, '');
  const requestDelayMs = isLocalUrl(apiRoot) ? 0 : 100;
  const cards: CardImageEntry[] = [];

  // Build search query
  const query = setCode ? `set:${setCode}` : 'game:paper';
  let url: string | null = `${apiRoot}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=set`;

  while (url && (!limit || cards.length < limit)) {
    if (requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }

    const response = await fetch(url);
    if (!response.ok) break;

    const data = await response.json() as {
      data: Array<{
        id: string;
        name: string;
        set: string;
        set_name: string;
        rarity: string;
        image_uris?: { normal?: string; small?: string };
        card_faces?: Array<{ image_uris?: { normal?: string } }>;
      }>;
      has_more?: boolean;
      next_page?: string;
    };

    for (const card of data.data) {
      // Get image URL (handle double-faced cards)
      const imageUrl =
        card.image_uris?.normal ??
        card.card_faces?.[0]?.image_uris?.normal;

      if (!imageUrl) continue;

      cards.push({
        externalId: card.id,
        name: card.name,
        setCode: card.set,
        setName: card.set_name,
        rarity: card.rarity,
        imageUrl,
      });

      if (limit && cards.length >= limit) break;
    }

    url = data.has_more ? (data.next_page ?? null) : null;
  }

  return cards;
}

/**
 * Fetch Pokemon cards from Pokemon TCG API.
 */
async function fetchPokemonCards(
  setCode?: string,
  limit?: number
): Promise<CardImageEntry[]> {
  const apiRoot = env.POKEMON_API_BASE_URL.replace(/\/+$/, '');
  const requestDelayMs = isLocalUrl(apiRoot) ? 0 : 200;
  const isTcgdex = /tcgdex/i.test(apiRoot);
  const cards: CardImageEntry[] = [];
  const query = !isTcgdex && setCode ? `set.id:${setCode}` : '';
  const pageSize = 250;
  let page = 1;
  let hasMore = true;

  const headers: Record<string, string> = {};
  if (env.SCRYDEX_API_KEY) {
    headers['X-Api-Key'] = env.SCRYDEX_API_KEY;
  }
  if (env.SCRYDEX_TEAM_ID) {
    headers['X-Team-ID'] = env.SCRYDEX_TEAM_ID;
  }

  while (hasMore && (!limit || cards.length < limit)) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (query) {
      params.set('q', query);
    }
    if (requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }

    const response = await fetch(`${apiRoot}/cards?${params}`, { headers });
    if (!response.ok) break;

    if (isTcgdex) {
      const data = (await response.json()) as {
        data: Array<{
          id: string;
          localId?: string;
          name: string;
          image?: string;
        }>;
        totalCount: number;
      };

      for (const card of data.data) {
        const matchesSet = !setCode || card.id.toLowerCase().startsWith(`${setCode.toLowerCase()}-`);
        const imageUrl = card.image ? `${card.image}/high.webp` : null;
        if (!matchesSet || !imageUrl) continue;

        cards.push({
          externalId: card.id,
          name: card.name,
          setCode: card.id.split('-')[0] ?? null,
          setName: null,
          rarity: null,
          imageUrl,
        });

        if (limit && cards.length >= limit) break;
      }

      hasMore = page * pageSize < data.totalCount;
    } else {
      const data = (await response.json()) as {
        data: Array<{
          id: string;
          name: string;
          set: { id: string; name: string };
          rarity?: string;
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
          setCode: card.set.id,
          setName: card.set.name,
          rarity: card.rarity ?? null,
          imageUrl,
        });

        if (limit && cards.length >= limit) break;
      }

      hasMore = cards.length < data.totalCount;
    }

    page++;
  }

  return cards;
}

/**
 * Fetch Yu-Gi-Oh! cards from YGOPRODeck.
 */
async function fetchYugiohCards(limit?: number): Promise<CardImageEntry[]> {
  const apiRoot = env.YGO_API_BASE_URL.replace(/\/+$/, '');
  const requestDelayMs = isLocalUrl(apiRoot) ? 0 : 200;
  const cards: CardImageEntry[] = [];
  const pageSize = 200;
  let offset = 0;

  while (!limit || cards.length < limit) {
    if (requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }

    const response = await fetch(`${apiRoot}/cardinfo.php?num=${pageSize}&offset=${offset}`);
    if (!response.ok) break;

    const data = (await response.json()) as {
      data: Array<{
        id: number;
        name: string;
        card_images: Array<{ id: number; image_url: string; image_url_small: string }>;
        card_sets?: Array<{ set_name: string; set_code: string; set_rarity: string }>;
      }>;
      meta?: {
        next_page_offset?: number;
      };
    };

    if (!Array.isArray(data.data) || !data.data.length) {
      break;
    }

    for (const card of data.data) {
      const imageUrl = card.card_images?.[0]?.image_url;
      if (!imageUrl) continue;

      const firstSet = card.card_sets?.[0];

      cards.push({
        externalId: String(card.id),
        name: card.name,
        setCode: firstSet?.set_code ?? null,
        setName: firstSet?.set_name ?? null,
        rarity: firstSet?.set_rarity ?? null,
        imageUrl,
      });

      if (limit && cards.length >= limit) break;
    }

    if (limit && cards.length >= limit) {
      break;
    }

    const nextOffset = data.meta?.next_page_offset;
    if (typeof nextOffset !== 'number' || nextOffset <= offset) {
      break;
    }
    offset = nextOffset;
  }

  return cards;
}
