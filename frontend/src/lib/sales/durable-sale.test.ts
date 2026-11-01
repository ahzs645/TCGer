import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { useAuthStore, type AuthUser } from "@/stores/auth";
import { pendingSales, submitDurableSale } from "./durable-sale";
import type { InventorySaleInput } from "@tcg/api-types";
const user = (id: string): AuthUser => ({
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
});
const input = (): InventorySaleInput => ({
  operationId: "sale-operation-1",
  collectionId: "binder",
  copyIds: ["copy-1"],
  amount: 32,
  currency: "CAD",
  removeFromInventory: true,
});
let values: Map<string, string>;
beforeEach(() => {
  mock.method(console, "warn", () => undefined);
  values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  useAuthStore.getState().setAuth(user("A"), "A");
});
afterEach(() => {
  mock.restoreAll();
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("a sale with a lost response remains recoverable after its copy is removed and uses its original currency/operation", async () => {
  let sent = 0;
  const requests: InventorySaleInput[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      const sale = JSON.parse(String(init?.body));
      requests.push(sale);
      if (++sent === 1) throw new Error("Response lost after sale commit");
      return Response.json({
        operationId: sale.operationId,
        transactionId: "transaction-1",
        copyIds: ["copy-1"],
        removedCopyIds: ["copy-1"],
        amount: sale.amount,
        currency: sale.currency,
      });
    },
  );
  await assert.rejects(submitDurableSale("A", input()), /Response lost/);
  assert.equal(pendingSales().length, 1);
  const receipt = await submitDurableSale("A", {
    ...input(),
    operationId: "new-click-key",
    amount: 99,
    currency: "USD",
  });
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(receipt.currency, "CAD");
  assert.equal(receipt.amount, 32);
  assert.deepEqual(receipt.removedCopyIds, ["copy-1"]);
  assert.equal(pendingSales().length, 0);
});

test("other accounts cannot enumerate or recover this account's pending sale", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("offline");
  });
  await assert.rejects(submitDurableSale("A", input()));
  useAuthStore.getState().setAuth(user("B"), "B");
  assert.equal(pendingSales().length, 0);
  useAuthStore.getState().setAuth(user("A"), "rotated-A");
  assert.equal(pendingSales()[0]?.input.operationId, "sale-operation-1");
});
