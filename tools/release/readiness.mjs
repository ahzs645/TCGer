import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appAssociations, associationEnvironment } from '../../frontend/src/lib/app-associations.mjs';
import { loadApkSigning, signingEnvironment } from './apk-signing.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function configurationChecks(env) {
  let associations;
  try { associations = appAssociations(env); }
  catch (error) { return [{ id: 'associations.configuration', status: 'failed', detail: error.message }]; }
  return [
    { id: 'android.signing.configuration', status: ['STORE_FILE', 'STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD'].every(name => env[`TCGER_RELEASE_${name}`]?.trim()) && fs.existsSync(env.TCGER_RELEASE_STORE_FILE) ? 'passed' : 'pending', detail: 'A real keystore and all four environment signing settings are required; credentials are never included in reports.' },
    { id: 'android.association.identity', status: associations.android.length ? 'passed' : 'pending', detail: 'TCGER_ANDROID_CERT_SHA256 must identify the direct-install APK signing certificate.' },
    { id: 'ios.association.identity', status: associations.ios.applinks.details.length ? 'passed' : 'pending', detail: 'TCGER_IOS_APP_ID must match the signed application-identifier entitlement.' },
  ];
}

export function deviceEvidenceValid(record, platform, revision, artifactHash, now = Date.now()) {
  return record?.platform === platform && record.revision === revision && record.artifactSha256 === artifactHash &&
    typeof record.device === 'string' && !!record.device.trim() && typeof record.os === 'string' && !!record.os.trim() &&
    Number.isFinite(Date.parse(record.checkedAt)) && Date.parse(record.checkedAt) <= now + 60000 && now - Date.parse(record.checkedAt) < 30 * 86400000 &&
    ['authenticationSuccess', 'authenticationCancel', 'authenticationUnavailable', 'backgroundPrivacy', 'coldAppLink', 'warmAppLink', 'camera'].every(key => record.checks?.[key] === true);
}

export function webEvidenceValid(record, revision, baseURL, now = Date.now()) {
  return record?.platform === 'web' && record.revision === revision && record.baseURL === baseURL &&
    typeof record.browser === 'string' && !!record.browser.trim() &&
    Number.isFinite(Date.parse(record.checkedAt)) && Date.parse(record.checkedAt) <= now + 60000 && now - Date.parse(record.checkedAt) < 30 * 86400000 &&
    ['installation', 'offlineLaunch', 'serviceWorkerUpdate'].every(key => record.checks?.[key] === true);
}

export async function hostedChecks(baseURL, env, fetcher = fetch) {
  if (!baseURL) return [{ id: 'web.hosted', status: 'pending', detail: 'Supply --base-url for a deployed HTTPS application.' }];
  const origin = new URL(baseURL);
  if (origin.protocol !== 'https:' || origin.hostname !== 'tcger.ahmadjalil.com' || origin.username || origin.password || origin.port) throw new Error('Hosted checks require the configured HTTPS app-link origin.');
  const expected = appAssociations(env);
  const checks = [];
  for (const [pathname, identity] of [['/.well-known/assetlinks.json', expected.android], ['/.well-known/apple-app-site-association', expected.ios]]) {
    try {
      const response = await fetcher(new URL(pathname, origin), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      const data = response.ok ? await response.json() : null;
      const configured = pathname.includes('assetlinks') ? expected.android.length > 0 : expected.ios.applinks.details.length > 0;
      checks.push({ id: pathname, status: configured && response.status === 200 && response.headers.get('content-type')?.includes('application/json') && JSON.stringify(data) === JSON.stringify(identity) ? 'passed' : 'pending', detail: `HTTP ${response.status}; Content-Type ${response.headers.get('content-type') ?? 'missing'}; must serve the configured public identities as application/json without a redirect.` });
    } catch (error) { checks.push({ id: pathname, status: 'failed', detail: error.message }); }
  }
  for (const pathname of ['/manifest.webmanifest', '/sw.js']) {
    try {
      const response = await fetcher(new URL(pathname, origin), { signal: AbortSignal.timeout(15000) });
      const text = await response.text();
      const valid = pathname.endsWith('webmanifest') ? (() => { const m = JSON.parse(text); return m.start_url && m.display && m.icons?.some(icon => icon.sizes?.includes('512x512')); })() : text.includes('addEventListener') && !text.includes('<!DOCTYPE');
      checks.push({ id: pathname, status: response.ok && valid ? 'passed' : 'failed', detail: `HTTP ${response.status}; deployed PWA asset check.` });
    } catch (error) { checks.push({ id: pathname, status: 'failed', detail: error.message }); }
  }
  for (const pathname of ['/search?q=Pikachu', '/binder/release-link-test', '/wishlist/release-link-test']) {
    try {
    const response = await fetcher(new URL(pathname, origin), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const expectedPath = pathname.startsWith('/search') ? '/cards' : pathname.startsWith('/binder') ? '/collections' : '/wishlists';
    const location = response.headers.get('location');
    checks.push({ id: `web.fallback:${pathname}`, status: [307, 308].includes(response.status) && location && new URL(location, origin).pathname === expectedPath ? 'passed' : 'failed', detail: `HTTP ${response.status}; expected canonical ${expectedPath} fallback.` });
    } catch (error) { checks.push({ id: `web.fallback:${pathname}`, status: 'failed', detail: error.message }); }
  }
  // Browser installation/update is an executed journey, not an HTTP asset assertion.
  return checks;
}

async function main() {
  const arg = name => { const index = process.argv.indexOf(name); return index === -1 ? null : process.argv[index + 1]; };
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const environment = { ...signingEnvironment(loadApkSigning()), ...associationEnvironment() };
  const checks = configurationChecks(environment);
  checks.push({ id: 'source.committed', status: execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim() ? 'pending' : 'passed', detail: 'Commit source before collecting artifact-bound release evidence.' });
  checks.push(...await hostedChecks(arg('--base-url'), environment));
  const evidencePath = arg('--device-evidence');
  const evidence = evidencePath ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : [];
  const webProven = checks.filter(check => check.id.startsWith('web.') || check.id.startsWith('/')).every(check => check.status === 'passed') &&
    evidence.some(record => webEvidenceValid(record, revision, arg('--base-url')));
  checks.push({ id: 'web.install-update', status: webProven ? 'passed' : 'pending', detail: 'Require current deployed-revision browser evidence for installation, offline launch and service-worker update.' });
  for (const platform of ['android', 'ios']) {
    const artifact = arg(platform === 'android' ? '--android-apk' : '--ios-ipa');
    let signed = false;
    if (artifact && fs.existsSync(artifact)) {
      try {
        if (platform === 'android') {
          const sdk = environment.ANDROID_HOME || environment.ANDROID_SDK_ROOT;
          if (!sdk) throw new Error('Configure ANDROID_HOME for APK verification');
          const versions = fs.readdirSync(path.join(sdk, 'build-tools')).sort((a,b) => b.localeCompare(a, undefined, { numeric: true }));
          const signer = path.join(sdk, 'build-tools', versions[0], 'apksigner');
          const output = execFileSync(signer, ['verify', '--print-certs', artifact], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          const digest = /certificate SHA-256 digest:\s*([0-9a-f]+)/i.exec(output)?.[1]?.toUpperCase();
          const expected = environment.TCGER_ANDROID_CERT_SHA256?.split(',').map(x => x.replaceAll(':', '').trim().toUpperCase());
          signed = !!digest && expected?.includes(digest) && !/Android Debug/i.test(output);
        } else {
          const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tcger-release-ipa-'));
          try {
            execFileSync('unzip', ['-q', artifact, '-d', temporary]);
            const apps = fs.readdirSync(path.join(temporary, 'Payload')).filter(name => name.endsWith('.app'));
            if (apps.length !== 1) throw new Error('Expected exactly one application');
            const app = path.join(temporary, 'Payload', apps[0]);
            execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
            const entitlements = execFileSync('codesign', ['-d', '--entitlements', ':-', app], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            signed = !!environment.TCGER_IOS_APP_ID && entitlements.includes(`<string>${environment.TCGER_IOS_APP_ID}</string>`) && !/<key>get-task-allow<\/key>\s*<true\s*\/>/.test(entitlements);
          } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
        }
      } catch { signed = false; }
    }
    checks.push({ id: `${platform}.signed-artifact`, status: signed ? 'passed' : artifact ? 'failed' : 'pending', detail: 'Verify an actual signed distribution artifact; unsigned compiler checks do not satisfy this gate.' });
    const proven = signed && evidence.some(record => deviceEvidenceValid(record, platform, revision, sha(artifact)));
    checks.push({ id: `${platform}.physical-device`, status: proven ? 'passed' : 'pending', detail: 'Require current-commit, artifact-bound device evidence for authentication, privacy, cold/warm links and camera.' });
  }
  const directory = path.join(root, 'mobile-parity/results/release');
  fs.mkdirSync(directory, { recursive: true });
  const report = { revision, checkedAt: new Date().toISOString(), checks, ready: checks.every(check => check.status === 'passed') };
  fs.writeFileSync(path.join(directory, 'readiness.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(checks.map(check => `${check.status.toUpperCase()} ${check.id}: ${check.detail}`).join('\n'));
  if (!report.ready && !process.argv.includes('--allow-pending')) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
