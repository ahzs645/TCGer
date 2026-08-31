#!/usr/bin/env node

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

function usage() {
  console.log(`Usage:
  node tools/game-packages/sign-manifest.mjs --manifest <file> --private-key <ed25519.pem> --key-id <id>

The manifest is rewritten with its public signing key and detached-signature
metadata. The raw 64-byte signature is written beside it as <manifest>.sig.`);
}

function argumentsMap(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    if (!key || !value) throw new Error("Signing options require values");
    result.set(key, value);
  }
  return result;
}

const rawArguments = process.argv.slice(2);
if (rawArguments.includes("--help")) {
  usage();
  process.exit(0);
}
const options = argumentsMap(rawArguments);
const manifestOption = options.get("manifest");
const privateKeyOption = options.get("private-key");
const keyId = options.get("key-id");
if (!manifestOption || !privateKeyOption || !keyId) {
  usage();
  throw new Error("--manifest, --private-key, and --key-id are required");
}
const manifestPath = resolve(manifestOption);
const privateKeyPath = resolve(privateKeyOption);

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest?.publisher?.id || !manifest?.packageId) {
  throw new Error("Signed packages require publisher.id and packageId");
}
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(keyId)) {
  throw new Error("Invalid signing key id");
}
const privateKey = createPrivateKey(await readFile(privateKeyPath));
if (privateKey.asymmetricKeyType !== "ed25519") {
  throw new Error("The private key must be Ed25519");
}
const spki = createPublicKey(privateKey).export({
  type: "spki",
  format: "der",
});
const publicKey = spki.subarray(spki.length - 32);
const signatureFilename = `${basename(manifestPath)}.sig`;
manifest.publisher.signingKey = {
  id: keyId,
  algorithm: "ed25519",
  publicKey: publicKey.toString("base64"),
};
manifest.signature = {
  algorithm: "ed25519",
  keyId,
  url: `./${signatureFilename}`,
};
const contents = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const signature = sign(null, contents, privateKey);
if (!verify(null, contents, createPublicKey(privateKey), signature)) {
  throw new Error("Generated signature could not be verified");
}
await writeFile(manifestPath, contents);
const signaturePath = resolve(dirname(manifestPath), signatureFilename);
await writeFile(signaturePath, signature);
console.log(
  JSON.stringify({
    manifest: manifestPath,
    signature: signaturePath,
    publisherId: manifest.publisher.id,
    packageId: manifest.packageId,
    keyId,
    publicKey: publicKey.toString("base64"),
  }),
);
