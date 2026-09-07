---
title: Catalogs and identity
description: Choose stable game, package, card, and printing identifiers.
---

## Identify the game and its library

Use manifest schema `https://tcger.app/schemas/game-package-manifest/v2`. `game.id` identifies the game's card/rules namespace. It accepts lowercase letters, digits, and hyphens, starts with a letter or digit, and is at most 64 characters.

`publisher.id` plus `packageId` identifies a particular library as `<publisher.id>--<packageId>`. Keep all three IDs stable across updates. Two publishers can distribute different libraries for the same game. Legacy packages without a package identity use the game ID as their installation identity.

The built-in game list is for discovery; persistent game IDs are open. Saving or importing package cards can register a missing backend game namespace. Local catalog browsing does not require a remote provider for that game.

## Create the catalog

This is a complete one-card catalog example:

```json
{
  "formatVersion": 1,
  "tcg": "star-garden",
  "sets": [{ "code": "SG1", "name": "First Garden", "cardCount": 1 }],
  "cards": [{
    "id": "scout-1",
    "name": "Moonseed Scout",
    "baseExternalId": "scout",
    "printingKey": "scout-1",
    "setCode": "SG1",
    "setName": "First Garden",
    "collectorNumber": "001",
    "rarity": "common",
    "attributes": { "role": "scout", "resources": ["sun"] }
  }]
}
```

Each card needs a unique, non-empty `id` and `name`. `tcg` must equal the manifest's `game.id`. Keep IDs stable when correcting names or artwork so saved cards, packs, and price quotes retain their references.

| Field | Meaning |
| --- | --- |
| `id` | Catalog record identity; capability artifacts refer to it as `cardId` |
| `baseExternalId` | Underlying card identity shared by alternate printings |
| `printingKey` | Exact printing identity |
| `attributes` | Game-specific fields used by filters, symbols, and deck predicates |

Reserve `attributes.tcger` for metadata the app attaches when saving cards. Do not publish your own values there. See [Printings and finishes](/adding-games/printings-and-finishes/) before assigning alternate-print IDs.

## Reference the bytes

The manifest's `catalog` uses schema `tcger-catalog-v1`, an `asset` with `url`, exact `bytes`, and `sha256`, plus `cardCount` and optional `setCount`. Use the complete Star Garden manifest as a template; its recorded hashes apply only to its exact files.

## Check the result

Install from URL and verify the game label, card count, set browsing, and a search for a known card. Save a card, update the catalog without changing its identity, and confirm the saved record remains associated with the same game. Continue with [Search and collections](/adding-games/search-and-collections/) and [Publishing](/adding-games/publishing/).
