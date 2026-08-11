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

test("only ids this store minted are recognised", async () => {
  const db = new LocalPortableDb();
  const id = await makeBinder(db, "Ids");
  assert.equal(db.normalizeId("binders", id), id);
  assert.equal(db.normalizeId("collectionEntries", id), null);
  assert.equal(db.normalizeId("binders", "jd7abc123"), null);
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
