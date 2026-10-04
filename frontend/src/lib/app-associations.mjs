import fs from 'node:fs';
const publicIdentities = JSON.parse(fs.readFileSync(new URL('./release-identities.json', import.meta.url), 'utf8'));
export function associationEnvironment(env = process.env) { return { ...publicIdentities, ...env }; }
const fingerprintPattern = /^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/;
export function appAssociations(env = associationEnvironment()) {
  const fingerprints = (env.TCGER_ANDROID_CERT_SHA256 ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (fingerprints.some(value => !fingerprintPattern.test(value))) throw new Error('TCGER_ANDROID_CERT_SHA256 must contain SHA-256 fingerprints in colon-separated hex');
  const appID = env.TCGER_IOS_APP_ID?.trim();
  if (appID && !/^[A-Z0-9]{10}\.firstform\.TCGer$/.test(appID)) throw new Error('TCGER_IOS_APP_ID must match the signed firstform.TCGer application identifier');
  return {
    android: fingerprints.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.ahmadjalil.tcger', sha256_cert_fingerprints: fingerprints.map(x => x.toUpperCase()) } }] : [],
    ios: { applinks: { apps: [], details: appID ? [{ appID, paths: ['/scan', '/search', '/binder/*', '/collections', '/wishlist/*', '/wishlists', '/packs'] }] : [] } },
  };
}
