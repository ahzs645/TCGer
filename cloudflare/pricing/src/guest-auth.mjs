import { SignJWT, jwtVerify } from 'jose';
import { positiveLimit } from './contracts.mjs';

export function guestSecret(env) {
  // Dedicated random secret, never a public app key or Better Auth secret.
  if (!env.GUEST_TOKEN_SECRET || env.GUEST_TOKEN_SECRET.length < 43) throw new Error('Guest signing is not configured');
  return new TextEncoder().encode(env.GUEST_TOKEN_SECRET);
}

export async function issueGuestToken(subject, env) {
  return new SignJWT({ scope: 'prices:read' }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('tcger-pricing').setAudience('prices').setSubject(subject)
    .setIssuedAt().setExpirationTime('15m').sign(guestSecret(env));
}

export async function authenticateGuest(request, env) {
  if (env.GUEST_ENABLED !== 'true') return null;
  const secret = guestSecret(env);
  const bearer = request.headers.get('Authorization');
  if (!bearer?.startsWith('Bearer ') || bearer.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(bearer.slice(7), secret, {
      issuer: 'tcger-pricing', audience: 'prices', algorithms: ['HS256'], typ: 'JWT',
      requiredClaims: ['sub', 'iat', 'exp'], maxTokenAge: '15m',
    });
    if (!/^device:(ios|android):[A-Za-z0-9_-]{43}$/.test(payload.sub ?? '') ||
        payload.scope !== 'prices:read' || payload.exp - payload.iat > 900) return null;
    return payload.sub;
  } catch { return null; }
}

export async function guestRoute(path, input, ip, env) {
  if (env.GUEST_ENABLED !== 'true') return { status: 503, body: { error: 'guest_verification_unavailable' } };
  guestSecret(env);
  if (!['ios', 'android'].includes(input?.platform) || typeof input.keyId !== 'string' ||
      !(input.platform === 'ios' ? /^[A-Za-z0-9+/]{43}=$/ : /^[A-Za-z0-9_-]{43}$/).test(input.keyId)) {
    return { status: 400, body: { error: 'invalid_device_key' } };
  }
  const fields = path === '/v1/guest/challenge' ? ['platform', 'keyId'] :
    input.platform === 'ios' ? ['platform', 'keyId', 'challenge', 'attestation', 'assertion'] :
      ['platform', 'keyId', 'challenge', 'publicKey', 'signature', 'integrityToken'];
  if (Object.keys(input).some(key => !fields.includes(key)) ||
      (path === '/v1/guest/verify' && !/^[A-Za-z0-9_-]{43}$/.test(input.challenge ?? ''))) {
    return { status: 400, body: { error: 'invalid_request' } };
  }
  const perIp = await env.QUOTAS.getByName(`enrollment-ip:${ip}`).consume({ cards: 1, cardLimit: 60, requestLimit: 60 });
  const limit = positiveLimit(env.GUEST_DAILY_EXCHANGES, 100_000);
  if (!perIp.allowed) return { status: 429, body: { error: 'device_exchange_limit' }, headers: { 'Retry-After': String(perIp.retryAfter) } };
  const global = await env.QUOTAS.getByName('enrollment-global').consume({ cards: 1, cardLimit: limit, requestLimit: limit });
  if (!global.allowed) return { status: 503, body: { error: 'device_exchange_capacity' }, headers: { 'Retry-After': String(global.retryAfter) } };
  const device = env.DEVICES.getByName(`${input.platform}:${input.keyId}`);
  if (path === '/v1/guest/challenge') {
    return { status: 200, body: await device.challenge(input.platform, input.keyId) };
  }
  const verified = await device.verify(input);
  if (!verified) return { status: 401, body: { error: 'device_verification_failed' } };
  return { status: 200, body: { token: await issueGuestToken(verified.subject, env), expiresIn: 900 } };
}
