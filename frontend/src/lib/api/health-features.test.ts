import { expect, test } from "vitest";
import { createServerFeatureCache, parseServerFeatures } from "./health-features";

test("explicit disabled online codes survives parsing; unknown and malformed flags stay unknown", () => {
  expect(parseServerFeatures({features: {onlineCodes: false, decks: true, finance: "false", future: true}})).toEqual({onlineCodes: false, decks: true});
  expect(parseServerFeatures(null)).toEqual({});
});
test("an outage does not permanently cache fail-open and recovery notifies mounted consumers", async () => {
  let calls = 0;
  const cache = createServerFeatureCache(async () => {
    if (++calls === 1) throw new Error("offline");
    return {features: {onlineCodes: false}};
  });
  const seen: unknown[] = [];
  const unsubscribe = cache.subscribe(features => seen.push(features));
  expect(await cache.get()).toEqual({});
  expect(await cache.get()).toEqual({onlineCodes: false});
  expect(seen).toEqual([{onlineCodes: false}]);
  await cache.get();
  expect(calls).toBe(2);
  unsubscribe();
});
test("recovery refresh supersedes an older in-flight fetch", async () => {
  let finish!: (value: unknown) => void;
  let calls = 0;
  const cache = createServerFeatureCache(async () => ++calls === 1 ? new Promise(resolve => {finish = resolve;}) : {features: {onlineCodes: false}});
  const seen: unknown[] = [];
  cache.subscribe(value => seen.push(value));
  const old = cache.get();
  await cache.refresh();
  finish({features: {onlineCodes: true}});
  await old;
  expect(await cache.get()).toEqual({onlineCodes: false});
  expect(seen).toEqual([{onlineCodes: false}]);
});
