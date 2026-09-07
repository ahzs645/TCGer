import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizePortableBackup } from "../../../../packages/api-types/src/portable-backup";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../../mobile-parity/fixtures/portable-backup-v2.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
test("the shared backup fixture keeps physical IDs, prices, null condition and future sections", () => {
  const backup = normalizePortableBackup(fixture);
  assert.equal(backup.binders[0]!.cards.length, 3);
  assert.equal(
    new Set(backup.binders[0]!.cards.map((copy) => copy.id)).size,
    3,
  );
  assert.equal(backup.binders[0]!.cards[1]!.condition, null);
  assert.equal(backup.binders[0]!.cards[0]!.acquisitionPrice, 4.25);
  assert.deepEqual(
    normalizePortableBackup(JSON.parse(JSON.stringify(backup))),
    backup,
  );
  assert.deepEqual(
    backup.sections.futureFeature,
    fixture.sections.futureFeature,
  );
});
test("invalid version, duplicate IDs and negative prices fail validation", () => {
  assert.throws(() =>
    normalizePortableBackup({ ...fixture, formatVersion: 100 }),
  );
  const bad = structuredClone(fixture);
  bad.binders[0].cards[1].id = bad.binders[0].cards[0].id;
  assert.throws(() => normalizePortableBackup(bad), /Duplicate/);
  bad.binders[0].cards[1].id = "unique";
  bad.binders[0].cards[1].price = -1;
  assert.throws(() => normalizePortableBackup(bad));
});
test("legacy Android backups are promoted without re-minting saved copy IDs", () => {
  const { format, ...legacy } = fixture;
  const backup = normalizePortableBackup({ ...legacy, formatVersion: 1 });
  assert.equal(backup.formatVersion, 2);
  assert.equal(backup.binders[0]!.cards[0]!.id, "pokemon-copy-1");
});

test("web deck and trade rows validate before import and retain their IDs", async () => {
  const { restoreWebSections } = await import("./portable-web-sections");
  const deck = {
    _id: "deck",
    _creationTime: 1,
    userId: "foreign",
    name: "My deck",
    tcg: "pokemon",
    isPublic: false,
    createdAt: 1,
    updatedAt: 1,
  };
  const card = {
    _id: "card",
    _creationTime: 1,
    deckId: "deck",
    name: "Pikachu",
    quantity: 2,
  };
  const result = restoreWebSections(
    { deckRows: { decks: [deck], deckCards: [card] } },
    {},
  );
  assert.equal(result.deckRows?.decks[0]?._id, "deck");
  assert.notEqual(result.deckRows?.decks[0]?.userId, "foreign");
  assert.equal(result.deckRows?.deckCards[0]?.quantity, 2);
  assert.throws(
    () =>
      restoreWebSections({ deckRows: { decks: [], deckCards: [card] } }, {}),
    /parent/,
  );
  assert.throws(() =>
    restoreWebSections(
      { deckRows: { decks: [deck], deckCards: [{ ...card, quantity: -1 }] } },
      {},
    ),
  );
});
