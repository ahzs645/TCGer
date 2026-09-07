import assert from "node:assert/strict";
import test from "node:test";
import { LatestRequest } from "./latest-request";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("late success and errors cannot replace a newer search or end its loading state", async () => {
  for (const fail of [false, true]) {
    const requests = new LatestRequest();
    const old = deferred<number>();
    const current = deferred<number>();
    const results: unknown[] = [];
    const first = requests.run(() => old.promise, (result) => results.push(result));
    const second = requests.run(() => current.promise, (result) => results.push(result));
    if (fail) old.reject(new Error("old failure")); else old.resolve(1);
    await first;
    assert.deepEqual(results, [], "old request must not complete current loading state");
    current.resolve(2);
    await second;
    assert.deepEqual(results, [{ value: 2 }]);
  }
});

test("changing context or unmounting suppresses a pending completion", async () => {
  const requests = new LatestRequest();
  const pending = deferred<number>();
  const result = requests.run(() => pending.promise, () => assert.fail("cancelled completion"));
  requests.cancel();
  pending.resolve(1);
  await result;
  const error = new Error("current failure");
  await requests.run(async () => { throw error; }, (result) => assert.equal(result.error, error));
});
