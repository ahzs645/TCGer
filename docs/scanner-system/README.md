# TCGer scanner and offline-game system

**Status date:** 2026-08-27

**Purpose:** canonical index for the scanner, catalog, offline-pack, training,
and distribution work completed during the universal-scanner project.

This documentation set supersedes the status sections of the earlier
[universal scanner handoff](../universal-scanner-project-handoff-2026-08-27.md).
The earlier document remains useful as a historical record of the decision to
run the first full jobs, but it predates the completed three-game training,
R2 publication, app integration, durable image-library work, and the Pokémon
TCG Pocket audit.

## Read this first

The project now has a working end-to-end recognition and distribution path for
Pokémon, Magic: The Gathering, and Yu-Gi-Oh!:

1. Authoritative catalogs are normalized into visual identities.
2. Per-game FastViT-T8 ArcFace encoders are trained on Hugging Face Jobs.
3. Each encoder emits a 384-dimensional normalized embedding.
4. Metadata and packed int8 reference vectors are exported in identical row
   order for iOS, Android, and web.
5. Platform-specific model formats and indexes are published to Cloudflare R2.
6. Clients download, validate, stage, and atomically activate game-specific
   scanner releases.
7. Catalogs and offline pack-opening data are distributed separately today.
   `GamePackageManifest` now provides a shared install overlay for external,
   catalog-first game libraries and their declarative filters.

The most important correction is that the production direction is currently
**per-game encoders with a shared runtime contract**, not one shared encoder.
The mixed-game model remains a useful experiment, but isolated training gave
each game its own classification head, checkpoint, thresholds, and release
lifecycle. The browser can search heterogeneous installed models by running
the required encoders separately and merging calibrated candidates.

## Documentation map

| Document | Use it for |
|---|---|
| [System architecture](architecture.md) | Runtime boundaries, data flow, identity model, and automatic versus explicit scanning |
| [Training data and model pipeline](training-and-data-pipeline.md) | Catalog normalization, image library, Hugging Face jobs, checkpoints, evaluation, and exports |
| [Two-stage recognition](two-stage-recognition.md) | Recognition-family labels, exact-print verification, abstention, per-game policies, and physical Pokémon scope |
| [Artwork-family matching](artwork-family-matching.md) | Pokémon reprint-source research, reproducible visual grouping, review workflow, and release gates |
| [Release inventory](release-inventory-2026-08-27.md) | Exact model metrics, hashes, sizes, R2 versions, Hub revision, and job identifiers |
| [Client integration and distribution](client-integration-and-distribution.md) | Web, iOS, Android, R2 object layout, download behavior, caching, and rollback |
| [Implementation map and project history](implementation-map-and-history.md) | Source-file ownership, delivered components, data inventory, commit milestones, and local/remote state |
| [Operations runbook](operations-runbook.md) | Source checks, catalog refresh, image sync, training, evaluation, publication, and incident response |
| [Decisions, lessons, and open risks](decisions-and-known-issues.md) | Why the system was built this way, failed approaches, Pocket contamination, and remaining gates |
| [Extensible game-package framework](game-package-framework.md) | Proposed catalog + optional packs + optional scanner install contract for future games |
| [GamePackageManifest v1](game-package-manifest.md) | Implemented user-URL contract, filter model, trust boundary, schema, and publisher example |
| [Dynamic scanner runtime audit](dynamic-scanner-runtime-audit.md) | Safe activation contract, platform refactors, trust rollout, and conformance tests for community scanner models |
| [Dynamic offline-pack runtime audit](dynamic-offline-pack-runtime-audit.md) | Declarative collation schema, cache/activation semantics, hard-coded blockers, and rollout tests |
| [Game-package hardening roadmap](game-package-hardening-roadmap.md) | Validator parity, atomic/streamed installs, publisher authority, identity, lifecycle, and future capabilities |

Supporting implementation-specific documentation remains in:

- [Cloudflare R2 delivery](../../cloudflare/README.md)
- [Scanner image library](../../tools/scanner-image-library/README.md)
- [Offline catalogs](../offline-catalogs.md)
- [iOS scanner internals](../../mobile-apps/ios/TCGer/TCGer/CardScanner/README.md)
- [Android scanner model internals](../../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/model/README.md)
- [Browser scanner assets](../../frontend/public/scan-index/README.md)

## Current production-facing state

| Area | State on 2026-08-27 |
|---|---|
| Persistent Hugging Face authentication | Working; device-code workaround retired |
| Full Pokémon training | Completed, but contaminated by 2,321 Pocket-only rows |
| Full Magic training | Completed |
| Full Yu-Gi-Oh training | Completed |
| Android fp32 ONNX parity exports | Completed for all three games |
| iOS downloadable scanner releases | Published for all three games |
| Android downloadable scanner releases | Published for all three games |
| Browser ArcFace releases | Published for all three games; indexes gzip-transferred and decoded into IndexedDB |
| Catalog packs | Published for Pokémon, Magic, Yu-Gi-Oh, One Piece, and Lorcana |
| Sealed-product catalogs | Published as optional per-game artifacts |
| Durable scanner image-library tooling | Implemented and locally tested; no production image dataset release uploaded yet |
| Source-release planner | Implemented for Pokémon, Scryfall, and YGOPRODeck, with a future-game adapter contract |
| User-URL GamePackageManifest | Implemented for verified catalog install, browse, search, and filters on web, iOS, and Android; unknown-game scanner/pack adapters remain gated |
| Real-phone acceptance suites | Incomplete for Magic and Yu-Gi-Oh; Pokémon needs a clean physical-only rerun |

## Immediate priorities

1. Rebuild the physical-only Pokémon index at 19,507 rows and replace the web,
   iOS, and Android releases so the browser cannot return Pocket entries.
2. Build and upload the first audited private image-library release, then pin
   its immutable revision in future jobs.
3. Retrain and evaluate Pokémon on physical-only data; do not treat the current
   98.24% Recall@1 as a physical-only metric.
4. Evaluate the family-disjoint MTG retrain and exact-print verifier on binder
   captures before promotion.
5. Establish real-phone evaluation and per-game operating points before
   enabling automatic cross-game acceptance broadly.
6. Publish a first-party game-package registry over the implemented direct-URL
   contract and connect the unknown-game scanner/pack runtime adapters.

## Source-of-truth hierarchy

When documents disagree, use this order:

1. Immutable model/dataset revision and persisted evaluation artifact.
2. Live content-addressed R2 object plus its mutable manifest reference.
3. Code that validates and consumes the artifact.
4. This documentation set.
5. Historical handoffs and experiment notes.

No model should be identified only by a friendly filename. Record its catalog
fingerprint, image-library revision, checkpoint hash, export hash, dimensions,
and evaluation artifact together.
