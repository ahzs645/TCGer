import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import {
  authLifecycleFetch,
  beginAuthAction,
  canSynchronizeAuthSession,
} from "./auth-lifecycle";
import { useAuthStore, type AuthUser } from "@/stores/auth";
import { SessionChangedError } from "./private-session";

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
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const response = (id: string) =>
  new Response(JSON.stringify({ user: { id }, session: { token: id } }));
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mock.method(console, "warn", () => undefined);
  beginAuthAction("signout").finish();
});
afterEach(() => mock.restoreAll());

test("logout while bootstrap getSession is pending cannot reinstate its old account", async () => {
  useAuthStore.getState().setAuth(user("A"), "A");
  const pending = deferred<Response>();
  const session = authLifecycleFetch(
    () => pending.promise,
    "https://example.test/api/auth/get-session",
  ).catch((error) => error);
  beginAuthAction("signout").finish();
  pending.resolve(response("A"));
  assert.ok((await session) instanceof SessionChangedError);
  assert.equal(canSynchronizeAuthSession("A", "A"), false);
  assert.equal(useAuthStore.getState().isAuthenticated, false);
});

test("logout immediately cancels a pending login even when no prior user was signed in", async () => {
  const pending = deferred<string>();
  const login = beginAuthAction("signin");
  const result = login.run(() => pending.promise).catch((error) => error);
  await tick();
  const logout = beginAuthAction("signout");
  const order: string[] = [];
  const signedOut = logout.run(async () => {
    order.push("signout");
  });
  assert.equal(useAuthStore.getState().isAuthenticated, false);
  pending.resolve("old login committed");
  assert.ok((await result) instanceof SessionChangedError);
  await signedOut;
  logout.finish();
  assert.deepEqual(order, ["signout"]);
  assert.throws(() => login.accept(user("A"), "A"), SessionChangedError);
});

for (const failed of [false, true])
  test(`a newer login wins over an older login's ${failed ? "error" : "success"}, with ordered cookie writes`, async () => {
    const pending = deferred<string>();
    const first = beginAuthAction("signin");
    const calls: string[] = [];
    const old = first
      .run(async () => {
        calls.push("A");
        return pending.promise;
      })
      .catch((error) => error);
    await tick();
    const second = beginAuthAction("signin");
    const fresh = second.run(async () => {
      calls.push("B");
      return "B";
    });
    await tick();
    assert.deepEqual(calls, ["A"]);
    if (failed) pending.reject(new Error("A's private login failure"));
    else pending.resolve("A");
    assert.ok((await old) instanceof SessionChangedError);
    assert.equal(await fresh, "B");
    second.accept(user("B"), "B");
    second.finish();
    assert.deepEqual(calls, ["A", "B"]);
    assert.equal(useAuthStore.getState().user?.id, "B");
    assert.equal(canSynchronizeAuthSession("A", "A"), false);
    assert.equal(canSynchronizeAuthSession("B", "B"), true);
  });

test("a previously cached hook value and new cookie responses stay fenced after signout", async () => {
  useAuthStore.getState().setAuth(user("A"), "A");
  assert.equal(canSynchronizeAuthSession("A", "A"), true);
  beginAuthAction("signout").finish();
  assert.equal(canSynchronizeAuthSession("A", "A"), false);
  await assert.rejects(
    authLifecycleFetch(
      async () => response("A"),
      "https://example.test/api/auth/get-session",
    ),
    SessionChangedError,
  );
  assert.equal(useAuthStore.getState().user, null);
});

test("body parsing and account changes fence auth responses after headers arrive", async () => {
  const attempt = beginAuthAction("signin");
  const guarded = await authLifecycleFetch(
    async () => response("A"),
    "https://example.test/api/auth/sign-in/username",
  );
  const replacement = beginAuthAction("signin");
  replacement.accept(user("B"), "B");
  await assert.rejects(guarded.json(), SessionChangedError);
  assert.equal(attempt.current(), false);
});
