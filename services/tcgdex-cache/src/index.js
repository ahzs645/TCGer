import http from 'node:http';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TCGDEX_API_BASE = 'https://api.tcgdex.net/v2/en';
const DEFAULT_REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 250;

const config = {
  dataDir: (process.env.TCGDEX_CACHE_DATA_DIR || '/data').trim(),
  port: Number.parseInt(process.env.PORT || '4040', 10),
  host: process.env.HOST || '0.0.0.0',
  refreshMs: Math.max(5 * 60 * 1000, Number.parseInt(process.env.TCGDEX_CACHE_REFRESH_MS || `${DEFAULT_REFRESH_MS}`, 10)),
  defaultPageSize: Math.max(1, Number.parseInt(process.env.TCGDEX_CACHE_PAGE_SIZE || `${DEFAULT_PAGE_SIZE}`, 10))
};

let cards = [];
let cardById = new Map();
let metadata = null;
let refreshPromise = null;

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
  for (const card of cardList) {
    if (card?.id) {
      cardById.set(card.id.toLowerCase(), card);
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

function searchCardsLocal(query, page, pageSize) {
  const searchTerm = (query || '').toLowerCase();
  let filtered = cards;

  if (searchTerm) {
    filtered = cards.filter((card) => {
      const name = (card.name || '').toLowerCase();
      const id = (card.id || '').toLowerCase();
      return name.includes(searchTerm) || id.includes(searchTerm);
    });
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
          sendJson(response, 200, { data: fullCard });
          return;
        }
      }

      sendJson(response, 404, { error: 'Card not found' });
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
