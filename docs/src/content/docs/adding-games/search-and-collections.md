---
title: Search and collections
description: Configure reusable facets, grouping modes, sets, and wishlists.
---

## Enable the basic surfaces

`definition.interfaces.search`, `collection`, `sets`, and `wishlists` default to `true`. Use the singular key `collection`. An explicit `definition` also requires its `id`, `label`, `collection`, and `search` blocks; start from the complete fixture rather than treating the fragments below as a complete manifest.

For catalog-only packages, omitting `definition` lets clients construct a compatible default from the manifest and its legacy `filters`.

## Choose collection identity

Set `definition.collection` to a block such as:

```json
{
  "identityModes": [
    { "id": "consolidated", "label": "By card", "description": "Group alternate printings.", "key": "baseExternalId" },
    { "id": "collector", "label": "By printing", "description": "Keep exact printings separate.", "key": "printingKey" }
  ],
  "defaultIdentityMode": "collector",
  "facets": []
}
```

Declare one or both modes; the default must be present. The IDs and keys shown are the supported pairs. Their labels and descriptions are configurable. Populate [card and printing identities](/adding-games/catalogs/) consistently to make grouping meaningful.

## Add filters

Place this facet in `definition.search.facets` or `definition.collection.facets`:

```json
{
  "id": "role",
  "label": "Role",
  "property": "attributes.role",
  "type": "multiSelect",
  "options": [
    { "value": "captain", "label": "Captain" },
    { "value": "scout", "label": "Scout" }
  ]
}
```

Supported controls are `select`, `multiSelect`, `numberRange`, `boolean`, and `text`. Each surface permits up to 24 facets, with up to 200 options per select control. Give selection controls explicit options for consistent native behavior. Number ranges need finite `min` and `max`; optional `step` must be positive.

Properties use allowlisted core fields or dotted `attributes.*` paths. Collection facets can also read fields such as `quantity` and `copies.condition`. The exact property allowlist is in `packages/api-types/src/game-definitions.ts`; legacy manifest `filters` have their own catalog-filter contract in `game-packages.ts`.

Values within one multi-select use OR; separate filters use AND. Empty controls impose no restriction. Text matching is literal and case-insensitive. Packages cannot supply SQL, regular expressions, or executable filter functions.

## Check the result

Search with each facet separately and together, then clear the controls. Save alternate printings and verify both identity modes. Check set membership and adding a card to a wishlist. Format facets read static `formatLegality`; [dated legality](/adding-games/legality/) is applied during deck validation.

Specialized Pokémon checklist behavior is intentionally outside this guide's configurable collection features; see [scope](/adding-games/#scope-of-configuration).
