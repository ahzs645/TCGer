import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlan } from '../prototype/publish.mjs';

test('prototype publication verifies bytes and rejects unsafe paths and public bucket targets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tcger-prototype-test-'));
  try {
    const data = Buffer.from('opaque test artifact');
    const sha256 = createHash('sha256').update(data).digest('hex');
    const file = `database-${sha256}.sqlite.gz`;
    const manifest = { schema: 'tcger-pricing-prototype-v1', prototype: true, snapshotId: sha256,
      assets: [{ kind: 'database', file, sha256, bytes: data.length }] };
    const save = () => writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(directory, file), data); await save();
    assert.equal((await loadPlan(directory, 'tcger-pricing-prototype')).objects.at(-1).key, 'manifest.json');
    await assert.rejects(loadPlan(directory, 'tcger-assets'), /dedicated/);
    await writeFile(join(directory, file), 'tampered');
    await assert.rejects(loadPlan(directory, 'tcger-pricing-prototype'), /checksum mismatch/);
    manifest.assets[0].file = '../outside.sqlite.gz'; await save();
    await assert.rejects(loadPlan(directory, 'tcger-pricing-prototype'), /filename/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
