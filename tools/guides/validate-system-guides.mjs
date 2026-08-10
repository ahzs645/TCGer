import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const catalogDirectory = resolve(repo, 'data/catalog');
const guideCatalog = JSON.parse(await readFile(resolve(repo, 'data/system-guides.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(catalogDirectory, 'manifest.json'), 'utf8'));
const errors = [];
const packs = new Map();

for (const [game, entry] of Object.entries(manifest.games ?? {})) {
  if (!entry?.file) continue;
  const pack = JSON.parse(await readFile(resolve(catalogDirectory, entry.file), 'utf8'));
  packs.set(game, pack);
  const uniqueIds = new Set(pack.cards.map((card) => card.id));
  if (uniqueIds.size !== pack.cards.length) {
    errors.push(`${game} has ${pack.cards.length - uniqueIds.size} duplicate card IDs`);
  }
  const missingTags = pack.cards.filter((card) => !Array.isArray(card.collectionTags)).length;
  if (missingTags) errors.push(`${game} has ${missingTags} cards without collection tags`);
}

const seenSlugs = new Set();
const counts = [];
for (const guide of guideCatalog.guides) {
  if (seenSlugs.has(guide.slug)) errors.push(`duplicate guide slug: ${guide.slug}`);
  seenSlugs.add(guide.slug);
  const pack = packs.get(guide.tcg);
  if (!pack) {
    counts.push({ slug: guide.slug, status: 'catalog-unavailable' });
    continue;
  }
  let count = guide.cardCountHint ?? 0;
  if (guide.ruleType === 'tag') {
    count = pack.cards.filter((card) =>
      (card.collectionTags ?? []).includes(guide.ruleQuery),
    ).length;
  } else if (guide.ruleType === 'name') {
    count = pack.cards.filter((card) =>
      card.name.toLowerCase() === guide.ruleQuery.toLowerCase(),
    ).length;
  }
  counts.push({ slug: guide.slug, count });
  if (count === 0) errors.push(`${guide.slug} has no matching cards`);
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    guides: counts.length,
    available: counts.filter((row) => row.status !== 'catalog-unavailable').length,
    catalogUnavailable: counts.filter((row) => row.status === 'catalog-unavailable').length,
    cards: Object.fromEntries([...packs].map(([game, pack]) => [game, pack.cards.length])),
  }, null, 2));
}
