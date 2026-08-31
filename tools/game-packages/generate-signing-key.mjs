#!/usr/bin/env node

import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function usage() {
  console.log(`Usage:
  npm run game-packages:keygen -- --out /secure/path/tcger-game-packages.pem --key-id tcger-release-1

Creates a new Ed25519 PKCS#8 private key with owner-only permissions. The
destination must not already exist. Keep it outside the repository and store a
backup in the release secret manager.`);
}

function parseArgs(argv) {
  const values = new Map();
  const args = [...argv];
  while (args.length) {
    const token = args.shift();
    if (token === "--help" || token === "-h") return null;
    if (!token?.startsWith("--"))
      throw new Error(`Unexpected argument: ${token}`);
    const [key, inline] = token.slice(2).split("=", 2);
    const value = inline ?? args.shift();
    if (!value || value.startsWith("--"))
      throw new Error(`--${key} requires a value`);
    if (!new Set(["out", "key-id"]).has(key))
      throw new Error(`Unknown option: --${key}`);
    values.set(key, value);
  }
  const out = values.get("out");
  const keyId = values.get("key-id");
  if (!out || !keyId) throw new Error("--out and --key-id are required");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(keyId)) {
    throw new Error(
      "--key-id must use 1-64 lowercase letters, numbers, dot, underscore, or dash",
    );
  }
  return { out: resolve(out), keyId };
}

const options = parseArgs(process.argv.slice(2));
if (!options) {
  usage();
  process.exit(0);
}

const { privateKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicDer = createPublicKey(privateKey).export({
  type: "spki",
  format: "der",
});
const rawPublicKey = publicDer.subarray(publicDer.length - 32);

await mkdir(dirname(options.out), { recursive: true });
await writeFile(options.out, pem, { flag: "wx", mode: 0o600 });

console.log(
  JSON.stringify(
    {
      privateKey: options.out,
      keyId: options.keyId,
      algorithm: "ed25519",
      publicKey: rawPublicKey.toString("base64"),
      fingerprint: createHash("sha256").update(rawPublicKey).digest("hex"),
    },
    null,
    2,
  ),
);
