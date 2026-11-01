#!/usr/bin/env node
// Local development only. Deployment environment is separate from the CLI's
// process environment; initialize it before the application becomes ready.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const markerName = '.convex/tcger-dev-ready.json';
const selectionKeys = ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT_TOKEN', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY'];
const providerKeys = [
  'SCRYFALL_API_BASE_URL', 'YGO_API_BASE_URL', 'POKEMON_API_BASE_URL', 'TCGDEX_API_BASE_URL',
  'JUSTTCG_API_BASE_URL', 'JUSTTCG_API_KEY', 'SCRYDEX_API_KEY', 'SCRYDEX_TEAM_ID',
  'POKEWALLET_API_KEY', 'POKEWALLET_PROXY_SECRET', 'POKEWALLET_API_BASE_URL',
  'PRICE_USD_TO_EUR', 'PRICE_FX_SOURCE', 'PRICE_FX_AS_OF', 'TCGCSV_API_BASE_URL',
  'TCGCSV_MIN_INTERVAL_MS', 'PROVIDER_MAX_RETRIES', 'SCRYFALL_MIN_INTERVAL_MS',
  'PSA_API_BASE_URL', 'PSA_API_TOKEN', 'PSA_MIN_INTERVAL_MS',
  'POKEMON_PRICE_TRACKER_API_BASE_URL', 'POKEMON_PRICE_TRACKER_API_KEY',
  'POKEMON_PRICE_TRACKER_LICENSE_ACK', 'POKEMON_PRICE_TRACKER_MIN_INTERVAL_MS',
  'EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_MARKETPLACE_ID', 'EBAY_USE_SANDBOX',
  'PRICE_REFRESH_INTERVAL_MS', 'PRICE_FORCE_REFRESH_COOLDOWN_MS',
];

function readSources(cwd, environment) {
  return ['.env', '.env.local'].map(name => {
    const path = resolve(cwd, name);
    return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
  }).concat(environment);
}

export function readConfiguration(cwd, environment = process.env) {
  const sources = readSources(cwd, environment);
  const env = Object.assign({}, ...sources);
  const target = env.TCGER_CONVEX_DEV_TARGET;
  if (target !== 'anonymous' && target !== 'local') {
    throw new Error('Set TCGER_CONVEX_DEV_TARGET=anonymous to create/reuse an anonymous local deployment, or local to reuse an already selected local deployment.');
  }
  for (const source of sources) {
    for (const key of selectionKeys) {
      if (source[key]?.trim()) throw new Error(`${key} selects another deployment. Unset it or use a separate checkout; local bootstrap leaves the selection unchanged.`);
    }
    const selected = source.CONVEX_DEPLOYMENT?.trim();
    if (selected && !new RegExp(`^${target}:${target}-[A-Za-z0-9_-]+$`).test(selected)) {
      throw new Error('The existing CONVEX_DEPLOYMENT is not the requested local target. Select the intended local deployment yourself or use a separate checkout; bootstrap will not replace it.');
    }
    if (selected && env.CONVEX_DEPLOYMENT?.trim() !== selected) {
      throw new Error('Conflicting CONVEX_DEPLOYMENT selections. Resolve them explicitly before local startup.');
    }
  }
  if (target === 'local' && !env.CONVEX_DEPLOYMENT?.trim()) {
    throw new Error('Local mode requires an existing local CONVEX_DEPLOYMENT selection. Select it with the Convex CLI first.');
  }
  let configPath = resolve(cwd, '.convex/local/default/config.json');
  const selectedName = env.CONVEX_DEPLOYMENT?.trim().slice(target.length + 1);
  if (!existsSync(configPath) && selectedName) {
    const legacyPath = resolve(homedir(), '.convex', target === 'anonymous' ? 'anonymous-convex-backend-state' : 'convex-backend-state', selectedName, 'config.json');
    if (existsSync(legacyPath)) configPath = legacyPath;
    else throw new Error('The selected local deployment data is unavailable. Preserve or mount its existing .convex state, or use a separate fresh checkout; bootstrap will not create a replacement database.');
  }
  if (!existsSync(configPath) && existsSync(resolve(cwd, '.convex/local/default/convex_local_backend.sqlite3'))) {
    throw new Error('Local database exists without its deployment configuration. Restore that configuration before startup; bootstrap will not reset the database.');
  }
  if (existsSync(configPath)) {
    let state;
    try { state = JSON.parse(readFileSync(configPath, 'utf8')); }
    catch { throw new Error('Existing local deployment configuration could not be read. Restore it before startup.'); }
    const stateName = state.deploymentName ?? selectedName; // Older CLI state stores the name in its directory.
    if (!stateName?.startsWith(`${target}-`) || (selectedName && selectedName !== stateName)) {
      throw new Error('Existing local database state belongs to another deployment. Bootstrap will not replace or reset it.');
    }
  }
  const values = {};
  for (const key of ['BETTER_AUTH_SECRET', 'TCGER_BRIDGE_SECRET']) {
    const value = env[key];
    if (!value || value.trim() !== value || value.length < 32 || /[\r\n\0]/.test(value)) {
      throw new Error(`${key} must be supplied as at least 32 characters without surrounding whitespace or line breaks.`);
    }
    values[key] = value;
  }
  values.SITE_URL = env.SITE_URL || 'http://localhost:3000';
  values.BETTER_AUTH_URL = env.BETTER_AUTH_URL || `${values.SITE_URL.replace(/\/$/, '')}/api/auth`;
  values.BETTER_AUTH_TRUSTED_ORIGINS = env.BETTER_AUTH_TRUSTED_ORIGINS || values.SITE_URL;
  for (const key of ['SITE_URL', 'BETTER_AUTH_URL']) {
    let url;
    try { url = new URL(values[key]); } catch { throw new Error(`${key} must be an absolute HTTP(S) URL.`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`${key} must be an absolute HTTP(S) URL without credentials.`);
  }
  for (const key of ['BETTER_AUTH_DISABLE_ORIGIN_CHECK', 'BETTER_AUTH_USE_SECURE_COOKIES']) {
    values[key] = env[key] || (key === 'BETTER_AUTH_USE_SECURE_COOKIES' && values.SITE_URL.startsWith('https:') ? 'true' : 'false');
    if (!['true', 'false'].includes(values[key])) throw new Error(`${key} must be true or false.`);
  }
  for (const key of providerKeys) if (env[key] !== undefined) values[key] = env[key];
  return { env, values, target };
}

// Values travel over stdin, never argv or a generated file. Use a delimiter
// absent from each value so dotenv (used by the locked Convex CLI) round-trips it.
export function serializeEnvironment(values) {
  return Object.entries(values).map(([name, value]) => {
    if (/[\r\n\0]/.test(value)) throw new Error(`${name} must not contain line breaks or NUL characters.`);
    const quote = ["'", '`', '"'].find(delimiter => !value.includes(delimiter) && !(delimiter === '"' && /\\[nr]/.test(value)));
    if (!quote) throw new Error(`${name} contains incompatible dotenv quote delimiters; use a base64 or hexadecimal credential.`);
    return `${name}=${quote}${value}${quote}\n`;
  }).join('');
}

export function redactOutput(text, values) {
  return Object.values(values).filter(value => value.length >= 8).sort((a, b) => b.length - a.length)
    .reduce((result, value) => result.replaceAll(value, '[configured value]'), text);
}

async function checkBridge(cwd, env) {
  const loaded = Object.assign({}, ...readSources(cwd, env));
  let origin;
  try { origin = new URL(loaded.CONVEX_SITE_URL); } catch { throw new Error('Local deployment has not written CONVEX_SITE_URL yet.'); }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.protocol !== 'http:' || origin.username || origin.password) {
    throw new Error('Readiness may only probe the selected local HTTP deployment.');
  }
  const response = await fetch(new URL('/setup/setup-required', origin), {
    headers: { 'x-tcger-bridge-key': loaded.TCGER_BRIDGE_SECRET },
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || typeof (await response.json()).setupRequired !== 'boolean') {
    throw new Error('Configured Convex bridge is not ready; deployment environment initialization must succeed first.');
  }
  return origin.origin;
}

async function readiness(cwd, markReady) {
  const path = resolve(cwd, markerName);
  if (!markReady) {
    const marker = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isInteger(marker.pid) || marker.pid < 1) throw new Error('Invalid development readiness marker.');
    process.kill(marker.pid, 0);
  }
  const origin = await checkBridge(cwd, process.env);
  if (markReady) {
    const pid = Number(process.env.TCGER_CONVEX_DEV_PID);
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Readiness must run under the development bootstrap.');
    process.kill(pid, 0);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ pid, origin }), { mode: 0o600 });
    console.log('[convex-dev] Deployment settings applied and authenticated bridge ready.');
  }
}

export async function startDevelopment(cwd = process.cwd(), environment = process.env) {
  const configuration = readConfiguration(cwd, environment);
  const payload = serializeEnvironment(configuration.values);
  const markerPath = resolve(cwd, markerName);
  rmSync(markerPath, { force: true });
  const require = createRequire(resolve(cwd, 'package.json'));
  const cli = resolve(dirname(require.resolve('convex/package.json')), 'bin/main.js');
  const childEnv = { ...configuration.env, ...configuration.values, TCGER_CONVEX_DEV_PID: String(process.pid) };
  if (configuration.target === 'anonymous') childEnv.CONVEX_AGENT_MODE = 'anonymous';
  else delete childEnv.CONVEX_AGENT_MODE;
  // The local backend requires TZ to be unset, even when the inherited value is UTC.
  delete childEnv.TZ;
  let child;
  let stopping = false;
  const stop = () => {
    stopping = true;
    rmSync(markerPath, { force: true });
    child?.kill('SIGINT');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const run = (args, stdin = '', quiet = false) => new Promise((resolveRun, reject) => {
    if (stopping) return resolveRun();
    let output = '';
    child = spawn(process.execPath, [cli, ...args], { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream, crlfDelay: Infinity }).on('line', line => {
        const safe = redactOutput(line, configuration.values);
        if (quiet) output = `${output}${safe}\n`.slice(-20000);
        else process.stdout.write(`${safe}\n`);
      });
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = undefined;
      if (!stopping && (code !== 0 || signal)) {
        if (quiet) process.stderr.write(output);
        reject(new Error(`Local Convex ${args[0]} failed (${signal ?? code}).`));
      } else resolveRun();
    });
    child.stdin.on('error', () => {}); // A failed CLI may close stdin before reading it.
    child.stdin.end(stdin);
  });
  try {
    console.log('[convex-dev] Preparing the selected local deployment; application is not ready yet.');
    await run(['dev', '--once', '--typecheck', 'disable', '--tail-logs', 'disable'], '', true);
    if (stopping) return;
    // Revalidate the generated selection before modifying deployment settings.
    const initialized = readConfiguration(cwd, environment);
    childEnv.CONVEX_DEPLOYMENT = initialized.env.CONVEX_DEPLOYMENT;
    childEnv.CONVEX_SITE_URL = initialized.env.CONVEX_SITE_URL;
    childEnv.CONVEX_URL = initialized.env.CONVEX_URL;
    console.log('[convex-dev] Applying declared deployment settings (values withheld).');
    await run(['env', 'set', '--force'], payload, true);
    if (stopping) return;
    console.log('[convex-dev] Starting the configured local watcher.');
    await run(['dev', '--typecheck', 'enable', '--tail-logs', 'disable', '--start', 'node ../tools/dev/convex-dev.mjs --ready']);
  } finally {
    rmSync(markerPath, { force: true });
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv[2];
  const action = flag === '--ready' || flag === '--health'
    ? readiness(process.cwd(), flag === '--ready')
    : flag ? Promise.reject(new Error('Unknown option. Use no arguments, --ready, or --health.')) : startDevelopment();
  action.catch(error => {
    // Never include configuration values or subprocess argument/environment dumps.
    console.error(`[convex-dev] ${error.message}`);
    process.exitCode = 1;
  });
}
