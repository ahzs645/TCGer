import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { pagesFallbackHtml, publishPagesAppLinks } from './pages-app-links.mjs';
import { appAssociations } from '../../frontend/src/lib/app-associations.mjs';
const template = fs.readFileSync(new URL('../../marketing-site/public/404.html', import.meta.url), 'utf8');

test('generated Pages 404 routes app links into the demo and retains marketing fallback', () => {
  const html = pagesFallbackHtml(template);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [pathname, search, expected] of [
    ['/search', '?q=Black%20Lotus', '/demo/?next=%2Fdemo%2Fcards%3Fq%3DBlack%2520Lotus'],
    ['/binder/fixture-binder', '', '/demo/?next=%2Fdemo%2Fcollections%3Fbinder%3Dfixture-binder'],
    ['/wishlist/missing', '', '/demo/?next=%2Fdemo%2Fwishlists%3Fwishlist%3Dmissing'],
    ['/support', '?topic=backup', '/'],
  ]) {
    let replaced; const stored = new Map();
    const location = { hostname: 'tcger.ahmadjalil.com', pathname, search, href: `https://tcger.ahmadjalil.com${pathname}${search}`, replace: value => { replaced = value; } };
    vm.runInNewContext(script, { URL, encodeURIComponent, decodeURIComponent, location, sessionStorage: { setItem: (key, value) => stored.set(key, value) } });
    assert.equal(replaced, expected);
    assert.equal(stored.get('spa-redirect'), expected === '/' ? pathname + search : undefined);
  }
});
test('Pages artifact publishes the same public release identities and requires the copied demo', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcger-pages-links-'));
  try {
    assert.throws(() => publishPagesAppLinks(directory, template), /copy the static demo/);
    fs.mkdirSync(path.join(directory, 'demo')); fs.writeFileSync(path.join(directory, 'demo/index.html'), '<html>Demo</html>');
    publishPagesAppLinks(directory, template);
    const expected = appAssociations();
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, '.well-known/assetlinks.json'))), expected.android);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, '.well-known/apple-app-site-association'))), expected.ios);
    assert.ok(fs.existsSync(path.join(directory, '.nojekyll')));
    assert.ok(fs.readFileSync(path.join(directory, '404.html'), 'utf8').includes('demoAppLinkFallback'));
    assert.throws(() => publishPagesAppLinks(directory, template, {}), /identities/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
