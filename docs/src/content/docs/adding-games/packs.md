---
title: Pack opening
description: Define offline pack recipes using weighted card pools.
---

## Enable a pack library

Set `definition.interfaces.packOpening` to `true`. At the manifest root, provide `offlinePacks` with `schema: "tcger-pack-library-v1"` and a hashed `manifest` asset reference. That referenced JSON contains the recipes:

```json
{
  "schema": "tcger-pack-library-v1",
  "gameId": "star-garden",
  "packs": [{
    "id": "first-garden",
    "name": "First Garden",
    "setCode": "SG1",
    "slots": [
      { "count": 1, "pool": [{ "cardId": "captain-1", "weight": 1 }] },
      { "count": 2, "withoutReplacement": true, "pool": [
        { "cardId": "scout-1", "weight": 4 },
        { "cardId": "scout-2", "weight": 1 }
      ] }
    ]
  }]
}
```

The game and every card reference must match the installed catalog. A library supports up to 10,000 unique packs. Each pack has 1–32 slots; each slot draws 1–100 cards from a pool of 1–100,000 unique card IDs. Weights must be positive, finite, and at most 1,000,000.

## Understand the draw behavior

Weights are relative within a slot. In the second example slot, the first draw has weights 4:1. Because two distinct cards are drawn from a two-card pool without replacement, both scouts ultimately appear.

`withoutReplacement` applies only within its slot and requires enough distinct pool entries. Other slots may draw the same card, and a new pack opening starts with fresh pools. The contract does not encode arbitrary factory collation or dependencies between slots.

Enable **Pack opening** in the installed library, choose a pack, and inspect/save pulls through the normal card actions. Pack wrapper artwork is not required. Recipes work offline after download; card image availability follows the client's separate image cache.

These recipes simulate pulls. They do not automatically represent a sale, consume a physical inventory item, or provide [sealed-product catalog integration](/adding-games/sealed-products/).

## Check the result

Open the sample recipe and confirm one captain plus both scouts. Test a weighted replacement pool separately if you want repeated draws. Verify unknown card IDs and oversized without-replacement draws are rejected. The schema is `docs/scanner-system/schemas/game-pack-library.v1.schema.json`; use [Publishing](/adding-games/publishing/) for asset hashing and delivery.
