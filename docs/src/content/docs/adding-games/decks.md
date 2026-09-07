---
title: Deck rules
description: Declare game formats, custom zones, eligibility, and copy limits.
---

## Enable and declare rules

Set `definition.interfaces.decks` to `true`. A v2 manifest must then include `definition.deckRules`. This example is the value of that field:

```json
{
  "version": 1,
  "defaultFormat": "duel",
  "formats": [{
    "id": "duel",
    "label": "Garden Duel",
    "defaultZone": "lineup",
    "maxCopies": 2,
    "copyIdentity": "baseExternalId",
    "requireLegality": true,
    "zones": [
      { "id": "captain", "label": "Captain", "min": 1, "max": 1,
        "eligibility": [{ "property": "attributes.role", "values": ["captain"] }] },
      { "id": "lineup", "label": "Lineup", "min": 2, "max": 4 }
    ]
  }]
}
```

Declare 1–32 unique formats and 1–16 unique zones per format. Defaults must reference declared IDs. Zone sizes use inclusive minimum/maximum bounds, with counts at most 10,000. `definition.formats` describes physical/digital variants; deck construction formats belong in `definition.deckRules.formats`.

## Eligibility and copies

Zone eligibility predicates read supported card properties or `attributes.*`. Values within a predicate are alternatives; multiple predicates must all match. Predicates can match scalars or elements of arrays.

Copy limits count a card across all zones and alternate printings. `copyIdentity: "baseExternalId"` falls back to the exact card ID if no base identity exists. `"name"` groups by normalized name instead. For alternate printings, prefer explicit base IDs.

A format may have up to 32 `copyLimitExceptions`. Each has `when: { "property": "attributes.role", "values": ["basic"] }` and `maxCopies`. The first matching exception applies to a card; conflicting limits within one copy group use the lowest limit.

## Validation and saved decks

Deck creation snapshots the rules. Later catalog updates or removal do not silently replace the rules of an existing deck. Ordinary deck use still follows the client's account/server requirements.

Unsupported formats and unknown required legality produce `valid: false`, with `unsupported` or `unknown` status. `requireLegality: true` uses the [legality contract](/adding-games/legality/). Existing built-in validators remain available for older decks.

This contract expresses sizes, per-zone eligibility, copy limits, and legality. It does not express every possible game mechanic or arbitrary relationships between zones; those may need a future rule version or adapter.

## Check the result

Create a deck with one captain and two scout printings. Verify that a scout in the captain zone fails, exceeding a zone maximum fails, and three printings of the same base card exceed the two-copy limit. Test unknown legality and confirm an existing deck retains its saved rules after a package update.
