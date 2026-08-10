# Collection Guides

Collection guides are reusable collecting ideas that a user can browse, search,
filter, and follow. Following a dynamic guide creates a normal wishlist plus a
saved expansion rule. Following a curated guide copies its exact card-printing
membership into a normal wishlist. Both forms use the existing ownership and
completion system.

The initial system guides are:

- **The Clay Collection** — every English Pokémon card credited to Yuka Morii.
  TCGer describes these as the artist's well-known hand-sculpted clay scenes but
  keeps membership tied to the provider's illustrator credit rather than visual
  guesses.
- **Every Ditto** — every English Pokémon printing whose exact card name is Ditto.
- **Crown Zenith Connected Art** — the nine exact Galarian Gallery printings
  GG26–GG34, in illustration order. This is curated membership rather than a
  provider text search.

## Data model

`collectionGuides` stores discoverable metadata and one dynamic matching rule.
The rule types supported by the API, web, and iOS are:

- `name`: exact card-name collection, such as every Ditto printing.
- `set`: every card in one set.
- `artist`: exact provider illustrator credit, such as Yuka Morii.
- `manual`: exact `collectionGuideItems`, used when membership depends on visual
  or editorial knowledge rather than a provider field.

`userGuideFollows` links one guide to the wishlist created for one user. The link
is idempotent: following twice returns the existing wishlist. Deleting that
wishlist removes the follow, allowing the guide to be followed again.

`collectionGuideItems` supports collections that cannot be expressed as a query.
Each row identifies an exact printing and can preserve source, guide version,
artist, rarity, variant, provenance URL, review time, `position`, `groupKey`,
`groupLabel`, and `groupOrder`. A connected-art guide can therefore store each
panorama as a group and preserve its intended card order. Dynamic name/set/artist
guides do not duplicate rows there.

Manual follows are snapshots: the exact curated cards are copied when the user
follows the guide and the follow records the guide version. A later guide-version
upgrade can therefore be handled explicitly instead of silently changing an
existing wishlist.

## Client behavior

Web and iOS provide two search scopes:

- **Guides** searches guide titles, descriptions, tags, and curators.
- **All Cards** searches the merged cards from every published guide. The client
  exposes game, category, and ownership controls, while text search also matches
  guide names/tags, card/set names, artist, rarity, and connected-art group. The
  API additionally accepts exact guide, set, artist, and rarity filters. Results
  are deduplicated by game and printing id while retaining every matched guide
  and connected-art group.

The server expands dynamic guide rules through the live card providers and reads
manual guides from exact item membership. iOS and the web demo can perform the
same merge from bundled catalog data plus local manual items. A partial provider
failure is returned in `failedGuideSlugs` rather than hiding successful results.

Artist metadata is included in generated Pokémon catalog packs, so the Clay guide
also works without a configured server. Regenerate and synchronize packs with:

```sh
npx tsx backend/src/scripts/build-catalog-packs.ts --game pokemon --sync
```

## Cross-game guide fields

The catalog format and both clients preserve searchable metadata that can power
similar guides in the other games:

| Game | Searchable guide metadata retained |
| --- | --- |
| Pokémon | illustrator, type, Pokémon types, HP |
| Magic | artist, card type, finishes, frame effects, promo types, full-art and border treatments |
| Yu-Gi-Oh! | archetype, race, type, ATK, DEF, level |
| Disney Lorcana | illustrators, classifications, card type |
| Dragon Ball Super | character, era, special trait, card type |
| One Piece | name, set/deck, rarity, card type; art/theme membership still requires curated items or richer provider data |

Magic's live adapter also supports exact artist expansion. No non-Pokémon system
guides are published yet: the fields above make them searchable and guide-ready,
but their titles and membership still need an editorial definition and, for
visual themes, provenance-backed manual items.

## Adding a guide

System guides are seeded idempotently by `convex/guides.ts`. Increment `version`
when a guide's definition or curation changes. For a query-driven guide, add the
metadata and rule to the seed. For connected art or another editorial collection,
add ordered `collectionGuideItems`, use a `manual` rule, include a provenance URL,
and test both item order and exact-card wishlist creation before publishing it.
