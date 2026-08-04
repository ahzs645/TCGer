# Offline Catalog Packs

Per-game card catalog packs that give clients (iOS local mode, PWA demo mode) full
card search and set browsing without a server. Generated locally by
`backend/src/scripts/build-catalog-packs.ts`; production distribution uses
Cloudflare R2 while generated copies may also be bundled into iOS and served
from `frontend/public/catalog/` for local development.

## Locations

- Canonical build output: `data/catalog/` at the repo root (gitignored).
  - `data/catalog/manifest.json`
  - `data/catalog/{game}.v{version}.{sha-prefix}.pack.json` (uncompressed;
    game = `pokemon | magic | yugioh | onepiece | lorcana | dragonball`)
- Synced copies (both gitignored, each with a committed README explaining regeneration):
  - `frontend/public/catalog/` — served same-origin to the PWA.
  - `mobile-apps/ios/TCGer/TCGer/Resources/Catalogs/` — bundled into the app
    (wired into the Xcode target the same way as `CardScanner/Resources/ScanIndex`).

## manifest.json

```json
{
  "formatVersion": 1,
  "generatedAt": "2026-07-24T00:00:00Z",
  "games": {
    "pokemon": {
      "version": 1,
      "cardCount": 23444,
      "setCount": 160,
      "bytes": 5000000,
      "sha256": "…",
      "file": "pokemon.v1.fd0c13e09b1483cb.pack.json"
    }
  }
}
```

Games are independent — a pack may be absent (client treats that game as "no catalog").

## {game}.pack.json

```json
{
  "formatVersion": 1,
  "tcg": "pokemon",
  "version": 1,
  "updatedAt": "2026-07-24T00:00:00Z",
  "sets": [
    {
      "code": "swsh6",
      "name": "Chilling Reign",
      "serie": "swsh",
      "releasedAt": "2021-06-18",
      "count": 233,
      "iconUrl": "https://assets.tcgdex.net/univ/swsh/swsh6/symbol.webp",
      "logoUrl": "https://assets.tcgdex.net/en/swsh/swsh6/logo.webp"
    }
  ],
  "cards": [
    {
      "id": "swsh6-82",
      "name": "Galarian Yamask",
      "setCode": "swsh6",
      "collectorNumber": "82",
      "rarity": "Common",
      "type": "Pokémon"
    }
  ]
}
```

Set fields — common: `code`, `name`, `count`; optional: `serie`, `releasedAt`,
`iconUrl`, `logoUrl`. Clients should render `iconUrl`, then `logoUrl`, then a
set-code badge when neither image is available.

Card fields — common: `id`, `name`, `setCode?`, `collectorNumber?`, `rarity?`, `type?`,
`imageUrl?`, `imageUrlSmall?`.
`setName` is NOT stored per card; clients join via the `sets` array by `setCode`.
Per game extras (all optional):

- pokemon: `types` (string[]), `hp` (number). `id` is the tcgdex id (`{setCode}-{localId}`).
- magic: `manaCost`, `colors` (string[]). `id` is the Scryfall print UUID.
- yugioh: `race`, `atk`, `def`, `level`, `konamiId` (number). `konamiId` is the
  representative artwork/image id used to derive the YGOPRODeck image URL.
- onepiece, lorcana, dragonball: provider image URLs are stored because their
  current CDNs do not expose a stable derivation rule from the compact card id.

### Yu-Gi-Oh identity and set convention

The pack has one row per Konami card, matching `YugiohAdapter.searchCards`: it uses
the first `card_sets` entry and first `card_images` entry from YGOPRODeck as the
representative printing. It intentionally does not expand every set printing.
The id is exactly the adapter's printing key:

`yugioh:print:v1:{base Konami id}:{canonical full set code}:{normalized rarity}:{artwork id}`

Each component is URI-encoded as in `buildYugiohPrintingKey`. This makes an offline
result dedupe with the representative server search result while keeping the pack
near 14.5k cards. The server's explicit “all prints” response can contain additional
print ids that are not in the offline catalog.

For browsing, a Yu-Gi-Oh card's `setCode` and the joined `sets[].code` use the product
prefix (for example `LOB`), while its id retains the full printing code (for example
`LOB-EN005`). Cards without a `card_sets` entry omit `setCode`; their id still matches
the adapter's setless representative printing key.

Card ids MUST match the ids the backend adapters return for the same game, so a card
found offline and a card found via server search dedupe to the same identity.

## Image URLs (derived client-side, never stored in packs)

- pokemon: `https://assets.tcgdex.net/en/{serie}/{setCode}/{collectorNumber}/high.webp`
  (`serie` comes from the pack's `sets` entry; `low.webp` for thumbnails)
- magic: `https://cards.scryfall.io/normal/front/{id[0]}/{id[1]}/{id}.jpg`
  (`small`/`large` variants swap the first path segment)
- yugioh: `https://images.ygoprodeck.com/images/cards/{konamiId}.jpg`
  (`images/cards_small/` for thumbnails)

Image hosting is independent of catalog distribution. Moving an image source
does not require rebuilding or republishing these metadata packs.

While an image is not yet cached (or offline), clients show the per-game card back:
iOS asset names `PokemonCardBack` / `MagicCardBack` / `YugiohCardBack`
(see `APIService.cardBack(for:)`), web `marketing-site/public/*_Back.png` equivalents.

## Sources & expected sizes

| game    | source                                                               | cards             | pack raw |
| ------- | -------------------------------------------------------------------- | ----------------- | -------- |
| pokemon | tcgdex (`https://api.tcgdex.net/v2/en`)                              | ~23.4k            | ~5 MB    |
| magic   | Scryfall bulk `default_cards` (~558 MB download, streamed + trimmed) | ~96k paper prints | ~15 MB   |
| yugioh  | YGOPRODeck `cardinfo.php`                                            | ~14.5k            | ~4–8 MB  |
| onepiece | OPTCG API set and starter-deck dumps                                | ~4k               | ~1.1 MB  |
| lorcana | Lorcast per-set card endpoints                                       | ~3.2k             | ~1.1 MB  |
| dragonball | API TCG Fusion World products (requires `APITCG_API_KEY`)          | provider-dependent | provider-dependent |

Magic includes every `default_cards` record whose `games` contains `paper`.
Pure-digital records are excluded. Paper tokens, emblems, and art-series cards
remain included because the backend Magic adapter does not exclude those classes.

Version bumps are automatic: the builder compares each regenerated pack with the
existing output manifest and pack. Unchanged content keeps the existing game's
`version`; changed content increments it (or starts at `1` when no prior entry
exists). The pack and manifest always carry the same version. Clients compare
versions to decide whether to reload.
