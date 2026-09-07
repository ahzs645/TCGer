---
title: Price snapshots
description: Publish dated, source-attributed prices for a future game's cards.
---

## Enable a price asset

Set `definition.interfaces.pricing` to `true` and provide root `pricing` with `schema: "tcger-price-snapshot-v1"` and an `asset` reference containing `url`, `bytes`, and `sha256`. A v2 package cannot enable pricing without that reference.

The referenced JSON follows this shape:

```json
{
  "schema": "tcger-price-snapshot-v1",
  "gameId": "star-garden",
  "quotes": [{
    "cardId": "scout-1",
    "printingKey": "scout-1",
    "finishCode": "matte",
    "condition": "NM",
    "language": "English",
    "amount": 2,
    "currency": "USD",
    "source": "Fictional test prices",
    "observedAt": "2026-09-01T00:00:00Z",
    "expiresAt": "2026-10-01T00:00:00Z"
  }]
}
```

The sample dates are deliberately finite; replace them with truthful observation and expiry times for real data. `gameId` must match the package, and each `cardId` must exist in its catalog. Amounts must be finite and nonnegative; currencies use three uppercase letters. `expiresAt` must be later than `observedAt`. An optional `sourceUrl` can link to provenance.

## Matching and availability

Quotes are matched to the requested card and optional printing, finish, condition, and language. Missing dimensions represent an unspecified variant, not a wildcard over all variants. Use the exact codes and labels your catalog/copy editor stores.

A quote is current only when `observedAt <= now < expiresAt`; the newest applicable observation wins. Missing, expired, incompatible, or ambiguously sourced prices remain unavailable instead of becoming zero. Snapshots do not supply a live provider, automatic foreign-exchange conversion, or background price alerts.

Enable **Price snapshots** in the installed library. Native card/copy views use package quotes. On web, supported previews and tracked collection pricing consult package prices before remote providers when the selected source is automatic; the existing collection accounting path requires matching USD quotes. Multiple installed pricing libraries for one game can make aggregate lookup ambiguous; package-scoped previews retain their source.

## Check the result

Inspect an exact matching card/copy, a different finish or language, and an expired quote. Confirm provenance and currency. Publish fresh snapshots through the normal [update lifecycle](/adding-games/publishing/). The artifact schema is `docs/scanner-system/schemas/game-price-snapshot.v1.schema.json`.
