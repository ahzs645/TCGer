import assert from "node:assert/strict";
import test from "node:test";

import type { Card } from "@tcg/api-types";

import { selectBestCatalogCardMatch } from "./catalog-search";

function card(overrides: Partial<Card> & Pick<Card, "id">): Card {
  const { id, ...rest } = overrides;
  return {
    id,
    tcg: overrides.tcg ?? "magic",
    name: overrides.name ?? "Lightning Bolt",
    ...rest,
  };
}

test("prefers an exact set and collector-number printing", () => {
  const match = selectBestCatalogCardMatch(
    {
      key: "bolt",
      name: "Lightning Bolt",
      setCode: "STA",
      collectorNumber: "042",
    },
    [
      card({ id: "other", setCode: "2xm", collectorNumber: "117" }),
      card({ id: "expected", setCode: "sta", collectorNumber: "42" }),
    ],
  );

  assert.equal(match?.id, "expected");
});

test("uses set name and collector number when provider set codes differ", () => {
  const match = selectBestCatalogCardMatch(
    {
      key: "charizard",
      name: "Charizard ex",
      setCode: "PAL",
      setName: "Paldea Evolved",
      collectorNumber: "199",
    },
    [
      card({
        id: "wrong-set",
        tcg: "pokemon",
        name: "Charizard ex",
        setCode: "sv3",
        setName: "Obsidian Flames",
        collectorNumber: "125",
      }),
      card({
        id: "expected",
        tcg: "pokemon",
        name: "Charizard ex",
        setCode: "sv2",
        setName: "Paldea Evolved",
        collectorNumber: "199",
      }),
    ],
  );

  assert.equal(match?.id, "expected");
});

test("falls back deterministically to an exact card name", () => {
  const match = selectBestCatalogCardMatch(
    { key: "blue-eyes", name: "Blue-Eyes White Dragon" },
    [
      card({ id: "z-print", tcg: "yugioh", name: "Blue-Eyes White Dragon" }),
      card({ id: "a-print", tcg: "yugioh", name: "Blue-Eyes White Dragon" }),
    ],
  );

  assert.equal(match?.id, "a-print");
});

test("does not enrich from a partial-name match", () => {
  const match = selectBestCatalogCardMatch(
    { key: "blue-eyes", name: "Blue-Eyes White Dragon" },
    [
      card({
        id: "alternative",
        tcg: "yugioh",
        name: "Blue-Eyes Alternative White Dragon",
      }),
    ],
  );

  assert.equal(match, undefined);
});
