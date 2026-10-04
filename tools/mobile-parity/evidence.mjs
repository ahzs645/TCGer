import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = data => createHash('sha256').update(data).digest('hex');
export function sourceIdentity() {
  const candidates = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', 'frontend', 'mobile-apps', 'backend', 'convex-backend', 'packages', 'mobile-parity', 'tools/mobile-parity', 'package.json', 'package-lock.json', '.github/workflows/mobile-parity.yml'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
  const files = [...new Set(candidates)].filter(file => /\.(swift|kt|kts|ts|tsx|mjs|cjs|js|sh|json|yaml|yml|pbxproj|xcconfig|plist|properties|xml)$/.test(file) && !/\/(results|build|node_modules|\.next|Resources|assets|public|test-results)\//.test(file));
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(file);
    hash.update(fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file)) : '<deleted>');
  }
  const fingerprint = hash.digest('hex');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  const runID = process.env.PARITY_RUN_ID ?? process.env.GITHUB_RUN_ID ?? `local:${revision}:${fingerprint}:${new Date().toISOString().slice(0, 10)}`;
  return {fingerprint, revision, runID};
}
export function validateEvidence(file, platform, identity = sourceIdentity(), now = Date.now()) {
  if (!file || !fs.existsSync(file)) return 'Not run';
  try {
    const evidence = JSON.parse(fs.readFileSync(file + '.evidence.json', 'utf8'));
    if (evidence.platform !== platform || evidence.schemaVersion !== 1) return 'Invalid evidence';
    if (evidence.fingerprint !== identity.fingerprint || evidence.revision !== identity.revision) return 'Stale source';
    if (evidence.runID !== identity.runID) return 'Different run';
    const started = Date.parse(evidence.startedAt), completed = Date.parse(evidence.completedAt);
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started || completed > now + 60000 || now - started > 86400000) return 'Expired evidence';
    if (evidence.xmlDigest !== digest(fs.readFileSync(file))) return 'Changed results';
    return null;
  } catch { return 'Unbound evidence'; }
}
export function beginEvidence(file, platform) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  for (const target of [file, file + '.evidence.json']) if (fs.existsSync(target)) fs.unlinkSync(target);
  fs.writeFileSync(file + '.pending.json', JSON.stringify({schemaVersion: 1, platform, ...sourceIdentity(), startedAt: new Date().toISOString()}));
}
export function completeEvidence(file, platform) {
  const pending = JSON.parse(fs.readFileSync(file + '.pending.json', 'utf8'));
  const identity = sourceIdentity();
  if (pending.platform !== platform || ['fingerprint', 'revision', 'runID'].some(key => pending[key] !== identity[key])) throw new Error('Source or execution session changed during UI tests; rerun this platform');
  fs.writeFileSync(file + '.evidence.json', JSON.stringify({...pending, completedAt: new Date().toISOString(), xmlDigest: digest(fs.readFileSync(file))}, null, 2) + '\n');
  fs.unlinkSync(file + '.pending.json');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, file, platform] = process.argv.slice(2);
    if (!['web', 'ios', 'android'].includes(platform)) throw new Error('Unknown platform');
    if (command === 'begin') beginEvidence(file, platform);
    else if (command === 'complete') completeEvidence(file, platform);
    else throw new Error('Usage: evidence.mjs begin|complete <junit-file> <platform>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
