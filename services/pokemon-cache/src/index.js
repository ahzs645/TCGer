import http from 'node:http';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_REFRESH_MS = 12 * 60 * 60 * 1000; // 12 hours
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGE_SIZE = 200;
const DEFAULT_FETCH_PAGE_SIZE = 250;
const DEFAULT_FETCH_DELAY_MS = 200;

const config = {
  sourceBase: (process.env.POKEMON_SOURCE_BASE_URL || 'https://api.pokemontcg.io/v2').replace(/\/+$/, ''),
  dataDir: (process.env.POKEMON_CACHE_DATA_DIR || '/data').trim(),
  port: Number.parseInt(process.env.PORT || '4030', 10),
  host: process.env.HOST || '0.0.0.0',
  refreshMs: Math.max(5 * 60 * 1000, Number.parseInt(process.env.POKEMON_CACHE_REFRESH_MS || `${DEFAULT_REFRESH_MS}`, 10)),
  defaultPageSize: Math.max(1, Number.parseInt(process.env.POKEMON_CACHE_PAGE_SIZE || `${DEFAULT_PAGE_SIZE}`, 10)),
  maxPageSize: Math.max(1, Number.parseInt(process.env.POKEMON_CACHE_MAX_PAGE_SIZE || `${DEFAULT_MAX_PAGE_SIZE}`, 10)),
  fetchPageSize: Math.max(1, Number.parseInt(process.env.POKEMON_CACHE_FETCH_PAGE_SIZE || `${DEFAULT_FETCH_PAGE_SIZE}`, 10)),
  fetchDelayMs: Math.max(0, Number.parseInt(process.env.POKEMON_CACHE_FETCH_DELAY_MS || `${DEFAULT_FETCH_DELAY_MS}`, 10)),
  apiKey: process.env.POKEMON_SOURCE_API_KEY || process.env.POKEMON_TCG_API_KEY || ''
};

if (config.defaultPageSize > config.maxPageSize) {
  config.defaultPageSize = config.maxPageSize;
}

const CARDS_ENDPOINT = `${config.sourceBase.replace(/\/+$/, '')}/cards`;

let cards = [];
let cardById = new Map();
let metadata = null;
let refreshPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDirectory(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function cleanupCacheFiles(keepPath) {
  const files = await readdir(config.dataDir);
  await Promise.all(
    files
      .filter((file) => file.endsWith('.json') && path.join(config.dataDir, file) !== keepPath)
      .map((file) => rm(path.join(config.dataDir, file), { force: true }))
  );
}

function buildHeaders() {
  const headers = { Accept: 'application/json' };
  if (config.apiKey) {
    headers['X-Api-Key'] = config.apiKey;
  }
  return headers;
}

async function fetchPage(page, pageSize) {
  const url = new URL(CARDS_ENDPOINT);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));
  const response = await fetch(url, { headers: buildHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to fetch Pokémon cards page ${page}: ${response.status}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.data)) {
    throw new Error('Unexpected Pokémon cards response shape');
  }
  return {
    data: payload.data,
    count: payload.count ?? payload.data.length,
    totalCount: payload.totalCount ?? payload.total_count ?? null,
    page: payload.page ?? page,
    pageSize: payload.pageSize ?? pageSize
  };
}

async function downloadDataset() {
  const allCards = [];
  let page = 1;
  let totalCount = null;
  while (true) {
    const { data, count, totalCount: remoteTotal } = await fetchPage(page, config.fetchPageSize);
    allCards.push(...data);
    if (typeof remoteTotal === 'number') {
      totalCount = remoteTotal;
    }
    if (count < config.fetchPageSize) {
      break;
    }
    page += 1;
    if (config.fetchDelayMs > 0) {
      await sleep(config.fetchDelayMs);
    }
  }

  await ensureDirectory(config.dataDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetPath = path.join(config.dataDir, `pokemon-cards-${timestamp}.json`);
  const tempPath = `${targetPath}.tmp`;
  const payload = {
    meta: {
      totalCount: totalCount ?? allCards.length,
      fetchedAt: new Date().toISOString()
    },
    data: allCards
  };
  await writeFile(tempPath, JSON.stringify(payload), 'utf8');
  await rename(tempPath, targetPath);
  await cleanupCacheFiles(targetPath);
  return { filePath: targetPath, cards: allCards, totalCount: payload.meta.totalCount, fetchedAt: payload.meta.fetchedAt };
}

function indexCards(cardList) {
  cardById = new Map();
  for (const card of cardList) {
    if (card?.id) {
      cardById.set(card.id, card);
    }
  }
}

async function loadCards(cardList, filePath, fetchedAt, totalCount) {
  cards = cardList;
  indexCards(cards);
  metadata = {
    totalCount: totalCount ?? cards.length,
    filePath,
    loadedAt: new Date().toISOString(),
    fetchedAt
  };
}

async function loadLatestFromDisk() {
  try {
    await ensureDirectory(config.dataDir);
    const files = await readdir(config.dataDir);
    const jsonFiles = files.filter((file) => file.endsWith('.json'));
    if (!jsonFiles.length) {
      return false;
    }
    let latestPath = null;
    let latestMtime = 0;
    await Promise.all(
      jsonFiles.map(async (file) => {
        const filePath = path.join(config.dataDir, file);
        const stats = await stat(filePath);
        if (stats.mtimeMs > latestMtime) {
          latestMtime = stats.mtimeMs;
          latestPath = filePath;
        }
      })
    );
    if (!latestPath) {
      return false;
    }
    const raw = await readFile(latestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.data)) {
      return false;
    }
    await loadCards(parsed.data, latestPath, parsed?.meta?.fetchedAt ?? null, parsed?.meta?.totalCount ?? parsed.data.length);
    metadata.restoredFromDisk = true;
    return true;
  } catch (error) {
    console.error('Failed to restore Pokémon dataset from disk', error);
    return false;
  }
}

async function refreshData(force = false) {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    const lastLoaded = metadata?.loadedAt ? Date.parse(metadata.loadedAt) : null;
    const elapsed = lastLoaded ? Date.now() - lastLoaded : Number.POSITIVE_INFINITY;
    if (!force && cards.length && elapsed < config.refreshMs) {
      return metadata;
    }
    try {
      const { cards: freshCards, filePath, fetchedAt, totalCount } = await downloadDataset();
      await loadCards(freshCards, filePath, fetchedAt, totalCount);
      return metadata;
    } catch (error) {
      console.error('Failed to refresh Pokémon cache', error);
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

function parseQuery(qString) {
  const filters = [];
  const terms = [];
  if (!qString) {
    return { filters, terms };
  }
  const regex = /(\w+):"([^"]+)"|(\w+):([^\s]+)|(\S+)/g;
  let match;
  while ((match = regex.exec(qString))) {
    if (match[1] && match[2]) {
      filters.push({ key: match[1].toLowerCase(), value: match[2].toLowerCase() });
    } else if (match[3] && match[4]) {
      filters.push({ key: match[3].toLowerCase(), value: match[4].toLowerCase() });
    } else if (match[5]) {
      terms.push(match[5].toLowerCase());
    }
  }
  return { filters, terms };
}

function arrayIncludesCaseInsensitive(list, value) {
  if (!Array.isArray(list) || !value) {
    return false;
  }
  const lower = value.toLowerCase();
  return list.some((entry) => typeof entry === 'string' && entry.toLowerCase() === lower);
}

function matchesFilter(card, filter) {
  const value = filter.value;
  switch (filter.key) {
    case 'name':
      return typeof card.name === 'string' && card.name.toLowerCase().includes(value);
    case 'supertype':
      return typeof card.supertype === 'string' && card.supertype.toLowerCase() === value;
    case 'subtype':
    case 'subtypes':
      return arrayIncludesCaseInsensitive(card.subtypes, value);
    case 'type':
    case 'types':
      return arrayIncludesCaseInsensitive(card.types, value);
    case 'set.id':
    case 'setid':
    case 'set':
      return typeof card.set?.id === 'string' && card.set.id.toLowerCase() === value;
    case 'set.name':
      return typeof card.set?.name === 'string' && card.set.name.toLowerCase().includes(value);
    case 'rarity':
      return typeof card.rarity === 'string' && card.rarity.toLowerCase() === value;
    case 'evolvesfrom':
      return typeof card.evolvesFrom === 'string' && card.evolvesFrom.toLowerCase().includes(value);
    case 'hp': {
      const cardHp = Number.parseInt(card.hp ?? '', 10);
      const targetHp = Number.parseInt(value, 10);
      return Number.isFinite(cardHp) && Number.isFinite(targetHp) && cardHp === targetHp;
    }
    default: {
      const cardValue = card[filter.key];
      if (typeof cardValue === 'string') {
        return cardValue.toLowerCase().includes(value);
      }
      if (Array.isArray(cardValue)) {
        return cardValue.some((entry) => typeof entry === 'string' && entry.toLowerCase() === value);
      }
      return false;
    }
  }
}

function matchesTerms(card, terms) {
  if (!terms.length) {
    return true;
  }
  const haystack = [card.name, card.supertype, card.set?.name, card.rarity, card.number]
    .filter((value) => typeof value === 'string')
    .join('\n')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function searchCardsLocal(qString, page, pageSize) {
  const { filters, terms } = parseQuery(qString);
  const filtered = cards.filter((card) => filters.every((filter) => matchesFilter(card, filter)) && matchesTerms(card, terms));
  const totalCount = filtered.length;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;
  const safePage = Math.max(1, Math.min(page, totalPages));
  const offset = (safePage - 1) * pageSize;
  const slice = filtered.slice(offset, offset + pageSize);
  return {
    data: slice,
    totalCount,
    page: safePage,
    pageSize,
    totalPages,
    count: slice.length
  };
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
      sendJson(response, 200, { status: 'ok', data: metadata });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/admin/refresh') {
      await refreshData(true);
      sendJson(response, 200, { status: 'refreshed', data: metadata });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/cards') {
      await refreshData();
      if (!cards.length) {
        sendJson(response, 503, { error: 'Card cache unavailable' });
        return;
      }
      const q = requestUrl.searchParams.get('q') || '';
      const pageSizeParam = Number.parseInt(requestUrl.searchParams.get('pageSize') || '', 10);
      const pageParam = Number.parseInt(requestUrl.searchParams.get('page') || '', 10);
      const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0 ? Math.min(pageSizeParam, config.maxPageSize) : config.defaultPageSize;
      const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
      const result = searchCardsLocal(q, page, pageSize);
      sendJson(response, 200, {
        data: result.data,
        page: result.page,
        pageSize: result.pageSize,
        count: result.count,
        totalCount: result.totalCount,
        totalPages: result.totalPages
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname.startsWith('/cards/')) {
      await refreshData();
      if (!cards.length) {
        sendJson(response, 503, { error: 'Card cache unavailable' });
        return;
      }
      const id = requestUrl.pathname.replace('/cards/', '');
      const card = cardById.get(id);
      if (!card) {
        sendJson(response, 404, { error: 'Card not found' });
        return;
      }
      sendJson(response, 200, { data: card });
      return;
    }

    if (request.method && request.method !== 'GET' && request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method Not Allowed' });
      return;
    }

    sendJson(response, 404, { error: 'Not Found' });
  } catch (error) {
    console.error('Pokémon cache service error', error);
    sendJson(response, 500, { error: 'Internal Server Error' });
  }
});

async function start() {
  await loadLatestFromDisk();
  await refreshData(cards.length === 0).catch((error) => {
    console.error('Initial Pokémon cache refresh failed', error);
  });
  server.listen(config.port, config.host, () => {
    console.log(`Pokémon cache service listening on http://${config.host}:${config.port}`);
  });
}

start();
