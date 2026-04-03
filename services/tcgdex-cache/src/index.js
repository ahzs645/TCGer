import http from 'node:http';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const TCGDEX_API_BASE = 'https://api.tcgdex.net/v2/en';
const DEFAULT_REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 250;

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const normalized = `${value}`.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

const config = {
  dataDir: (process.env.TCGDEX_CACHE_DATA_DIR || '/data').trim(),
  port: Number.parseInt(process.env.PORT || '4040', 10),
  host: process.env.HOST || '0.0.0.0',
  refreshMs: Math.max(5 * 60 * 1000, Number.parseInt(process.env.TCGDEX_CACHE_REFRESH_MS || `${DEFAULT_REFRESH_MS}`, 10)),
  defaultPageSize: Math.max(1, Number.parseInt(process.env.TCGDEX_CACHE_PAGE_SIZE || `${DEFAULT_PAGE_SIZE}`, 10))
};

const imageCacheConfig = {
  enabled: parseBoolean(process.env.TCGDEX_CACHE_IMAGES ?? 'true', true),
  directory: (process.env.TCGDEX_CACHE_IMAGE_DIR || path.join(config.dataDir, 'images')).trim(),
  variants: (process.env.TCGDEX_CACHE_IMAGE_VARIANTS || 'high.webp,low.webp').split(',').map((value) => value.trim()).filter(Boolean),
  maxDownloadsPerRefresh: Number.parseInt(process.env.TCGDEX_CACHE_IMAGE_MAX_PER_REFRESH || '250', 10),
  concurrency: Math.max(1, Number.parseInt(process.env.TCGDEX_CACHE_IMAGE_CONCURRENCY || '4', 10))
};

let cards = [];
let cardById = new Map();
let metadata = null;
let refreshPromise = null;
let imageBaseById = new Map();

function normalizeForSearch(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function contentTypeForExtension(extension) {
  switch (extension.toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.webp':
    default:
      return 'image/webp';
  }
}

function toLocalImageBase(origin, cardId) {
  return `${origin}/images/${encodeURIComponent(cardId)}`;
}

function decorateCardSummary(card, origin) {
  if (!card?.image) {
    return card;
  }
  return {
    ...card,
    image: toLocalImageBase(origin, card.id)
  };
}

function decorateCardDetail(card, origin) {
  if (!card?.image) {
    return card;
  }
  return {
    ...card,
    image: toLocalImageBase(origin, card.id)
  };
}

function levenshteinDistance(left, right) {
  if (left === right) {
    return 0;
  }

  if (!left.length) {
    return right.length;
  }

  if (!right.length) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let row = 0; row < left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row + 1;

    for (let column = 0; column < right.length; column += 1) {
      const current = previous[column + 1];
      if (left[row] === right[column]) {
        previous[column + 1] = diagonal;
      } else {
        previous[column + 1] = Math.min(
          previous[column] + 1,
          previous[column + 1] + 1,
          diagonal + 1
        );
      }
      diagonal = current;
    }
  }

  return previous[right.length];
}

function fuzzyMatchCards(searchTerm) {
  const maxDistance = Math.max(1, Math.floor(searchTerm.length / 4));

  return cards
    .map((card) => {
      const name = normalizeForSearch(card?.name);
      const id = normalizeForSearch(card?.id);
      const candidates = [name, id].filter(Boolean);
      let bestScore = Number.POSITIVE_INFINITY;

      for (const candidate of candidates) {
        if (Math.abs(candidate.length - searchTerm.length) > maxDistance + 2) {
          continue;
        }

        if (candidate[0] !== searchTerm[0]) {
          continue;
        }

        bestScore = Math.min(bestScore, levenshteinDistance(searchTerm, candidate));
      }

      return {
        card,
        score: bestScore
      };
    })
    .filter(({ score }) => Number.isFinite(score) && score <= maxDistance)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      return String(left.card?.name || '').localeCompare(String(right.card?.name || ''));
    })
    .map(({ card }) => card);
}

function sleep(duration) {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

async function ensureDirectory(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function cleanupCacheFiles(keepPath) {
  const files = await readdir(config.dataDir);
  await Promise.all(
    files
      .filter((file) => file.startsWith('tcgdex-cards-') && file.endsWith('.json') && path.join(config.dataDir, file) !== keepPath)
      .map((file) => rm(path.join(config.dataDir, file), { force: true }))
  );
}

async function fetchAllCards() {
  console.log('Fetching card list from TCGdex...');
  const response = await fetch(`${TCGDEX_API_BASE}/cards`);
  if (!response.ok) {
    throw new Error(`Failed to fetch TCGdex card list: ${response.status}`);
  }
  const cardList = await response.json();
  console.log(`Fetched ${cardList.length} cards from TCGdex`);
  return cardList;
}

async function downloadAndCache() {
  const cardList = await fetchAllCards();
  await ensureDirectory(config.dataDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetPath = path.join(config.dataDir, `tcgdex-cards-${timestamp}.json`);
  const tempPath = `${targetPath}.tmp`;

  const cacheData = {
    downloadedAt: new Date().toISOString(),
    totalCards: cardList.length,
    cards: cardList
  };

  await writeFile(tempPath, JSON.stringify(cacheData, null, 2), 'utf8');
  await rename(tempPath, targetPath);
  await cleanupCacheFiles(targetPath);

  return { cards: cardList, filePath: targetPath };
}

function indexCards(cardList) {
  cardById = new Map();
  imageBaseById = new Map();
  for (const card of cardList) {
    if (card?.id) {
      cardById.set(card.id.toLowerCase(), card);
      if (card.image) {
        imageBaseById.set(card.id.toLowerCase(), card.image);
      }
    }
  }
}

async function loadCards(cardList, filePath) {
  cards = cardList;
  indexCards(cards);
  metadata = {
    filePath,
    totalCards: cards.length,
    loadedAt: new Date().toISOString()
  };
}

async function loadLatestFromDisk() {
  try {
    await ensureDirectory(config.dataDir);
    const files = await readdir(config.dataDir);
    const jsonFiles = files.filter((file) => file.startsWith('tcgdex-cards-') && file.endsWith('.json'));
    if (!jsonFiles.length) {
      return false;
    }

    let latestPath = null;
    let latestTime = 0;
    await Promise.all(
      jsonFiles.map(async (file) => {
        const filePath = path.join(config.dataDir, file);
        const stats = await stat(filePath);
        if (stats.mtimeMs > latestTime) {
          latestTime = stats.mtimeMs;
          latestPath = filePath;
        }
      })
    );

    if (!latestPath) {
      return false;
    }

    const rawText = await readFile(latestPath, 'utf8');
    const parsed = JSON.parse(rawText);
    if (!Array.isArray(parsed?.cards)) {
      return false;
    }

    cards = parsed.cards;
    indexCards(cards);
    metadata = {
      filePath: latestPath,
      totalCards: cards.length,
      loadedAt: new Date().toISOString(),
      downloadedAt: parsed.downloadedAt,
      restoredFromDisk: true
    };

    console.log(`Restored ${cards.length} TCGdex cards from disk: ${latestPath}`);
    return true;
  } catch (error) {
    console.error('Failed to restore TCGdex dataset from disk', error);
    return false;
  }
}

async function refreshData(force = false) {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const now = Date.now();
    const lastLoaded = metadata?.loadedAt ? Date.parse(metadata.loadedAt) : 0;
    const elapsed = now - lastLoaded;

    if (!force && cards.length && elapsed < config.refreshMs) {
      return metadata;
    }

    try {
      console.log('Refreshing TCGdex card cache...');
      const { cards: freshCards, filePath } = await downloadAndCache();
      await loadCards(freshCards, filePath);
      await cacheCardImages(cards);
      console.log(`TCGdex cache refreshed: ${cards.length} cards`);
      return metadata;
    } catch (error) {
      console.error('Failed to refresh TCGdex cache', error);
      if (!cards.length) {
        throw error;
      }
      return metadata;
    }
  })()
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildImageJobs(cardList) {
  const jobs = [];
  for (const card of cardList) {
    if (!card?.id || !card?.image) {
      continue;
    }
    const safeId = encodeURIComponent(card.id.toLowerCase());
    for (const variant of imageCacheConfig.variants) {
      jobs.push({
        cardId: card.id.toLowerCase(),
        url: `${card.image}/${variant}`,
        variant,
        filePath: path.join(imageCacheConfig.directory, safeId, variant)
      });
    }
  }
  return jobs;
}

async function downloadImage(job) {
  const response = await fetch(job.url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with status ${response.status}`);
  }
  await ensureDirectory(path.dirname(job.filePath));
  const tempPath = `${job.filePath}.tmp`;
  const writer = createWriteStream(tempPath);
  await pipeline(response.body, writer);
  await rename(tempPath, job.filePath);
}

async function cacheCardImages(cardList) {
  if (!imageCacheConfig.enabled || !cardList?.length) {
    return;
  }

  await ensureDirectory(imageCacheConfig.directory);
  const queue = [];

  outer: for (const job of buildImageJobs(cardList)) {
    if (await fileExists(job.filePath)) {
      continue;
    }
    queue.push(job);
    if (imageCacheConfig.maxDownloadsPerRefresh > 0 && queue.length >= imageCacheConfig.maxDownloadsPerRefresh) {
      break outer;
    }
  }

  if (!queue.length) {
    return;
  }

  console.log(`Caching ${queue.length} TCGdex images (target dir: ${imageCacheConfig.directory})`);
  const workers = Math.min(imageCacheConfig.concurrency, queue.length);
  let index = 0;
  const errors = [];

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const currentIndex = index;
        index += 1;
        if (currentIndex >= queue.length) {
          break;
        }
        const job = queue[currentIndex];
        try {
          await downloadImage(job);
        } catch (error) {
          errors.push({ job, error });
        }
      }
    })
  );

  if (errors.length) {
    console.warn(`Failed to cache ${errors.length} TCGdex images`);
    errors.slice(0, 5).forEach(({ job, error }) => {
      console.warn(`  - ${job.cardId}/${job.variant}: ${error.message}`);
    });
  }
}

function searchCardsLocal(query, page, pageSize) {
  const searchTerm = (query || '').toLowerCase();
  const normalizedSearchTerm = normalizeForSearch(query);
  let filtered = cards;

  if (searchTerm) {
    filtered = cards.filter((card) => {
      const name = (card.name || '').toLowerCase();
      const id = (card.id || '').toLowerCase();
      return name.includes(searchTerm) || id.includes(searchTerm);
    });

    if (!filtered.length && normalizedSearchTerm.length >= 4) {
      filtered = fuzzyMatchCards(normalizedSearchTerm);
    }
  }

  const totalCount = filtered.length;
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * pageSize;
  const slice = filtered.slice(offset, offset + pageSize);

  return {
    data: slice,
    page: safePage,
    pageSize,
    count: slice.length,
    totalCount
  };
}

async function fetchCardDetails(id) {
  const response = await fetch(`${TCGDEX_API_BASE}/cards/${id}`);
  if (!response.ok) {
    return null;
  }
  return response.json();
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
}

async function sendImageFile(response, filePath) {
  response.statusCode = 200;
  response.setHeader('Content-Type', contentTypeForExtension(path.extname(filePath)));
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  try {
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      await refreshData();
      sendJson(response, 200, {
        status: 'ok',
        data: metadata
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/cards') {
      await refreshData();
      if (!cards.length) {
        sendJson(response, 503, { error: 'Card cache unavailable' });
        return;
      }

      const query = requestUrl.searchParams.get('q') || '';
      const pageSizeParam = Number.parseInt(requestUrl.searchParams.get('pageSize') || '', 10);
      const pageParam = Number.parseInt(requestUrl.searchParams.get('page') || '', 10);
      const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0 ? Math.min(pageSizeParam, MAX_PAGE_SIZE) : config.defaultPageSize;
      const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

      const result = searchCardsLocal(query, page, pageSize);
      result.data = result.data.map((card) => decorateCardSummary(card, requestUrl.origin));
      sendJson(response, 200, result);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname.startsWith('/cards/')) {
      const id = requestUrl.pathname.replace('/cards/', '').trim().toLowerCase();
      if (!id) {
        sendJson(response, 400, { error: 'Missing card id' });
        return;
      }

      await refreshData();

      // First check local cache
      const cachedCard = cardById.get(id);
      if (cachedCard) {
        // Fetch full details from API
        const fullCard = await fetchCardDetails(id);
        if (fullCard) {
          sendJson(response, 200, { data: decorateCardDetail(fullCard, requestUrl.origin) });
          return;
        }
      }

      sendJson(response, 404, { error: 'Card not found' });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname.startsWith('/images/')) {
      await refreshData();
      const segments = requestUrl.pathname.split('/').filter(Boolean);
      if (segments.length !== 3) {
        sendJson(response, 400, { error: 'Invalid image path' });
        return;
      }

      const [, rawCardId, rawVariant] = segments;
      const cardId = decodeURIComponent(rawCardId).toLowerCase();
      const variant = decodeURIComponent(rawVariant);
      const imageBase = imageBaseById.get(cardId);
      if (!imageBase) {
        sendJson(response, 404, { error: 'Image not found' });
        return;
      }

      const filePath = path.join(imageCacheConfig.directory, encodeURIComponent(cardId), variant);
      if (!(await fileExists(filePath))) {
        await downloadImage({
          cardId,
          variant,
          url: `${imageBase}/${variant}`,
          filePath
        });
      }

      await sendImageFile(response, filePath);
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/admin/refresh') {
      await refreshData(true);
      sendJson(response, 200, { status: 'refreshed', data: metadata });
      return;
    }

    sendJson(response, 404, { error: 'Not Found' });
  } catch (error) {
    console.error('TCGdex cache service error', error);
    sendJson(response, 500, { error: 'Internal Server Error' });
  }
});

async function start() {
  await loadLatestFromDisk();
  // Start server first so it's responsive even if sync fails
  server.listen(config.port, config.host, () => {
    console.log(`TCGdex cache service listening on http://${config.host}:${config.port}`);
  });
  // Then attempt refresh in background
  refreshData(cards.length === 0).catch((error) => {
    console.error('Initial TCGdex cache refresh failed', error);
  });
}

start();
