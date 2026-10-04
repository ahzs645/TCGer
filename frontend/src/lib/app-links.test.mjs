import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { appLinkFallback, appLinkRedirects, demoAppLinkFallback, demoReturnTarget } from './app-links.mjs';
const fixtures = JSON.parse(fs.readFileSync(new URL('../../../mobile-parity/fixtures/app-links-v1.json', import.meta.url)));
for (const item of fixtures) test(`web app link: ${item.url}`, () => assert.equal(appLinkFallback(item.url), item.web));
test('native aliases redirect into canonical web screens', () => assert.deepEqual(appLinkRedirects.map(x => x.source), ['/search', '/binder/:id', '/wishlist/:id']));
test('Pages demo entry preserves all supported native destinations', () => {
  for (const item of fixtures) {
    const entry = demoAppLinkFallback(item.url);
    if (!item.web) { assert.equal(entry, null); continue; }
    assert.equal(demoReturnTarget(new URL(entry, 'https://tcger.ahmadjalil.com').searchParams.get('next')), `/demo${item.web}`);
  }
});
test('demo return paths reject external or unexpected destinations and unsafe identifiers', () => {
  for (const input of [null, '//evil.example', '/demo/../../settings', '/demo/\\evil.example', '/demo/%2e%2e/settings', '/demo/cards/extra', '/demo/collections?binder=%2Fprivate']) {
    assert.equal(demoReturnTarget(input), '/demo/dashboard');
  }
  assert.equal(demoReturnTarget('/demo/cards?q=Pikachu&next=https://evil.example#script'), '/demo/cards?q=Pikachu');
});
