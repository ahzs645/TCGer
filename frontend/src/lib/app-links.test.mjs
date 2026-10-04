import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { appLinkFallback, appLinkRedirects } from './app-links.mjs';
const fixtures = JSON.parse(fs.readFileSync(new URL('../../../mobile-parity/fixtures/app-links-v1.json', import.meta.url)));
for (const item of fixtures) test(`web app link: ${item.url}`, () => assert.equal(appLinkFallback(item.url), item.web));
test('native aliases redirect into canonical web screens', () => assert.deepEqual(appLinkRedirects.map(x => x.source), ['/search', '/binder/:id', '/wishlist/:id']));
