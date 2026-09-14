import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lookupKey, validateSnapshot } from '../src/contracts.mjs';

const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;

export function buildImport(snapshot, now = Date.now()) {
  const quotes = validateSnapshot(snapshot, now);
  const normalized = JSON.stringify({ schema: 'tcger-hosted-prices-v1', quotes });
  const id = createHash('sha256').update(normalized).digest('hex');
  const stage = [
    `INSERT OR IGNORE INTO price_batches (id, imported_at, quote_count) VALUES (${sqlString(id)}, ${sqlString(new Date(now).toISOString())}, ${quotes.length});`,
  ];
  for (let start = 0; start < quotes.length; start += 20) {
    stage.push(`INSERT OR IGNORE INTO price_quotes (batch_id, lookup_key, source, currency, payload) VALUES ${quotes.slice(start, start + 20).map(quote =>
      `(${[id, lookupKey(quote), quote.source, quote.currency, JSON.stringify(quote)].map(sqlString).join(',')})`).join(',')};`);
  }
  // A partial upload cannot replace the active batch. Failed imports can be
  // retried with the same content hash without duplicating observations.
  const activate = `INSERT INTO active_price_batch (singleton, batch_id)
    SELECT 1, id FROM price_batches WHERE id = ${sqlString(id)}
      AND quote_count = (SELECT COUNT(*) FROM price_quotes WHERE batch_id = ${sqlString(id)})
    ON CONFLICT(singleton) DO UPDATE SET batch_id = excluded.batch_id;`;
  return { id, count: quotes.length, normalized, stage: stage.join('\n'), activate };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file || args.slice(1).some(arg => !['--local', '--remote'].includes(arg)) || args.length > 2) {
    throw new Error('Usage: npm run import -- snapshot.json [--local|--remote]. Without a flag, validates only.');
  }
  const result = buildImport(JSON.parse(await readFile(file, 'utf8')));
  console.log(`Validated ${result.count} quotes; snapshot ${result.id}`);
  if (!args[1]) return;
  const directory = await mkdtemp(join(tmpdir(), 'tcger-prices-'));
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const wrangler = join(dirname(fileURLToPath(import.meta.resolve('wrangler/package.json'))), 'bin/wrangler.js');
  try {
    for (const [name, sql] of [['stage', result.stage], ['activate', result.activate]]) {
      const path = join(directory, `${name}.sql`);
      await writeFile(path, sql);
      const command = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'tcger-pricing', args[1], '--file', path, '--yes'], {
        cwd, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      });
      if (command.error || command.status !== 0) throw new Error(`D1 ${name} failed; active batch has not been intentionally advanced past a failed stage`);
    }
    console.log(`Activated ${result.id}. Retain this source snapshot for rollback.`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
