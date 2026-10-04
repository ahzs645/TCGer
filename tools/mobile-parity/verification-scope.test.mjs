import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beginEvidence, completeEvidence } from './evidence.mjs';
import { requiredScope } from './verification-scope.mjs';
test('full verification remains the default and CI subsets must be explicit and valid', () => {
  const allowed = ['web', 'ios', 'android'];
  assert.deepEqual(requiredScope([], '--require-platforms', allowed), allowed);
  assert.deepEqual(requiredScope(['--require-platforms', 'web,android'], '--require-platforms', allowed), ['web', 'android']);
  for (const value of [undefined, '', 'web,', 'web,web', 'unknown', '--require-pass']) {
    assert.throws(() => requiredScope(['--require-platforms', value], '--require-platforms', allowed));
  }
});
test('UI CLI subset passes fresh Linux results without marking iOS verified; full/failed/stale gates fail', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcger-scope-report-'));
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'mobile-parity/features.json'), 'utf8'));
    const ids = manifest.features.filter(feature => feature.policy === 'parity').map(feature => feature.id);
    const write = (platform, failure = false) => {
      const file = path.join(directory, `${platform}.xml`);
      beginEvidence(file, platform);
      fs.writeFileSync(file, `<testsuite>${ids.map((id, index) => `<testcase name="[${id}] fixture">${failure && index === 0 ? '<failure/>' : ''}</testcase>`).join('')}</testsuite>`);
      completeEvidence(file, platform);
    };
    write('web'); write('android');
    const args = ['tools/mobile-parity/parity.mjs', 'report', '--output', path.join(directory, 'REPORT.md'), '--web-results', path.join(directory, 'web.xml'), '--android-results', path.join(directory, 'android.xml')];
    const run = flags => spawnSync(process.execPath, [...args, ...flags], { cwd: root, encoding: 'utf8' });
    assert.equal(run(['--require-platforms', 'web,android']).status, 0);
    const markdown = fs.readFileSync(path.join(directory, 'REPORT.md'), 'utf8');
    assert.match(markdown, /does not establish three-platform parity/);
    assert.doesNotMatch(markdown, /\| Verified \|/);
    assert.equal(run(['--require-pass']).status, 1);
    assert.equal(run(['--require-pass', '--require-platforms', 'web,android']).status, 1);
    write('android', true);
    assert.equal(run(['--require-platforms', 'web,android']).status, 1);
    write('android');
    const evidenceFile = path.join(directory, 'android.xml.evidence.json');
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
    evidence.revision = 'old'; fs.writeFileSync(evidenceFile, JSON.stringify(evidence));
    assert.equal(run(['--require-platforms', 'web,android']).status, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
