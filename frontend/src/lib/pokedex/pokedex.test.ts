import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPokedex,
  filterPokedex,
  pokedexProgress,
  speciesForCard,
} from "./pokedex";

test("explicit dex metadata supports cards featuring multiple species", () => {
  assert.deepEqual(
    speciesForCard({
      id: "tag-team",
      name: "Pikachu & Zekrom-GX",
      dexEntries: [
        { number: 25, name: "Pikachu" },
        { number: 644, name: "Zekrom" },
      ],
    }),
    [
      { number: 25, name: "Pikachu" },
      { number: 644, name: "Zekrom" },
    ],
  );
});

test("legacy name matching respects boundaries and excludes Trainer cards", () => {
  assert.deepEqual(
    speciesForCard({ id: "one", name: "Shining Mew", type: "Pokemon" }),
    [{ number: 151, name: "Mew" }],
  );
  assert.deepEqual(
    speciesForCard({ id: "two", name: "Mewtwo VSTAR", type: "Pokemon" }),
    [{ number: 150, name: "Mewtwo" }],
  );
  assert.deepEqual(
    speciesForCard({ id: "three", name: "Pikachu Collector", type: "Trainer" }),
    [],
  );
});

test("catalog printings merge with owned quantities without losing metadata", () => {
  const dex = buildPokedex(
    [
      {
        id: "base1-58",
        name: "Pikachu",
        setName: "Base Set",
        dexEntries: [{ number: 25, name: "Pikachu" }],
      },
      {
        id: "xy-25",
        name: "Pikachu EX",
        dexEntries: [{ number: 25, name: "Pikachu" }],
      },
    ],
    [
      {
        id: "entry-1",
        externalId: "base1-58",
        name: "Pikachu",
        quantity: 3,
        dexEntries: [{ number: 25, name: "Pikachu" }],
      },
    ],
  );
  const pikachu = dex[24];
  assert.equal(pikachu.owned, true);
  assert.equal(pikachu.ownedQuantity, 3);
  assert.equal(pikachu.ownedPrintings, 1);
  assert.equal(pikachu.printings.length, 2);
  assert.equal(pikachu.printings[0].setName, "Base Set");
});

test("generation, ownership and search filters compose", () => {
  const dex = buildPokedex(
    [],
    [{ id: "owned", name: "Cyndaquil", quantity: 1 }],
  );
  assert.deepEqual(
    filterPokedex(dex, {
      generation: 2,
      ownership: "owned",
      query: "#0155",
    }).map((entry) => entry.name),
    ["Cyndaquil"],
  );
  assert.equal(filterPokedex(dex, { generation: 1 }).length, 151);
  assert.deepEqual(pokedexProgress(dex), {
    owned: 1,
    total: 1025,
    percent: 1 / 10.25,
  });
});
