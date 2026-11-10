import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  autocontrastTable,
  blendEmbeddings,
  builtinQueryNormalization,
  greyWorldGains,
  normalizeRgba,
  parseQueryNormalization,
  queryRenderings,
} from "./query-color-normalization";

test("autocontrast table matches Pillow semantics", () => {
  // A histogram occupying [64, 191] stretches to [0, 255]; with a 1 % cutoff
  // the outermost 1 % of pixels are discarded first.
  const histogram = new Array<number>(256).fill(0);
  for (let value = 64; value <= 191; value++) histogram[value] = 100;
  const table = autocontrastTable(histogram, 0);
  assert.equal(table[64], 0);
  assert.equal(table[191], 255);
  assert.equal(table[0], 0);
  assert.equal(table[255], 255);
  assert.equal(table[128], Math.trunc(((128 - 64) * 255) / 127));
  // 12,800 pixels: 1 % = 128 pixels removes bin 64 and part of 65.
  const cut = autocontrastTable(histogram, 1);
  assert.equal(cut[65], 0);
  assert.equal(cut[190], 255);
  // A flat (single-value) histogram is left as identity.
  const flat = new Array<number>(256).fill(0);
  flat[100] = 500;
  assert.equal(autocontrastTable(flat, 1)[100], 100);
});

test("grey world gains balance a warm cast", () => {
  const gains = greyWorldGains([150, 128, 100]);
  assert.ok(Math.abs(gains[0]! * 150 - 126) < 0.01);
  assert.ok(Math.abs(gains[2]! * 100 - 126) < 0.01);
  assert.equal(greyWorldGains([0, 10, 20])[0], 1);
});

test("RGBA normalization neutralizes a cast and leaves alpha untouched", () => {
  const pixels: number[] = [];
  for (let index = 0; index < 98; index++) pixels.push(150, 128, 100, 255);
  pixels.push(200, 178, 150, 255, 100, 78, 50, 255);
  const rgba = Uint8ClampedArray.from(pixels);
  normalizeRgba(rgba);
  assert.ok(Math.abs(rgba[0]! - rgba[1]!) <= 2);
  assert.ok(Math.abs(rgba[1]! - rgba[2]!) <= 2);
  assert.equal(rgba[3], 255);
});

test("RGBA normalization reproduces Pillow on a deterministic image", () => {
  // Same generator and reference hashes as the Python contract
  // (tools/card-geometry/crop_parity.py normalize_query_colors, Pillow
  // ImageOps.autocontrast cutoff=1 after a grey-world gain).
  let state = 20261110;
  const next = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 16) & 0xff;
  };
  const width = 40;
  const height = 25;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    rgba[index * 4] = 80 + (next() % 160);
    rgba[index * 4 + 1] = 50 + (next() % 140);
    rgba[index * 4 + 2] = 20 + (next() % 120);
    rgba[index * 4 + 3] = 255;
  }
  const rgb = (source: Uint8ClampedArray) => {
    const out = new Uint8Array(width * height * 3);
    for (let index = 0; index < width * height; index++) {
      out[index * 3] = source[index * 4]!;
      out[index * 3 + 1] = source[index * 4 + 1]!;
      out[index * 3 + 2] = source[index * 4 + 2]!;
    }
    return createHash("sha256").update(out).digest("hex");
  };
  assert.equal(
    rgb(rgba),
    "f803c55bef7230205e776a33454b8cb7409ad5801de1191523b0116a0329218a",
  );
  normalizeRgba(rgba);
  assert.equal(
    rgb(rgba),
    "926fa10498d10c8b84d7a9244a13704d3e548cdc3f6f94a359624d32d9e287dd",
  );
});

test("declared modes map to the renderings that are embedded", () => {
  assert.deepEqual(queryRenderings("none"), [false]);
  assert.deepEqual(queryRenderings("grey-world-autocontrast"), [true]);
  assert.deepEqual(queryRenderings("grey-world-autocontrast-blend"), [
    false,
    true,
  ]);
  assert.equal(
    parseQueryNormalization("grey-world-autocontrast-blend"),
    "grey-world-autocontrast-blend",
  );
  // An unknown or missing declaration is not guessed at.
  assert.equal(parseQueryNormalization("blend"), null);
  assert.equal(parseQueryNormalization(undefined), null);
  // Built-in profiles mirror the native clients.
  assert.equal(
    builtinQueryNormalization("magic", "arcface"),
    "grey-world-autocontrast",
  );
  assert.equal(builtinQueryNormalization("pokemon", "arcface"), "none");
  assert.equal(builtinQueryNormalization("yugioh", "arcface"), "none");
  assert.equal(builtinQueryNormalization("magic", "dinov2"), "none");
});

test("blend averages unit vectors and rejects unusable embeddings", () => {
  // Each rendering is L2-normalized first, so a long vector cannot outvote a
  // short one.
  const mixed = blendEmbeddings([
    Float32Array.from([10, 0]),
    Float32Array.from([0, 1]),
  ]);
  assert.ok(mixed);
  assert.ok(Math.abs(mixed[0]! - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(mixed[1]! - Math.SQRT1_2) < 1e-6);
  const same = blendEmbeddings([
    Float32Array.from([0.6, 0.8]),
    Float32Array.from([0.6, 0.8]),
  ]);
  assert.ok(same);
  assert.ok(Math.abs(same[0]! - 0.6) < 1e-6);
  assert.ok(Math.abs(same[1]! - 0.8) < 1e-6);
  assert.equal(
    blendEmbeddings([Float32Array.from([1, 0]), Float32Array.from([1, 0, 0])]),
    null,
  );
  assert.equal(
    blendEmbeddings([Float32Array.from([0, 0]), Float32Array.from([1, 0])]),
    null,
  );
  assert.equal(blendEmbeddings([]), null);
});
