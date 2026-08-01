# Offline Card Catalogs

TCGer's web app (installable PWA) and iOS app can both run without a server in
their local modes. Historically that meant card search only covered a handful of
seeded demo cards plus cards the user already owned. Offline catalog packs close
that gap: each game's full card list ships as a small local pack, so search, set
browsing, and set detail work entirely on-device.

Pack format, per-game fields, and image-URL derivation rules are specified in
[catalog-pack-format.md](./catalog-pack-format.md). This page covers how the
feature works and how to maintain it.

## What ships

| Game | Cards | Sets | Pack size (raw) |
|---|---:|---:|---:|
| Pokémon (tcgdex) | 23,444 | 214 | ~1.8 MB |
| Magic (Scryfall, paper prints) | 106,826 | 986 | ~20.7 MB |
| Yu-Gi-Oh (YGOPRODeck, representative printing per card) | 14,471 | 454 | ~3.4 MB |

Packs store no image URLs — clients derive them from card ids (Scryfall CDN,
tcgdex assets, YGOPRODeck images). While an image loads (or offline), clients
show the per-game card back instead of a gray placeholder:
`Assets.xcassets/CardBacks/*` on iOS, `frontend/public/card-backs/*.png` on web.

Card ids match the backend adapters' ids exactly, so a card found offline and
the same card found via server search dedupe to one identity.

## Generating and updating packs

Packs are generated build artifacts (gitignored), like the scanner's
large `ScanIndex` resources. For an iOS-ready checkout, run the reproducible
pipeline from the repo root:

```bash
bash scripts/ios-assets.sh build
bash scripts/ios-assets.sh check
```

`build` generates and synchronizes all three catalog packs, converts the web
embedding artifact into the compact iOS index, copies the tracked card-face
gate fixture, and converts DINOv2 to Core ML when the required Python packages
are available. If the web embedding source or Core ML Python packages are
absent, it prints the exact prerequisite commands, skips that generator, and
the final validation remains nonzero until every required asset exists.

To regenerate only the catalog packs, the underlying command is:

```bash
cd backend
npx --no-install tsx src/scripts/build-catalog-packs.ts --sync
```

This fetches from tcgdex, the Scryfall bulk `default_cards` file (~558 MB
download, streamed), and YGOPRODeck; writes `data/catalog/` (canonical output);
and `--sync` copies packs + manifest to the two consumers:

- `frontend/public/catalog/` — served same-origin to the web app.
- `mobile-apps/ios/TCGer/TCGer/Resources/Catalogs/` — bundled into the iOS app
  by the existing Xcode synchronized-resources setup.

Options: `--game pokemon|magic|yugioh` (rebuild one game; other games'
manifest entries are preserved), `--limit <n>` (fast test builds),
`--out <dir>`.

Versioning is automatic: regenerating unchanged content keeps a game's
`version`; changed content increments it. Clients compare manifest versions to
offer updates.

The TCGer Xcode target runs `scripts/ios-assets.sh check` before compiling.
Debug builds emit a warning and continue when assets are absent, preserving
clean-clone simulator development. Release builds hard-fail so an app cannot be
shipped without valid catalogs, model/index resources, and rejection gate.

## Web / PWA behavior

- Catalog code lives in `frontend/src/lib/catalog/` (IndexedDB store,
  download client with progress, lazy in-memory search index per game).
- "Card Catalogs" management UI is in Account & Preferences: per-game download,
  update, and remove with size/count labels. In demo mode, using a game without
  its catalog shows a dismissible download prompt.
- Demo-mode search, set lists, and set detail route through installed catalogs;
  owned cards are merged over catalog results by id. Games without an installed
  catalog keep the original demo fixtures.
- The service worker caches packs cache-first (manifest network-first), so an
  installed PWA keeps its catalogs offline. Removing a catalog also clears its
  SW cache entry.

## iOS behavior

- `Services/CatalogStore.swift` reads the bundled manifest/packs via a small
  `CatalogSource` protocol (`BundledCatalogSource` today; a remote CDN source
  can be added later without UI changes).
- Install state is per game in UserDefaults. Settings has a "Card Catalogs"
  section (install/update/remove, counts, sizes); the "This Phone" onboarding
  offers the same rows. Enabling a game in local mode without its catalog
  prompts to install it.
- Installed packs load lazily per enabled game at background priority; the
  Magic pack (~107k compact entries) is only decoded when Magic is both
  enabled and installed. Search matches card names first (prefix, then
  substring), then set names/codes.
- Removing a catalog never touches the user's saved cards.

## Known limitations

- **Clean clones don't include generated packs/model/index files.** A fresh
  checkout must run `bash scripts/ios-assets.sh build` before a complete Release
  build is possible (Debug degrades gracefully: clients show
  catalogs as unavailable and fall back to seeded demo behavior). If/when packs
  move to a CDN (e.g. R2), the client abstractions are already in place —
  publish the same files and add a remote source.
- Yu-Gi-Oh has one row per Konami card (representative printing), not one per
  print — see the format spec for the exact identity rules.
- Card images still load from the upstream CDNs; only metadata is offline.
  Cached images persist via the existing image caches on both platforms.
