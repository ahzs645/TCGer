# Implementation map and project history

## Repository state at documentation time

- Branch: `main`
- HEAD: `95f739f4c53b8a738905dca7f4426d79a032c66d`
- Date: 2026-08-27
- The full training artifacts and R2 publications are remote/live.
- The newest cross-platform download integration, image-library hardening, and
  this documentation suite are present as local working-tree changes and must
  not be described as committed until they are reviewed and committed.

This distinction matters: a live R2 manifest can reference a release produced
from code that has not yet been captured in the repository's current HEAD.
Before another maintainer reproduces publication, first commit or otherwise pin
the exact reviewed working tree.

## Data inventory established

### Google Drive and raw archives

The scanner datasets were organized under `TCGer-Scanner-Datasets/games` with
game-separated `raw`, `derived`, `catalog`, `replay`, and `models` areas while
preserving older Pokémon paths for compatibility.

Six Roboflow archives were downloaded and checksummed:

| Game | Approximate archive bytes |
|---|---:|
| Pokémon | 349.3 MB |
| Magic | 295.4 MB |
| Yu-Gi-Oh | 109.3 MB |
| Total | approximately 754 MB |

These archives belong to detection and camera evaluation. Comprehensive
Scryfall and YGOPRODeck reference mirrors were also located in the UniFi backup
for recognition work.

### Hugging Face

The private model repository stores:

- normalized catalogs and provenance;
- the shipped Pokémon baseline ONNX;
- quick and full checkpoints;
- per-game full exports and evaluation reports;
- Android ONNX parity reports;
- run configuration/status artifacts.

The durable training image library is designed as a separate private dataset,
`ahzs645/tcger-scanner-images`, so large image bytes and their lifecycle are not
mixed into the model repository. Tooling exists, but the first production
release has not been uploaded.

## Training and data source files

| File | Responsibility |
|---|---|
| `mobile-apps/ios/scripts/prepare_universal_arcface_hub.py` | CPU catalog preflight, normalization preparation, and private Hub upload |
| `mobile-apps/ios/scripts/build_universal_trainer_metadata.py` | Provider-specific rows to normalized trainer metadata |
| `mobile-apps/ios/scripts/run_universal_arcface_hf_job.py` | Quick/full Jobs wrapper, game isolation, pinned inputs, Hub persistence |
| `mobile-apps/ios/scripts/train_arcface_encoder.py` | Image validation/materialization, training, resume, evaluation, Core ML/index export |
| `mobile-apps/ios/scripts/export_arcface_onnx.py` | Original ONNX export path used for browser convergence |
| `mobile-apps/ios/scripts/export_arcface_android_onnx.py` | Fixed-contract fp32 ONNX export and parity artifact |
| `mobile-apps/ios/scripts/tests/test_train_arcface_encoder.py` | Image coverage, cache, fingerprint, quarantine, and durable-library regression tests |
| `tools/scanner-image-library/plan_source_releases.py` | Cheap provider release/set planning and cadence decisions |
| `tools/scanner-image-library/source-providers.json` | Pokémon/Scryfall/YGOPRODeck signals, policy, and future-game template |
| `tools/scanner-image-library/sync_training_image_library.py` | Deterministic validated image release, audit, diff, distribution plan, upload |
| `tools/scanner-image-library/test_plan_source_releases.py` | Planner behavior and provider adapter tests |
| `tools/scanner-image-library/test_sync_training_image_library.py` | Network-free library release/audit/incremental tests |

## Browser implementation

| File | Responsibility |
|---|---|
| `backend/src/scripts/build-arcface-web-index.ts` | Converts trainer metadata/vector exports into one game-scoped browser index |
| `backend/src/scripts/update-scan-index-manifest.ts` | Builds local preferred/alternate scanner manifest |
| `frontend/src/lib/scan/embedding-matcher.ts` | Model loading, preprocessing, model-keyed cache, int8 cosine search, multi-model merge |
| `frontend/src/components/scan/use-video-scan-data.ts` | Manifest/index acquisition, IndexedDB caching, game shard lifecycle |
| `frontend/src/components/scan/use-video-scan-processor.ts` | Detection-to-embedding flow, gate, rectification rescue, OCR/tie handling |
| `frontend/src/lib/scan/scanner-asset-diagnostics.ts` | Live artifact and integrity validation |
| `tools/r2/publish-scan-index.mjs` | Content-addressed model/index upload, gzip encoding, manifest-last publication |
| `frontend/public/scan-index/README.md` | Browser artifact build and publication notes |

Delivered browser changes include:

- ArcFace for Pokémon, Magic, and Yu-Gi-Oh;
- per-game model URLs and metadata-derived index entries;
- heterogeneous-model automatic scanning;
- session reuse keyed by full model contract;
- gzip index transfer;
- parsed index caching in IndexedDB;
- live diagnostics for all three releases;
- retained Pokémon DINOv2 rollback artifact.

## iOS implementation

| File | Responsibility |
|---|---|
| `TCGer/Services/ScannerAssetStore.swift` | Manifest discovery, staged download, SHA/count/header validation, Core ML compilation, atomic activation |
| `TCGer/Views/Components/ScannerAssetInstallRow.swift` | Per-game install/update/remove UI and progress |
| `TCGer/SettingsView.swift` | Offline scanner-model settings section |
| `CardScanner/CardScannerCoordinator.swift` | Adds installed game-scoped strategies and bundled fallback |
| `CardScanner/Embedding/CardEmbeddingEncoder.swift` | Bundle and file-backed Core ML model loaders |
| `CardScanner/ANN/AnnoyIndexStore.swift` | Bundle and file-backed packed vector loading |
| `CardScanner/ANN/CardIndexMetadataStore.swift` | Bundle/file metadata, game indices, physical/Pocket eligibility |
| `CardScanner/BoardCardEmbeddingScannerStrategy.swift` | Injected encoder/index/metadata and per-mode scope |
| `tools/r2/publish-ios-scan-pack.mjs` | Core ML package/vector/metadata validation and R2 publication |

Delivered iOS behavior:

- installable Pokémon, Magic, and Yu-Gi-Oh scanner runtimes;
- application-support version directories;
- whole-release staging and activation;
- on-device Core ML compilation;
- installed-version persistence and cleanup;
- file-backed model/index/metadata pairing;
- physical-only Pokémon candidate filtering;
- bundled scanner fallback.

## Android implementation

| File | Responsibility |
|---|---|
| `data/scanner/model/ScannerAssetStore.kt` | Per-game manifest download, validation, staging, atomic activation, status flow |
| `data/scanner/model/ArcFaceModelContract.kt` | Runtime model/vector/metadata contract for bundled and downloaded sources |
| `data/scanner/model/ArcFaceOnnxEncoder.kt` | ONNX execution against a runtime contract |
| `data/scanner/model/ArcFaceCardRecognizer.kt` | Runtime-specific recognizer and artifact-version identity |
| `data/scanner/model/PackedCardEmbeddingIndex.kt` | Packed cosine search, game scoping, physical/Pocket filtering |
| `data/repository/DefaultTCGerRepository.kt` | Selects/caches downloaded per-game recognizers with Pokémon fallback |
| `TCGerApplication.kt` | Scanner asset-store dependency construction |
| `ui/AppViewModel.kt` | Exposes install states and actions |
| `ui/screens/SettingsScreen.kt` | Offline scanner install/update/remove/progress UI |
| `tools/r2/publish-android-scan-pack.mjs` | ONNX/evaluation/vector/metadata validation and R2 publication |

Delivered Android behavior:

- installable runtimes for all three trained games;
- downloaded model selection in explicit scan mode;
- recognizer cache invalidation on version change;
- failed-update retention of the installed runtime;
- strict hash, count, dimension, game, and threshold validation;
- physical-only Pokémon candidate filtering.

## Catalog and offline-pack implementation

| File/area | Responsibility |
|---|---|
| `backend/src/scripts/build-catalog-packs.ts` | Builds compact per-game card catalogs |
| `backend/src/scripts/build-sealed-catalog-packs.ts` | Builds optional sealed-product packs |
| `tools/r2/publish-catalogs.mjs` | Content-addressed catalog publication |
| `frontend/src/lib/catalog/` | Browser catalog parsing, IndexedDB persistence, search, and install state |
| `mobile-apps/ios/TCGer/TCGer/Services/CatalogStore.swift` | iOS catalog source, cache, install state, lazy loading, and search |
| `frontend/src/lib/packs/offline-packs.ts` | Current browser per-set offline cache implementation |
| `mobile-apps/android/.../PackOfflineDownloadManager.kt` | Android offline pack download management |
| `tools/r2/publish-pack-assets.mjs` | Content-addressed wrapper/mesh/cover publication |

Catalogs currently cover Pokémon, Magic, Yu-Gi-Oh, One Piece, and Lorcana in
the live R2 manifest; code also models Dragon Ball when its authenticated source
is available. Scanner models currently exist only for the first three.

## Cloud and publication implementation

`cloudflare/README.md` defines the R2 custom-domain layout and publication
credentials. No Worker is required for asset delivery; Cloudflare cache serves
R2 objects directly.

Root package scripts:

```text
catalogs:build
catalogs:build-sealed
catalogs:download
assets:r2:publish-catalogs
assets:r2:publish-pack-assets
assets:r2:publish-scan-index
assets:r2:publish-ios-scan-pack
assets:r2:publish-android-scan-pack
```

## Major project milestones

| Revision/date | Milestone |
|---|---|
| `3bdbb34a`, 2026-08-24 | Added free Hugging Face catalog preflight |
| `146eb3d2`, 2026-08-24 | Documented staged Hugging Face training |
| `31bd77cd` / `89d43681` / `51d2ef98`, 2026-08-24 | Updated Scryfall bulk compatibility across branches/history |
| `17093431`, 2026-08-24 | Established SWSH204 losses as crop/detection failures rather than missing index rows |
| `f76e37eb`, 2026-08-24 | Recorded that all 19 labeled device losses in that session were detection failures |
| `218cd80a`, 2026-08-26 | Merged universal scanner shard runtime work |
| `9ada8d2e`, 2026-08-26 | Recovered paired Pokémon evaluator |
| `16da75ec`, 2026-08-26 | Corrected production ONNX preprocessing contract |
| `e2c2860b`, 2026-08-26 | Recorded corrected quick paired A/B result |
| `daa79109`, 2026-08-26 | Added mobile parity/scanner updates |
| `4eab206c`, 2026-08-26 | Isolated per-game ArcFace training paths |
| `4354ff02`, 2026-08-26 | Added matched-step experiment controls |
| 2026-08-27 | Completed isolated full Pokémon, Magic, and Yu-Gi-Oh jobs |
| 2026-08-27 | Exported and parity-checked all Android fp32 ONNX models |
| 2026-08-27 | Published all three games to browser, iOS, and Android R2 manifests |
| 2026-08-27 | Added browser gzip transfer/IndexedDB behavior and heterogeneous-model scanning |
| 2026-08-27 | Added mobile runtime stores and settings installation flows |
| 2026-08-27 | Implemented source-release planner, durable image library, and trainer hardening |
| 2026-08-27 | Audited and confirmed Pokémon TCG Pocket contamination |
| 2026-08-27 | Designed unified game-package capability framework |

## Tests and verification map

| Area | Verification |
|---|---|
| Image library | Network-free sync/audit/incremental tests and Python compilation |
| Trainer hardening | Six ingestion/fingerprint/quarantine/library tests |
| Browser | TypeScript validation, 134 tests, live asset diagnostics |
| iOS | Simulator build and scanner index/format tests |
| Android | `testDebugUnitTest`, runtime/index/store tests |
| Export | ONNX CPU parity JSON per game |
| Publication | Publisher dry-run validation and live manifest/hash checks |

## Generated artifacts and Git policy

Large catalogs, image caches, durable release shards, downloaded Hub snapshots,
Core ML export zips, ONNX files, and vector indexes belong under `.artifacts` or
other ignored build paths unless a specific bundled-fallback decision says
otherwise. Do not commit private training images or tokens.

Local changes in a dirty working tree belong to their original author. Review
and commit scanner/documentation changes separately from unrelated edits; do
not reset or overwrite them to obtain a clean tree.
