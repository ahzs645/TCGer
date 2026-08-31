# GamePackageManifest v1

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

The normative JSON Schema is [`schemas/game-package-manifest.v1.schema.json`](schemas/game-package-manifest.v1.schema.json). TypeScript runtime validation lives in `packages/api-types/src/game-packages.ts`; iOS and Android apply the same allowlists before saving anything.

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

The optional scanner entries reference per-platform manifests and name the `tcger-arcface-v1` data runtime. The optional `sealedProducts` entry references a `tcger-sealed-catalog-v1` artifact, and the optional offline-pack entry names the declarative `tcger-pack-library-v1` schema. Declaring a sealed-products interface without its sealed catalog is invalid, just as scanner and pack-opening interfaces require their corresponding capabilities. Current clients preserve these declarations but specialized unknown-game renderers remain capability-gated until their runtime adapters are connected. Catalog and filter support does not depend on those adapters.
