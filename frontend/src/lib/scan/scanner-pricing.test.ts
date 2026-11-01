import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { TrackedPriceItem, TrackedPricesResponse } from "@tcg/api-types";
import {
  ScannerPriceController,
  scannerPriceItems,
  scannerPriceKey,
  scannerPriceSnapshot,
} from "./scanner-pricing";
import { useAuthStore, type AuthUser } from "@/stores/auth";

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
const base: TrackedPriceItem = {
  tcg: "pokemon",
  externalId: "same-printing",
  finishCode: "normal",
  condition: "Near Mint",
  language: "English",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function response(item: TrackedPriceItem, price = 12): TrackedPricesResponse {
  const now = new Date().toISOString();
  return {
    prices: [
      {
        ...item,
        key: scannerPriceKey(item),
        price,
        currency: "CAD",
        cached: true,
        updatedAt: now,
        source: "test-provider",
      },
    ],
    refreshedAt: now,
    refreshAfter: new Date(Date.now() + 3_600_000).toISOString(),
    health: {
      status: "healthy",
      total: 1,
      priced: 1,
      fresh: 1,
      stale: 0,
      missing: 0,
      failed: 0,
      lowConfidence: 0,
      coverage: 1,
      freshnessHours: 24,
      message: "One exact quote",
    },
  };
}
beforeEach(() => {
  mock.method(console, "warn", () => undefined);
  useAuthStore.getState().setAuth(user("A"), "A");
});
afterEach(() => mock.restoreAll());

test("scanner quote identity preserves game, printing, finish, condition and language", () => {
  const variants = [
    base,
    { ...base },
    { ...base, tcg: "magic" },
    { ...base, externalId: "other-printing" },
    { ...base, finishCode: "holo" },
    { ...base, condition: "Damaged" },
    { ...base, language: "Japanese" },
  ];
  assert.equal(scannerPriceItems(variants).length, 6);
  assert.equal(
    new Set(scannerPriceItems(variants).map(scannerPriceKey)).size,
    6,
  );
});

for (const failed of [false, true])
  test(`a superseded finish's late ${failed ? "error" : "quote"} cannot replace the current finish`, async () => {
    const first = deferred<TrackedPricesResponse>();
    const second = deferred<TrackedPricesResponse>();
    const holo = { ...base, finishCode: "holo" };
    const controller = new ScannerPriceController(async (_token, items) =>
      items[0]?.finishCode === "holo" ? second.promise : first.promise,
    );
    const publications: unknown[] = [];
    const old = controller.refresh("A", [base], "automatic", false, (result) =>
      publications.push(result),
    );
    const fresh = controller.refresh(
      "A",
      [holo],
      "automatic",
      false,
      (result) => publications.push(result),
    );
    second.resolve(response(holo, 30));
    await fresh;
    if (failed) first.reject(new Error("Old finish failure"));
    else first.resolve(response(base, 1));
    await old;
    assert.equal(publications.length, 1);
    assert.equal(
      (
        publications[0] as {
          value: { quotes: Record<string, { price: number }> };
        }
      ).value.quotes[scannerPriceKey(holo)]?.price,
      30,
    );
  });

for (const failed of [false, true])
  test(`replacement account rejects the old scanner ${failed ? "error" : "quote"}`, async () => {
    const pending = deferred<TrackedPricesResponse>();
    const controller = new ScannerPriceController(async () => pending.promise);
    const publications: unknown[] = [];
    const request = controller.refresh(
      "A",
      [base],
      "automatic",
      false,
      (result) => publications.push(result),
    );
    useAuthStore.getState().setAuth(user("B"), "B");
    if (failed) pending.reject(new Error("A's pricing failure"));
    else pending.resolve(response(base));
    await request;
    assert.deepEqual(publications, []);
  });

test("disabling automatic mode or clearing the session cancels its in-flight completion", async () => {
  const pending = deferred<TrackedPricesResponse>();
  const controller = new ScannerPriceController(async () => pending.promise);
  const publications: unknown[] = [];
  const request = controller.refresh(
    "A",
    [base],
    "automatic",
    false,
    (result) => publications.push(result),
  );
  controller.cancel();
  pending.resolve(response(base));
  await request;
  assert.deepEqual(publications, []);
});

test("provider keys cannot substitute another game or an unspecified variant", () => {
  for (const wrong of [
    { ...base, tcg: "magic" },
    { ...base, finishCode: undefined },
    { ...base, condition: undefined },
    { ...base, language: undefined },
  ]) {
    const received = response(wrong);
    received.prices[0]!.key = scannerPriceKey(base);
    const quote = scannerPriceSnapshot([base], received).quotes[
      scannerPriceKey(base)
    ];
    assert.equal(quote?.freshness, "missing");
    assert.equal(quote?.price, undefined);
  }
});

test("quotes keep original currency and expose stale or unknown dates instead of inventing freshness", () => {
  const received = response(base);
  received.prices[0]!.updatedAt = "2020-01-01T00:00:00.000Z";
  const stale = scannerPriceSnapshot([base], received).quotes[
    scannerPriceKey(base)
  ]!;
  assert.equal(stale.currency, "CAD");
  assert.equal(stale.freshness, "stale");
  delete received.prices[0]!.updatedAt;
  assert.equal(
    scannerPriceSnapshot([base], received).quotes[scannerPriceKey(base)]
      ?.freshness,
    "unknown",
  );
  delete received.prices[0]!.currency;
  assert.equal(
    scannerPriceSnapshot([base], received).quotes[scannerPriceKey(base)]
      ?.freshness,
    "missing",
  );
});
