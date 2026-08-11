/**
 * The nested → rows conversion, against the demo's real seeded collection.
 *
 * A toy fixture would prove nothing here: the risk is that some shape actually
 * in the wild converts wrongly and a returning visitor's collection comes back
 * altered. So this seeds the store the way a first visit does and converts
 * that, then checks the round trip through the shared projection reproduces
 * what the REST contract returned before.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { projectBinder, type CardRow } from "@tcg/api-types";
import { useDemoStore, type DemoBinder } from "@/stores/demo-store";
import {
  toPortableRows,
  toDemoBinders,
  indexDemoCards,
  LOCAL_USER_ID,
} from "./legacy-collection-rows";
import { LocalPortableDb } from "./local-portable-db";

function seededBinders(): DemoBinder[] {
  useDemoStore.getState().init();
  const binders = useDemoStore.getState().binders;
  assert.ok(binders.length > 0, "the demo seeded no binders");
  return binders;
}

type Projected = ReturnType<typeof projectBinder>;

function projectAll(rows: ReturnType<typeof toPortableRows>): Projected[] {
  const cards = new Map<string, CardRow>(
    rows.cards.map((card) => [card._id, card]),
  );
  return rows.binders.map((binder) =>
    projectBinder(
      binder,
      rows.collectionEntries.filter((e) => e.binderId === binder._id),
      cards,
    ),
  );
}

test("every binder, card and copy survives the conversion", () => {
  const binders = seededBinders();
  const rows = toPortableRows(binders);

  assert.equal(rows.binders.length, binders.length, "binder count");

  const expectedCopies = binders.reduce(
    (sum, binder) =>
      sum +
      binder.cards.reduce(
        (cards, card) =>
          cards + (card.copies?.length || Math.max(1, card.quantity)),
        0,
      ),
    0,
  );
  assert.equal(
    rows.collectionEntries.length,
    expectedCopies,
    "one entry row per physical copy",
  );
});

test("ids are carried over, never re-minted", () => {
  const binders = seededBinders();
  const rows = toPortableRows(binders);

  for (const binder of binders) {
    assert.ok(
      rows.binders.some((row) => row._id === binder.id),
      `binder ${binder.id} lost its id — links and bookmarks would break`,
    );
  }

  const copyIds = new Set(
    binders.flatMap((b) =>
      b.cards.flatMap((c) => (c.copies ?? []).map((x) => x.id)),
    ),
  );
  for (const id of copyIds) {
    assert.ok(
      rows.collectionEntries.some((row) => row._id === id),
      `copy ${id} lost its id — it is what the REST contract hands out`,
    );
  }
});

test("the projected shape matches what the store held", () => {
  const binders = seededBinders();
  const projected = projectAll(toPortableRows(binders));

  for (const binder of binders) {
    const mirror = projected.find((entry) => entry.id === binder.id);
    assert.ok(mirror, `binder ${binder.name} missing after projection`);
    assert.equal(mirror.name, binder.name);
    assert.equal(
      mirror.cards.length,
      binder.cards.length,
      `${binder.name}: distinct card count changed`,
    );

    for (const card of binder.cards) {
      const externalId = card.cardData?.externalId ?? card.cardId;
      const projectedCard: Projected["cards"][number] | undefined =
        mirror.cards.find((entry) => entry.externalId === externalId);
      assert.ok(projectedCard, `${card.name} missing after projection`);
      assert.equal(
        projectedCard.quantity,
        card.copies?.length || Math.max(1, card.quantity),
        `${card.name}: quantity changed`,
      );
      assert.equal(projectedCard.name, card.cardData?.name ?? card.name);
    }
  }
});

test("total owned copies and value are unchanged", () => {
  const binders = seededBinders();
  const rows = toPortableRows(binders);

  const before = binders.reduce(
    (sum, binder) =>
      sum +
      binder.cards.reduce(
        (cards, card) =>
          cards + (card.copies?.length || Math.max(1, card.quantity)),
        0,
      ),
    0,
  );
  assert.equal(rows.collectionEntries.length, before, "copy count");

  // Value is what the dashboard shows, so a drift here is user-visible.
  const valueBefore = binders.reduce(
    (sum, binder) =>
      sum +
      binder.cards.reduce((cards, card) => {
        const copies = card.copies?.length
          ? card.copies.map((copy) => copy.price ?? card.price)
          : Array.from(
              { length: Math.max(1, card.quantity) },
              () => card.price,
            );
        return cards + copies.reduce((a: number, b) => a + (b ?? 0), 0);
      }, 0),
    0,
  );
  const valueAfter = rows.collectionEntries.reduce(
    (sum, entry) => sum + (entry.price ?? 0),
    0,
  );
  assert.equal(valueAfter.toFixed(2), valueBefore.toFixed(2), "total value");
});

test("cards are deduplicated across binders", () => {
  const binders = seededBinders();
  const rows = toPortableRows(binders);

  const distinct = new Set(
    binders.flatMap((b) => b.cards.map((c) => `${c.tcg}:${c.cardId}`)),
  );
  assert.equal(
    rows.cards.length,
    distinct.size,
    "one card row per distinct printing, shared across binders",
  );
  assert.equal(
    new Set(rows.cards.map((c) => c._id)).size,
    rows.cards.length,
    "card row ids must be unique",
  );
});

test("a pre-copies card is expanded into one row per copy", () => {
  const legacy: DemoBinder[] = [
    {
      id: "binder-legacy",
      name: "Pre-copies",
      color: "#3b82f6",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      cards: [
        {
          id: "card-legacy",
          cardId: "ygo-1",
          name: "Legacy Dragon",
          tcg: "yugioh",
          setCode: "LOB-001",
          setName: "Legend of Blue Eyes",
          rarity: "Ultra Rare",
          condition: "Near Mint",
          price: 12.34,
          quantity: 3,
          addedAt: "2026-01-01T00:00:00.000Z",
          // no `copies` — the shape that shipped before copies existed
        },
      ],
    },
  ];

  const rows = toPortableRows(legacy);
  assert.equal(rows.collectionEntries.length, 3, "three copies");
  for (const entry of rows.collectionEntries) {
    assert.equal(
      entry.condition,
      "Near Mint",
      "card-level condition inherited",
    );
    assert.equal(entry.price, 12.34, "card-level price inherited");
    assert.equal(entry.userId, LOCAL_USER_ID);
  }
  assert.equal(
    new Set(rows.collectionEntries.map((e) => e._creationTime)).size,
    3,
    "creation times must not tie, or the card-level id is unstable",
  );
});

test("converted rows are usable by the rules", async () => {
  const rows = toPortableRows(seededBinders());
  const db = new LocalPortableDb(rows);

  const binderId = rows.binders[0]!._id;
  assert.equal(db.normalizeId("binders", binderId), binderId);

  const entries = await db.query("collectionEntries", "by_binder", {
    binderId,
  });
  assert.ok(entries.length > 0, "no entries queryable through the index");

  const group = await db.query("collectionEntries", "by_binder_and_card", {
    binderId,
    cardId: entries[0]!.cardId,
  });
  assert.ok(group.length > 0, "group lookup returned nothing");
});

test("nested → rows → nested is lossless for everything the UI reads", () => {
  const binders = seededBinders();
  const rows = toPortableRows(binders);
  const back = toDemoBinders(rows, indexDemoCards(binders));

  assert.equal(back.length, binders.length, "binder count");

  for (const original of binders) {
    const rebuilt: DemoBinder | undefined = back.find(
      (b) => b.id === original.id,
    );
    assert.ok(rebuilt, `binder ${original.name} lost`);
    assert.equal(rebuilt.name, original.name);
    assert.equal(rebuilt.color, original.color, "colour round trip");
    assert.equal(rebuilt.cards.length, original.cards.length, "card count");

    for (const card of original.cards) {
      const mirror: DemoBinder["cards"][number] | undefined =
        rebuilt.cards.find((c) => c.cardId === card.cardId);
      assert.ok(
        mirror,
        `${card.name}: cardId ${card.cardId} did not survive — ownership badges read this`,
      );
      assert.equal(mirror.name, card.name, `${card.name}: name`);
      assert.equal(mirror.tcg, card.tcg, `${card.name}: tcg`);
      assert.equal(mirror.rarity, card.rarity, `${card.name}: rarity`);
      assert.equal(
        mirror.quantity,
        card.copies?.length || Math.max(1, card.quantity),
        `${card.name}: quantity`,
      );
      assert.deepEqual(
        mirror.cardData,
        card.cardData,
        `${card.name}: cardData must survive, catalog enrichment writes it`,
      );
    }
  }
});

test("round trip preserves the totals the dashboard shows", () => {
  const binders = seededBinders();
  const back = toDemoBinders(toPortableRows(binders), indexDemoCards(binders));

  const count = (list: DemoBinder[]) =>
    list.reduce(
      (sum, b) =>
        sum +
        b.cards.reduce(
          (n, c) => n + (c.copies?.length || Math.max(1, c.quantity)),
          0,
        ),
      0,
    );
  const value = (list: DemoBinder[]) =>
    list.reduce(
      (sum, b) =>
        sum +
        b.cards.reduce(
          (n, c) =>
            n +
            (c.copies?.length
              ? c.copies.reduce((a, copy) => a + (copy.price ?? c.price), 0)
              : c.price * Math.max(1, c.quantity)),
          0,
        ),
      0,
    );

  assert.equal(count(back), count(binders), "total cards");
  assert.equal(
    value(back).toFixed(2),
    value(binders).toFixed(2),
    "total value",
  );

  const uniqueBefore = new Set(
    binders.flatMap((b) => b.cards.map((c) => c.cardId)),
  ).size;
  const uniqueAfter = new Set(back.flatMap((b) => b.cards.map((c) => c.cardId)))
    .size;
  assert.equal(uniqueAfter, uniqueBefore, "unique cards");
});
