import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { parseEnv } from 'node:util';
import { readConfiguration, redactOutput, serializeEnvironment } from './convex-dev.mjs';

const environment = {
  TCGER_CONVEX_DEV_TARGET: 'anonymous',
  BETTER_AUTH_SECRET: 'custom-auth-secret-with-32-characters-for-testing',
  TCGER_BRIDGE_SECRET: 'custom-bridge-secret-with-32-characters-for-testing',
  SITE_URL: 'http://localhost:3003',
};
const fixture = t => {
  const cwd = mkdtempSync(resolve(tmpdir(), 'tcger-dev-guard-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
};

test('explicit local target required; cloud selection is preserved even with an environment override', t => {
  const cwd = fixture(t);
  assert.throws(() => readConfiguration(cwd, {}), /TCGER_CONVEX_DEV_TARGET/);
  const selected = 'CONVEX_DEPLOYMENT=dev:existing-cloud\n';
  writeFileSync(resolve(cwd, '.env.local'), selected);
  assert.throws(() => readConfiguration(cwd, { ...environment, CONVEX_DEPLOYMENT: 'anonymous:anonymous-agent' }), /existing CONVEX_DEPLOYMENT/);
  assert.equal(readFileSync(resolve(cwd, '.env.local'), 'utf8'), selected);
});

test('deploy keys and self-hosted selectors cannot leak into the local initializer', t => {
  const cwd = fixture(t);
  for (const key of ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT_TOKEN', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY']) {
    assert.throws(() => readConfiguration(cwd, { ...environment, [key]: 'not-for-local' }), new RegExp(key));
  }
});

test('anonymous restart preserves selected deployment and existing database state', t => {
  const cwd = fixture(t);
  writeFileSync(resolve(cwd, '.env.local'), 'CONVEX_DEPLOYMENT=anonymous:anonymous-existing\n');
  mkdirSync(resolve(cwd, '.convex/local/default'), { recursive: true });
  const original = JSON.stringify({ deploymentName: 'anonymous-existing', adminKey: 'private-local-key' });
  writeFileSync(resolve(cwd, '.convex/local/default/config.json'), original);
  const configuration = readConfiguration(cwd, environment);
  assert.equal(configuration.env.CONVEX_DEPLOYMENT, 'anonymous:anonymous-existing');
  assert.equal(readFileSync(resolve(cwd, '.convex/local/default/config.json'), 'utf8'), original);
  assert.throws(() => readConfiguration(cwd, { ...environment, CONVEX_DEPLOYMENT: 'anonymous:anonymous-another' }), /Conflicting/);
});

test('an unselected linked local database is never converted into an anonymous deployment', t => {
  const cwd = fixture(t);
  mkdirSync(resolve(cwd, '.convex/local/default'), { recursive: true });
  writeFileSync(resolve(cwd, '.convex/local/default/config.json'), JSON.stringify({ deploymentName: 'local-team-project' }));
  assert.throws(() => readConfiguration(cwd, environment), /another deployment/);
  assert.throws(() => readConfiguration(cwd, { ...environment, TCGER_CONVEX_DEV_TARGET: 'local' }), /existing local/);
  writeFileSync(resolve(cwd, '.env.local'), 'CONVEX_DEPLOYMENT=local:local-team-project\n');
  assert.equal(readConfiguration(cwd, { ...environment, TCGER_CONVEX_DEV_TARGET: 'local' }).target, 'local');
});

test('a persisted deployment selection without its database cannot silently create a replacement', t => {
  const cwd = fixture(t);
  const selected = 'CONVEX_DEPLOYMENT=anonymous:anonymous-missing-data-fixture\n';
  writeFileSync(resolve(cwd, '.env.local'), selected);
  assert.throws(() => readConfiguration(cwd, environment), /deployment data is unavailable/);
  assert.equal(readFileSync(resolve(cwd, '.env.local'), 'utf8'), selected);
});

test('declared settings round-trip through stdin with quoted secrets and no unrelated variables', t => {
  const cwd = fixture(t);
  const values = readConfiguration(cwd, {
    ...environment, JUSTTCG_API_KEY: "quote'and#comment$()with\\n-preserved", UNRELATED_SECRET: 'leave-private',
  }).values;
  assert.deepEqual(parseEnv(serializeEnvironment(values)), values);
  assert.equal(values.BETTER_AUTH_URL, 'http://localhost:3003/api/auth');
  assert.equal(values.BETTER_AUTH_TRUSTED_ORIGINS, 'http://localhost:3003');
  assert.equal(values.BETTER_AUTH_DISABLE_ORIGIN_CHECK, 'false');
  assert.equal(values.UNRELATED_SECRET, undefined);
  for (const secret of [values.BETTER_AUTH_SECRET, values.TCGER_BRIDGE_SECRET, values.JUSTTCG_API_KEY]) {
    assert.equal(redactOutput(`unexpected CLI text ${secret}`, values).includes(secret), false);
  }
  assert.throws(() => serializeEnvironment({ SOME_VALUE: 'line\nbreak' }), /line breaks/);
});
