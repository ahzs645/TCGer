import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const root = fileURLToPath(new URL('../../', import.meta.url));
test('GitHub workflows have no macOS or iOS execution path', () => {
  for (const name of fs.readdirSync(path.join(root, '.github/workflows')).filter(name => /\.ya?ml$/.test(name))) {
    const source = fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8');
    assert.doesNotMatch(source, /\bmacos\b|\bxcodebuild\b|npm run (?:parity:ios|api-contracts:ios|verify:ios:local)\b/i, name);
  }
});
test('iOS execution entrypoints reject GitHub Actions', () => {
  for (const [binary, args] of [['bash', ['mobile-parity/verify-ios-local.sh']], ['bash', ['mobile-parity/run.sh', 'ios']], [process.execPath, ['tools/api-contracts/run.mjs', 'ios']]]) {
    const result = spawnSync(binary, args, { cwd: root, env: { ...process.env, GITHUB_ACTIONS: 'true' }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /locally only/);
  }
});
test('local API/regression failure stops Maestro and both runs use the same UUID/build directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcger-local-ios-policy-'));
  try {
    const log = path.join(directory, 'calls');
    fs.writeFileSync(path.join(directory, 'npm'), '#!/bin/sh\nprintf "%s|%s|%s|%s\\n" "$*" "$MAESTRO_DEVICE_ID" "$API_CONTRACT_IOS_DESTINATION" "$IOS_DERIVED_DATA" >> "$TCGER_TEST_LOG"\nif [ "$2" = "api-contracts:ios" ] && [ "$TCGER_TEST_FAIL_API" = "true" ]; then exit 1; fi\n', { mode: 0o755 });
    const env = { ...process.env, GITHUB_ACTIONS: 'false', PATH: `${directory}:${process.env.PATH}`, MAESTRO_DEVICE_ID: 'fixture-uuid', IOS_DERIVED_DATA: directory, TCGER_TEST_LOG: log };
    let result = spawnSync('bash', ['mobile-parity/verify-ios-local.sh'], { cwd: root, env: { ...env, TCGER_TEST_FAIL_API: 'true' } });
    assert.equal(result.status, 1);
    assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /run parity:ios/);
    fs.writeFileSync(log, '');
    result = spawnSync('bash', ['mobile-parity/verify-ios-local.sh'], { cwd: root, env });
    assert.equal(result.status, 0);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.match(calls[1], /run api-contracts:ios\|fixture-uuid\|platform=iOS Simulator,id=fixture-uuid/);
    assert.match(calls[2], /run parity:ios\|fixture-uuid\|platform=iOS Simulator,id=fixture-uuid/);
    assert.ok(calls.slice(1).every(call => call.endsWith(`|${directory}`)));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
