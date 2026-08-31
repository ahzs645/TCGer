import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("key generator creates a protected Ed25519 key and refuses replacement", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "tcger-package-keygen-"));
  const keyPath = resolve(directory, "release.pem");
  const command = [
    resolve(import.meta.dirname, "generate-signing-key.mjs"),
    "--out",
    keyPath,
    "--key-id",
    "tcger-release-1",
  ];
  try {
    const { stdout } = await execFileAsync(process.execPath, command);
    const result = JSON.parse(stdout);
    const key = createPrivateKey(await readFile(keyPath));
    const keyStat = await stat(keyPath);

    assert.equal(key.asymmetricKeyType, "ed25519");
    assert.equal(keyStat.mode & 0o777, 0o600);
    assert.equal(result.keyId, "tcger-release-1");
    assert.equal(Buffer.from(result.publicKey, "base64").byteLength, 32);
    assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
    await assert.rejects(execFileAsync(process.execPath, command), /EEXIST/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
