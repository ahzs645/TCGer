---
title: Adding a future game
description: Build a game library and configure its reusable TCGer capabilities.
---

A new game starts with a catalog and a `GamePackageManifest` v2. Give it a stable game ID, describe the features its data supports, and install its manifest URL through the Game Store. A catalog-only game does not need a new built-in game enum or server card-provider adapter.

These pages describe the current repository implementation. They do not establish that a deployed server or installed mobile release already includes it. The implementation and validation record is `docs/game-extensibility-implementation.md`.

## Start with a working package

1. Copy `docs/scanner-system/examples/star-garden/` as an authoring reference. It contains a complete manifest, three-card catalog, price snapshot, and pack library.
2. Choose your game and publisher/package identities using [Catalogs and identity](/adding-games/catalogs/). Replace the fixture cards with your own data, keeping IDs stable across releases.
3. Configure [search and collections](/adding-games/search-and-collections/), then add the capabilities below that your game needs.
4. Recalculate every asset's exact byte count and SHA-256 after editing. Follow [Publishing and validation](/adding-games/publishing/) to host, install, and test the package.
5. Exercise each enabled feature on the clients you support before publishing a release.

The fixture generator, run from the repository root, reproduces the example files and their hashes:

```sh
npx tsx tools/game-packages/build-future-game-fixture.ts
```

This regenerates the Star Garden example; it is not a converter for your own game. Its prices are fictional and expire on October 1, 2026. It includes no scanner model.

## One page per capability

All interface flags below live under `definition.interfaces`. A flag declares support; the linked data contract supplies the behavior.

| Capability | Configuration | Guide |
| --- | --- | --- |
| Catalog and game identity | `game`, `publisher`, `packageId`, `catalog` | [Catalogs and identity](/adding-games/catalogs/) |
| Search, collections, sets, wishlists | `search`, `collection`, `sets`, `wishlists`; facets and identity modes | [Search and collections](/adding-games/search-and-collections/) |
| Deck construction | `decks: true` and `definition.deckRules` | [Deck rules](/adding-games/decks/) |
| Printing selection and finishes | `definition.printings` and catalog identities | [Printings and finishes](/adding-games/printings-and-finishes/) |
| Format legality | Card legality fields; deck format `requireLegality` | [Legality](/adding-games/legality/) |
| Rarity, resource, and type artwork | `definition.presentation.symbols` | [Symbols and presentation](/adding-games/symbols/) |
| Downloadable prices | `pricing: true` and root `pricing` asset | [Price snapshots](/adding-games/pricing/) |
| Offline pack opening | `packOpening: true` and root `offlinePacks` | [Pack opening](/adding-games/packs/) |
| Card recognition | `scanner: true` and root `scanner` platform entries | [Scanning](/adding-games/scanning/) |
| Sealed inventory | Declaration exists; generic URL-package ingestion is not implemented | [Sealed products](/adding-games/sealed-products/) |
| Distribution and updates | Hashes, signatures, release sequence | [Publishing and validation](/adding-games/publishing/) |

## Scope of configuration

Packages contain declarative data, not executable plugins. The supported contracts cover generic collection behavior, bounded deck rules, prices, collation, and compatible scanner assets. A game mechanic beyond those contracts still needs an implementation change.

**Specialized collection views remain deferred.** The `pokedex` adapter still uses Pokémon's built-in species and generation data. It cannot configure an arbitrary character roster for a future game. This work does not change that implementation.

Custom `interfaces.features` IDs must use `<publisher.id>--<feature-id>`; unprefixed IDs are reserved. Declaring an ID preserves the feature request, but each client needs a compatible renderer before it can display it.

## Source of truth

Use `packages/api-types/src/game-packages.ts`, `game-definitions.ts`, and `game-capabilities.ts` for runtime contracts. Generated JSON schemas live in `docs/scanner-system/schemas/`. The longer package reference remains in `docs/scanner-system/game-package-manifest.md`.
