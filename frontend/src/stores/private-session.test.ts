import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { useAuthStore, type AuthUser } from "./auth";
import { useCollectionsStore } from "./collections";
import { useWishlistsStore } from "./wishlists";
import { useTagsStore } from "./tags";
import {
  SessionChangedError,
  capturePrivateSession,
} from "@/lib/private-session";
import { sessionFetch } from "@/lib/api/session-fetch";
import { createPrivateQueryClient } from "@/lib/private-query-client";

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
function signIn(id: string, token = id) {
  useAuthStore.getState().setAuth(user(id), token);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });
beforeEach(() => {
  mock.method(console, "warn", () => undefined);
  useAuthStore.getState().clearAuth();
  signIn("A");
});
afterEach(() => {
  mock.restoreAll();
});

test("logout synchronously clears collections, wishlists, tags and the query cache", () => {
  const cache = createPrivateQueryClient();
  cache.connect();
  useCollectionsStore.setState({
    collections: [{ id: "private-A" } as never],
    hasFetched: true,
  });
  useWishlistsStore.setState({
    wishlists: [{ id: "private-A" } as never],
    hasFetched: true,
  });
  useTagsStore.setState({ tags: [{ id: "private-A" } as never] });
  cache.client.setQueryData(["finance"], { amount: 100 });
  useAuthStore.getState().clearAuth();
  assert.deepEqual(useCollectionsStore.getState().collections, []);
  assert.equal(useCollectionsStore.getState().hasFetched, false);
  assert.deepEqual(useWishlistsStore.getState().wishlists, []);
  assert.deepEqual(useTagsStore.getState().tags, []);
  assert.equal(cache.client.getQueryData(["finance"]), undefined);
  cache.dispose();
});

test("A's late collection fetch cannot replace B's completed fetch", async () => {
  const pending = deferred<Response>();
  mock.method(
    globalThis,
    "fetch",
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Headers(init?.headers).get("Authorization") === "Bearer A"
        ? pending.promise
        : Promise.resolve(response([{ id: "B-binder" }])),
  );
  const old = useCollectionsStore.getState().fetchCollections("A");
  signIn("B");
  await useCollectionsStore.getState().fetchCollections("B");
  pending.resolve(response([{ id: "A-binder" }]));
  await old;
  assert.deepEqual(
    useCollectionsStore.getState().collections.map((item) => item.id),
    ["B-binder"],
  );
});

for (const [name, action, state] of [
  [
    "collection",
    () => useCollectionsStore.getState().addCollection("A", { name: "old" }),
    () => useCollectionsStore.getState(),
  ],
  [
    "wishlist",
    () => useWishlistsStore.getState().addWishlist("A", { name: "old" }),
    () => useWishlistsStore.getState(),
  ],
  [
    "tag",
    () => useTagsStore.getState().addTag("A", { label: "old" }),
    () => useTagsStore.getState(),
  ],
] as const) {
  for (const fail of [false, true])
    test(`${name} ${fail ? "failure" : "success"} after account change cannot publish private mutation state`, async () => {
      const pending = deferred<Response>();
      mock.method(globalThis, "fetch", () => pending.promise);
      const result = action().catch((error) => error);
      signIn("B");
      const fresh = state();
      if (fail) pending.reject(new Error("A's private error"));
      else pending.resolve(response({ id: "A-private", name: "old" }));
      assert.ok((await result) instanceof SessionChangedError);
      assert.equal(state(), fresh);
      assert.equal(state().error, null);
    });
}

test("A → B → A and credential rotation invalidate previously captured work", () => {
  const origin = capturePrivateSession("A");
  signIn("B");
  signIn("A");
  assert.equal(origin.current(), false);
  const beforeRotation = capturePrivateSession("A");
  signIn("A", "rotated");
  assert.equal(beforeRotation.current(), false);
});

test("body decoding is guarded even if HTTP headers arrived before logout", async () => {
  const body = deferred<unknown>();
  const http = response(null);
  http.json = () => body.promise;
  mock.method(globalThis, "fetch", async () => http);
  const received = await sessionFetch("https://example.test/private");
  const decoded = received.json().catch((error) => error);
  signIn("B");
  body.resolve({ account: "A" });
  assert.ok((await decoded) instanceof SessionChangedError);
});

test("a stale caller cannot send its bearer token using the replacement account's cookies", async () => {
  signIn("B");
  const fetch = mock.method(globalThis, "fetch", async () => response(null));
  await assert.rejects(
    sessionFetch("https://example.test/private", {
      headers: { Authorization: "Bearer A" },
    }),
    SessionChangedError,
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test("inventory commits invalidate ownership and every private query", async () => {
  const cache = createPrivateQueryClient();
  cache.connect();
  useCollectionsStore.setState({ hasFetched: true });
  useWishlistsStore.setState({ hasFetched: true });
  cache.client.setQueryData(["finance"], { amount: 100 });
  mock.method(globalThis, "fetch", async () => response({ success: true }));
  await sessionFetch("https://example.test/collections/binder/intake", {
    method: "POST",
    headers: { Authorization: "Bearer A" },
  });
  assert.equal(useCollectionsStore.getState().hasFetched, false);
  assert.equal(useWishlistsStore.getState().hasFetched, false);
  assert.equal(cache.client.getQueryState(["finance"])?.isInvalidated, true);
  cache.dispose();
});

test("portable backup import and recovery refresh ownership, tags and private queries", async () => {
  const cache = createPrivateQueryClient();
  cache.connect();
  for (const path of ["/backups", "/backups/recovery"]) {
    useCollectionsStore.setState({ hasFetched: true });
    useWishlistsStore.setState({ hasFetched: true });
    useTagsStore.setState({ tags: [{ id: "old-tag" } as never] });
    cache.client.setQueryData(["storage"], { old: true });
    mock.method(globalThis, "fetch", async () => response({ success: true }));
    await sessionFetch(`https://example.test${path}`, {
      method: "POST",
      headers: { Authorization: "Bearer A" },
    });
    assert.equal(useCollectionsStore.getState().hasFetched, false);
    assert.equal(useWishlistsStore.getState().hasFetched, false);
    assert.deepEqual(useTagsStore.getState().tags, []);
    assert.equal(cache.client.getQueryState(["storage"])?.isInvalidated, true);
  }
  cache.dispose();
});
