import { describe, expect, test } from "vitest";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";
import {
  COLLECTION_SEMANTICS_CASES,
  SECONDARY_BINDER_TOKEN,
  type CollectionSemanticsCase,
  type SemanticsExpectation,
} from "../../packages/api-types/src/collection-semantics";

/**
 * Server-side harness for the shared collection-semantics fixtures.
 *
 * Drives the same table as
 * `frontend/src/lib/api/collection-semantics.test.ts`, through the real HTTP
 * router instead of the demo adapter. See the header of
 * `packages/api-types/src/collection-semantics.ts` for why the rules are pinned
 * as fixtures rather than extracted into a shared module.
 */

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

function headersFor(caseId: string) {
  // A distinct viewer per case, so one case cannot see another's binders.
  const subject = `user_${caseId.replace(/[^a-z0-9]/gi, "_")}`;
  return {
    Authorization: "Bearer local-test-token",
    "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
    "x-tcger-user-id": subject,
    "x-tcger-user-email": `${subject}@example.com`,
    "x-tcger-username": subject,
  };
}

async function runCase(testCase: CollectionSemanticsCase) {
  const t = createTestConvex();
  const headers = headersFor(testCase.id);

  const call = async (method: string, path: string, body?: unknown) =>
    t.fetch(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const json = async <T>(method: string, path: string, body?: unknown) => {
    const response = await call(method, path, body);
    expect(
      response.status,
      `${method} ${path} -> ${response.status}`,
    ).toBeLessThan(400);
    return (await response.json()) as T;
  };

  const createBinder = async (name: string) =>
    (
      await json<{ id: string }>("POST", "/collections", {
        name,
        colorHex: "22c55e",
      })
    ).id;

  const readBinder = (binderId: string) =>
    json<Binder>("GET", `/collections/${binderId}`);

  const findCard = (binder: Binder, externalId: string) =>
    binder.cards.find((card) => card.externalId === externalId);

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
  expect(
    seeded,
    `${testCase.id}: seed card missing before the action`,
  ).toBeDefined();

  const targetId =
    testCase.action.target === "card" ? seeded!.id : seeded!.copies![0]!.id;

  if (testCase.action.kind === "delete") {
    const response = await call(
      "DELETE",
      `/collections/${primary}/cards/${targetId}`,
    );
    expect(response.status, `${testCase.id}: DELETE`).toBeLessThan(400);
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
    await assertExpectation(testCase, await readBinder(binderId), expectation);
  }
}

function assertExpectation(
  testCase: CollectionSemanticsCase,
  binder: Binder,
  expectation: SemanticsExpectation,
) {
  const card = binder.cards.find(
    (entry) => entry.externalId === expectation.externalId,
  );
  const where = `${testCase.id} [${expectation.binder}]`;

  if (expectation.quantity === null) {
    expect(card, `${where}: card should have been removed`).toBeUndefined();
    return;
  }

  expect(card, `${where}: card missing`).toBeDefined();
  expect(card!.quantity, `${where}: quantity`).toBe(expectation.quantity);

  if (!expectation.copy0) return;
  const copy = card!.copies?.[0];
  expect(copy, `${where}: no copies on the card`).toBeDefined();
  for (const [field, want] of Object.entries(expectation.copy0)) {
    const got: unknown = copy![field];
    if (want === undefined) {
      expect(
        got === undefined || got === null,
        `${where}: ${field} should be cleared, got ${JSON.stringify(got)}`,
      ).toBe(true);
    } else {
      expect(got, `${where}: ${field}`).toEqual(want);
    }
  }
}

describe("shared collection semantics", () => {
  for (const testCase of COLLECTION_SEMANTICS_CASES) {
    test(testCase.id, async () => {
      await runCase(testCase);
    });
  }
});
