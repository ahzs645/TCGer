import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appAssociations } from '../../frontend/src/lib/app-associations.mjs';
import { appLinkFallback, demoAppLinkFallback } from '../../frontend/src/lib/app-links.mjs';

export function pagesFallbackHtml(template) {
  if (!template.includes('<script>')) throw new Error('Pages 404 template must contain its marketing fallback script');
  // Inline the same pure parser used by the web client; do not maintain a second routing table.
  return template.replace('<script>', `<script>\n${appLinkFallback.toString()}\n${demoAppLinkFallback.toString()}\n` +
    `const demoDestination = demoAppLinkFallback(location.href);\nif (demoDestination) { location.replace(demoDestination); } else {\n`)
    .replace('</script>', '}\n</script>');
}

export function publishPagesAppLinks(directory, template, environment) {
  if (!fs.existsSync(path.join(directory, 'demo/index.html'))) throw new Error('Build and copy the static demo before publishing app links');
  const associations = appAssociations(environment);
  if (!associations.android.length || !associations.ios.applinks.details.length) throw new Error('Public release identities are required');
  fs.mkdirSync(path.join(directory, '.well-known'), { recursive: true });
  for (const [name, data] of [['assetlinks.json', associations.android], ['apple-app-site-association', associations.ios]]) {
    fs.writeFileSync(path.join(directory, '.well-known', name), JSON.stringify(data, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(directory, '.nojekyll'), '');
  fs.writeFileSync(path.join(directory, '404.html'), pagesFallbackHtml(template));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  publishPagesAppLinks(path.join(root, 'marketing-site/dist'), fs.readFileSync(path.join(root, 'marketing-site/public/404.html'), 'utf8'));
}
