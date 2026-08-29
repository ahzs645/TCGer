import assert from "node:assert/strict";
import test from "node:test";

import { buildBrowserIndex } from "./build-browser-scan-index.mjs";

function vectors(count = 1, dimension = 3) {
  const value = Buffer.alloc(8 + count * dimension);
  value.writeUInt32LE(count, 0);
  value.writeUInt32LE(dimension, 4);
  Buffer.from([127, 0, 129]).copy(value, 8);
  return value;
}

const row = {
  annIndex: 0,
  cardId: "newest",
  exactPrintingId: "newest",
  recognitionFamilyId: "magic:visual:one",
  name: "Example Card",
  game: "magic",
  setCode: "new",
  collectorNumber: "1",
  imageURL: "https://example.com/new.jpg",
  printings: [
    { cardId: "newest", setCode: "new", collectorNumber: "1" },
    { cardId: "older", setCode: "old", collectorNumber: "7" },
  ],
};

test("preserves family row order and expands lightweight printings", () => {
  const built = buildBrowserIndex({
    metadata: [row],
    vectorContents: vectors(),
    game: "magic",
    version: 2,
    modelFile: "magic.onnx",
    model: "example/model",
  });
  assert.equal(built.total, 1);
  assert.equal(built.printingTotal, 2);
  assert.equal(built.dimension, 3);
  assert.equal(built.entries[0].externalId, "newest");
  assert.equal(built.entries[0].printings[1].externalId, "older");
  assert.equal(Buffer.from(built.vectors, "base64").compare(Buffer.from([127, 0, 129])), 0);
});

test("rejects a metadata/vector cardinality mismatch", () => {
  assert.throws(() => buildBrowserIndex({
    metadata: [row],
    vectorContents: vectors(2),
    game: "magic",
    version: 2,
    modelFile: "magic.onnx",
    model: "example/model",
  }), /Vector count 2/);
});

test("rejects Pokémon Pocket rows", () => {
  assert.throws(() => buildBrowserIndex({
    metadata: [{ ...row, game: "pokemon", imageURL: "https://x/tcgp/card.webp" }],
    vectorContents: vectors(),
    game: "pokemon",
    version: 4,
    modelFile: "pokemon.onnx",
    model: "example/model",
  }), /Pocket row/);
});
