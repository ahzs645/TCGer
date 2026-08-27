import assert from "node:assert/strict";
import test from "node:test";

import type {
  PackOpeningNativeCardPool,
  PackOpeningNativePackOption,
} from "@tcg/pack-core/experience";

import {
  filterPackSets,
  filterPossiblePulls,
  groupPackOptions,
  possiblePullRarities,
} from "./pack-browsing";

const option = (
  id: string,
  setID: string,
  setLabel: string,
  variationLabel: string,
): PackOpeningNativePackOption => ({
  id,
  label: `${setLabel} · ${variationLabel}`,
  setID,
  setLabel,
  variationLabel,
  packPoolID: setID,
  oddsReference: {
    title: "Source",
    url: "https://example.com",
    sampleSize: 1,
    note: "",
  },
});

const groups = groupPackOptions([
  option("base1:red", "base1", "Base Set", "Red wrapper"),
  option("base1:blue", "base1", "Base Set", "Blue wrapper"),
  option("me5:black", "me5", "Pitch Black", "Black wrapper"),
]);

test("groups variants and searches set or wrapper labels", () => {
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.options.length, 2);
  assert.deepEqual(
    filterPackSets(groups, {
      query: "black wrapper",
      availability: "all",
      isDownloaded: () => false,
      canOpen: () => true,
    }).map((group) => group.id),
    ["me5"],
  );
});

test("filters sets by download status and offline accessibility", () => {
  assert.deepEqual(
    filterPackSets(groups, {
      query: "",
      availability: "downloaded",
      isDownloaded: (setID) => setID === "base1",
      canOpen: (setID) => setID === "base1",
    }).map((group) => group.id),
    ["base1"],
  );
});

const pool: PackOpeningNativeCardPool = {
  id: "base1",
  label: "Base Set",
  cards: [
    {
      cardId: "charizard",
      name: "Charizard",
      rarity: "Rare Holo",
      tier: "chase",
      collectorNumber: "4",
      tcg: "pokemon",
      setCode: "base1",
      setName: "Base Set",
      imageUrl: "https://example.com/charizard-high.webp",
      imageUrlSmall: "https://example.com/charizard-low.webp",
    },
    {
      cardId: "bulbasaur",
      name: "Bulbasaur",
      rarity: "Common",
      tier: "common",
      collectorNumber: "44",
      tcg: "pokemon",
      setCode: "base1",
      setName: "Base Set",
      imageUrl: "https://example.com/bulbasaur-high.webp",
      imageUrlSmall: "https://example.com/bulbasaur-low.webp",
    },
  ],
};

test("possible pulls combine search and an exact rarity filter", () => {
  assert.deepEqual(possiblePullRarities(pool), ["Common", "Rare Holo"]);
  assert.deepEqual(
    filterPossiblePulls(pool, "char", "Rare Holo").map((card) => card.cardId),
    ["charizard"],
  );
  assert.equal(filterPossiblePulls(pool, "char", "Common").length, 0);
});
