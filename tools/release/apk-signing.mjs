import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, X509Certificate } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
export const signingDirectory = process.env.TCGER_APK_SIGNING_DIRECTORY || path.join(os.homedir(), '.config/tcger/apk-signing');
export function loadApkSigning() {
  const file = path.join(signingDirectory, 'signing.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
export function signingEnvironment(settings) {
  return settings ? { TCGER_RELEASE_STORE_FILE: settings.storeFile, TCGER_RELEASE_STORE_PASSWORD: settings.storePassword, TCGER_RELEASE_KEY_ALIAS: settings.keyAlias, TCGER_RELEASE_KEY_PASSWORD: settings.keyPassword } : {};
}
export function prepareApkSigning() {
  const previous = loadApkSigning();
  if (previous) {
    if (!fs.existsSync(previous.storeFile)) throw new Error('The existing APK signing key is missing; restore it rather than creating a different update identity.');
    return previous;
  }
  fs.mkdirSync(signingDirectory, { recursive: true, mode: 0o700 });
  const storeFile = path.join(signingDirectory, 'tcger-apk.p12');
  if (fs.existsSync(storeFile)) throw new Error('A signing key already exists without its configuration; restore signing.json before continuing.');
  const password = randomBytes(32).toString('base64url');
  const settings = { storeFile, storePassword: password, keyPassword: password, keyAlias: 'tcger-apk' };
  execFileSync('keytool', ['-genkeypair', '-keystore', storeFile, '-storetype', 'PKCS12', '-alias', settings.keyAlias, '-storepass:env', 'TCGER_KEY_PASSWORD', '-keypass:env', 'TCGER_KEY_PASSWORD', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000', '-dname', 'CN=TCGer APK'], { env: { ...process.env, TCGER_KEY_PASSWORD: password }, stdio: 'pipe' });
  fs.chmodSync(storeFile, 0o600);
  fs.writeFileSync(path.join(signingDirectory, 'signing.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  return settings;
}
export function apkCertificate(settings) {
  const pem = execFileSync('keytool', ['-exportcert', '-rfc', '-keystore', settings.storeFile, '-alias', settings.keyAlias, '-storepass:env', 'TCGER_KEY_PASSWORD'], { env: { ...process.env, TCGER_KEY_PASSWORD: settings.storePassword }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return new X509Certificate(pem).fingerprint256;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const settings = prepareApkSigning();
  const fingerprint = apkCertificate(settings);
  // Public identity only. Signing secrets stay outside the repository.
  const identityFile = path.join(root, 'frontend/src/lib/release-identities.json');
  const identities = fs.existsSync(identityFile) ? JSON.parse(fs.readFileSync(identityFile, 'utf8')) : {};
  fs.writeFileSync(identityFile, JSON.stringify({ ...identities, TCGER_ANDROID_CERT_SHA256: fingerprint }, null, 2) + '\n');
  console.log(`APK signing identity prepared in ${signingDirectory}. Public SHA-256: ${fingerprint}`);
  if (process.argv.includes('--build')) {
    const result = spawnSync(path.join(root, 'mobile-apps/android/gradlew'), ['-p', path.join(root, 'mobile-apps/android'), 'assembleRelease', '--no-daemon'], { cwd: root, env: { ...process.env, ...signingEnvironment(settings) }, stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
    if (result.status === 0) {
      const artifact = path.join(root, 'mobile-parity/results/release/android/TCGer.apk');
      fs.mkdirSync(path.dirname(artifact), { recursive: true });
      fs.copyFileSync(path.join(root, 'mobile-apps/android/app/build/outputs/apk/release/app-release.apk'), artifact);
      console.log(`Signed APK: ${artifact}`);
    }
  }
}
