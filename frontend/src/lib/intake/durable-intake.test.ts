import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { useAuthStore, type AuthUser } from "@/stores/auth";
import {
  loadIntakeDraft,
  prepareIntakeDraft,
  submitIntakeDraft,
  type IntakeDraft,
} from "./durable-intake";

const account = (id: string) =>
  ({
    id,
    email: `${id}@example.test`,
    isAdmin: false,
    showCardNumbers: true,
    showPricing: true,
    enabledYugioh: true,
    enabledMagic: true,
    enabledPokemon: true,
    enabledOnepiece: false,
    enabledLorcana: false,
    enabledDragonball: false,
  }) satisfies AuthUser;
const draft = (): IntakeDraft => ({
  collectionId: "binder-original",
  request: {
    operationId: "durable-operation-1",
    source: "scanner",
    rows: [
      {
        rowId: "review-row-1",
        cardId: "card-a",
        quantity: 1,
        cardData: { externalId: "card-a", tcg: "pokemon", name: "Actual card" },
      },
    ],
  },
});
let values: Map<string, string>;
let writesFail: boolean;
beforeEach(() => {
  mock.method(console, "warn", () => undefined);
  values = new Map();
  writesFail = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (writesFail) throw new Error("Storage full");
        values.set(key, value);
      },
      removeItem: (key: string) => values.delete(key),
    },
  });
  useAuthStore.getState().setAuth(account("A"), "A");
});
afterEach(() => {
  mock.restoreAll();
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("a lost response and changed review replay the frozen operation without extra copies", async () => {
  const committed = new Map<
    string,
    {
      operationId: string;
      entryIds: string[];
      rows: Array<{ rowId: string; entryIds: string[] }>;
    }
  >();
  const requests: unknown[] = [];
  let loseFirstResponse = true;
  mock.method(
    globalThis,
    "fetch",
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      const receipt = committed.get(request.operationId) ?? {
        operationId: request.operationId,
        entryIds: ["physical-copy-1"],
        rows: [{ rowId: request.rows[0].rowId, entryIds: ["physical-copy-1"] }],
      };
      committed.set(request.operationId, receipt);
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error("Response lost after commit");
      }
      return new Response(JSON.stringify(receipt));
    },
  );
  await assert.rejects(
    submitIntakeDraft("A", "scan", draft()),
    /Response lost/,
  );
  assert.equal(
    loadIntakeDraft("scan")?.request.operationId,
    "durable-operation-1",
  );
  const changed = draft();
  changed.collectionId = "different-binder";
  changed.request.operationId = "accidental-new-key";
  changed.request.rows[0]!.quantity = 5;
  const receipt = await submitIntakeDraft("A", "scan", changed);
  assert.equal(committed.size, 1);
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(receipt.entryIds, ["physical-copy-1"]);
  assert.equal(loadIntakeDraft("scan")?.collectionId, "binder-original");
});

test("failure to persist the frozen operation prevents a network mutation", async () => {
  const fetch = mock.method(
    globalThis,
    "fetch",
    async () => new Response("{}"),
  );
  writesFail = true;
  await assert.rejects(submitIntakeDraft("A", "scan", draft()), /Storage full/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("drafts survive credential rotation but remain isolated from other accounts", () => {
  const input = draft();
  prepareIntakeDraft("scan", input);
  input.request.rows[0]!.cardId = "edited-after-freeze";
  useAuthStore.getState().setAuth(account("A"), "A-rotated");
  assert.equal(loadIntakeDraft("scan")?.request.rows[0]?.cardId, "card-a");
  useAuthStore.getState().setAuth(account("B"), "B");
  assert.equal(loadIntakeDraft("scan"), null);
  useAuthStore.getState().setAuth(account("A"), "A-rotated");
  assert.equal(
    loadIntakeDraft("scan")?.request.operationId,
    "durable-operation-1",
  );
});

test("a storage failure after server commit retains the original recoverable request", async () => {
  mock.method(
    globalThis,
    "fetch",
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      writesFail = true;
      return new Response(
        JSON.stringify({
          operationId: request.operationId,
          entryIds: ["copy-1"],
          rows: [{ rowId: "review-row-1", entryIds: ["copy-1"] }],
        }),
      );
    },
  );
  await assert.rejects(submitIntakeDraft("A", "scan", draft()), /Storage full/);
  assert.equal(
    loadIntakeDraft("scan")?.request.operationId,
    "durable-operation-1",
  );
  assert.equal(loadIntakeDraft("scan")?.receipt, undefined);
});

test("an incomplete or unrelated receipt never marks a reviewed row as saved", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          operationId: "durable-operation-1",
          entryIds: ["unrelated-copy"],
          rows: [{ rowId: "other-review", entryIds: ["unrelated-copy"] }],
        }),
      ),
  );
  await assert.rejects(
    submitIntakeDraft("A", "scan", draft()),
    /intake receipt/,
  );
  assert.equal(loadIntakeDraft("scan")?.receipt, undefined);
  assert.equal(loadIntakeDraft("scan")?.request.rows[0]?.rowId, "review-row-1");
});
