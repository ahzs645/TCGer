# Collection Guides

Collection guides are reusable collecting ideas that a user can browse, filter,
and follow. Following a guide creates a normal wishlist plus a saved expansion
rule, so ownership, completion, and future sync use the existing wishlist system.

The initial system guides are:

- **The Clay Collection** — every English Pokémon card credited to Yuka Morii.
  TCGer describes these as the artist's well-known hand-sculpted clay scenes but
  keeps membership tied to the provider's illustrator credit rather than visual
  guesses.
- **Every Ditto** — every English Pokémon printing whose exact card name is Ditto.

## Data model

`collectionGuides` stores discoverable metadata and one dynamic matching rule.
The rule types currently supported by both web and iOS are:

- `name`: exact card-name collection, such as every Ditto printing.
- `set`: every card in one set.
- `artist`: exact provider illustrator credit, such as Yuka Morii.

`userGuideFollows` links one guide to the wishlist created for one user. The link
is idempotent: following twice returns the existing wishlist. Deleting that
wishlist removes the follow, allowing the guide to be followed again.

`collectionGuideItems` supports collections that cannot be expressed as a query.
Each row identifies an exact printing and has `position`, optional `groupKey`,
`groupLabel`, and `groupOrder`. A connected-art guide can therefore store each
panorama as a group and preserve left-to-right card order. This table is ready for
curated connected-art data; dynamic name/set/artist guides do not duplicate rows
there.

## Client behavior

Web and iOS load the published guide list, expand the guide rule against the live
card provider (or the bundled catalog in phone-only mode), and offer card-name,
set, owned, and missing filters. Following a guide creates its wishlist, expands
the rule in API-sized batches, and records the last match count on the rule.

Artist metadata is included in generated Pokémon catalog packs, so the Clay guide
also works without a configured server. Regenerate and synchronize packs with:

```sh
npx tsx backend/src/scripts/build-catalog-packs.ts --game pokemon --sync
```

## Adding a guide

System guides are seeded idempotently by `convex/guides.ts`. Increment `version`
when a guide's definition or curation changes. For a query-driven guide, add the
metadata and rule to the seed. For connected art, add ordered
`collectionGuideItems` and expose a manual-item rule in the guide resolver before
publishing it.
