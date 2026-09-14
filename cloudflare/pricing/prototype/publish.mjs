import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const hash = data => createHash('sha256').update(data).digest('hex');
const wrangler = join(dirname(fileURLToPath(import.meta.resolve('wrangler/package.json'))), 'bin/wrangler.js');

async function command(args) {
  const result = await exec(process.execPath, [wrangler, ...args], {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, timeout: 120_000, maxBuffer: 2_000_000,
  });
  return result.stdout;
}

export async function loadPlan(directory, bucket) {
  if (!/^tcger-pricing-prototype(?:-[a-z0-9-]+)?$/.test(bucket)) {
    throw new Error('Use a dedicated tcger-pricing-prototype bucket, not the public assets bucket');
  }
  const contents = await readFile(join(directory, 'manifest.json'));
  const manifest = JSON.parse(contents);
  if (manifest.schema !== 'tcger-pricing-prototype-v1' || manifest.prototype !== true ||
      !/^[a-f0-9]{64}$/.test(manifest.snapshotId) || !Array.isArray(manifest.assets) ||
      manifest.assets.length < 1 || manifest.assets.length > 2 ||
      manifest.assets.filter(asset => asset.kind === 'database').length !== 1) {
    throw new Error('Invalid prototype manifest');
  }
  const seen = new Set();
  const plan = [];
  for (const asset of manifest.assets) {
    if (!/^(database|prices)-[a-f0-9]{64}\.(sqlite|json)\.gz$/.test(asset.file) || seen.has(asset.file)) {
      throw new Error('Invalid or repeated artifact filename');
    }
    seen.add(asset.file);
    const file = join(directory, asset.file);
    const bytes = await readFile(file);
    if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256 || bytes.length > 300_000_000) {
      throw new Error('Artifact size or checksum mismatch');
    }
    plan.push({ key: `objects/${asset.file}`, file, bytes: bytes.length, sha256: asset.sha256, contentType: 'application/gzip' });
  }
  plan.push({ key: 'manifest.json', file: join(directory, 'manifest.json'), bytes: contents.length,
    sha256: hash(contents), contentType: 'application/json' });
  return { bucket, snapshotId: manifest.snapshotId, objects: plan };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 3 || (args[2] && args[2] !== '--publish')) {
    throw new Error('Usage: node prototype/publish.mjs OUTPUT_DIR [BUCKET] [--publish]');
  }
  const plan = await loadPlan(resolve(args[0]), args[1] ?? 'tcger-pricing-prototype');
  console.log(JSON.stringify(plan, null, 2));
  if (args[2] !== '--publish') return;
  const temporary = await mkdtemp(join(tmpdir(), 'tcger-r2-verify-'));
  try {
    // A manifest is not published until all referenced objects have been
    // downloaded from R2 and verified. A failed upload leaves the old pointer.
    for (const object of plan.objects) {
      await command(['r2', 'object', 'put', `${plan.bucket}/${object.key}`, '--file', object.file,
        '--content-type', object.contentType, '--cache-control', 'private, no-store',
        '--storage-class', 'Standard', '--remote', '--force']);
      const downloaded = join(temporary, 'object');
      await command(['r2', 'object', 'get', `${plan.bucket}/${object.key}`, '--file', downloaded, '--remote']);
      const bytes = await readFile(downloaded);
      if (bytes.length !== object.bytes || hash(bytes) !== object.sha256) throw new Error(`Remote verification failed: ${object.key}`);
      console.log(`Verified r2://${plan.bucket}/${object.key} (${bytes.length} bytes)`);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
