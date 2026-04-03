import http from 'node:http';
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { URL } from 'node:url';

const BULK_INDEX_URL = 'https://api.scryfall.com/bulk-data';
const DEFAULT_LIMIT = 50;
const config = {
  bulkType: (process.env.SCRYFALL_BULK_TYPE || 'oracle_cards').trim(),
  dataDir: (process.env.SCRYFALL_BULK_DATA_DIR || '/data').trim(),
  port: Number.parseInt(process.env.PORT || '4010', 10),
  host: process.env.HOST || '0.0.0.0',
  refreshMs: Math.max(5 * 60 * 1000, Number.parseInt(process.env.SCRYFALL_BULK_REFRESH_MS || `${12 * 60 * 60 * 1000}`, 10)),
  resultLimit: Math.max(1, Number.parseInt(process.env.SCRYFALL_BULK_MAX_RESULTS || `${20}`, 10))
};

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

const imageCacheConfig = {
  enabled: parseBoolean(process.env.SCRYFALL_BULK_CACHE_IMAGES ?? 'true', true),
  directory: (process.env.SCRYFALL_BULK_IMAGE_DIR || path.join(config.dataDir, 'images')).trim(),
  preferredField: (process.env.SCRYFALL_BULK_IMAGE_FIELD || 'normal').trim(),
  fallbackFields: (process.env.SCRYFALL_BULK_IMAGE_FALLBACKS || 'large,small,border_crop,art_crop').split(',').map((entry) => entry.trim()).filter(Boolean),
  maxDownloadsPerRefresh: Number.parseInt(process.env.SCRYFALL_BULK_IMAGE_MAX_PER_REFRESH || '250', 10),
  concurrency: Math.max(1, Number.parseInt(process.env.SCRYFALL_BULK_IMAGE_CONCURRENCY || '4', 10))
};

let cards = [];
let cardById = new Map();
let cardByOracle = new Map();
let activeFilePath = null;
let lastMetadataCheck = 0;
let dataState = null;
let refreshPromise = null;
let imageTargetByFilename = new Map();

function sanitizeFilename(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

async function fetchMetadata() {
  const response = await fetch(BULK_INDEX_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Scryfall bulk index: ${response.status}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.data)) {
    throw new Error('Unexpected bulk index response');
  }
  const entry = payload.data.find((item) => item?.type === config.bulkType);
  if (!entry) {
    throw new Error(`Bulk type ${config.bulkType} not found`);
  }
  return entry;
}

async function ensureDirectory(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function downloadBulk(entry) {
  await ensureDirectory(config.dataDir);
  const timestampTag = sanitizeFilename(entry.updated_at || entry.id || 'latest');
  const targetPath = path.join(config.dataDir, `${config.bulkType}-${timestampTag}.json`);
  try {
    await stat(targetPath);
    return targetPath;
  } catch {}

  const response = await fetch(entry.download_uri);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download bulk file: ${response.status}`);
  }

  const tempPath = `${targetPath}.tmp`;
  const writer = createWriteStream(tempPath);
  // fetch() automatically decompresses gzip, so we don't need to decompress again
  await pipeline(response.body, writer);
  await rename(tempPath, targetPath);

  const files = await readdir(config.dataDir);
  await Promise.all(
    files
      .filter((file) => file.startsWith(`${config.bulkType}-`) && path.join(config.dataDir, file) !== targetPath)
      .map((file) => rm(path.join(config.dataDir, file), { force: true }))
  );

  return targetPath;
}

function indexCards(cardList) {
  cardById = new Map();
  cardByOracle = new Map();
  imageTargetByFilename = new Map();
  const fieldOrder = getImageFieldOrder();
  for (const card of cardList) {
    if (card?.id) {
      cardById.set(card.id, card);
    }
    if (card?.oracle_id) {
      cardByOracle.set(card.oracle_id, card);
    }
    for (const target of buildImageTargets(card, fieldOrder)) {
      imageTargetByFilename.set(`${target.id}${target.extension}`, target);
    }
  }
}

async function loadCardsFromFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Bulk file is not an array');
  }
  cards = parsed;
  indexCards(cards);
  activeFilePath = filePath;
  dataState = {
    totalCards: cards.length,
    filePath,
    loadedAt: new Date().toISOString()
  };
}

function parseQueryString(query) {
  const tokens = (query.match(/"[^"]+"|\S+/g) || []).map((token) => token.replace(/^"|"$/g, ''));
  const filters = [];
  const terms = [];
  for (const token of tokens) {
    const colonIndex = token.indexOf(':');
    if (colonIndex > 0) {
      const key = token.slice(0, colonIndex).toLowerCase();
      const value = token.slice(colonIndex + 1).toLowerCase();
      filters.push({ key, value });
    } else if (token.trim()) {
      terms.push(token.toLowerCase());
    }
  }
  return { filters, terms };
}

function matchesFilters(card, filters) {
  for (const filter of filters) {
    switch (filter.key) {
      case 'type': {
        const typeLine = (card.type_line || '').toLowerCase();
        if (!typeLine.includes(filter.value)) {
          return false;
        }
        break;
      }
      case 'set': {
        const setCode = (card.set || '').toLowerCase();
        const setName = (card.set_name || '').toLowerCase();
        if (setCode !== filter.value && setName !== filter.value) {
          return false;
        }
        break;
      }
      case 'name': {
        const name = (card.name || '').toLowerCase();
        if (!name.includes(filter.value)) {
          return false;
        }
        break;
      }
      case 'oracle': {
        const oracleText = (card.oracle_text || '').toLowerCase();
        if (!oracleText.includes(filter.value)) {
          return false;
        }
        break;
      }
      default:
        break;
    }
  }
  return true;
}

function matchesTerms(card, terms) {
  if (!terms.length) {
    return true;
  }
  const haystack = `${card.name || ''}\n${card.oracle_text || ''}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function searchCardsLocal(query, options = {}) {
  const { filters, terms } = parseQueryString(query);
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const page = Number.isFinite(options.page) && options.page > 0 ? options.page : 1;
  const maxResults = Math.min(config.resultLimit, limit);
  const offset = (page - 1) * maxResults;
  const end = offset + maxResults;
  const collected = [];
  let totalMatches = 0;

  for (const card of cards) {
    if (!matchesFilters(card, filters)) {
      continue;
    }
    if (!matchesTerms(card, terms)) {
      continue;
    }
    totalMatches += 1;
    if (totalMatches > offset && totalMatches <= end) {
      collected.push(card);
    }
  }

  const hasMore = totalMatches > end;
  return {
    object: 'list',
    total_cards: totalMatches,
    has_more: hasMore,
    data: collected
  };
}

async function refreshData(force = false) {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    const now = Date.now();
    if (!force && now - lastMetadataCheck < config.refreshMs && cards.length) {
      return dataState;
    }
    const metadata = await fetchMetadata();
    lastMetadataCheck = Date.now();
    const filePath = await downloadBulk(metadata);
    if (filePath !== activeFilePath || !cards.length) {
      await loadCardsFromFile(filePath);
    }
    await cacheCardImages(cards);
    dataState = {
      ...dataState,
      updatedAt: metadata.updated_at,
      downloadUri: metadata.download_uri,
      totalCards: cards.length
    };
    return dataState;
  })()
    .catch((error) => {
      console.error('Failed to refresh Scryfall bulk data', error);
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
}

function notFound(response) {
  sendJson(response, 404, { error: 'Not Found' });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      await refreshData();
      sendJson(response, 200, {
        status: 'ok',
        bulkType: config.bulkType,
        data: dataState
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/cards/search') {
      const query = requestUrl.searchParams.get('q');
      if (!query) {
        sendJson(response, 400, { error: 'Missing query parameter q' });
        return;
      }
      await refreshData();
      const limitParam = Number.parseInt(requestUrl.searchParams.get('limit') || '', 10);
      const pageParam = Number.parseInt(requestUrl.searchParams.get('page') || '', 10);
      const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
      const payload = searchCardsLocal(query, {
        limit: Number.isFinite(limitParam) ? limitParam : undefined,
        page,
      });
      if (payload.has_more) {
        const nextPageUrl = new URL(requestUrl.toString());
        nextPageUrl.searchParams.set('page', String(page + 1));
        payload.next_page = nextPageUrl.toString();
      }
      payload.data = payload.data.map((card) => decorateCardForResponse(card, requestUrl.origin));
      sendJson(response, 200, payload);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname.startsWith('/cards/')) {
      const id = requestUrl.pathname.replace('/cards/', '');
      if (!id) {
        sendJson(response, 400, { error: 'Missing card id' });
        return;
      }
      await refreshData();
      const normalized = id.trim();
      const card = cardById.get(normalized) || cardByOracle.get(normalized);
      if (!card) {
        sendJson(response, 404, { error: 'Card not found' });
        return;
      }
      sendJson(response, 200, decorateCardForResponse(card, requestUrl.origin));
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname.startsWith('/images/')) {
      const filename = decodeURIComponent(requestUrl.pathname.replace('/images/', '').trim());
      if (!filename) {
        sendJson(response, 400, { error: 'Missing image filename' });
        return;
      }

      await refreshData();
      const target = imageTargetByFilename.get(filename);
      if (!target) {
        sendJson(response, 404, { error: 'Image not found' });
        return;
      }

      await ensureDirectory(imageCacheConfig.directory);
      const filePath = path.join(imageCacheConfig.directory, filename);
      if (!(await fileExists(filePath))) {
        await downloadImage({ ...target, filePath });
      }

      await sendImageFile(response, filePath);
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/admin/refresh') {
      await refreshData(true);
      sendJson(response, 200, { status: 'refreshed', data: dataState });
      return;
    }

    notFound(response);
  } catch (error) {
    console.error('Bulk service error', error);
    sendJson(response, 500, { error: 'Internal Server Error' });
  }
});

async function start() {
  try {
    await refreshData(true);
  } catch (error) {
    console.error('Initial bulk load failed', error);
  }
  server.listen(config.port, config.host, () => {
    console.log(`Scryfall bulk service listening on http://${config.host}:${config.port}`);
  });
}

start();

function getImageFieldOrder() {
  const fields = [imageCacheConfig.preferredField, ...imageCacheConfig.fallbackFields];
  const seen = new Set();
  const deduped = [];
  for (const field of fields) {
    if (!field) {
      continue;
    }
    const lowered = field.toLowerCase();
    if (!seen.has(lowered)) {
      seen.add(lowered);
      deduped.push(lowered);
    }
  }
  return deduped.length ? deduped : ['border_crop', 'art_crop', 'large', 'normal'];
}

function resolveImageUrl(imageMap, fieldOrder) {
  if (!imageMap) {
    return null;
  }
  for (const field of fieldOrder) {
    if (imageMap[field]) {
      return imageMap[field];
    }
  }
  const values = Object.values(imageMap);
  return values.length ? values[0] : null;
}

function extensionFromUrl(urlString) {
  try {
    const ext = path.extname(new URL(urlString).pathname);
    if (ext) {
      return ext;
    }
  } catch {}
  return '.jpg';
}

function contentTypeForExtension(extension) {
  switch (extension.toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.jpeg':
    case '.jpg':
    default:
      return 'image/jpeg';
  }
}

function buildImageTargets(card, fieldOrder) {
  const targets = [];
  if (!card?.id) {
    return targets;
  }

  if (card.image_uris) {
    const url = resolveImageUrl(card.image_uris, fieldOrder);
    if (url) {
      targets.push({
        id: card.id,
        url,
        extension: extensionFromUrl(url),
        label: card.name || card.id
      });
    }
  }

  if (Array.isArray(card.card_faces)) {
    card.card_faces.forEach((face, index) => {
      if (!face?.image_uris) {
        return;
      }
      const url = resolveImageUrl(face.image_uris, fieldOrder);
      if (url) {
        targets.push({
          id: `${card.id}-face${index}`,
          url,
          extension: extensionFromUrl(url),
          label: (face.name || card.name || card.id)
        });
      }
    });
  }

  return targets;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function cacheCardImages(cardList) {
  if (!imageCacheConfig.enabled || !cardList?.length) {
    return;
  }

  const fieldOrder = getImageFieldOrder();
  await ensureDirectory(imageCacheConfig.directory);

  const queue = [];
  outer: for (const card of cardList) {
    const targets = buildImageTargets(card, fieldOrder);
    for (const target of targets) {
      const filePath = path.join(imageCacheConfig.directory, `${target.id}${target.extension}`);
      if (await fileExists(filePath)) {
        continue;
      }
      queue.push({ ...target, filePath });
      if (imageCacheConfig.maxDownloadsPerRefresh > 0 && queue.length >= imageCacheConfig.maxDownloadsPerRefresh) {
        break outer;
      }
    }
  }

  if (!queue.length) {
    return;
  }

  console.log(`Caching ${queue.length} Scryfall images (target dir: ${imageCacheConfig.directory})`);
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
    console.warn(`Failed to cache ${errors.length} Scryfall images`);
    errors.slice(0, 5).forEach(({ job, error }) => {
      console.warn(`  - ${job.label} (${job.url}): ${error.message}`);
    });
  }
}

async function downloadImage(job) {
  const response = await fetch(job.url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with status ${response.status}`);
  }
  const tempPath = `${job.filePath}.tmp`;
  const writer = createWriteStream(tempPath);
  await pipeline(response.body, writer);
  await rename(tempPath, job.filePath);
}

function cloneCard(card) {
  return JSON.parse(JSON.stringify(card));
}

function toLocalImageUrl(origin, filename) {
  return `${origin}/images/${encodeURIComponent(filename)}`;
}

function rewriteImageMap(imageMap, localUrl) {
  if (!imageMap || typeof imageMap !== 'object') {
    return imageMap;
  }

  const rewritten = {};
  for (const key of Object.keys(imageMap)) {
    rewritten[key] = localUrl;
  }
  return rewritten;
}

function decorateCardForResponse(card, origin) {
  const cloned = cloneCard(card);
  const targets = buildImageTargets(card, getImageFieldOrder());
  if (!targets.length) {
    return cloned;
  }

  const rootTarget = targets.find((target) => target.id === card.id) ?? targets[0];
  if (cloned.image_uris && rootTarget) {
    cloned.image_uris = rewriteImageMap(
      cloned.image_uris,
      toLocalImageUrl(origin, `${rootTarget.id}${rootTarget.extension}`)
    );
  }

  if (Array.isArray(cloned.card_faces)) {
    cloned.card_faces = cloned.card_faces.map((face, index) => {
      if (!face?.image_uris) {
        return face;
      }
      const target = targets.find((candidate) => candidate.id === `${card.id}-face${index}`);
      if (!target) {
        return face;
      }
      return {
        ...face,
        image_uris: rewriteImageMap(
          face.image_uris,
          toLocalImageUrl(origin, `${target.id}${target.extension}`)
        )
      };
    });
  }

  return cloned;
}

async function sendImageFile(response, filePath) {
  response.statusCode = 200;
  response.setHeader('Content-Type', contentTypeForExtension(path.extname(filePath)));
  createReadStream(filePath).pipe(response);
}
