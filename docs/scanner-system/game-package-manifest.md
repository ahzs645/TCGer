# GamePackageManifest v1

`GamePackageManifest` is the platform-neutral intake contract for a game library that TCGer has never shipped. The same URL works in web account settings and in the iOS and Android Settings screens.

The first release makes unknown games useful for catalog download, offline storage, browsing, searching, and publisher-defined filters. A manifest may also advertise scanner and offline-pack assets, but clients activate those only when the declared runtime/schema is supported; a manifest never carries executable code.

## Publishing

1. Publish a `tcger-catalog-v1` JSON object with `formatVersion: 1`, a `tcg` value identical to `game.id`, and `cards` containing unique non-empty `id` and `name` fields.
2. Put game-specific scalar or array fields under `card.attributes`. Core fields such as `rarity`, `setCode`, and `artist` may remain top-level.
3. Record the catalog's exact byte count and SHA-256 in the package manifest.
4. Serve the manifest and assets over HTTPS. Web hosts must also return suitable CORS headers.
5. Test with the example in [`examples/community-demo.game-package.json`](examples/community-demo.game-package.json).

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
- Refreshing the same URL is the update operation. Downloads are fully validated before installed state changes; native files use atomic writes and web replacement uses one IndexedDB transaction.
- This is integrity verification, not publisher identity verification. A future registry/signature layer can add publisher trust without changing the package contents.

## Scanner and pack capability boundary

The optional scanner entries reference per-platform manifests and name the `tcger-arcface-v1` data runtime. The optional offline-pack entry names the declarative `tcger-pack-library-v1` schema. Current clients preserve these declarations but the unknown-game scanner and pack renderers remain capability-gated until their runtime adapters are connected. Catalog and filter support does not depend on those adapters.
