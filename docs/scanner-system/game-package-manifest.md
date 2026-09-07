# GamePackageManifest v1 and v2

For step-by-step authoring, start with [Adding a future game](../src/content/docs/adding-games/index.md). The Starlight documentation site's **Adding Games** section provides a separate page for each capability, examples, validation steps, and current limitations. This file remains the consolidated package reference.

`GamePackageManifest` is the platform-neutral intake contract for any game library, including an alternative library for a game TCGer already ships. The same URL works in web account settings and in the iOS and Android Settings screens. Built-in libraries remain available and use the same effective `GameDefinition` shape inside each client.

The first release makes unknown games useful for catalog download, offline storage, browsing, searching, and publisher-defined filters. A manifest may also advertise scanner and offline-pack assets, but clients activate those only when the declared runtime/schema is supported; a manifest never carries executable code.

## Publishing

1. Publish a `tcger-catalog-v1` JSON object with `formatVersion: 1`, a `tcg` value identical to `game.id`, and `cards` containing unique non-empty `id` and `name` fields.
2. Put game-specific scalar or array fields under `card.attributes`. Core fields such as `rarity`, `setCode`, and `artist` may remain top-level.
3. Record the catalog's exact byte count and SHA-256 in the package manifest.
4. Serve the manifest and assets over HTTPS. Web hosts must also return suitable CORS headers.
5. Give new releases a monotonically increasing `update.sequence` and keep `update.manifestUrl` stable. `packageVersion` remains a publisher-facing display version and does not need to be SemVer.
6. Sign public releases with `npm run game-packages:sign -- --manifest ... --private-key ... --key-id ...`. Keep the private key outside the repository.
7. Start with the two-card conformance example in
   [`examples/community-demo.game-package.json`](examples/community-demo.game-package.json),
   then test the full import experience with the fictional
   [Codex Critters fixture](examples/codex-critters/README.md).

## Package and game identity

`game.id` identifies the rules/card namespace, not the publisher's particular data library. This means two publishers may both distribute a Pokémon-compatible library. New manifests should include stable `publisher.id` and `packageId` values; clients install them under the combined identity `publisher.id--packageId`, so they do not replace another publisher's package. Existing v1 manifests without those fields remain valid and continue to install under `game.id`.

TCGer's own catalogs use the same identity model (`tcger--pokemon-catalog`, `tcger--magic-catalog`, and so on). The catalog build emits a stable `<game>.game-package.json` beside every generated pack, so official and third-party libraries share one definition and artifact contract. A third-party package may target the same `game.id`; only its package identity must be different.

The generated catalog `manifest.json` is also the official Game Store index. Each published game entry names its `packageFile`; the catalog publisher uploads that package manifest beside its referenced card and sealed-product artifacts. Web and iOS Settings build their Game Store rows from those package manifests rather than a separate hard-coded download list. Other publishers remain installable from **Install from URL** inside the Game Store.

Clients reject redundant installations. The exact same package version cannot be installed twice, and a second package ID cannot wrap an identical catalog hash for the same game. TCGer's official package identities are reserved for the Game Store and cannot be installed through the generic URL channel. A changed catalog in the same `publisher.id--packageId` slot is treated as an update. If a package's source later becomes unavailable, the installed local package remains usable and the client reports that it could not check for updates.

## Unified game definition

The optional `definition` describes how the game participates in generic app surfaces:

- `collection.identityModes` defines whether records group by underlying card (`baseExternalId`) or exact printing (`printingKey`).
- `collection.facets` and `search.facets` define declarative controls using the filter types below.
- `formats` records physical or digital variants of the game.
- `presentation` provides portable branding hints.
- `interfaces` declares which surfaces the package has enough data to support: search, collections, sets, wishlists, decks, pricing, sealed products, scanner, and pack opening.
- `interfaces.features` declares versioned game-specific adapters. Clients preserve unknown feature IDs but expose them only when that client has a compatible adapter. The first standard adapter is `pokedex` version 1, which consumes normalized `dexEntries` from catalog cards. Publishers can use the same mechanism for future game-specific indexes, rule tools, or collection views without adding executable package code.

Unprefixed adapter IDs are reserved by TCGer and listed in the shared adapter registry. Publisher-specific adapters must use `<publisher.id>--<feature-id>`—for example, `tcger-fixtures--critter-index`. Adding a declaration does not inject UI: each platform registers a compatible renderer and maximum adapter version before advertising the surface.

For consistent controls in all three clients, publishers should provide explicit `options` for package `select` and `multiSelect` facets. Core catalog fields include printing identity, set metadata, language, regulation/legal status, `formatLegality`, `dexEntries`, and arbitrary declarative `attributes` for other game rules.

When `definition` is absent, every client produces a backward-compatible definition from `game`, `catalog`, `filters`, `scanner`, `sealedProducts`, and `offlinePacks`. Search, collections, sets, and wishlists default on; specialized surfaces and feature adapters default off unless declared. An interface flag is a capability declaration, not executable behavior: pricing, deck rules, scanner models, sealed products, pack opening, and feature adapters still require their corresponding data/runtime contracts.

The Codex Critters README includes one stable HTTPS URL that can be pasted into
web, iOS, or Android Settings. URL fields intentionally start empty; clients do
not silently select a publisher or example package.

The structural JSON Schemas are [v2 for new packages](schemas/game-package-manifest.v2.schema.json) and [v1 for legacy packages](schemas/game-package-manifest.v1.schema.json). TypeScript runtime validation lives in `packages/api-types/src/game-packages.ts`; iOS and Android also validate packages before saving them. Runtime checks additionally enforce cross-field and artifact integrity requirements.

## Filters

Filters are UI declarations, not code. A package can define up to 24 controls using `select`, `multiSelect`, `numberRange`, `boolean`, or `text`. Each control may read a core property or a dotted `attributes.*` path. Option lists are capped at 200 entries. Text matching is literal and case-insensitive; regular expressions, functions, scripts, SQL, and unrestricted JSONPath are deliberately unsupported.

Multi-select values within one filter use OR semantics. Different filters use AND semantics. Empty controls do not constrain results. Clients cap the visible result list while retaining the full verified catalog offline.

The semantics intentionally borrow the small, interoperable core of
[OGC CQL2](https://docs.ogc.org/is/21-065r2/21-065r2.html) (boolean composition,
property comparisons, and `IN`) without exposing its full expression language.
The manifest itself follows
[JSON Schema 2020-12](https://json-schema.org/draft/2020-12), and the clients use
allowlisted types, paths, sizes, and counts in line with
[OWASP input-validation guidance](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html).

## Trust and update model

- HTTPS is required, except loopback HTTP for local development.
- URL credentials and fragments are rejected. Cross-origin web servers must opt in with CORS.
- Manifests are capped at 1 MiB. Each referenced artifact declares its own byte ceiling, with a hard 512 MiB v1 maximum.
- Catalog byte count, SHA-256, game id, schema version, and card count must all agree before installation replaces an earlier version.
- `update.manifestUrl` is the stable update channel. Clients fetch only that small manifest when checking; the catalog is downloaded after the user chooses **Update**.
- `update.sequence` is monotonic. A higher sequence is an update, a lower sequence is a rejected downgrade, and changed content at the same sequence is a conflict. Legacy manifests without a sequence fall back to `publishedAt`; mixing sequenced and unsequenced releases in one package slot is rejected.
- Downloads are fully validated before installed state changes; native clients use a staged backup/rollback swap plus an atomic installed-index write, and web replacement uses one IndexedDB transaction. The original installation date and package identity survive an update.
- `publisher.signingKey` and `signature` declare an Ed25519 public key and detached signature over the exact manifest bytes. Web, iOS, and Android verify the signature before installing signed packages and pin the key to `publisher.id:keyId` on first use. A verified package cannot be replaced by an unsigned release or a different key.
- First use is trust-on-first-use: a valid signature proves continuity with the displayed key, not that a publisher name is legally verified. Curated store keys can be pre-pinned later without changing the package format.
- The catalog publisher uploads immutable catalog objects first, then the detached signature, the game-package manifest, and finally the global Game Store index. Non-dry-run official publishing rejects unsigned package manifests unless the explicit development-only `--allow-unsigned` flag is supplied.

### Update lifecycle

1. **Check:** fetch the installed package's stable update manifest and validate identity, feature namespace, release sequence, and signature continuity.
2. **Offer:** show release notes/version when the candidate sequence is newer. The installed catalog remains active.
3. **Stage:** download the candidate catalog and validate its declared size, SHA-256, game identity, counts, and adapter-specific required fields.
4. **Commit:** replace the existing package slot with a platform transaction or rollback-safe staged swap, and keep collection records intact because package and card identities are stable.
5. **Recover:** if any network, signature, or validation step fails, keep the previous release untouched. Removal remains a separate explicit action.

## Specialized capability boundary

The optional scanner entries reference per-platform manifests and name the `tcger-arcface-v1` data runtime. The optional `sealedProducts` entry references a `tcger-sealed-catalog-v1` artifact, and the optional offline-pack entry names the declarative `tcger-pack-library-v1` schema. Declaring a sealed-products interface without its sealed catalog is invalid, just as scanner and pack-opening interfaces require their corresponding capabilities. Compatible pricing, pack-opening, and scanner assets can be downloaded from the installed library on web, iOS, and Android. Generic URL-package ingestion into sealed inventory is not yet implemented; the sealed declaration alone does not activate that integration. Catalog and filter support does not depend on enabling optional downloads.


## Version 2: reusable game capabilities

Use `schema: "https://tcger.app/schemas/game-package-manifest/v2"` for new packages.
Existing v1 catalogs remain readable. Both versions use the same catalog format;
v2 additionally requires `definition.deckRules` when `interfaces.decks` is true,
and a `pricing` asset when `interfaces.pricing` is true. Flags describe available
features; downloading a scanner or pack library is a separate action in the
installed library. Packages contain data, never executable extensions.

The [Star Garden fixture](examples/star-garden/README.md) is a complete example.
The structural contracts are generated with
`npx tsx tools/game-packages/build-schema.ts` into `schemas/`. Clients also check
cross-field invariants that JSON Schema does not express, including unique IDs,
reference integrity, checksum agreement, and effective-date ordering.

### Decks

`definition.deckRules` version 1 declares formats, each format's named zones,
zone size limits and optional card eligibility, its default zone, a copy limit,
and optional copy-limit exceptions. Eligibility predicates read a supported
card field or `attributes.*`; values in a predicate are alternatives, and multiple
predicates are all required. Copies aggregate across zones and alternate
printings by `baseExternalId` (falling back to exact card ID), or by normalized
name when explicitly configured. Declare `baseExternalId` for every alternate
printing if they share a copy limit.

Deck creation snapshots these rules into the deck. Editing and validation use
that snapshot after catalog updates or removal. Unsupported formats and unknown
legality return `valid: false` with `unsupported` or `unknown` status. The existing
built-in validators remain available for older decks. Rules supplied by a package
are publisher rules, not an assertion that an official tournament approved them.
Decks remain subject to each client's existing account/server availability.

### Printings, finishes, and symbols

`definition.printings` version 1 enables printing selection and declares finishes
as `{ code, label, foil }`. A custom non-foil finish must explicitly set `foil: false`.
`baseExternalId` groups alternate printings; `printingKey` identifies one printing.
Names alone do not establish that two cards are the same card. Printing lookup is
scoped to the originating installed package; an ambiguous source is not silently
chosen. The `selection` value preserves a publisher's preferred grouping mode;
package catalogs currently expose a flat list of exact printings.

`definition.presentation.symbols` supplies HTTPS artwork with a stable ID, label,
and kind (`rarity`, `resource`, or `type`). Rarity badges match the card's rarity
value to the declared symbol ID. Resource and type symbols match string tokens in
`types` or scalar/array `attributes` (for example, `attributes.resources: ["sun"]`). Clients retain metadata in `attributes.tcger`
when a catalog card is saved, so labels and finish behavior survive removal of
its source library. Publishers must reserve that attribute for the app.

### Legality

`formatLegality` accepts arbitrary format IDs. `legalityPeriods` can declare
`format`, `legal`, `validFrom`, and `validTo`; starts are inclusive, ends exclusive.
The latest applicable start wins. Once a format has dated coverage, a date outside
that coverage is unknown, even when an undated value exists. A card marked
`sanctionedPlayLegal: false` is always ineligible for sanctioned validation.
Static catalog filters read `formatLegality`; deck validation applies the dated
rules at the requested/current time.

### Price snapshots

`pricing: { schema: "tcger-price-snapshot-v1", asset }` references quotes with exact
card/printing/finish/condition/language identity, amount, currency, source,
observation time, and expiry. Optional identity fields are exact: absent means
unspecified, not a wildcard. Supply `printingKey` when the catalog uses it.
Clients never substitute another variant, currency, or expired quote. For example,
a Japanese foil quote does not become an English non-foil value.

Native copy/detail views and web card previews expose package prices with source
and date. Web tracked collection pricing also resolves installed snapshots before
remote providers when the source is automatic, using exact USD quotes for its
existing accounting path. Multiple installed price sources for one game are an
explicit miss in that aggregate path; individual card previews retain package
scope. Package snapshots do not create a live provider integration or a background
price-alert service. Refresh a snapshot by publishing and installing a new release.

### Packs and scanner assets

`offlinePacks.manifest` references a `tcger-pack-library-v1` file. Each pack has
named weighted slots; `withoutReplacement` applies within that slot. Pools
reference catalog card IDs and cannot have duplicates or impossible draw counts.
The shared sampler and native samplers use the same weighted semantics. Once
installed, collation works offline. Artwork still follows normal image caching.
Pulls can be inspected and saved through existing collection/wishlist controls.

Web `scanner.web.manifest` references `tcger-scanner-bundle-v1`, containing bounded,
hashed `index` and `model` assets. The index must declare the package's game and
catalog IDs, the supported ArcFace encoder, and consistent int8 vector dimensions.
The verified model bytes feed the existing inference runtime. Index-supplied
unverified model/gate URLs are discarded. iOS and Android entries point to their
existing native ArcFace manifests, including those runtimes' model/index and
integrity requirements. A scanner flag cannot make an incompatible or untrained
model work; publishers still need platform-compatible models and accuracy tests.

All relative URLs resolve against the manifest that contains the reference.
`update.manifestUrl` is an update channel, not the base URL of the installed
release. Failed capability downloads preserve the previous active data. Web
catalog replacement clears its capability activation records; new native catalog
installations replace the capability files in their package directory. Native
scanner binaries retain the scanner store's independent installation lifecycle.

Specialized collection views, including Pokémon's Pokédex roster and generations,
are unchanged by this work.
