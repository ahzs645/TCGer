import { createLocalJWKSet, jwtVerify } from 'jose';
import { lookupRequest, lookupKey, positiveLimit, MAX_BODY_BYTES } from './contracts.mjs';
import { authenticateGuest, guestRoute } from './guest-auth.mjs';
export { PricingQuota } from './quota.mjs';
export { GuestDevice } from './guest-device.mjs';

let keyCache;
function json(status, body, extra = {}) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...extra,
  } });
}

async function readBody(request) {
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new Error('body_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_request');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

async function authenticate(request, env) {
  if (!env.AUTH_ISSUER?.startsWith('https://') || !env.AUTH_AUDIENCE) throw new Error('configuration');
  if (keyCache?.raw !== env.AUTH_JWKS) {
    const jwks = JSON.parse(env.AUTH_JWKS);
    if (!Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.some(key => key.d || key.k || !['RSA', 'EC', 'OKP'].includes(key.kty))) {
      throw new Error('configuration');
    }
    keyCache = { raw: env.AUTH_JWKS, resolve: createLocalJWKSet(jwks) };
  }
  const bearer = request.headers.get('Authorization');
  if (!bearer?.startsWith('Bearer ') || bearer.length > 8192) return null;
  try {
    const { payload } = await jwtVerify(bearer.slice(7), keyCache.resolve, {
      issuer: env.AUTH_ISSUER, audience: env.AUTH_AUDIENCE,
      algorithms: ['RS256', 'ES256', 'EdDSA'], requiredClaims: ['sub', 'iat', 'exp'], maxTokenAge: '20m',
    });
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 240 ||
        payload.exp - payload.iat > 1200) return null;
    return `${payload.iss}|${payload.sub}`;
  } catch { return null; }
}

async function handle(request, env) {
  // Default-off also acts as a cheap emergency switch, before any bindings.
  if (env.PRICING_ENABLED !== 'true') return json(503, { error: 'pricing_unavailable' });
  const url = new URL(request.url);
  const guestPath = ['/v1/guest/challenge', '/v1/guest/verify'].includes(url.pathname);
  if (url.pathname !== '/v1/prices/lookup' && !guestPath) return json(404, { error: 'not_found' });
  if (url.search) return json(400, { error: 'unsupported_query' });
  const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  if (origin && !origins.includes(origin)) return json(403, { error: 'origin_denied' });
  const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  const respond = (status, body, extra) => json(status, body, { ...cors, ...extra });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-TCGer-Guest',
    'Access-Control-Max-Age': '600',
  } });
  if (request.method !== 'POST') return respond(405, { error: 'method_not_allowed' }, { Allow: 'POST' });
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return respond(403, { error: 'client_address_unavailable' });
  if (!(await env.IP_RATE_LIMIT.limit({ key: ip })).success) {
    return respond(429, { error: 'rate_limited' }, { 'Retry-After': '60' });
  }
  if (guestPath) {
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json' || request.headers.has('Content-Encoding')) {
      return respond(415, { error: 'expected_uncompressed_json' });
    }
    let input;
    try { input = await readBody(request); }
    catch (error) { return respond(error.message === 'body_too_large' ? 413 : 400, { error: 'invalid_request' }); }
    const result = await guestRoute(url.pathname, input, ip, env);
    return respond(result.status, result.body, result.headers);
  }
  const user = request.headers.get('X-TCGer-Guest') === '1'
    ? await authenticateGuest(request, env)
    : env.ACCOUNT_ACCESS_ENABLED === 'true' ? await authenticate(request, env) : null;
  if (!user) return respond(401, { error: 'unauthorized' });
  if (!(await env.USER_RATE_LIMIT.limit({ key: user })).success) {
    return respond(429, { error: 'rate_limited' }, { 'Retry-After': '60' });
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json' || request.headers.has('Content-Encoding')) {
    return respond(415, { error: 'expected_uncompressed_json' });
  }
  let items;
  try { items = lookupRequest(await readBody(request)); }
  catch (error) { return respond(error.message === 'body_too_large' ? 413 : 400, { error: 'invalid_request' }); }
  const userLimit = positiveLimit(env.USER_DAILY_CARDS, 100_000);
  const globalLimit = positiveLimit(env.GLOBAL_DAILY_CARDS, 10_000_000);
  const globalRequests = positiveLimit(env.GLOBAL_DAILY_REQUESTS, 1_000_000);
  // Charge supplied items including duplicates and misses; reordering or tokens
  // with a new signature cannot reset a subject's quota.
  const userQuota = await env.QUOTAS.getByName(`user:${user}`).consume({ cards: items.length, cardLimit: userLimit, requestLimit: userLimit });
  if (!userQuota.allowed) return respond(429, { error: 'daily_limit' }, { 'Retry-After': String(userQuota.retryAfter) });
  const globalQuota = await env.QUOTAS.getByName('global').consume({ cards: items.length, cardLimit: globalLimit, requestLimit: globalRequests });
  if (!globalQuota.allowed) return respond(503, { error: 'daily_capacity_reached' }, { 'Retry-After': String(globalQuota.retryAfter) });

  const keys = [...new Set(items.map(lookupKey))];
  const result = await env.DB.prepare(`SELECT q.lookup_key, q.payload, q.batch_id FROM price_quotes q
    JOIN active_price_batch a ON a.batch_id = q.batch_id AND a.singleton = 1
    WHERE q.lookup_key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
  const grouped = new Map();
  const now = Date.now();
  for (const row of result.results) {
    const quote = JSON.parse(row.payload);
    const rows = grouped.get(row.lookup_key) ?? [];
    rows.push({ ...quote, stale: Date.parse(quote.expiresAt) <= now });
    grouped.set(row.lookup_key, rows);
  }
  return respond(200, {
    schema: 'tcger-hosted-price-results-v1',
    prices: items.map(item => ({ ...item, quotes: grouped.get(lookupKey(item)) ?? [] })),
  });
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch { return json(503, { error: 'pricing_unavailable' }); }
  },
};
