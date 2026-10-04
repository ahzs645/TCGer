import assert from 'node:assert/strict';
import test from 'node:test';
import { configurationChecks, deviceEvidenceValid, webEvidenceValid, hostedChecks } from './readiness.mjs';
test('missing signing configuration and associations remain pending', () => assert.ok(configurationChecks({}).every(check => check.status === 'pending')));
test('malformed identities fail rather than produce a green gate', () => assert.equal(configurationChecks({ TCGER_ANDROID_CERT_SHA256: 'bad' })[0].status, 'failed'));
test('physical evidence must bind the current artifact, commit and every device journey', () => {
  const record = { platform: 'ios', revision: 'abc', artifactSha256: 'hash', device: 'iPhone', os: 'iOS 26', checkedAt: new Date().toISOString(), checks: Object.fromEntries(['authenticationSuccess','authenticationCancel','authenticationUnavailable','backgroundPrivacy','coldAppLink','warmAppLink','camera'].map(key => [key,true])) };
  assert.equal(deviceEvidenceValid(record, 'ios', 'abc', 'hash'), true);
  assert.equal(deviceEvidenceValid(record, 'ios', 'other', 'hash'), false);
  assert.equal(deviceEvidenceValid(record, 'ios', 'abc', 'wrong'), false);
  delete record.checks.authenticationCancel;
  assert.equal(deviceEvidenceValid(record, 'ios', 'abc', 'hash'), false);
});
test('an HTTP origin cannot prove production association readiness', async () => await assert.rejects(() => hostedChecks('http://tcger.ahmadjalil.com', {})));

test('browser evidence must bind the deployed revision, origin and every install journey', () => {
  const record = { platform: 'web', revision: 'abc', baseURL: 'https://tcger.ahmadjalil.com', browser: 'Chrome 140', checkedAt: new Date().toISOString(), checks: { installation: true, offlineLaunch: true, serviceWorkerUpdate: true } };
  assert.equal(webEvidenceValid(record, 'abc', record.baseURL), true);
  assert.equal(webEvidenceValid(record, 'other', record.baseURL), false);
  assert.equal(webEvidenceValid(record, 'abc', 'https://elsewhere.example'), false);
  record.checks.serviceWorkerUpdate = false;
  assert.equal(webEvidenceValid(record, 'abc', record.baseURL), false);
});
test('host errors remain reportable failed checks', async () => {
  const checks = await hostedChecks('https://tcger.ahmadjalil.com', {}, async () => { throw new Error('Offline'); });
  assert.equal(checks.length, 7);
  assert.ok(checks.every(check => check.status === 'failed'));
});
