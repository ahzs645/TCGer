---
title: Sealed products
description: Understand the existing sealed-product declaration and its current integration boundary.
---

## Current support

The package schema accepts `definition.interfaces.sealedProducts` and a root `sealedProducts` reference containing `schema: "tcger-sealed-catalog-v1"`, a hashed `asset`, and `productCount`. Enabling the interface without the reference is invalid.

**Generic URL-package installation does not currently ingest that artifact into the sealed inventory interface.** The declaration alone cannot give a future game a working sealed-product catalog. The built-in sealed catalog and inventory services use a separate integration path.

For a new game package, leave this interface disabled unless you are also implementing and verifying that integration. There is no generic sealed catalog payload recipe provided here because a schema name alone is not a completed runtime contract.

## What an integration still needs

The package artifact needs a defined product payload, verified download and persistence, product identity mapping, browsing, and connection to inventory actions on each client. Existing inventory operations use backend product IDs; arbitrary package product IDs cannot simply be passed through.

The current shared product contracts are in `packages/api-types/src/sealed.ts`. The package declaration is in `packages/api-types/src/game-packages.ts`. Use those as starting points when this capability is implemented, and add a generated artifact schema and cross-client tests with it.

## Pack recipes are available separately

A future game can already configure [offline pack opening](/adding-games/packs/) through `offlinePacks` and `packOpening`. That recipe contract simulates card draws and can be used without a sealed-product inventory catalog.

See the [capability overview](/adding-games/) for the other supported configuration paths and the separately deferred Pokédex work.
