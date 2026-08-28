# Dynamic offline-pack runtime audit

## Outcome

`GamePackageManifest.offlinePacks` must remain capability-gated until the pack
opening runtime consumes a validated, declarative pack-library document. The
current downloader can cache artwork, but the actual products, card pools,
collation, odds, and generated skins are compiled into `pack-core` as Pokemon
data. Enabling an unknown game's declaration without changing that runtime
would be incorrect: an unrecognized `packPool` currently falls through to the
Evolving Skies pool.

The safest activation path is to make the existing Pokemon products the first
`tcger-declarative-pack-v1` fixture. Once the existing experience produces the
same deterministic results from that fixture, the identical runtime can accept
an installed package without loading remote code.

## Existing hard-coded assumptions

### Shared web renderer

- `packages/pack-core/src/experience/pack-data.ts` fixes `PackCard.tcg` to
  `"pokemon"`, contains all card pools and odds in TypeScript, and selects among
  only `swsh7`, `base1`, and `me5`.
- `generatePack()` treats every pool other than `base1` and `me5` as `swsh7`.
  A missing or unknown identifier therefore silently produces Pokemon cards
  instead of failing closed.
- `possiblePackCards()` has the same fallback, so native download screens would
  advertise and cache the wrong card list too.
- `pack-skins.ts` hard-codes the generated Base Set and Pitch Black choices,
  defaults cover metadata to `swsh7`, and assumes Base Set has 11 cards while
  every other generated skin has 5.
- Rarity presentation and sorting assume the five internal tiers `common`,
  `uncommon`, `rare`, `ultra`, and `chase`. Those can remain presentation tiers,
  but an external game's printed rarity must not be forced to use the same
  vocabulary.
- The current pack artwork manifest describes a mesh, covers, bases, and decals;
  it does not describe products, catalog card identities, card groups, slot
  collation, probabilities, or complete offline assets.
- `pack-core` accepts absolute HTTP, HTTPS, `data:`, and `blob:` asset strings
  and performs no manifest runtime validation. That behavior is acceptable only
  for trusted compiled assets, not an external package trust boundary.

### Web host and downloader

- `frontend/src/lib/packs/offline-packs.ts` recognizes only `base1` and `me5`.
- Cache names use only `setID`; two games with the same set identifier collide.
- The offline asset list always includes the Pokemon card back and a fixed
  `/pack/manifest.json` and mesh.
- Downloads check HTTP success but do not verify declared length, SHA-256,
  content type, decoded image dimensions, or a total installation budget.
- Records in local storage trust the built-in definition list and are not tied
  to the game-package version or pack-library digest.
- The page takes one global pack asset base. It has no selected package/product
  configuration and does not expose installed package packs in navigation.

### iOS host and downloader

- `PackOfflineSetDefinition.available` contains only Base Set and Pitch Black.
- Card artwork is derived from `CardIndexMetadataStore` specifically for
  `.pokemon`, rather than the installed package catalog.
- The manager always downloads the first-party global pack manifest and filters
  its covers by the compiled pool identifier.
- Record keys and record filenames are set-only rather than package/product
  scoped.
- Removal evicts every recorded set-specific URL without checking whether a
  second downloaded product still references the same cached object.
- The WebKit resource bridge is bound to the app's first-party remote base and
  bundled fallback. It needs a read-only mounted namespace for a package's
  already-verified local assets.
- The native bridge models use string `tcg` values and are otherwise suitable
  for unfamiliar games.

### Android host and downloader

- The WebView host uses one global first-party asset base and recognizes only
  its `pack/manifest.json` and `pack/objects/` namespace.
- The downloader obtains card URLs from the card pools emitted by the compiled
  JavaScript runtime, so it cannot discover an external product independently.
- Remote bytes are cached after HTTP success without expected SHA-256, exact
  length, media-type, or decoded-dimension verification.
- Records and status maps use only `setID`, allowing collisions across games.
- Android does avoid deleting shared URLs still referenced by another record,
  but URL identity is not as robust as content-addressed object identity.
- The native models and collection conversion already retain `tcg` as a string,
  so they can represent an unknown game's pulls after the renderer becomes
  dynamic.

## Required GamePackageManifest change

The outer declaration should name both the document schema and the runtime. It
must continue to reference the library through the existing bounded asset
descriptor:

```json
{
  "offlinePacks": {
    "schema": "tcger-pack-library-v1",
    "runtime": "tcger-declarative-pack-v1",
    "manifest": {
      "url": "./packs/library.json",
      "bytes": 28431,
      "sha256": "<64 lowercase hexadecimal characters>",
      "mediaType": "application/json"
    }
  }
}
```

Older clients that know the outer package schema but not the runtime continue
to install the catalog and show packs as unavailable. They must never guess a
fallback runtime.

## Proposed `tcger-pack-library-v1`

The library is data, not a plug-in. Version 1 should intentionally use the
audited booster renderer and built-in mesh. Custom JavaScript, shaders, HTML,
CSS, SVG, model files, JSONPath, regular expressions, and arbitrary expressions
are out of scope.

```json
{
  "schema": "tcger-pack-library-v1",
  "runtime": "tcger-declarative-pack-v1",
  "gameId": "example-game",
  "libraryVersion": "2026.08.27",
  "publishedAt": "2026-08-27T20:00:00Z",
  "assets": {
    "card-back": {
      "url": "./assets/card-back.webp",
      "bytes": 12034,
      "sha256": "<sha256>",
      "mediaType": "image/webp"
    },
    "wrapper-front": {
      "url": "./assets/wrapper-front.webp",
      "bytes": 88420,
      "sha256": "<sha256>",
      "mediaType": "image/webp"
    }
  },
  "products": [
    {
      "id": "set-a-booster",
      "name": "Set A Booster",
      "setCode": "set-a",
      "cardCount": 5,
      "cardBackAsset": "card-back",
      "artworks": [
        {
          "id": "front",
          "name": "Front artwork",
          "sheetAsset": "wrapper-front"
        }
      ],
      "groups": [
        {
          "id": "common",
          "displayTier": "common",
          "cards": [
            { "cardId": "set-a-001", "weight": 1 }
          ]
        },
        {
          "id": "rare",
          "displayTier": "rare",
          "cards": [
            { "cardId": "set-a-100", "weight": 1 }
          ]
        }
      ],
      "slots": [
        {
          "count": 4,
          "withoutReplacement": true,
          "choices": [{ "groupId": "common", "weight": 1 }]
        },
        {
          "count": 1,
          "withoutReplacement": true,
          "choices": [
            { "groupId": "common", "weight": 2 },
            { "groupId": "rare", "weight": 1 }
          ]
        }
      ],
      "odds": {
        "kind": "observed",
        "title": "Published opening sample",
        "url": "https://example.com/methodology",
        "sampleSize": 1000,
        "note": "Observed probabilities; not manufacturer collation."
      }
    }
  ],
  "offlineArt": {
    "set-a-001": { "largeAsset": "card-set-a-001" },
    "set-a-100": { "largeAsset": "card-set-a-100" }
  }
}
```

### Declarative collation rules

- A product contains an ordered list of slots. Slot `count` values must sum to
  `cardCount`.
- A slot selects a group by positive bounded integer weight, then selects a card
  from that group's positive bounded integer weights.
- `withoutReplacement` applies across the complete product opening, not merely
  within one slot. A validator rejects any recipe that cannot produce the
  declared count without violating it.
- Group IDs, asset IDs, product IDs, and card IDs are literal identifiers. Every
  reference must resolve; unknown references are fatal.
- `displayTier` is one of the renderer's five presentation tiers. The actual
  rarity label comes from the catalog card and may use any game's vocabulary.
- Odds metadata is required and labels its source `official`, `observed`, or
  `estimated`. The user-facing disclosure is part of the generated native state.
- The generator fails closed on an unknown product or group. There is no default
  product, game, set, pool, rarity, or card back.
- Version 1 should not attempt factory sequencing, print sheets, guaranteed-box
  distributions, replacement collation, or state shared across openings. Those
  need explicitly versioned future primitives rather than hidden behavior.

### Artwork rules

- Version 1 uses the bundled, audited booster mesh. An external package can
  provide wrapper sheets, a card back, and card art, or a bounded generated
  wrapper theme made from an allowlisted motif and color palette.
- Remote SVG and HTML are disallowed. Raster inputs are restricted to PNG,
  JPEG, and WebP, with byte and decoded-pixel limits. Wrapper sheets must match
  the renderer's declared layout dimensions.
- The product's offline closure includes its library document, wrapper/card-back
  assets, and verified artwork for every card that its groups can produce.
  Catalog image URLs may be used online, but do not by themselves qualify a
  product as downloaded for offline use.
- Every network artifact uses the package asset descriptor: exact compressed
  bytes, SHA-256, media type, and HTTPS URL. A later bundle/ZIP format should be
  a separate schema with explicit uncompressed totals, entry hashes, entry-count
  limits, and traversal/symlink rejection.

## Validation and limits

Validation belongs in the shared TypeScript contract and `pack-core`; native
downloaders additionally enforce the transport and storage boundary. Suggested
v1 caps should be finalized from real first-party manifests, but must include:

- library document byte limit and maximum JSON nesting depth;
- maximum products, artworks per product, groups per product, slots per product,
  choices per slot, and card references per product;
- positive integer weights with a bounded sum safe in JavaScript, Swift, and
  Kotlin integer arithmetic;
- maximum individual and total downloaded bytes and maximum decoded image
  pixels;
- unique identifiers at every scope and exact cross-reference checks;
- `gameId` equal to the containing package and every card ID present in its
  installed catalog;
- secure relative URL resolution, no credentials/fragments, no HTTP downgrade,
  and revalidation of every redirect target;
- release clients rejecting loopback, link-local, private-network literal, and
  non-HTTPS destinations. Development loopback should remain an explicit build
  mode rather than data selected by a manifest.

An input being valid JSON or having a matching digest is not sufficient. Hashes
protect integrity after the publisher chooses bytes; schema and semantic
validation protect the runtime from those bytes.

## Download, cache, update, and removal behavior

### Identity and namespaces

Use `(gameId, librarySha256, productId)` as the installed-product identity, not
`setID`. Store assets by SHA-256 and keep references from installed products.
This prevents cross-game collisions and permits safe de-duplication.

### Installation

1. Fetch and verify the outer pack-library asset into a staging namespace.
2. Decode and semantically validate the entire library against the installed
   catalog before presenting download actions.
3. Plan the selected product's complete offline asset closure and total bytes.
4. Check available disk space and ask the platform to download only missing
   content-addressed objects.
5. Verify exact length and SHA-256 before decoding; verify raster type and pixel
   limits after decoding.
6. Write the product record last and atomically activate it. Cancellation or any
   failed artifact removes unreferenced staging data and leaves the prior active
   version usable.

Web should stage in a versioned Cache Storage or IndexedDB namespace and commit
its record in one IndexedDB transaction. Native platforms should stage in a
temporary sibling directory and atomically rename or replace the active record.
Progress should use verified expected bytes rather than completed URL count.

### Updates

Refreshing a GamePackage URL fetches the new outer manifest and pack library but
does not destroy the current installed product. After the catalog is updated,
revalidate every referenced card ID. Compatible downloaded products remain
usable; incompatible ones are marked `updateRequired` until their replacement
is fully verified. A metadata-only catalog change therefore need not force a
large artwork download.

The app should expose `availableVersion`, expected incremental bytes, and the
reason an old product is incompatible. Automatic background updates may fetch
small manifests, but large product assets remain user-controlled unless the user
has explicitly enabled automatic downloads.

### Removal

Removing a product deletes its record and then garbage-collects content hashes
with zero remaining references. Removing a game package cascades through all of
its product records, pack-library metadata, and unreferenced objects. It does
not delete collection cards, pack-opening history, or sealed-opening records;
those user records retain the original string game and card identities and may
show that their catalog package is no longer installed.

## Runtime integration by platform

### `pack-core`

Introduce a validated `PackRuntimeLibrary` input and make product selection,
skins, possible-card emission, generation, card count, and odds disclosure read
only from it. Keep the existing visual state machine. Convert current Pokemon
data to a built-in library fixture, and delete every unknown-pool fallback.

The embedded runtime should accept either a host-provided validated library
object or a read-only local virtual URL. It must never import or evaluate code
from the package. A shared seeded generator and conformance fixtures guarantee
that web, iOS, and Android display the same products and possible pulls.

### Web

Mount verified cached objects behind package-scoped local URLs or Blob URLs and
pass the parsed library to `pack-core`. Add installed game/package selection to
the pack-opening entry point. Move offline records from local storage to the
same transactional package database, or make the cross-store commit and repair
behavior explicit.

### iOS

Give `PackOpeningWebSession` a selected package/product configuration. Extend
the custom scheme handler with a package-scoped, read-only local mount that can
serve only verified objects from the content store. Generalize the offline
manager away from `TCGGame.pokemon` and its static definitions. The native
state and pull decoders can remain string-based.

### Android

Give `PackOpeningHostConfig` a selected package/product and mount verified files
under a package-scoped path on the existing app-owned WebView origin. Replace
the first-party base URL assumptions in the dynamic path. The existing native
models and collection conversion already accept arbitrary string game IDs.

## Test matrix required before activation

### Shared contract and generator

- JSON Schema and semantic conformance fixtures shared by all three platforms.
- Duplicate IDs, dangling references, wrong game IDs, invalid counts, impossible
  no-replacement recipes, zero/overflowing weights, deep JSON, and all size caps.
- Deterministic seeded generation with exact expected card IDs.
- Weighted-distribution statistical smoke tests with a fixed seed and tolerance.
- Product card count, source order, duplicate prevention, and printed-rarity vs
  presentation-tier behavior.
- An unknown product or group must produce an error and never a Pokemon fallback.
- The converted Pokemon fixture must preserve current Base Set, Pitch Black, and
  Evolving Skies behavior before external packages are enabled.

### Transport and persistence

- Wrong hash, short/long body, misleading `Content-Length`, bad media type,
  oversized decoded image, redirect downgrade, URL credentials, private target,
  timeout, cancellation, disk-full, and process restart during staging.
- Two games with the same set/product IDs remain isolated.
- Shared content survives removal of one referencing product and is collected
  after the last reference is removed.
- Failed updates roll back to the old usable product; compatible catalog updates
  do not trigger unnecessary redownloads.
- Removing a game cascades package assets without removing user history.

### End to end

- The same external package installs, downloads, opens in airplane mode, emits
  the same product/card identities, and saves pulls on web, iOS, and Android.
- WebView/local-origin policy prevents navigation or asset access outside the
  mounted verified package namespace.
- Older clients display catalog-only compatibility instead of attempting an
  unsupported pack runtime.

## Recommended implementation order

1. Add the outer `runtime` discriminator and normative pack-library JSON Schema.
2. Implement the parser, semantic validator, artifact planner, and seeded
   weighted-slot generator in shared TypeScript.
3. Express the three existing Pokemon pools as a built-in declarative fixture;
   prove parity and remove fallback behavior.
4. Update `pack-core` to accept the validated runtime input while keeping its
   visual state machine and native event contract.
5. Implement versioned, content-addressed staging and package-scoped identity on
   the web, then add installed-package selection.
6. Mount the same verified objects in the iOS and Android embedded WebViews and
   generalize their offline download managers.
7. Add cascade/update recovery, compatibility UI, and the complete cross-
   platform test matrix.
8. Enable `tcger-declarative-pack-v1` for user packages only after a first-party
   package passes the full airplane-mode conformance run on all three clients.
