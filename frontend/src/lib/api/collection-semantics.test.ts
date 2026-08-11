/**
 * Demo-side harness for the shared collection-semantics fixtures.
 *
 * Drives `packages/api-types/src/collection-semantics.ts` through the demo's
 * REST seam (`handleDemoRequest`, the fetch interceptor demo mode installs).
 * `convex-backend/convex/collectionSemantics.test.ts` drives the identical
 * table through the real HTTP router, so a rule that only one side implements
 * fails here or there.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  COLLECTION_SEMANTICS_CASES,
  SECONDARY_BINDER_TOKEN,
  type CollectionSemanticsCase,
  type SemanticsExpectation,
} from "../../../../packages/api-types/src/collection-semantics";
import { handleDemoRequest } from "./demo-adapter";
import { useDemoStore } from "@/stores/demo-store";

interface Copy {
  id: string;
  [key: string]: unknown;
}
interface Card {
  id: string;
  externalId?: string;
  quantity: number;
  copies?: Copy[];
}
interface Binder {
  id: string;
  cards: Card[];
}

async function call(method: string, path: string, body?: unknown) {
  const response = await handleDemoRequest(method, path, body);
  return response;
}

async function json<T>(method: string, path: string, body?: unknown) {
  const response = await call(method, path, body);
  assert.ok(
    response.status < 400,
    `${method} ${path} -> ${response.status}: ${await response.clone().text()}`,
  );
  return (await response.json()) as T;
}

async function createBinder(name: string): Promise<string> {
  const binder = await json<{ id: string }>("POST", "/collections", {
    name,
    colorHex: "22c55e",
  });
  return binder.id;
}

async function readBinder(binderId: string): Promise<Binder> {
  return json<Binder>("GET", `/collections/${binderId}`);
}

function findCard(binder: Binder, externalId: string): Card | undefined {
  return binder.cards.find((card) => card.externalId === externalId);
}

async function runCase(testCase: CollectionSemanticsCase) {
  // Each case starts from a store with no binders, so ids never collide and a
  // leaked mutation from an earlier case cannot make a later one pass.
  useDemoStore.setState({ binders: [], initialized: true });

  const primary = await createBinder(`Primary (${testCase.id})`);
  const secondary = testCase.needsSecondBinder
    ? await createBinder(`Secondary (${testCase.id})`)
    : null;

  for (const seed of testCase.seed) {
    await json("POST", `/collections/${primary}/cards`, {
      quantity: seed.quantity,
      cardData: seed.cardData,
      ...(seed.fields ?? {}),
    });
  }

  const before = await readBinder(primary);
  const seeded = findCard(before, testCase.seed[0]!.cardData.externalId);
  assert.ok(seeded, `${testCase.id}: seed card missing before the action`);

  const targetId =
    testCase.action.target === "card" ? seeded.id : seeded.copies![0]!.id;

  if (testCase.action.kind === "delete") {
    const response = await call(
      "DELETE",
      `/collections/${primary}/cards/${targetId}`,
    );
    assert.ok(
      response.status < 400,
      `${testCase.id}: DELETE -> ${response.status}`,
    );
  } else {
    const body = JSON.parse(
      JSON.stringify(testCase.action.body).replaceAll(
        SECONDARY_BINDER_TOKEN,
        secondary ?? "",
      ),
    ) as Record<string, unknown>;
    await json("PATCH", `/collections/${primary}/cards/${targetId}`, body);
  }

  for (const expectation of testCase.expect) {
    const binderId = expectation.binder === "primary" ? primary : secondary!;
    await assertExpectation(testCase, binderId, expectation);
  }
}

async function assertExpectation(
  testCase: CollectionSemanticsCase,
  binderId: string,
  expectation: SemanticsExpectation,
) {
  const binder = await readBinder(binderId);
  const card = findCard(binder, expectation.externalId);
  const where = `${testCase.id} [${expectation.binder}]`;

  if (expectation.quantity === null) {
    assert.equal(card, undefined, `${where}: card should have been removed`);
    return;
  }

  assert.ok(card, `${where}: card missing`);
  assert.equal(
    card.quantity,
    expectation.quantity,
    `${where}: quantity mismatch`,
  );

  if (!expectation.copy0) return;
  const copy = card.copies?.[0];
  assert.ok(copy, `${where}: no copies on the card`);
  for (const [field, want] of Object.entries(expectation.copy0)) {
    const got: unknown = copy[field];
    if (want === undefined) {
      assert.ok(
        got === undefined || got === null,
        `${where}: ${field} should be cleared, got ${JSON.stringify(got)}`,
      );
    } else {
      assert.deepEqual(got, want, `${where}: ${field} mismatch`);
    }
  }
}

for (const testCase of COLLECTION_SEMANTICS_CASES) {
  test(`demo semantics: ${testCase.id}`, async () => {
    await runCase(testCase);
  });
}
