import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPhysicalScannerEntries,
  isPokemonPocketScannerEntry,
  loadAcceptancePolicy,
} from "./lib.mjs";

test("physical scanner guard recognizes every Pokemon Pocket marker", () => {
  const rows = [
    { game: "pokemon", cardId: "url", imageURL: "https://assets.tcgdex.net/en/tcgp/A1/001/high.webp" },
    { game: "pokemon", cardId: "format", format: "pocket" },
    { game: "pokemon", cardId: "series", series: { id: "tcgp" } },
  ];
  assert.ok(rows.every(isPokemonPocketScannerEntry));
  assert.throws(
    () => assertPhysicalScannerEntries(rows),
    /3 Pokemon TCG Pocket row\(s\)/,
  );
});

test("physical Pokemon and non-Pokemon rows remain publishable", () => {
  const rows = [
    { game: "pokemon", cardId: "base1-1", format: "paper", imageURL: "https://assets.tcgdex.net/en/base/base1/1/high.webp" },
    { game: "magic", cardId: "printing", format: "paper" },
  ];
  assert.ok(rows.every((row) => !isPokemonPocketScannerEntry(row)));
  assert.doesNotThrow(() => assertPhysicalScannerEntries(rows));
});

test("shared acceptance policies publish per game with the conservative default for unknown games", async () => {
  const magic = await loadAcceptancePolicy("magic");
  assert.equal(magic.schema, "tcger-scanner-acceptance-policy-v1");
  assert.equal(magic.strongAcceptanceScore, 0.7);
  assert.equal(magic.titleGate, "binderPage");
  assert.equal(magic.collectorNumberScope, "family");
  assert.equal(magic.calibration, undefined);

  const pokemon = await loadAcceptancePolicy("pokemon");
  assert.equal(pokemon.strongAcceptanceScore, 0.65);
  assert.equal(pokemon.titleGate, "never");

  const future = await loadAcceptancePolicy("lorcana");
  assert.equal(future.strongAcceptanceScore, 0.7);
  assert.equal(future.titleGate, "never");
  assert.equal(future.uniqueTitleRescue, true);
  assert.ok(future.evidenceFloor <= future.strongAcceptanceScore);
});
