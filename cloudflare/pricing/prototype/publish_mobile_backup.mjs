import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const wrangler = join(dirname(fileURLToPath(import.meta.resolve('wrangler/package.json'))), 'bin/wrangler.js');
const base = 'https://assets.tcger.ahmadjalil.com/prices/pokemon/';
export async function plan(directory) {
  const manifestBytes = await readFile(join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== 'tcger-pokemon-prices-backup-v1' || !Number.isFinite(Date.parse(manifest.sourceAsOf)) || !manifest.groups.length) throw Error('Invalid manifest');
  const objects = [];
  for (const [id, asset] of Object.entries(manifest.sets)) {
    if (!/^\d+$/.test(id) || !/^[a-f0-9]{64}$/.test(asset.sha256) || asset.file !== `objects/${asset.sha256}.json`) throw Error('Invalid shard');
    const bytes = await readFile(join(directory, asset.file));
    if (hash(bytes) !== asset.sha256 || bytes.length !== asset.bytes || bytes.length > 8_000_000) throw Error('Invalid checksum/size');
    const group = JSON.parse(bytes);
    if (group.groupId !== Number(id) || group.sourceAsOf !== manifest.sourceAsOf) throw Error('Mismatched group');
    objects.push(asset);
  }
  if (objects.length !== manifest.groups.length) throw Error('Incomplete groups');
  return { objects, manifest: { file: 'manifest.json', sha256: hash(manifestBytes), bytes: manifestBytes.length } };
}
async function publish(directory) {
  const { objects, manifest } = await plan(directory);
  async function put(asset, immutable) {
    const args = ['r2', 'object', 'put', `tcger-assets/prices/pokemon/${asset.file}`, '--file', join(directory, asset.file), '--content-type', 'application/json', '--cache-control', immutable ? 'public,max-age=31536000,immutable' : 'public,max-age=300', '--remote', '--force'];
    await exec(process.execPath, [wrangler, ...args], { env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, timeout: 120000 });
    // Verify through the exact delivery path used by phones before publishing the pointer.
    const response = await fetch(base + asset.file + (immutable ? '' : `?verify=${asset.sha256}`));
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok || bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) throw Error(`Remote verification failed: ${asset.file}`);
  }
  const queue = [...objects];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await put(queue.shift(), true); }));
  await put(manifest, false);
  console.log(`Published and verified ${objects.length} sets and manifest at ${base}manifest.json`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2]);
  (process.argv[3] === '--publish' ? publish(directory) : plan(directory).then(p => console.log(`${p.objects.length} validated shards`))).catch(e => { console.error(e.message); process.exitCode = 1; });
}
