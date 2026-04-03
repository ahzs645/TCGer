import http from 'node:http';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const DEFAULT_REFRESH_MS = 12 * 60 * 60 * 1000; // 12 hours
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGE_SIZE = 200;

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
  sourceBase: (process.env.YGO_SOURCE_BASE_URL || 'https://db.ygoprodeck.com/api/v7').replace(/\/+$/, ''),
  dataDir: (process.env.YGO_CACHE_DATA_DIR || '/data').trim(),
  port: Number.parseInt(process.env.PORT || '4020', 10),
  host: process.env.HOST || '0.0.0.0',
  refreshMs: Math.max(5 * 60 * 1000, Number.parseInt(process.env.YGO_CACHE_REFRESH_MS || `${DEFAULT_REFRESH_MS}`, 10)),
  defaultPageSize: Math.max(1, Number.parseInt(process.env.YGO_CACHE_PAGE_SIZE || `${DEFAULT_PAGE_SIZE}`, 10)),
  maxPageSize: Math.max(1, Number.parseInt(process.env.YGO_CACHE_MAX_PAGE_SIZE || `${DEFAULT_MAX_PAGE_SIZE}`, 10))
};

const imageCacheConfig = {
  enabled: parseBoolean(process.env.YGO_CACHE_IMAGES ?? 'true', true),
  directory: (process.env.YGO_CACHE_IMAGE_DIR || path.join(config.dataDir, 'images')).trim(),
  variants: (process.env.YGO_CACHE_IMAGE_VARIANTS || 'full,small').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
  maxDownloadsPerRefresh: Number.parseInt(process.env.YGO_CACHE_IMAGE_MAX_PER_REFRESH || '250', 10),
  concurrency: Math.max(1, Number.parseInt(process.env.YGO_CACHE_IMAGE_CONCURRENCY || '4', 10))
};

if (config.defaultPageSize > config.maxPageSize) {
  config.defaultPageSize = config.maxPageSize;
}

let cards = [];
let cardById = new Map();
let metadata = null;
let lastVersionCheck = 0;
let refreshPromise = null;
let imageTargetByFilename = new Map();

function sanitizeFilename(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-');
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

function ygoVariantField(variant) {
  switch (variant) {
    case 'small':
      return 'image_url_small';
    case 'cropped':
      return 'image_url_cropped';
    case 'full':
    default:
      return 'image_url';
  }
}

function buildImageTargets(card) {
  if (!Array.isArray(card?.card_images)) {
    return [];
  }

  const targets = [];
  for (const image of card.card_images) {
    const imageId = image?.id ?? card.id;
    for (const variant of imageCacheConfig.variants) {
      const field = ygoVariantField(variant);
      const url = image?.[field];
      if (!url) {
        continue;
      }
      const extension = extensionFromUrl(url);
      targets.push({
        filename: `${imageId}-${variant}${extension}`,
        imageId: String(imageId),
        variant,
        url,
        extension
      });
    }
  }
  return targets;
}

function cloneCard(card) {
  return JSON.parse(JSON.stringify(card));
}

function toLocalImageUrl(origin, filename) {
  return `${origin}/images/${encodeURIComponent(filename)}`;
}

function decorateCardForResponse(card, origin) {
  const cloned = cloneCard(card);
  if (!Array.isArray(cloned.card_images)) {
    return cloned;
  }

  const targetByKey = new Map(
    buildImageTargets(card).map((target) => [`${target.imageId}:${target.variant}`, target])
  );

  cloned.card_images = cloned.card_images.map((image) => {
    const imageId = String(image?.id ?? card.id);
    const fullTarget = targetByKey.get(`${imageId}:full`);
    const smallTarget = targetByKey.get(`${imageId}:small`);
    const croppedTarget = targetByKey.get(`${imageId}:cropped`);
    return {
      ...image,
      image_url: fullTarget ? toLocalImageUrl(origin, fullTarget.filename) : image?.image_url,
      image_url_small: smallTarget ? toLocalImageUrl(origin, smallTarget.filename) : image?.image_url_small,
      image_url_cropped: croppedTarget ? toLocalImageUrl(origin, croppedTarget.filename) : image?.image_url_cropped
    };
  });

  return cloned;
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

async function fetchVersionInfo() {
  const url = `${config.sourceBase}/checkDBVer.php`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Yu-Gi-Oh! DB version: ${response.status}`);
  }
  const payload = await response.json();
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Unexpected version payload');
  }
  return payload;
}

async function downloadDataset(versionLabel) {
  const response = await fetch(`${config.sourceBase}/cardinfo.php`);
  if (!response.ok) {
    throw new Error(`Failed to download Yu-Gi-Oh! card data: ${response.status}`);
  }
  const rawText = await response.text();
  const parsed = JSON.parse(rawText);
  if (!Array.isArray(parsed?.data)) {
    throw new Error('Card data response missing data array');
  }
  await ensureDirectory(config.dataDir);
  const label = sanitizeFilename(versionLabel || 'latest');
  const targetPath = path.join(config.dataDir, `ygo-cardinfo-${label}.json`);
  const tempPath = `${targetPath}.tmp`;
  await writeFile(tempPath, rawText, 'utf8');
  await rename(tempPath, targetPath);
  await cleanupCacheFiles(targetPath);
  return { cards: parsed.data, filePath: targetPath };
}

function indexCards(cardList) {
  cardById = new Map();
  imageTargetByFilename = new Map();
  for (const card of cardList) {
    if (card?.id !== undefined && card?.id !== null) {
      cardById.set(String(card.id), card);
    }
    for (const target of buildImageTargets(card)) {
      imageTargetByFilename.set(target.filename, target);
    }
  }
}

async function loadCards(cardList, filePath, versionInfo) {
  cards = cardList;
  indexCards(cards);
  metadata = {
    version: versionInfo?.database_version ?? null,
    remoteDate: versionInfo?.date ?? null,
    filePath,
    totalCards: cards.length,
    loadedAt: new Date().toISOString()
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
    if (!Array.isArray(parsed?.data)) {
      return false;
    }
    cards = parsed.data;
    indexCards(cards);
    metadata = {
      version: parsed?.meta?.database_version ?? null,
      remoteDate: parsed?.meta?.date ?? null,
      filePath: latestPath,
      totalCards: cards.length,
      loadedAt: new Date().toISOString(),
      restoredFromDisk: true
    };
    return true;
  } catch (error) {
    console.error('Failed to restore Yu-Gi-Oh! dataset from disk', error);
    return false;
  }
}

async function refreshData(force = false) {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    const now = Date.now();
    if (!force && cards.length && now - lastVersionCheck < config.refreshMs) {
      return metadata;
    }
    try {
      const versionInfo = await fetchVersionInfo();
      lastVersionCheck = Date.now();
      const remoteVersion = versionInfo?.database_version ?? null;
      if (!force && metadata?.version === remoteVersion && cards.length) {
        metadata = {
          ...metadata,
          version: remoteVersion,
          remoteDate: versionInfo?.date ?? metadata?.remoteDate
        };
        return metadata;
      }
      const { cards: remoteCards, filePath } = await downloadDataset(remoteVersion || 'latest');
      await loadCards(remoteCards, filePath, versionInfo);
      await cacheCardImages(cards);
      return metadata;
    } catch (error) {
      console.error('Failed to refresh Yu-Gi-Oh! cache', error);
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

async function cacheCardImages(cardList) {
  if (!imageCacheConfig.enabled || !cardList?.length) {
    return;
  }

  await ensureDirectory(imageCacheConfig.directory);
  const queue = [];

  outer: for (const card of cardList) {
    for (const target of buildImageTargets(card)) {
      const filePath = path.join(imageCacheConfig.directory, target.filename);
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

  console.log(`Caching ${queue.length} Yu-Gi-Oh! images (target dir: ${imageCacheConfig.directory})`);
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
    console.warn(`Failed to cache ${errors.length} Yu-Gi-Oh! images`);
    errors.slice(0, 5).forEach(({ job, error }) => {
      console.warn(`  - ${job.filename}: ${error.message}`);
    });
  }
}

function toLowerSet(value, separator = ',') {
  if (!value) {
    return null;
  }
  return new Set(
    value
      .split(separator)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function parseNumericFilter(value) {
  if (!value) {
    return null;
  }
  const match = value.trim().match(/^(lt|lte|gt|gte)?\s*(\d+)$/i);
  if (match) {
    return { op: match[1]?.toLowerCase() ?? 'eq', value: Number.parseInt(match[2], 10) };
  }
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric)) {
    return { op: 'eq', value: numeric };
  }
  return null;
}

function satisfiesNumericFilter(cardValue, filter) {
  if (!filter) {
    return true;
  }
  if (!Number.isFinite(cardValue)) {
    return false;
  }
  switch (filter.op) {
    case 'lt':
      return cardValue < filter.value;
    case 'lte':
      return cardValue <= filter.value;
    case 'gt':
      return cardValue > filter.value;
    case 'gte':
      return cardValue >= filter.value;
    case 'eq':
    default:
      return cardValue === filter.value;
  }
}

function parseCardinfoParams(searchParams) {
  const original = new URLSearchParams(searchParams);
  const ids = toLowerSet(searchParams.get('id'), ',');
  const names = toLowerSet(searchParams.get('name'), '|');
  const konamiIds = toLowerSet(searchParams.get('konami_id'), ',');
  const fuzzyName = searchParams.get('fname')?.trim().toLowerCase();
  const archetypes = toLowerSet(searchParams.get('archetype'));
  const types = toLowerSet(searchParams.get('type'));
  const races = toLowerSet(searchParams.get('race'));
  const attributes = toLowerSet(searchParams.get('attribute'));
  const cardsets = toLowerSet(searchParams.get('cardset'));
  const numValue = Number.parseInt(searchParams.get('num') ?? '', 10);
  const pageSizeRaw = Number.isFinite(numValue) && numValue > 0 ? numValue : config.defaultPageSize;
  const pageSize = Math.min(pageSizeRaw, config.maxPageSize);
  const offsetRaw = Number.parseInt(searchParams.get('offset') ?? '', 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  const sortKey = searchParams.get('sort')?.trim().toLowerCase();
  const orderKey = searchParams.get('order')?.trim().toLowerCase() || searchParams.get('dir')?.trim().toLowerCase() || 'asc';
  const atkFilter = parseNumericFilter(searchParams.get('atk'));
  const defFilter = parseNumericFilter(searchParams.get('def'));
  const levelFilter = parseNumericFilter(searchParams.get('level'));
  const linkFilter = parseNumericFilter(searchParams.get('link'));
  const scaleFilter = parseNumericFilter(searchParams.get('scale'));
  const hasEffectParam = searchParams.get('has_effect');
  const hasEffect = typeof hasEffectParam === 'string' ? hasEffectParam.toLowerCase() === 'true' : null;

  return {
    ids,
    names,
    konamiIds,
    fuzzyName,
    archetypes,
    types,
    races,
    attributes,
    cardsets,
    pageSize,
    offset,
    sortKey,
    orderKey,
    atkFilter,
    defFilter,
    levelFilter,
    linkFilter,
    scaleFilter,
    hasEffect,
    originalSearchParams: original
  };
}

function matchesList(value, allowedValues) {
  if (!allowedValues || !allowedValues.size) {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  return allowedValues.has(value.trim().toLowerCase());
}

function matchesCardsets(card, cardsets) {
  if (!cardsets || !cardsets.size) {
    return true;
  }
  if (!Array.isArray(card?.card_sets)) {
    return false;
  }
  return card.card_sets.some((set) => {
    const code = typeof set?.set_code === 'string' ? set.set_code.toLowerCase() : null;
    const name = typeof set?.set_name === 'string' ? set.set_name.toLowerCase() : null;
    return (code && cardsets.has(code)) || (name && cardsets.has(name));
  });
}

function matchesKonamiId(card, konamiIds) {
  if (!konamiIds || !konamiIds.size) {
    return true;
  }
  const konamiId = card?.konami_id ? String(card.konami_id).toLowerCase() : null;
  return konamiId ? konamiIds.has(konamiId) : false;
}

function matchesHasEffect(card, hasEffect) {
  if (hasEffect === null) {
    return true;
  }
  const text = typeof card?.desc === 'string' ? card.desc.trim() : '';
  const hasText = text.length > 0;
  return hasEffect ? hasText : !hasText;
}

function compareValues(a, b) {
  if (a === b) {
    return 0;
  }
  if (a === undefined || a === null) {
    return -1;
  }
  if (b === undefined || b === null) {
    return 1;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  const aStr = String(a).toLowerCase();
  const bStr = String(b).toLowerCase();
  if (aStr === bStr) {
    return 0;
  }
  return aStr > bStr ? 1 : -1;
}

function sortCards(list, sortKey, order) {
  if (!sortKey) {
    return list;
  }
  const direction = order === 'desc' ? -1 : 1;
  const sortable = [...list];
  sortable.sort((a, b) => {
    let valueA;
    let valueB;
    switch (sortKey) {
      case 'atk':
        valueA = Number.parseInt(a.atk ?? '', 10);
        valueB = Number.parseInt(b.atk ?? '', 10);
        break;
      case 'def':
        valueA = Number.parseInt(a.def ?? '', 10);
        valueB = Number.parseInt(b.def ?? '', 10);
        break;
      case 'level':
        valueA = Number.parseInt(a.level ?? '', 10);
        valueB = Number.parseInt(b.level ?? '', 10);
        break;
      case 'id':
        valueA = Number.parseInt(a.id ?? '', 10);
        valueB = Number.parseInt(b.id ?? '', 10);
        break;
      case 'name':
        valueA = a.name ?? '';
        valueB = b.name ?? '';
        break;
      case 'type':
        valueA = a.type ?? '';
        valueB = b.type ?? '';
        break;
      case 'new':
      case 'release_date':
        valueA = a.tcg_date ?? a.date ?? '';
        valueB = b.tcg_date ?? b.date ?? '';
        break;
      default:
        valueA = a[sortKey];
        valueB = b[sortKey];
        break;
    }
    return compareValues(valueA, valueB) * direction;
  });
  return sortable;
}

function searchCardsLocal(params, origin) {
  let filtered = cards;

  if (params.ids && params.ids.size > 0) {
    filtered = filtered.filter((card) => params.ids.has(String(card.id).toLowerCase()));
  }

  if (params.konamiIds && params.konamiIds.size > 0) {
    filtered = filtered.filter((card) => matchesKonamiId(card, params.konamiIds));
  }

  if (params.names && params.names.size > 0) {
    filtered = filtered.filter((card) => matchesList(card?.name, params.names));
  }

  if (params.fuzzyName) {
    filtered = filtered.filter((card) => (card?.name || '').toLowerCase().includes(params.fuzzyName));
  }

  if (params.archetypes && params.archetypes.size > 0) {
    filtered = filtered.filter((card) => matchesList(card?.archetype, params.archetypes));
  }

  if (params.types && params.types.size > 0) {
    filtered = filtered.filter((card) => matchesList(card?.type, params.types));
  }

  if (params.races && params.races.size > 0) {
    filtered = filtered.filter((card) => matchesList(card?.race, params.races));
  }

  if (params.attributes && params.attributes.size > 0) {
    filtered = filtered.filter((card) => matchesList(card?.attribute, params.attributes));
  }

  if (params.cardsets && params.cardsets.size > 0) {
    filtered = filtered.filter((card) => matchesCardsets(card, params.cardsets));
  }

  filtered = filtered.filter((card) => {
    const atk = Number.parseInt(card?.atk ?? '', 10);
    const def = Number.parseInt(card?.def ?? '', 10);
    const level = Number.parseInt(card?.level ?? '', 10);
    const link = Number.parseInt(card?.linkval ?? '', 10);
    const scale = Number.parseInt(card?.scale ?? '', 10);
    return (
      satisfiesNumericFilter(atk, params.atkFilter) &&
      satisfiesNumericFilter(def, params.defFilter) &&
      satisfiesNumericFilter(level, params.levelFilter) &&
      satisfiesNumericFilter(link, params.linkFilter) &&
      satisfiesNumericFilter(scale, params.scaleFilter) &&
      matchesHasEffect(card, params.hasEffect)
    );
  });

  const sorted = sortCards(filtered, params.sortKey, params.orderKey);
  const totalRows = sorted.length;
  const offset = Math.min(params.offset, totalRows);
  const pageSize = params.pageSize;
  const data = sorted.slice(offset, offset + pageSize);
  const rowsRemaining = Math.max(totalRows - (offset + data.length), 0);
  const totalPages = pageSize > 0 ? Math.ceil(totalRows / pageSize) : 1;
  const currentPageIndex = pageSize > 0 ? Math.floor(offset / pageSize) : 0;
  const pagesRemaining = Math.max(totalPages - currentPageIndex - 1, 0);

  let nextPage = null;
  let nextOffset = null;
  if (rowsRemaining > 0) {
    nextOffset = offset + pageSize;
    const nextParams = new URLSearchParams(params.originalSearchParams);
    nextParams.set('offset', String(nextOffset));
    nextParams.set('num', String(pageSize));
    nextPage = `${origin}/cardinfo.php?${nextParams.toString()}`;
  }

  return {
    totalRows,
    data,
    meta: {
      current_rows: data.length,
      total_rows: totalRows,
      rows_remaining: rowsRemaining,
      total_pages: totalPages,
      pages_remaining: pagesRemaining,
      next_page: nextPage,
      next_page_offset: nextOffset
    }
  };
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

function methodNotAllowed(response) {
  sendJson(response, 405, { error: 'Method Not Allowed' });
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

    if (request.method === 'GET' && requestUrl.pathname === '/checkDBVer.php') {
      await refreshData();
      sendJson(response, 200, {
        object: 'version',
        database_version: metadata?.version ?? null,
        date: metadata?.remoteDate ?? null,
        cached_at: metadata?.loadedAt ?? null,
        total_cards: metadata?.totalCards ?? cards.length
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/randomcard.php') {
      await refreshData();
      if (!cards.length) {
        sendJson(response, 503, { error: 'Card cache unavailable' });
        return;
      }
      const randomIndex = Math.floor(Math.random() * cards.length);
      sendJson(response, 200, decorateCardForResponse(cards[randomIndex], requestUrl.origin));
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/cardinfo.php') {
      await refreshData();
      if (!cards.length) {
        sendJson(response, 503, { error: 'Card cache unavailable' });
        return;
      }
      const params = parseCardinfoParams(requestUrl.searchParams);
      const result = searchCardsLocal(params, requestUrl.origin);
      if (!result.totalRows) {
        sendJson(response, 404, { error: 'No card matching your query was found in the cache.' });
        return;
      }
      sendJson(response, 200, {
        data: result.data.map((card) => decorateCardForResponse(card, requestUrl.origin)),
        meta: result.meta
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname.startsWith('/images/')) {
      await refreshData();
      const filename = decodeURIComponent(requestUrl.pathname.replace('/images/', '').trim());
      if (!filename) {
        sendJson(response, 400, { error: 'Missing image filename' });
        return;
      }

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
      sendJson(response, 200, { status: 'refreshed', data: metadata });
      return;
    }

    if (request.method && request.method !== 'GET' && request.method !== 'POST') {
      methodNotAllowed(response);
      return;
    }

    sendJson(response, 404, { error: 'Not Found' });
  } catch (error) {
    console.error('Yu-Gi-Oh! cache service error', error);
    sendJson(response, 500, { error: 'Internal Server Error' });
  }
});

async function start() {
  await loadLatestFromDisk();
  await refreshData(true).catch((error) => {
    console.error('Initial Yu-Gi-Oh! cache refresh failed', error);
  });
  server.listen(config.port, config.host, () => {
    console.log(`Yu-Gi-Oh! cache service listening on http://${config.host}:${config.port}`);
  });
}

start();
