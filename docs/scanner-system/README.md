# TCGer scanner and offline-game system

**Status date:** 2026-08-29

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
| [Current state and direction](current-state-and-direction-2026-08-29.md) | What is live now, what the recent work established, quick versus precise behavior, and the next priorities |
| [2026-08-29 release record](releases/2026-08-29-physical-pokemon-and-magic-v2.md) | Physical-only Pokémon and family-aware Magic metrics, publication state, hashes, sizes, and rollback pointers |
| [Real-camera recognition findings](real-camera-recognition-findings-2026-08-29.md) | The 27-frame Magic audit, resolver defects, full-index ONNX replay method, failure taxonomy, and root cause |
| [Camera data and model hardening](camera-data-and-model-hardening.md) | Cross-game camera corpus schema, training recipe, hard negatives, dual-region experiment, and release gates |
| [Reference-session ingestion and replay](reference-session-ingestion-and-replay.md) | Canonical session library, deduplicated ingestion, labeling, replay, integrity, and train/test separation |
| [Game acceptance policy](game-acceptance-policy.md) | Declarative per-game thresholds, evidence behavior, client fallback order, calibration, and future-game onboarding |
| [Magic visual-first replay record](mtg-visual-first-policy-2026-08-29.md) | The measured 49-frame policy A/B, recovered family/printing cases, and remaining model-side misses |
| [Acceptance-policy manifest republish](releases/2026-08-29-acceptance-policy-manifest-republish.md) | Manifest-only Magic/Pokémon R2 publication and verification procedure |
| [System architecture](architecture.md) | Runtime boundaries, data flow, identity model, and automatic versus explicit scanning |
| [Training data and model pipeline](training-and-data-pipeline.md) | Catalog normalization, image library, Hugging Face jobs, checkpoints, evaluation, and exports |
| [Image-library ownership and update policy](image-library-ownership-and-update-policy.md) | Local-first image acquisition, private Hugging Face dataset maintenance, immutable releases, and operator responsibilities |
| [Two-stage recognition](two-stage-recognition.md) | Recognition-family labels, exact-print verification, abstention, per-game policies, and physical Pokémon scope |
| [Artwork-family matching](artwork-family-matching.md) | Pokémon reprint-source research, reproducible visual grouping, review workflow, and release gates |
| [Pokémon metadata reproducibility](pokemon-metadata-reproducibility.md) | Source lock, offline byte-for-byte verification, controlled refresh, and full-job boundary |
| [Release inventory](release-inventory-2026-08-27.md) | Exact model metrics, hashes, sizes, R2 versions, Hub revision, and job identifiers |
| [Client integration and distribution](client-integration-and-distribution.md) | Web, iOS, Android, R2 object layout, download behavior, caching, and rollback |
| [Implementation map and project history](implementation-map-and-history.md) | Source-file ownership, delivered components, data inventory, commit milestones, and local/remote state |
| [Operations runbook](operations-runbook.md) | Source checks, catalog refresh, image sync, training, evaluation, publication, and incident response |
| [Decisions, lessons, and open risks](decisions-and-known-issues.md) | Why the system was built this way, failed approaches, Pocket contamination, and remaining gates |
| [Extensible game-package framework](game-package-framework.md) | Proposed catalog + optional packs + optional scanner install contract for future games |
| [GamePackageManifest v1](game-package-manifest.md) | Implemented user-URL contract, filter model, trust boundary, schema, and publisher example |
| [Dynamic scanner runtime audit](dynamic-scanner-runtime-audit.md) | Safe activation contract, platform refactors, trust rollout, and conformance tests for community scanner models |
| [Dynamic offline-pack runtime audit](dynamic-offline-pack-runtime-audit.md) | Declarative collation schema, cache/activation semantics, hard-coded blockers, and rollout tests |
| [Shared card-geometry plan](shared-card-geometry-plan-2026-09-02.md) | Approved direction for one shared detector/corner/crop stack across iOS, Android, and web: licensing gate, geometry and crop contracts, corpus schema, benchmark, winner rule, and execution order |
| [Shared card-geometry baselines](benchmarks/2026-09-02-shared-card-geometry/README.md) | Pinned predictions and deterministic geometry reports for device, Vision/app detector, DETR, and DRAW2 on the first 228 human-corner evaluation set |
| [Card-geometry orientation baselines](benchmarks/2026-09-02-shared-card-geometry-orientation-v3/README.md) | Orientation-known rerun of the same predictions, including fixed-order tail errors, orientation accuracy, and the pinned fail-first Hub smoke |
| [Game-package hardening roadmap](game-package-hardening-roadmap.md) | Validator parity, atomic/streamed installs, publisher authority, identity, lifecycle, and future capabilities |

Supporting implementation-specific documentation remains in:

- [Cloudflare R2 delivery](../../cloudflare/README.md)
- [Scanner image library](../../tools/scanner-image-library/README.md)
- [Offline catalogs](../offline-catalogs.md)
- [iOS scanner internals](../../mobile-apps/ios/TCGer/TCGer/CardScanner/README.md)
- [Android scanner model internals](../../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/model/README.md)
- [Browser scanner assets](../../frontend/public/scan-index/README.md)

## Current production-facing state

| Area | State on 2026-08-29 |
|---|---|
| Persistent Hugging Face authentication | Working; device-code workaround retired |
| Pokémon physical-only v2 | Live on iOS, Android, and web with 19,507 rows and zero Pocket cards |
| Magic visual-family v2 | Live on iOS, Android, and web with 67,849 family vectors representing 109,546 printings |
| Full Yu-Gi-Oh training | Completed |
| Android fp32 ONNX parity exports | Completed for all three games |
| iOS downloadable scanner releases | Published for all three games |
| Android downloadable scanner releases | Published for all three games |
| Browser ArcFace releases | Published for all three games; indexes gzip-transferred and decoded into IndexedDB |
| Catalog packs | Published for Pokémon, Magic, Yu-Gi-Oh, One Piece, and Lorcana |
| Sealed-product catalogs | Published as optional per-game artifacts |
| Durable scanner image-library tooling | Implemented and locally tested; no production image dataset release uploaded yet |
| Source-release planner | Implemented for Pokémon, Scryfall, and YGOPRODeck, with a future-game adapter contract |
| Declarative game acceptance policy | Implemented across publishers, iOS, Android, and browser; live native manifests still need the manifest-only republish, while identical built-in profiles are active |
| User-URL GamePackageManifest | Implemented for verified catalog install, browse, search, and filters on web, iOS, and Android; unknown-game scanner/pack adapters remain gated |
| Real-phone acceptance suites | Pokémon physical-only replay is complete; Magic has an additional 27-frame diagnosed session; Yu-Gi-Oh coverage still needs expansion |

## Immediate priorities

1. Republish the four native Magic/Pokémon manifests with their declarative
   `acceptancePolicy` blocks, following the manifest-only runbook exactly.
2. Replay-validate Android's newly policy-enabled manual OCR rescue for
   Pokémon and Yu-Gi-Oh! before treating it as a measured platform result.
3. Create the private, platform-neutral camera-corpus manifest and prepare a
   separate Magic camera-training set; do not train on release-gate sessions.
4. A/B camera-positive training, full-gallery hard negatives, and a combined
   full-card/art-region representation.
5. Expand Yu-Gi-Oh real-phone and binder acceptance coverage.
6. Add a reviewed Pokémon same-art family overlay only after the grouping
   process is reproducible; keep the working physical-only v2 as the control.
7. Publish a first-party game-package registry over the implemented direct-URL
   contract and connect trusted unknown-game scanner/pack runtime adapters.

## Source-of-truth hierarchy

When documents disagree, use this order:

1. Immutable model/dataset revision and persisted evaluation artifact.
2. Live content-addressed R2 object plus its mutable manifest reference.
3. Code that validates and consumes the artifact.
4. This documentation set.
5. Historical handoffs and experiment notes.

Documents with an earlier status date may describe a then-current risk that is
now resolved. In particular, the 21,828-row Pocket-contaminated Pokémon package
is historical; the live package is the 19,507-row physical-only v2 release.

No model should be identified only by a friendly filename. Record its catalog
fingerprint, prepared-pack manifest SHA, checkpoint hash, export hash,
dimensions, and evaluation artifact together.
