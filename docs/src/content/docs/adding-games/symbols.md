---
title: Symbols and presentation
description: Supply portable artwork for game rarities, resources, and types.
---

## Declare symbols

Place this array at `definition.presentation.symbols`:

```json
[
  { "id": "common", "label": "Common", "kind": "rarity", "imageUrl": "https://example.com/star-garden/common.png" },
  { "id": "sun", "label": "Sun", "kind": "resource", "imageUrl": "https://example.com/star-garden/sun.png" }
]
```

The example URLs are placeholders; replace them with your own hosted artwork. Symbols use HTTPS, a stable `id`, a human-readable `label`, and kind `rarity`, `resource`, or `type`. Up to 1,000 symbols are supported. There is no separate interface flag.

## Match catalog values

Rarity symbols match `card.rarity` to a symbol ID. Resource and type symbols match string tokens in `card.types` or scalar/array attributes, such as `attributes.resources: ["sun"]`. App-owned `attributes.tcger` is excluded from token matching.

Matching uses literal tokens. A symbol declaration does not add a parser for a game's custom cost-string syntax. Normalize those values into supported fields when building your catalog.

Other presentation hints include `accentColor`, `iconUrl`, and `cardBackUrl`. Keep readable labels alongside artwork. Saved package cards retain presentation metadata, but external artwork still needs to be available or cached; metadata retention does not bundle the image bytes.

## Check the result

Inspect cards with each rarity/resource/type, plus one with an unknown token. Verify labels and artwork in the supported card surfaces on each target client. See [Printings and finishes](/adding-games/printings-and-finishes/) for finish labels and foil behavior; those use a separate declaration.
