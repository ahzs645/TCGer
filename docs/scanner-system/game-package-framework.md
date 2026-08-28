# Extensible game-package framework

**Implementation status (2026-08-27):** the direct-URL, catalog-first portion
is implemented as [`GamePackageManifest` v1](game-package-manifest.md), with a
normative JSON Schema and TypeScript, Swift, and Kotlin validators. Unknown
games can be installed, stored offline, browsed, searched, and filtered on all
three clients. The first-party registry, dependency coordinator, and dynamic
scanner/offline-pack adapters described below remain planned work.

## Problem

TCGer currently discovers capabilities through separate, partly hard-coded
systems:

- the catalog manifest knows a fixed list of product games;
- offline pack downloads know a fixed list of sets and Pokémon-oriented shared
  assets;
- browser scanner discovery has its own manifest;
- iOS and Android each hard-code three downloadable scanner games.

Adding a game therefore means editing multiple clients even when the new game
already supplies compatible data and models. A game-level registry should make
capabilities discoverable while keeping their bytes optional and independently
versioned.

## Design goals

1. One stable game identity and display descriptor.
2. Catalog as the required identity foundation.
3. Optional sealed products and offline pack/set assets.
4. Optional scanner assets per platform.
5. Independent capability versions with explicit dependency hashes.
6. Content-addressed payloads and manifest-last publication.
7. Data-driven onboarding for future games.
8. No remotely executable third-party code.
9. Backward-compatible adoption over existing manifests.

## Future registry manifest

Proposed endpoint:

```text
games/manifest.json
```

Example:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-27T00:00:00Z",
  "games": {
    "pokemon": {
      "manifest": "games/pokemon/manifest.v1.<sha>.json",
      "bytes": 2048,
      "sha256": "<sha256>",
      "minimumClientSchema": 1
    }
  }
}
```

The registry is mutable and short-cached. Per-game manifests are immutable and
content-addressed.

## Original registry descriptor sketch

```json
{
  "schemaVersion": 1,
  "game": {
    "id": "pokemon",
    "name": "Pokémon",
    "aliases": ["ptcg"],
    "accent": "#E3350D",
    "formats": [
      {"id": "tabletop", "physical": true},
      {"id": "pocket", "physical": false}
    ]
  },
  "capabilities": {
    "catalog": {
      "required": true,
      "manifest": "/catalogs/manifest.json#games.pokemon",
      "identityRevision": "<catalog-identity-sha256>"
    },
    "sealedProducts": {
      "required": false,
      "manifest": "/catalogs/manifest.json#games.pokemon.sealedProducts",
      "requiresCatalogIdentity": "<catalog-identity-sha256>"
    },
    "offlinePacks": {
      "required": false,
      "manifest": "/games/pokemon/packs/manifest.json",
      "selection": "set",
      "requiresCatalogIdentity": "<catalog-identity-sha256>"
    },
    "scanner": {
      "required": false,
      "formats": ["tabletop"],
      "catalogIdentity": "<catalog-identity-sha256>",
      "platforms": {
        "web": "/scan-index/manifest.json#indexes.pokemon",
        "ios": "/ios/scan-assets/pokemon/manifest.json",
        "android": "/android/scan-assets/pokemon/manifest.json"
      }
    }
  }
}
```

Fragment-like references above are logical references; the validator resolves
them through the known manifest schema rather than allowing arbitrary JSONPath
execution.

## Capability semantics

### Catalog

Required for enabling a game. Contains canonical card/set identities and
metadata. It may include multiple formats. The game manifest declares which
formats exist; features decide which are eligible.

### Sealed products

Optional small metadata pack. Depends on catalog identity but never duplicates
owned inventory. Removing it hides offline product discovery without deleting
user records.

### Offline packs

Optional per-game or per-set bundle containing declarative collation and
visual assets such as wrappers, card backs, meshes, bases, and decals. A set
entry should declare exact card-pool IDs, expected bytes, and catalog revision.

### Scanner

Optional platform matrix. A game can be catalog-only or support only some
platforms. Each platform manifest retains its current atomic model/index
contract. Scanner format scope is explicit; Pokémon's physical scanner lists
`tabletop`, never `pocket`.

## Install profiles

Clients can present four simple choices backed by individual capability state:

| Profile | Downloads |
|---|---|
| Browse | Required catalog only |
| Browse + packs | Catalog plus user-selected sealed/offline pack assets |
| Browse + scan | Catalog plus platform scanner runtime |
| Everything | Catalog plus all selected optional capabilities |

“Everything” should not silently download every card image for every set.
Offline artwork is selected by set or policy, with its byte estimate shown
before installation.

## Installed state

Store one record per `(game, capability, platform-or-selection)`:

```json
{
  "game": "magic",
  "capability": "scanner",
  "platform": "ios",
  "version": "1",
  "manifestSha256": "...",
  "catalogIdentity": "...",
  "installedAt": "...",
  "bytes": 84728327
}
```

The coordinator derives game status instead of using one ambiguous installed
boolean. A partially installed game is valid: catalog installed, scanner not
installed, two offline sets cached.

## Dependency and update rules

- Catalog update may be metadata-only, identity-changing, or artwork-changing.
- Metadata-only updates do not automatically invalidate a scanner.
- Identity changes trigger compatibility evaluation through the declared
  catalog identity hash.
- New cards may require an index update while retaining encoder weights.
- Scanner model changes require a complete atomic scanner release.
- Pack set updates invalidate only the selected pack asset bundle.
- Clients download dependencies first and activate the requesting capability
  last.

The manifest should explain why an update is offered: new catalog cards,
changed metadata, new offline sets, new scanner index, new model, or security/
schema requirement.

## Future-game provider package

A maintainer or approved contributor supplies:

```text
games/<game>/
  game.json
  provider.json
  fixtures/
    sets.json
    cards.json
  mapping.json
  pack-rules.json          # optional declarative schema
  scanner-contract.json    # optional metadata, no model bytes in Git
```

Minimum provider mapping:

- stable game key;
- catalog revision endpoint or cadence policy;
- set item path and set ID/code/name/date/count fields;
- card ID, name, set, format, visual/artwork ID, and image fields;
- physical/digital eligibility mapping;
- pagination/archive behavior;
- provenance and licensing notes.

The current `futureGameTemplate` in
`tools/scanner-image-library/source-providers.json` is the starting point for
the source planner. The game-package schema adds client-facing capability
metadata on top of it.

## Validation

Publication fails unless:

- game IDs and aliases are unique and normalized;
- referenced manifests use HTTPS or approved same-origin paths;
- every remote asset has bytes and SHA-256;
- dependency hashes resolve;
- scanner format scopes exist in the game descriptor;
- scanner candidates resolve to catalog identities;
- physical scanners contain no digital-only rows;
- pack card pools contain only catalog IDs for the declared revision;
- platform/schema minimums are satisfiable;
- paths cannot escape their object prefix;
- no executable script/module payload is declared.

## Migration plan

### Phase 1: direct URL and shared parser — complete

The shipped v1 accepts a publisher's HTTPS URL, validates a shared manifest,
verifies the catalog bytes and SHA-256, and installs an unfamiliar catalog on
web, iOS, and Android. It also renders allowlisted game-defined filter controls.

### Phase 2: registry overlay

Publish `games/manifest.json` and per-game descriptors that reference the
existing catalog, pack, and scanner manifests. No payload or client behavior
changes.

### Phase 3: expanded conformance corpus

Implement the schema once in a platform-neutral test fixture, then add strict
TypeScript, Swift, and Kotlin decoders with the same conformance corpus.

### Phase 4: install coordinator

Add one game download screen showing capability availability, installed state,
bytes, updates, dependencies, and removal. Existing catalog/scanner stores
remain responsible for their transactions; the coordinator orchestrates them.

### Phase 5: generalize offline packs

Replace hard-coded set definitions and Pokémon shared assets with game-scoped
declarative pack manifests and per-set bundles.

### Phase 6: remove hard-coded discovery

Once all clients use the registry and retain a bundled fallback descriptor,
remove hard-coded downloadable game arrays. Keep compile-time allowlists only
for executable features that truly require app code.

### Phase 7: onboard a catalog-only future game

Prove extensibility with the smallest safe case: catalog and identity mapping,
no scanner, no pack code. Add optional capabilities only after their separate
acceptance gates pass.

## Non-goals

- Downloading every image merely to detect provider changes.
- Treating all capabilities as one monolithic archive/version.
- Running third-party code fetched from a manifest.
- Claiming scanner support without a real-camera evaluation suite.
- Forcing a model retrain for every catalog update.
- Hiding digital formats from collection features merely because the physical
  scanner excludes them.
