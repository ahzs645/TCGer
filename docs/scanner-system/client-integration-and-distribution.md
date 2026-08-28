# Client integration and distribution

## R2 object model

Cloudflare R2 serves immutable objects behind mutable, short-lived manifests:

```text
catalogs/manifest.json
catalogs/{content-addressed pack}.json

pack/manifest.json
pack/objects/{content-addressed asset}

scan-index/manifest.json
scan-index/objects/{content-addressed browser model or index}

ios/scan-assets/{game}/manifest.json
ios/scan-assets/objects/{content-addressed runtime file}

android/scan-assets/{game}/manifest.json
android/scan-assets/objects/{content-addressed runtime file}
```

Publishers upload every immutable object first, verify or skip identical
objects by SHA-256 metadata, and write the mutable manifest last. A client
therefore never observes a new release whose referenced files have not been
uploaded.

Training images are deliberately absent from public R2. They belong in the
private Hugging Face image dataset. Clients receive only trained runtimes,
indexes, metadata, public catalog packs, and pack-opening assets.

## Browser

### Loading

The browser reads `scan-index/manifest.json`, selects a per-game entry, fetches
its content-addressed index, and loads the model URL embedded in that index.
ArcFace uses ONNX Runtime Web/WASM. DINOv2 remains a Pokémon rollback option.

The browser index JSON is gzip-compressed at R2 with
`Content-Encoding: gzip`. Fetch decodes it automatically before JSON parsing.
The decoded, parsed index is stored in the `tcger-scan-cache` IndexedDB store,
keyed by game and version, so the large network transfer is normally paid only
once per release.

### Model switching and automatic mode

The runtime caches initialized embedding closures by complete model contract.
When every selected shard shares a model, one crop embedding is reused across
shards. When installed shards use different per-game models, it computes one
embedding per distinct model and merges calibrated top-K candidates.

The model, encoder kind, dimensions, URL, and thresholds are treated as one
contract. Retaining a model session from a previous manifest is prevented by
the model key.

### Diagnostics

Browser diagnostics validate:

- artifact kind, encoder, dimensions, total, entries, and vector length;
- base64 vector payload without materializing an unnecessary decoded copy;
- model/index URL reachability and manifest agreement;
- decoded byte count and content hash semantics.

### Current Pocket exposure

The published browser Pokémon index contains the 2,321 Pocket rows and does not
filter them during top-K search. It must be replaced with a physical-only
index. The browser should also gain a defensive format/domain eligibility
check so one bad release cannot reintroduce the same class of candidate.

## iOS

### Download and activation

`ScannerAssetStore` discovers Pokémon, Magic, and Yu-Gi-Oh manifests. For one
game it:

1. downloads the manifest;
2. creates a private staging directory;
3. downloads every Core ML package file plus metadata and vectors;
4. verifies file byte counts and SHA-256 hashes;
5. validates metadata count, contiguous indices, and vector header/shape;
6. compiles the Core ML package on-device;
7. writes the manifest into the staged release;
8. atomically moves it into the version directory;
9. records that version as active and removes inactive versions.

If installation fails, the active version is not changed. Settings exposes an
“Offline Scanner Models” section with install/update/remove and progress.
Users reopen the scanner after installation so the coordinator is rebuilt with
the new runtime.

### Runtime construction

At scanner construction time, each installed game contributes a dedicated
`BoardCardEmbeddingScannerStrategy` with:

- file-backed compiled Core ML model loader;
- file-backed packed vector index;
- file-backed metadata store;
- only that game's supported scan mode.

The bundled strategy remains a fallback. Model, vectors, and metadata from a
downloaded release stay paired because they are resolved from the same version
directory.

### Pocket defense

iOS metadata eligibility rejects explicit `format: pocket` and the legacy
TCGdex `/tcgp/` URL path. This protects physical scan candidate selection even
when old metadata omitted the format field. It does not remove the rows from
the published payload or undo contaminated training, so the release still
needs replacement.

## Android

### Download and activation

Android's `ScannerAssetStore` follows the same transaction shape with a single
fp32 ONNX file instead of a Core ML package:

1. fetch per-game manifest into staging;
2. validate schema, game, version, encoder, thresholds, and safe paths;
3. download model, vectors, and metadata with progress;
4. verify byte counts and SHA-256;
5. decode the packed index and validate count, dimension, and game assignment;
6. atomically move the release into the version directory;
7. update the current manifest pointer.

Failed updates keep the installed manifest and runtime active. The Compose
settings screen exposes install, retry/update, removal, card count, and bytes.

### Runtime construction

The repository selects the installed game runtime for explicit ArcFace scans.
Pokémon falls back to the bundled model if no downloaded runtime exists. A
recognizer cache is keyed by game and artifact version; replacing a release
closes and rebuilds only the affected recognizer.

### Pocket defense

`PackedCardEmbeddingIndex` rejects rows marked `pocket` or whose image URL
contains `/tcgp/` when searching Pokémon. As on iOS, this is defense in depth,
not a substitute for publishing a clean physical-only payload.

## Catalog clients

Catalog delivery is separate from scanner delivery:

- Web downloads catalog packs into IndexedDB and service-worker caches.
- iOS uses an R2-backed source with persistent on-device cache and bundled
  fallback.
- Catalog install state is per game.
- Sealed products are a second optional per-game pack.
- Removing a catalog never removes saved collection records.

The current catalog manifest has hard-coded consumers for six game keys, while
the scanner stores hard-code three downloadable games. This is the main reason
the proposed game-package registry is needed.

## Offline pack-opening assets

Pack-opening assets use a separate `pack/manifest.json` containing a shared
mesh and content-addressed covers/bases/decals. Projected wrapper exports carry
their stable ID, label, card pool, and accent in `manifest.entry.json`; the
publisher discovers those entries rather than requiring a hard-coded cover
list.

Web's current offline set download list is still fixed and includes
Pokémon-specific shared assets such as the Pokémon card back. That must become
game-scoped before it can serve as the general future-game capability.

## Version and rollback policy

- Catalog, browser scanner, iOS scanner, and Android scanner versions are
  independent today.
- Content-addressed objects are immutable; rollback means repointing a mutable
  manifest to a previously accepted object/version.
- Client activation is per capability and per game.
- A future game-package manifest should declare compatibility and dependency
  hashes rather than forcing these releases to share one version number.

## Publishing tools

| Asset family | Publisher |
|---|---|
| Catalogs | `tools/r2/publish-catalogs.mjs` |
| Pack assets | `tools/r2/publish-pack-assets.mjs` |
| Browser scanner | `tools/r2/publish-scan-index.mjs` |
| iOS scanner | `tools/r2/publish-ios-scan-pack.mjs` |
| Android scanner | `tools/r2/publish-android-scan-pack.mjs` |

All support a dry-run/validation path. Production publication should always
start with that plan and end with live-manifest diagnostics.
