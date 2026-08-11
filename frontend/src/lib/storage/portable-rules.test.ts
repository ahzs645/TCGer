/**
 * The shared collection rules, executed over the local runtime.
 *
 * Drives `packages/api-types/src/collection-semantics.ts` — the same table the
 * demo REST harness and the Convex harness run — but one layer lower, against
 * `collection-rules.ts` over `LocalPortableDb`. If the extracted rules disagree
 * with the behaviour both runtimes already ship, these fail.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  addCopies,
  binderEntries,
  projectBinder,
  removeCard,
  updateEntry,
  entityId,
  entityIdTimestamp,
  isEntityId,
  type CardIdentity,
  type CardRow,
  type CopyFields,
  type UpdateFields,
} from "@tcg/api-types";
import {
  COLLECTION_SEMANTICS_CASES,
  SECONDARY_BINDER_TOKEN,
  type CollectionSemanticsCase,
  type SemanticsExpectation,
} from "../../../../packages/api-types/src/collection-semantics";
import { LocalPortableDb } from "./local-portable-db";

const USER = "local-user";

async function makeBinder(db: LocalPortableDb, name: string): Promise<string> {
  const now = Date.now();
  return db.insert("binders", {
    userId: USER,
    kind: "binder",
    name,
    colorHex: "22c55e",
    createdAt: now,
    updatedAt: now,
  });
}

async function project(db: LocalPortableDb, binderId: string) {
  const binder = await db.get("binders", binderId);
  assert.ok(binder, "binder missing");
  const entries = await binderEntries(db, binderId);
  const cards = new Map<string, CardRow>();
  for (const entry of entries) {
    if (cards.has(entry.cardId)) continue;
    const card = await db.get("cards", entry.cardId);
    if (card) cards.set(entry.cardId, card);
  }
  return projectBinder(binder, entries, cards);
}

async function runCase(testCase: CollectionSemanticsCase) {
  const db = new LocalPortableDb();
  const primary = await makeBinder(db, `Primary (${testCase.id})`);
  const secondary = testCase.needsSecondBinder
    ? await makeBinder(db, `Secondary (${testCase.id})`)
    : null;

  for (const seed of testCase.seed) {
    await addCopies(db, {
      userId: USER,
      binderId: primary,
      card: seed.cardData as CardIdentity,
      quantity: seed.quantity,
      fields: (seed.fields ?? {}) as CopyFields,
    });
  }

  const before = await project(db, primary);
  const seeded = before.cards.find(
    (card) => card.externalId === testCase.seed[0]!.cardData.externalId,
  );
  assert.ok(seeded, `${testCase.id}: seed card missing`);

  // Both targets resolve to a real entry id; the card-level id *is* the first
  // copy's id, which is the aliasing the REST contract exposes.
  const targetId =
    testCase.action.target === "card" ? seeded.id : seeded.copies[0]!.id;

  if (testCase.action.kind === "delete") {
    await removeCard(db, { userId: USER, entryId: targetId });
  } else {
    const patch = JSON.parse(
      JSON.stringify(testCase.action.body).replaceAll(
        SECONDARY_BINDER_TOKEN,
        secondary ?? "",
      ),
    ) as UpdateFields;
    await updateEntry(db, { userId: USER, entryId: targetId, updates: patch });
  }

  for (const expectation of testCase.expect) {
    const binderId = expectation.binder === "primary" ? primary : secondary!;
    await assertExpectation(testCase, await project(db, binderId), expectation);
  }
}

async function assertExpectation(
  testCase: CollectionSemanticsCase,
  binder: Awaited<ReturnType<typeof project>>,
  expectation: SemanticsExpectation,
) {
  const card = binder.cards.find(
    (entry) => entry.externalId === expectation.externalId,
  );
  const where = `${testCase.id} [${expectation.binder}]`;

  if (expectation.quantity === null) {
    assert.equal(card, undefined, `${where}: card should have been removed`);
    return;
  }

  assert.ok(card, `${where}: card missing`);
  assert.equal(card.quantity, expectation.quantity, `${where}: quantity`);

  if (!expectation.copy0) return;
  const copy = card.copies[0];
  assert.ok(copy, `${where}: no copies`);
  for (const [field, want] of Object.entries(expectation.copy0)) {
    const got: unknown = (copy as unknown as Record<string, unknown>)[field];
    if (want === undefined) {
      assert.ok(
        got === undefined || got === null,
        `${where}: ${field} should be cleared, got ${JSON.stringify(got)}`,
      );
    } else {
      assert.deepEqual(got, want, `${where}: ${field}`);
    }
  }
}

for (const testCase of COLLECTION_SEMANTICS_CASES) {
  test(`portable rules: ${testCase.id}`, async () => {
    await runCase(testCase);
  });
}

/* ---------------------------------------------------------------- */
/*  Contract-level properties the fixtures do not cover              */
/* ---------------------------------------------------------------- */

test("a failed transaction leaves no partial writes", async () => {
  const db = new LocalPortableDb();
  const binderId = await makeBinder(db, "Atomic");
  await addCopies(db, {
    userId: USER,
    binderId,
    card: { tcg: "magic", externalId: "atomic", name: "Atomic" },
    quantity: 2,
  });
  const before = db.snapshot();

  await assert.rejects(
    db.transaction(["collectionEntries"], async () => {
      const entries = await binderEntries(db, binderId);
      await db.delete("collectionEntries", entries[0]!._id);
      throw new Error("boom");
    }),
    /boom/,
  );

  const after = await binderEntries(db, binderId);
  assert.equal(after.length, 2, "the deletion inside the failed tx persisted");
  assert.equal(db.snapshot(), before, "snapshot identity changed on rollback");
});

test("a query through an index that cannot serve it is rejected", async () => {
  const db = new LocalPortableDb();
  await assert.rejects(
    () => db.query("collectionEntries", "by_binder", { cardId: "x" }),
    /cannot serve a lookup by cardId/,
  );
});

test("normalizeId answers for the table it is asked about", async () => {
  const db = new LocalPortableDb();
  const id = await makeBinder(db, "Ids");
  assert.equal(db.normalizeId("binders", id), id);
  // A real binder id is not a valid entry id.
  assert.equal(db.normalizeId("collectionEntries", id), null);
  assert.equal(db.normalizeId("binders", "jd7abc123"), null);
  assert.equal(db.normalizeId("binders", ""), null);
});

test("row writes touch one table, not the whole collection", async () => {
  const db = new LocalPortableDb();
  const binderId = await makeBinder(db, "Writes");
  const seen: Array<ReadonlySet<string>> = [];
  db.onCommit((_snapshot, changed) => seen.push(new Set(changed)));

  await addCopies(db, {
    userId: USER,
    binderId,
    card: { tcg: "magic", externalId: "one-write", name: "One" },
    quantity: 1,
  });

  // One commit for the whole transaction, naming only what it touched.
  assert.equal(seen.length, 1, `expected a single commit, got ${seen.length}`);
  assert.deepEqual(
    [...seen[0]!].sort(),
    ["binders", "cards", "collectionEntries"],
    "commit should name exactly the tables the add touched",
  );
});

test("concurrent transactions do not share an overlay", async () => {
  const db = new LocalPortableDb();
  const binderId = await makeBinder(db, "Concurrent");

  // Two overlapping mutations. Before transactions were serialised the second
  // joined the first's staged buffer, so the loser's writes vanished — the
  // data-loss bug societyer records in its own local row store.
  await Promise.all([
    addCopies(db, {
      userId: USER,
      binderId,
      card: { tcg: "magic", externalId: "concurrent-a", name: "A" },
      quantity: 2,
    }),
    addCopies(db, {
      userId: USER,
      binderId,
      card: { tcg: "magic", externalId: "concurrent-b", name: "B" },
      quantity: 3,
    }),
  ]);

  const entries = await binderEntries(db, binderId);
  assert.equal(entries.length, 5, "both adds must survive, 2 + 3");
  const cards = await Promise.all(
    entries.map((entry) => db.get("cards", entry.cardId)),
  );
  const names = new Set(cards.map((card) => card?.name));
  assert.deepEqual([...names].sort(), ["A", "B"], "both cards must exist");
});

test("a failed transaction does not roll back a concurrent one", async () => {
  const db = new LocalPortableDb();
  const binderId = await makeBinder(db, "Isolation");

  const good = addCopies(db, {
    userId: USER,
    binderId,
    card: { tcg: "magic", externalId: "survivor", name: "Survivor" },
    quantity: 1,
  });
  const bad = db
    .transaction(["collectionEntries"], async () => {
      await db.insert("collectionEntries", {
        userId: USER,
        binderId,
        cardId: "nonexistent",
        quantity: 1,
        createdAt: 0,
        updatedAt: 0,
      });
      throw new Error("rollback me");
    })
    .catch((error: unknown) => error);

  await good;
  const outcome = await bad;
  assert.ok(outcome instanceof Error, "the failing transaction must reject");

  const entries = await binderEntries(db, binderId);
  assert.equal(
    entries.length,
    1,
    "the committed add must survive the rollback",
  );
  assert.equal(entries[0]!.cardId !== "nonexistent", true, "no orphan row");
});

test("minted ids are time-sortable and unique", () => {
  const ids = Array.from({ length: 500 }, () => entityId());

  assert.equal(new Set(ids).size, ids.length, "ids collided");
  assert.deepEqual(
    [...ids].sort(),
    ids,
    "ids must sort lexicographically in creation order, including within one millisecond",
  );
  for (const id of ids) {
    assert.ok(isEntityId(id), `${id} is not a well-formed entity id`);
  }
});

test("an id carries the time it was minted", () => {
  const at = 1_800_000_000_000;
  const stamp = entityIdTimestamp(entityId(at));
  assert.equal(stamp, at, "timestamp did not survive the round trip");
  assert.equal(entityIdTimestamp("not-an-id"), null);
});

test("rows are created with promotion-safe ids", async () => {
  const db = new LocalPortableDb();
  const binderId = await makeBinder(db, "Ids");
  assert.ok(
    isEntityId(binderId),
    `a locally created row must carry an id the hosted runtime could accept, got ${binderId}`,
  );

  const [entry] = await addCopies(db, {
    userId: USER,
    binderId,
    card: { tcg: "magic", externalId: "id-shape", name: "Shape" },
    quantity: 1,
  });
  assert.ok(isEntityId(entry!._id), "entry id");
});
