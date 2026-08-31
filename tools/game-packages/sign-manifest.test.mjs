import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("manifest signer emits a detached Ed25519 signature over exact bytes", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "tcger-package-signing-"));
  try {
    const manifestPath = resolve(directory, "demo.game-package.json");
    const privateKeyPath = resolve(directory, "private.pem");
    const { privateKey } = generateKeyPairSync("ed25519");
    await writeFile(
      privateKeyPath,
      privateKey.export({ type: "pkcs8", format: "pem" }),
    );
    await writeFile(
      manifestPath,
      JSON.stringify({
        schema: "https://tcger.app/schemas/game-package-manifest/v1",
        packageId: "demo-library",
        publisher: { id: "demo-publisher", name: "Demo Publisher" },
      }),
    );

    await execFileAsync(process.execPath, [
      resolve(import.meta.dirname, "sign-manifest.mjs"),
      "--manifest",
      manifestPath,
      "--private-key",
      privateKeyPath,
      "--key-id",
      "release-1",
    ]);

    const contents = await readFile(manifestPath);
    const manifest = JSON.parse(contents.toString("utf8"));
    const signature = await readFile(`${manifestPath}.sig`);
    const rawPublicKey = Buffer.from(
      manifest.publisher.signingKey.publicKey,
      "base64",
    );
    const spki = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      rawPublicKey,
    ]);
    const publicKey = createPublicKey({
      key: spki,
      format: "der",
      type: "spki",
    });

    assert.equal(signature.byteLength, 64);
    assert.equal(verify(null, contents, publicKey, signature), true);
    assert.equal(
      verify(
        null,
        Buffer.concat([contents, Buffer.from(" ")]),
        publicKey,
        signature,
      ),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
