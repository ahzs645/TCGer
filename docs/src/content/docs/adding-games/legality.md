---
title: Format legality
description: Provide arbitrary format IDs and effective dates for card legality.
---

## Add legality to catalog cards

These are fields on a catalog card, not on its `attributes` object:

```json
{
  "formatLegality": { "duel": true },
  "sanctionedPlayLegal": true,
  "legalityPeriods": [{
    "format": "duel",
    "legal": true,
    "validFrom": "2026-09-01T00:00:00Z",
    "validTo": "2026-10-01T00:00:00Z"
  }]
}
```

Format IDs are game-defined. Use the same IDs in your [deck rules](/adding-games/decks/) and set that deck format's `requireLegality` to `true` to require a legal result.

## Effective-date behavior

Starts are inclusive and ends are exclusive. In this example the period covers September 2026, ending exactly at midnight UTC on October 1. Use explicit UTC timestamps for clear release boundaries.

The applicable period with the latest start wins. Avoid conflicting overlapping periods with the same start. Once a format has dated coverage, dates outside that coverage are **unknown**, even if an undated `formatLegality` value exists. Publish enough coverage for the period you intend to support.

`sanctionedPlayLegal: false` overrides other legality fields for sanctioned validation. Missing required legality is unknown rather than implicitly legal, and the deck cannot validate successfully.

Catalog search facets read the static `formatLegality` value. They do not dynamically calculate dated legality. Maintain that static summary when publishing updates if you expose it as a search filter.

## Check the result

Validate before, at, within, and at the end of the interval. Check that an unknown format and missing coverage cannot pass a deck requiring legality, and that explicitly unsanctioned cards fail even during an otherwise legal period.
