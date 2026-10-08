import { expect, test } from "vitest";
import {
  createServerFeatureCache,
  parseServerFeatures,
} from "./health-features";

test("explicit disabled online codes survives parsing; unknown and malformed flags stay unknown", () => {
  expect(
    parseServerFeatures({
      features: {
        onlineCodes: false,
        decks: true,
        finance: "false",
        future: true,
      },
    }),
  ).toEqual({ onlineCodes: false, decks: true });
  expect(parseServerFeatures(null)).toEqual({});
});
test("an outage does not permanently cache fail-open and recovery notifies mounted consumers", async () => {
  let calls = 0;
  const cache = createServerFeatureCache(async () => {
    if (++calls === 1) throw new Error("offline");
    return { features: { onlineCodes: false } };
  });
  const seen: unknown[] = [];
  const unsubscribe = cache.subscribe((features) => seen.push(features));
  expect(await cache.get()).toEqual({});
  expect(await cache.get()).toEqual({ onlineCodes: false });
  expect(seen).toEqual([{ onlineCodes: false }]);
  await cache.get();
  expect(calls).toBe(2);
  unsubscribe();
});
test("recovery refresh supersedes an older in-flight fetch", async () => {
  let finish!: (value: unknown) => void;
  let calls = 0;
  const cache = createServerFeatureCache(async () =>
    ++calls === 1
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : { features: { onlineCodes: false } },
  );
  const seen: unknown[] = [];
  cache.subscribe((value) => seen.push(value));
  const old = cache.get();
  await cache.refresh();
  finish({ features: { onlineCodes: true } });
  await old;
  expect(await cache.get()).toEqual({ onlineCodes: false });
  expect(seen).toEqual([{ onlineCodes: false }]);
});

test("concurrent status checks and navigation features share one health request", async () => {
  let finish!: (value: unknown) => void;
  let calls = 0;
  const cache = createServerFeatureCache(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const statuses: string[] = [];
  const unsubscribe = cache.subscribeStatus((status) => statuses.push(status));
  const statusCheck = cache.check();
  const featuresCheck = cache.get();
  const remountCheck = cache.check();
  expect(calls).toBe(1);
  finish({ features: { decks: false } });
  expect(await Promise.all([statusCheck, featuresCheck, remountCheck])).toEqual(
    [{ decks: false }, { decks: false }, { decks: false }],
  );
  expect(statuses).toEqual(["checking", "online"]);
  unsubscribe();
});

test("a later status check detects outages and recovery updates mounted feature consumers", async () => {
  let offline = false;
  const cache = createServerFeatureCache(async () => {
    if (offline) throw new Error("offline");
    return { features: { decks: false } };
  });
  const statuses: string[] = [];
  const features: unknown[] = [];
  cache.subscribeStatus((status) => statuses.push(status));
  cache.subscribe((value) => features.push(value));
  await cache.check();
  offline = true;
  await cache.check();
  offline = false;
  await cache.check();
  expect(statuses).toEqual(["checking", "online", "offline", "online"]);
  expect(features).toEqual([{ decks: false }, { decks: false }]);
});

test("a superseded failed response cannot replace the recovered status", async () => {
  let fail!: (error: Error) => void;
  let calls = 0;
  const cache = createServerFeatureCache(async () =>
    ++calls === 1
      ? new Promise((_, reject) => {
          fail = reject;
        })
      : { features: { decks: false } },
  );
  const statuses: string[] = [];
  cache.subscribeStatus((status) => statuses.push(status));
  const old = cache.check();
  await cache.refresh();
  fail(new Error("old outage"));
  await old;
  expect(statuses).toEqual(["checking", "online"]);
});
