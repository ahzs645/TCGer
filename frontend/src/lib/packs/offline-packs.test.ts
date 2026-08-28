import assert from "node:assert/strict";
import test from "node:test";

import type { PackOpeningPull } from "@tcg/pack-core/experience";

import {
  canOpenPackSet,
  offlinePackAssetURLs,
  offlinePackCacheName,
  parseOfflinePackRecords,
  serializeOfflinePackRecords,
} from "./offline-packs";

const card: PackOpeningPull = {
  cardId: "base1-4",
  name: "Charizard",
  rarity: "Rare Holo",
  tier: "chase",
  collectorNumber: "4",
  tcg: "pokemon",
  setCode: "base1",
  setName: "Base Set",
  imageUrl: "https://assets.example/4/high.webp",
  imageUrlSmall: "https://assets.example/4/low.webp",
};

test("builds a stable set-specific cache with card and pack assets", () => {
  assert.equal(offlinePackCacheName("BASE1"), "tcger-v2-pack-base1");
  assert.deepEqual(offlinePackAssetURLs([card, card]), [
    "/pack/manifest.json",
    "/pack/models/pack.obj",
    "/pack/card-backs/pokemon.png",
    card.imageUrl,
    card.imageUrlSmall,
  ]);
});

test("round trips valid download metadata and discards unsupported records", () => {
  const records = {
    base1: {
      setID: "base1",
      downloadedAt: "2026-08-26T00:00:00.000Z",
      cardCount: 102,
      assetCount: 207,
      byteCount: 1234,
    },
  };
  assert.deepEqual(
    parseOfflinePackRecords(serializeOfflinePackRecords(records)),
    records,
  );
  assert.deepEqual(
    parseOfflinePackRecords(
      JSON.stringify({ ...records, unknown: records.base1 }),
    ),
    records,
  );
  assert.deepEqual(parseOfflinePackRecords("not-json"), {});
});

test("downloaded packs remain openable when a reported route is unusable", () => {
  const records = {
    base1: {
      setID: "base1",
      downloadedAt: "2026-08-26T00:00:00.000Z",
      cardCount: 102,
      assetCount: 207,
      byteCount: 1234,
    },
  };

  assert.equal(canOpenPackSet("base1", false, records), true);
  assert.equal(canOpenPackSet("me5", false, records), false);
  assert.equal(canOpenPackSet("me5", true, records), true);
});
