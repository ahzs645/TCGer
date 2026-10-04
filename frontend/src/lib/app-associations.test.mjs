import assert from 'node:assert/strict';
import test from 'node:test';
import { appAssociations } from './app-associations.mjs';
test('unconfigured certificates never associate a debug or fabricated identity', () => {
  const result = appAssociations({});
  assert.deepEqual(result.android, []);
  assert.deepEqual(result.ios.applinks.details, []);
});
test('configured public signing identities produce both domain association records', () => {
  const cert = Array(32).fill('A1').join(':');
  const result = appAssociations({ TCGER_ANDROID_CERT_SHA256: cert, TCGER_IOS_APP_ID: '6347A46LMY.firstform.TCGer' });
  assert.equal(result.android[0].target.sha256_cert_fingerprints[0], cert);
  assert.equal(result.ios.applinks.details[0].appID, '6347A46LMY.firstform.TCGer');
  assert.ok(result.ios.applinks.details[0].paths.includes('/binder/*'));
});
test('invalid public identities fail configuration instead of silently shipping malformed associations', () => {
  assert.throws(() => appAssociations({ TCGER_ANDROID_CERT_SHA256: 'debug' }));
  assert.throws(() => appAssociations({ TCGER_IOS_APP_ID: 'wrong.app' }));
});
