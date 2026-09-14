import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { encode as encodeCbor } from 'cborg';
import { Miniflare } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT, calculateJwkThumbprint, jwtVerify } from 'jose';
import { buildImport } from '../scripts/import-snapshot.mjs';
import { issueGuestToken } from '../src/guest-auth.mjs';
import { validPlayVerdict, digest } from '../src/play-integrity.mjs';
import { decodeAllSync } from '../src/attestation-cbor.mjs';

const issuer = 'https://auth.example.test';
const item = { gameId: 'pokemon', cardId: 'test-1', finishCode: 'holo', language: 'English' };
let bundle, privateKey, jwks;
const runtimes = [];

before(async () => {
  const key = await generateKeyPair('ES256');
  privateKey = key.privateKey;
  jwks = { keys: [{ ...await exportJWK(key.publicKey), kid: 'test', alg: 'ES256' }] };
  // Exercise the production bundle, including Wrangler's Node compatibility
  // shims needed by the App Attest certificate and CBOR dependencies.
  const wrangler = join(dirname(fileURLToPath(import.meta.resolve('wrangler/package.json'))), 'bin/wrangler.js');
  await promisify(execFile)(process.execPath, [wrangler, 'deploy', '--dry-run', '--outdir', '.build'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 120_000,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  bundle = await readFile(new URL('../.build/worker.js', import.meta.url), 'utf8');
});
after(async () => { await Promise.all(runtimes.map(runtime => runtime.dispose())); });

async function runtime(vars = {}, rates = {}, outboundService = () => { throw new Error('Unexpected outbound request'); }, enrolledKey) {
  const source = enrolledKey ? `${bundle}\n
      export class TestGuestDevice extends GuestDevice {
        constructor(ctx, env) {
          super(ctx, env);
          ctx.blockConcurrencyWhile(async () => {
            if (!await ctx.storage.get('appleKey')) await ctx.storage.put('appleKey', ${JSON.stringify(enrolledKey)});
          });
        }
      }` : bundle;
  const mf = new Miniflare({ modules: true, script: source, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    outboundService,
    d1Databases: ['DB'], durableObjects: { QUOTAS: { className: 'PricingQuota', useSQLite: true },
      DEVICES: { className: enrolledKey ? 'TestGuestDevice' : 'GuestDevice', useSQLite: true } },
    ratelimits: {
      IP_RATE_LIMIT: { namespace_id: '1001', simple: { limit: rates.ip ?? 1000, period: 60 } },
      USER_RATE_LIMIT: { namespace_id: '1002', simple: { limit: rates.user ?? 1000, period: 60 } },
    },
    bindings: { PRICING_ENABLED: 'true', ACCOUNT_ACCESS_ENABLED: 'true', AUTH_ISSUER: issuer, AUTH_AUDIENCE: 'convex', AUTH_JWKS: JSON.stringify(jwks),
      USER_DAILY_CARDS: '2000', GLOBAL_DAILY_CARDS: '100000', GLOBAL_DAILY_REQUESTS: '10000', ...vars },
  });
  runtimes.push(mf);
  const db = await mf.getD1Database('DB');
  const schema = await readFile(new URL('../migrations/0001_prices.sql', import.meta.url), 'utf8');
  for (const statement of schema.replace(/--[^\n]*/g, '').split(';').filter(value => value.trim())) await db.prepare(statement).run();
  return { mf, db };
}

async function token(subject = 'user-a', claims = {}, key = privateKey) {
  return new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setSubject(subject).setIssuer(claims.issuer ?? issuer).setAudience(claims.audience ?? 'convex')
    .setIssuedAt().setExpirationTime(claims.expiration ?? '15m').sign(key);
}
async function request(mf, options = {}) {
  const jwt = options.token === undefined ? await token(options.user) : options.token;
  return mf.dispatchFetch(`https://prices.test${options.path ?? '/v1/prices/lookup'}`, {
    method: options.method ?? 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': options.ip ?? '192.0.2.1',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), ...options.headers },
    body: options.method === 'GET' ? undefined : options.body ?? JSON.stringify({ items: options.items ?? [item] }),
  });
}
function snapshot(amount = 12) {
  return { schema: 'tcger-hosted-prices-v1', quotes: [{ ...item, amount, currency: 'USD', source: 'Fictional test data',
    providerProductId: 'test-product', observedAt: '2026-01-01T00:00:00Z', retrievedAt: '2026-01-02T00:00:00Z', expiresAt: '2026-01-03T00:00:00Z' }] };
}
async function apply(db, sql) {
  for (const statement of sql.split(';').filter(value => value.trim())) await db.prepare(statement).run();
}

test('authentication rejects missing, forged, expired, wrong audience and wrong issuer tokens', async () => {
  const { mf, db } = await runtime();
  // No tables: a request that accidentally reaches D1 would fail with 503.
  await db.prepare('DROP TABLE price_quotes').run();
  const otherKey = await generateKeyPair('ES256');
  for (const jwt of ['', 'garbage', await token('x', {}, otherKey.privateKey), await token('x', { audience: 'other' }),
    await token('x', { issuer: 'https://other.test' }), await token('x', { expiration: '-1m' }), await token('x', { expiration: '1h' })]) {
    assert.equal((await request(mf, { token: jwt })).status, 401);
  }
});

test('default-off switch and broken quota configuration fail closed', async () => {
  const off = await runtime({ PRICING_ENABLED: 'false' });
  assert.equal((await request(off.mf, { token: '' })).status, 503);
  const invalid = await runtime({ USER_DAILY_CARDS: 'NaN' });
  assert.equal((await request(invalid.mf)).status, 503);
});

test('bounded requests reject oversized payloads, unknown dimensions and refresh instructions', async () => {
  const { mf } = await runtime();
  assert.equal((await request(mf, { items: Array(51).fill(item) })).status, 400);
  assert.equal((await request(mf, { body: JSON.stringify({ items: [item], force: true }) })).status, 400);
  assert.equal((await request(mf, { items: [{ ...item, providerUrl: 'https://example.test' }] })).status, 400);
  assert.equal((await request(mf, { body: ' '.repeat(32769) })).status, 413);
  assert.equal((await request(mf, { path: '/v1/prices/lookup?force=true' })).status, 400);
  assert.equal((await request(mf, { headers: { Origin: 'https://evil.test' } })).status, 403);
});

test('daily quotas count duplicates and missing cards and survive concurrent admission', async () => {
  const { mf } = await runtime({ USER_DAILY_CARDS: '3' });
  assert.equal((await request(mf, { items: [item, item] })).status, 200);
  const responses = await Promise.all(Array.from({ length: 5 }, () => request(mf)));
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal(responses.filter(response => response.status === 429).length, 4);
  assert.ok(Number(responses.find(response => response.status === 429).headers.get('Retry-After')) > 0);
  assert.equal((await request(mf, { user: 'user-b' })).status, 200);
});

test('global card and request caps work across users', async () => {
  const cards = await runtime({ GLOBAL_DAILY_CARDS: '2' });
  assert.equal((await request(cards.mf, { items: [item, item] })).status, 200);
  assert.equal((await request(cards.mf, { user: 'b' })).status, 503);
  const requests = await runtime({ GLOBAL_DAILY_REQUESTS: '1' });
  assert.equal((await request(requests.mf)).status, 200);
  assert.equal((await request(requests.mf, { user: 'b' })).status, 503);
});

test('IP burst limiting rejects traffic before auth', async () => {
  const { mf } = await runtime({}, { ip: 1 });
  assert.equal((await request(mf, { token: '' })).status, 401);
  assert.equal((await request(mf, { token: '' })).status, 429);
});

test('import is idempotent and prices preserve variant and observation time', async () => {
  const { mf, db } = await runtime();
  const first = buildImport(snapshot());
  await apply(db, first.stage); await apply(db, first.activate); await apply(db, first.stage);
  const response = await request(mf, { items: [item, { ...item, finishCode: 'normal' }, { gameId: item.gameId, cardId: item.cardId }] });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.prices[0].quotes[0].amount, 12);
  assert.equal(data.prices[0].quotes[0].observedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(data.prices[0].quotes[0].stale, true);
  assert.deepEqual(data.prices.slice(1).map(row => row.quotes), [[], []]);
  const next = buildImport(snapshot(15));
  // A partially staged batch must not be promoted.
  await apply(db, next.stage.split('\n')[0]); await apply(db, next.activate);
  assert.equal((await (await request(mf)).json()).prices[0].quotes[0].amount, 12);
  await apply(db, next.stage); await apply(db, next.activate);
  assert.equal((await (await request(mf)).json()).prices[0].quotes[0].amount, 15);
});

test('import rejects ambiguous duplicates, future timestamps and invalid amounts', () => {
  const duplicate = snapshot(); duplicate.quotes.push(duplicate.quotes[0]);
  assert.throws(() => buildImport(duplicate), /Duplicate/);
  const future = snapshot(); future.quotes[0].observedAt = '2099-01-01T00:00:00Z';
  assert.throws(() => buildImport(future), /timestamp/);
  const invalid = snapshot(-1);
  assert.throws(() => buildImport(invalid), /amount/);
});

const guestEnv = {
  GUEST_ENABLED: 'true', ACCOUNT_ACCESS_ENABLED: 'false',
  GUEST_TOKEN_SECRET: 'test-only-not-for-production-012345678901234567890123456789',
  GUEST_DAILY_EXCHANGES: '2000', APPLE_TEAM_ID: 'ABCDEFGHIJ', APPLE_BUNDLE_ID: 'firstform.TCGer',
};

test('guest tokens preserve device quota across renewal; forged tokens are denied', async () => {
  const { mf } = await runtime({ ...guestEnv, USER_DAILY_CARDS: '1' });
  const subject = `device:ios:${await digest('installation-key')}`;
  const headers = { 'X-TCGer-Guest': '1' };
  assert.equal((await request(mf, { headers, token: await token() })).status, 401);
  assert.equal((await request(mf, { headers, token: await issueGuestToken(subject, guestEnv) })).status, 200);
  assert.equal((await request(mf, { headers, ip: '192.0.2.2', token: await issueGuestToken(subject, guestEnv) })).status, 429);
});

test('App Attest assertions verify enrolled keys and consume challenges and counters exactly once', async () => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const keyId = Buffer.alloc(32, 7).toString('base64');
  // Simulates an already-enrolled key; genuine Apple enrollment requires a
  // physical device and Apple-signed certificate, never a test bypass in code.
  const { mf } = await runtime(guestEnv, {}, undefined, {
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), signCount: 0,
  });
  const challenge = async () => (await (await request(mf, { path: '/v1/guest/challenge', token: '',
    body: JSON.stringify({ platform: 'ios', keyId }) })).json()).challenge;
  const assertion = (value, counter) => {
    const authenticatorData = Buffer.alloc(37);
    createHash('sha256').update(`${guestEnv.APPLE_TEAM_ID}.${guestEnv.APPLE_BUNDLE_ID}`).digest().copy(authenticatorData);
    authenticatorData.writeUInt32BE(counter, 33);
    const nonce = createHash('sha256').update(Buffer.concat([authenticatorData, createHash('sha256').update(value).digest()])).digest();
    return Buffer.from(encodeCbor({ authenticatorData, signature: sign('sha256', nonce, keys.privateKey) })).toString('base64');
  };
  const first = await challenge();
  const body = JSON.stringify({ platform: 'ios', keyId, challenge: first, assertion: assertion(first, 1) });
  const verified = await request(mf, { path: '/v1/guest/verify', token: '', body });
  assert.equal(verified.status, 200);
  assert.equal(typeof (await verified.json()).token, 'string');
  assert.equal((await request(mf, { path: '/v1/guest/verify', token: '', body })).status, 401);
  const second = await challenge();
  assert.equal((await request(mf, { path: '/v1/guest/verify', token: '',
    body: JSON.stringify({ platform: 'ios', keyId, challenge: second, assertion: assertion(second, 1) }) })).status, 401);
  const third = await challenge();
  assert.equal((await request(mf, { path: '/v1/guest/verify', token: '',
    body: JSON.stringify({ platform: 'ios', keyId, challenge: third, assertion: assertion(third, 2) }) })).status, 200);
});

test('malformed attestations fail closed and enrollment has a separate global capacity limit', async () => {
  const { mf } = await runtime({ ...guestEnv, GUEST_DAILY_EXCHANGES: '2' });
  const keyId = Buffer.alloc(32, 9).toString('base64');
  const response = await request(mf, { path: '/v1/guest/challenge', token: '', body: JSON.stringify({ platform: 'ios', keyId }) });
  const { challenge } = await response.json();
  assert.equal(response.status, 200);
  assert.equal((await request(mf, { path: '/v1/guest/verify', token: '',
    body: JSON.stringify({ platform: 'ios', keyId, challenge, attestation: 'AAAA' }) })).status, 401);
  assert.equal((await request(mf, { path: '/v1/guest/challenge', token: '', body: JSON.stringify({ platform: 'ios', keyId }) })).status, 503);
});

test('Play verdict policy requires exact app, certificate, challenge, fresh time, device integrity and license', () => {
  const now = Date.now();
  const expected = { packageName: 'com.ahmadjalil.tcger', requestHash: 'bound-challenge', certificates: ['release-cert'] };
  const valid = {
    requestDetails: { requestPackageName: expected.packageName, requestHash: expected.requestHash, timestampMillis: String(now) },
    appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: expected.packageName, certificateSha256Digest: ['release-cert'] },
    accountDetails: { appLicensingVerdict: 'LICENSED' }, deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
  };
  assert.equal(validPlayVerdict(valid, expected, now), true);
  for (const modify of [p => p.requestDetails.requestHash = 'replay', p => p.requestDetails.requestPackageName = 'other',
    p => p.requestDetails.timestampMillis = String(now - 121000), p => p.appIntegrity.certificateSha256Digest = ['other'],
    p => p.appIntegrity.appRecognitionVerdict = 'UNRECOGNIZED_VERSION', p => p.accountDetails.appLicensingVerdict = 'UNLICENSED',
    p => p.deviceIntegrity.deviceRecognitionVerdict = []]) {
    const changed = structuredClone(valid); modify(changed);
    assert.equal(validPlayVerdict(changed, expected, now), false);
  }
});

test('attestation CBOR rejects ambiguous encodings and retains binary fields', () => {
  const value = { authenticatorData: Buffer.alloc(37, 1), signature: Buffer.alloc(70, 2) };
  assert.deepEqual(decodeAllSync(encodeCbor(value)), [value]);
  for (const hex of ['a2616101616102', '0102', '9f01ff', '1817', 'a16161582001']) {
    assert.throws(() => decodeAllSync(Buffer.from(hex, 'hex')));
  }
});

test('Android exchange verifies installation signature, Google verdict binding and one-time challenge', async () => {
  const installation = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const service = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = installation.publicKey.export({ format: 'jwk' });
  const keyId = await calculateJwkThumbprint(publicKey);
  const packageName = 'com.ahmadjalil.tcger';
  let decodeCalls = 0, requestHash;
  const { mf } = await runtime({ ...guestEnv, ANDROID_PACKAGE_NAME: packageName,
    ANDROID_CERTIFICATE_DIGESTS: 'release-cert', PLAY_SERVICE_ACCOUNT: JSON.stringify({
      client_email: 'integrity@test-project.iam.gserviceaccount.com',
      private_key: service.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }),
  }, {}, async req => {
    if (req.url === 'https://oauth2.googleapis.com/token') {
      const params = new URLSearchParams(await req.text());
      await jwtVerify(params.get('assertion'), service.publicKey, { algorithms: ['RS256'],
        issuer: 'integrity@test-project.iam.gserviceaccount.com', audience: req.url });
      return Response.json({ access_token: 'test-google-token', expires_in: 3600 });
    }
    assert.equal(req.url, `https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`);
    assert.equal(req.headers.get('Authorization'), 'Bearer test-google-token');
    assert.equal((await req.json()).integrity_token, 'test-integrity-token');
    decodeCalls++;
    return Response.json({ tokenPayloadExternal: {
      requestDetails: { requestPackageName: packageName, requestHash, timestampMillis: String(Date.now()) },
      appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName, certificateSha256Digest: ['release-cert'] },
      accountDetails: { appLicensingVerdict: 'LICENSED' }, deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    } });
  });
  const challenge = async () => (await (await request(mf, { path: '/v1/guest/challenge', token: '',
    body: JSON.stringify({ platform: 'android', keyId }) })).json()).challenge;
  const verify = (value, signature) => request(mf, { path: '/v1/guest/verify', token: '', body: JSON.stringify({
    platform: 'android', keyId, challenge: value, publicKey, signature,
    integrityToken: 'test-integrity-token',
  }) });
  const signature = value => sign('sha256', Buffer.from(value), { key: installation.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const first = await challenge();
  requestHash = await digest(first);
  const accepted = await verify(first, signature(first));
  assert.equal(accepted.status, 200);
  assert.equal(typeof (await accepted.json()).token, 'string');
  assert.equal((await verify(first, signature(first))).status, 401);
  assert.equal(decodeCalls, 1);
  const second = await challenge();
  assert.equal((await verify(second, signature(first))).status, 401);
  assert.equal(decodeCalls, 1); // Reject bad possession proof before contacting Google.
  const third = await challenge();
  assert.equal((await verify(third, signature(third))).status, 401); // Old Google request hash.
  assert.equal(decodeCalls, 2);
});
