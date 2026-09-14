import { SignJWT, importPKCS8, importJWK, calculateJwkThumbprint } from 'jose';

let oauth;
const oauthUrl = 'https://oauth2.googleapis.com/token';
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(bytes).toString('base64url');
}

export function validPlayVerdict(payload, expected, now = Date.now()) {
  const details = payload?.requestDetails;
  const app = payload?.appIntegrity;
  const timestamp = Number(details?.timestampMillis);
  return Boolean(details?.requestPackageName === expected.packageName && details?.requestHash === expected.requestHash &&
    Number.isFinite(timestamp) && timestamp <= now + 30_000 && now - timestamp <= 120_000 &&
    app?.appRecognitionVerdict === 'PLAY_RECOGNIZED' && app?.packageName === expected.packageName &&
    Array.isArray(app?.certificateSha256Digest) && app.certificateSha256Digest.some(value => expected.certificates.includes(value)) &&
    payload?.accountDetails?.appLicensingVerdict === 'LICENSED' &&
    payload?.deviceIntegrity?.deviceRecognitionVerdict?.includes('MEETS_DEVICE_INTEGRITY'));
}

async function accessToken(env) {
  if (oauth?.configuration === env.PLAY_SERVICE_ACCOUNT && oauth.expires > Date.now()) return oauth.token;
  const service = JSON.parse(env.PLAY_SERVICE_ACCOUNT ?? '{}');
  if (!service.client_email?.endsWith('.gserviceaccount.com') || typeof service.private_key !== 'string') throw new Error('Play Integrity is not configured');
  const key = await importPKCS8(service.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/playintegrity' })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(service.client_email).setAudience(oauthUrl)
    .setIssuedAt().setExpirationTime('1h').sign(key);
  const response = await fetch(oauthUrl, { method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error('Play authorization unavailable');
  const result = await response.json();
  if (typeof result.access_token !== 'string' || !Number.isFinite(result.expires_in) || result.expires_in <= 60) throw new Error('Invalid authorization response');
  oauth = { configuration: env.PLAY_SERVICE_ACCOUNT, token: result.access_token, expires: Date.now() + Math.min(result.expires_in - 60, 3500) * 1000 };
  return oauth.token;
}

export async function verifyPlay(input, challenge, env) {
  const publicKey = input.publicKey;
  if (!publicKey || publicKey.kty !== 'EC' || publicKey.crv !== 'P-256' || publicKey.d ||
      typeof input.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(input.signature) ||
      typeof input.integrityToken !== 'string' || input.integrityToken.length > 20_000) return false;
  if (await calculateJwkThumbprint(publicKey) !== input.keyId) return false;
  // The request is bound to the installation key and one-time server challenge.
  const key = await importJWK(publicKey, 'ES256');
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
    Buffer.from(input.signature, 'base64url'), new TextEncoder().encode(challenge))) return false;
  const certificates = (env.ANDROID_CERTIFICATE_DIGESTS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!/^[a-zA-Z0-9_.]+$/.test(env.ANDROID_PACKAGE_NAME ?? '') || !certificates.length) throw new Error('Play app identity is not configured');
  const response = await fetch(`https://playintegrity.googleapis.com/v1/${env.ANDROID_PACKAGE_NAME}:decodeIntegrityToken`, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ integrity_token: input.integrityToken }),
  });
  if (!response.ok) return false;
  const decoded = await response.json();
  return validPlayVerdict(decoded.tokenPayloadExternal, {
    packageName: env.ANDROID_PACKAGE_NAME, certificates, requestHash: await digest(challenge),
  });
}
