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

import { PrismaClient } from '@prisma/client';

import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { computeRGBHash } from './phash';

const prisma = new PrismaClient();

// ---------- types ----------

interface HashBuildProgress {
  tcg: string;
  total: number;
  processed: number;
  errors: number;
  skipped: number;
}

interface CardImageEntry {
  externalId: string;
  name: string;
  setCode: string | null;
  setName: string | null;
  rarity: string | null;
  imageUrl: string;
}

// ---------- rate limiting ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- public API ----------

/**
 * Build (or rebuild) the hash database for a given TCG.
 * Fetches card lists from external APIs, downloads images, computes hashes.
 */
export async function buildHashDatabase(
  tcg: 'magic' | 'pokemon' | 'yugioh',
  options: { limit?: number; setCode?: string; force?: boolean } = {}
): Promise<HashBuildProgress> {
  const progress: HashBuildProgress = {
    tcg,
    total: 0,
    processed: 0,
    errors: 0,
    skipped: 0,
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

  for (const card of cards) {
    try {
      // Check if hash already exists (skip unless force rebuild)
      if (!options.force) {
        const existing = await prisma.cardHash.findUnique({
          where: { tcg_externalId: { tcg, externalId: card.externalId } },
        });
        if (existing) {
          progress.skipped++;
          continue;
        }
      }

      // Download image
      const imageResponse = await fetch(card.imageUrl);
      if (!imageResponse.ok) {
        logger.warn({ card: card.name, status: imageResponse.status }, 'Failed to download image');
        progress.errors++;
        continue;
      }

      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

      // Compute pHash
      const hash = await computeRGBHash(imageBuffer);

      // Upsert into database
      await prisma.cardHash.upsert({
        where: { tcg_externalId: { tcg, externalId: card.externalId } },
        create: {
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
        },
        update: {
          name: card.name,
          setCode: card.setCode,
          setName: card.setName,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          rHash: hash.r,
          gHash: hash.g,
          bHash: hash.b,
        },
      });

      progress.processed++;

      if (progress.processed % 50 === 0) {
        logger.info(
          { tcg, processed: progress.processed, total: progress.total },
          'Hash build progress'
        );
      }

      // Rate limiting — be respectful to APIs
      await sleep(tcg === 'magic' ? 100 : 200);
    } catch (err) {
      logger.error({ card: card.name, err }, 'Error processing card');
      progress.errors++;
    }
  }

  logger.info(progress, 'Hash database build complete');
  return progress;
}

/**
 * Get current hash database stats.
 */
export async function getHashDatabaseStats() {
  const [magic, pokemon, yugioh, total] = await Promise.all([
    prisma.cardHash.count({ where: { tcg: 'magic' } }),
    prisma.cardHash.count({ where: { tcg: 'pokemon' } }),
    prisma.cardHash.count({ where: { tcg: 'yugioh' } }),
    prisma.cardHash.count(),
  ]);

  return { magic, pokemon, yugioh, total };
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
  const cards: CardImageEntry[] = [];

  // Build search query
  const query = setCode ? `set:${setCode}` : 'year>=2020'; // default: recent cards
  let url: string | null = `${apiRoot}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=set`;

  while (url && (!limit || cards.length < limit)) {
    await sleep(100); // Scryfall rate limit: 10 req/sec

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
  const cards: CardImageEntry[] = [];

  const query = setCode ? `set.id:${setCode}` : '';
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
    if (query) params.set('q', query);

    await sleep(200); // rate limit

    const response = await fetch(`${apiRoot}/cards?${params}`, { headers });
    if (!response.ok) break;

    const data = await response.json() as {
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
    page++;
  }

  return cards;
}

/**
 * Fetch Yu-Gi-Oh! cards from YGOPRODeck.
 */
async function fetchYugiohCards(limit?: number): Promise<CardImageEntry[]> {
  const apiRoot = env.YGO_API_BASE_URL.replace(/\/+$/, '');
  const cards: CardImageEntry[] = [];

  await sleep(200);

  const response = await fetch(`${apiRoot}/cardinfo.php?num=500&offset=0`);
  if (!response.ok) return cards;

  const data = await response.json() as {
    data: Array<{
      id: number;
      name: string;
      card_images: Array<{ id: number; image_url: string; image_url_small: string }>;
      card_sets?: Array<{ set_name: string; set_code: string; set_rarity: string }>;
    }>;
  };

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

  return cards;
}
