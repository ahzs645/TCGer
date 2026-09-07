---
title: Printings and finishes
description: Define alternate printings and custom foil or non-foil finishes.
---

## Declare printing behavior

Set `definition.printings` to:

```json
{
  "version": 1,
  "selection": "printing",
  "finishes": [
    { "code": "matte", "label": "Matte petal", "foil": false },
    { "code": "moon-glow", "label": "Moon glow", "foil": true }
  ]
}
```

This has no separate interface flag. Declare up to 200 unique finish codes. Codes are stable storage values; labels are display text. Always set `foil` explicitly, including `false` for a custom non-foil finish.

`selection` accepts `printing` or `functional` as the publisher's preference. Package catalogs currently present a flat list of exact printings; declaring `functional` does not generate a new functional-group interface.

## Link alternate printings

Two printings of Moonseed Scout should have different `id` and `printingKey` values, such as `scout-1` and `scout-2`, and the same `baseExternalId`, such as `scout`. Names alone do not establish identity.

Printing lookup uses the originating package's catalog. It must not silently borrow another publisher's printing list when the source is ambiguous. Saved cards carry package metadata under the app-owned `attributes.tcger`, retaining finish labels and foil behavior when the library is removed.

The same base identity supports [collection grouping](/adding-games/search-and-collections/) and [deck copy limits](/adding-games/decks/). [Price quotes](/adding-games/pricing/) can target a printing and finish precisely.

## Check the result

Select each alternate printing, save copies with both finishes, and reopen their details. Confirm `matte` remains non-foil and `moon-glow` remains foil. Verify that consolidated collection grouping and deck copy counting still recognize the shared base card.
