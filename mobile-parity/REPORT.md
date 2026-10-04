# Cross-platform feature parity

Generated from [product definitions](features.definitions.json) and platform source registrations into [features.json](features.json). Do not edit generated files by hand. API boundary compatibility is tracked separately in the [API contract workflow](api-contracts/README.md); API passes do not substitute for UI verification.

- Platforms: Web, iOS, Android.
- 7 features are parity-required.
- 107 features are explicitly tracked.
- A declaration is backed by source paths in the manifest. “Verified” additionally requires passing current JUnit evidence on every declared platform; a declared test that was not supplied is “Not run.”

## Declaration summary

| Platform | Implemented | Partial | Planned | Unavailable | Not applicable | Waived |
|---|---|---|---|---|---|---|
| Web | 90 | 12 | 10 | 0 | 2 | 0 |
| iOS | 108 | 5 | 1 | 0 | 0 | 0 |
| Android | 93 | 10 | 10 | 0 | 1 | 0 |

## Feature matrix

| ID | Feature | Policy | Web declaration | Web evidence | iOS declaration | iOS evidence | Android declaration | Android evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| home.dashboard | Dashboard | parity | Implemented | Not run | Implemented | Not run | Implemented | Not run | Declared |
| collections.browse | Browse binders | parity | Implemented | Not run | Implemented | Not run | Implemented | Not run | Declared |
| collections.create | Create a binder | parity | Implemented | Not run | Implemented | Not run | Implemented | Not run | Declared |
| cards.search | Search cards | parity | Implemented | Not run | Implemented | Not run | Implemented | Not run | Declared |
| wishlists.browse | Browse wishlists | parity | Implemented | Not run | Implemented | Not run | Implemented | Not run | Declared |
| wishlists.create | Create a wishlist | parity | Implemented | Not run | Implemented | Not run | Implemented | Not run | Declared |
| settings.browse | Settings | parity | Implemented | Not run | Implemented | Not run | Implemented | Not run | Declared |
| sets.browse | Browse card sets | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| pokedex.browse | Pokédex progress | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| decks.browse | Decks | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| guides.browse | Collection guides | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| sealed.inventory | Sealed inventory | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| packOpening.browse | Open the pack-opening experience | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.selectSet | Search and filter pack sets by download availability | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
| packOpening.selectVariant | Choose a pack-art variant within a set | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.possibleCards | Browse, search, and rarity-filter possible pulls | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
| packOpening.oddsReference | Source-backed pull-odds reference metadata | track | Implemented | — | Implemented | Not run | Implemented | — | Aligned |
| packOpening.count | Choose 1, 5, or 10 packs | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.mode.normal | Normal animated pack-opening mode | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.mode.quick | Quick-open mode that skips animations | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.orientation | Front-facing or backwards pack orientation | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.customArtwork | Upload custom pack artwork | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.animation.tear | Interactive tear and opening animation | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.reveal | Card-by-card reveal, flip, slide, and show-all controls | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.results.grouped | Grouped multi-pack results and best-pull summary | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.results.inspect | Inspect, flip, zoom, share, favorite, and wishlist a pull | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.save.collection | Save every revealed pull to a collection | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.save.sealedLedger | Link an opening to sealed inventory and decrement stock | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| packOpening.offline.downloads | Download, retry, remove, and open supported packs offline | track | Implemented | Not run | Implemented | Not run | Implemented | — | Aligned |
| codes.vault | Online code vault | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| prices.browse | Prices | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| analytics.browse | Collection analytics | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| trades.browse | Trades | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| activity.browse | Activity and notifications | track | Implemented | Not run | Implemented | — | Implemented | Not run | Aligned |
| scanner.identify | Camera card scanner | track | Partial | — | Implemented | — | Partial | — | Tracked gap |
| scanner.capture.manual | Manually capture one card from the live camera | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.capture.photo | Identify a card from an imported photo | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.capture.bulkPhoto | Bulk-import and identify multiple photos | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.capture.automatic | Automatic live capture with multi-frame consensus | track | Partial | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.capture.binderPage | Detect and identify multiple cards on binder pages | track | Partial | — | Implemented | — | Implemented | Not run | Tracked gap |
| scanner.mode.pokemon | Pokémon card scanning mode | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.mode.yugioh | Yu-Gi-Oh! card scanning mode | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.mode.mtg | Magic: The Gathering card scanning mode | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.engine.automatic | Selectable automatic recognition engine with fallback | track | Partial | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.engine.localOnly | Selectable fully on-device recognition engine | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.engine.serverHash | Selectable server perceptual-hash recognition engine | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.engine.serverEmbedding | Selectable server embedding recognition engine | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.model.arcface | ArcFace model, matching index, thresholds, and rejection policy | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.model.dinov2 | DINOv2 model, matching index, thresholds, and rejection policy | track | Partial | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.options.language | Assumed card-language scanner default | track | Implemented | Not run | Implemented | — | Partial | — | Tracked gap |
| scanner.options.torch | Scanner flashlight control | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.results.autoOpen | Automatically open each recognition result | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.results.priceMode | Per-card market prices and running scan-session total | track | Planned | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.results.sessionTray | Persistent multi-card scan-session tray | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.results.sessionReview | Select, remove, clear, and bulk-add scan-session results | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
| scanner.results.addToBinder | Add a recognized card directly to a binder | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.results.cropCorrection | Adjust card corners and retry recognition | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.sharedWebSession | Sync scanner results into a shared web session | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| scanner.binder.savePagePhotos | Save binder-page photos and replace them on retake | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.debug.serverCapture | Persist server-side scan images, crops, timings, and metadata | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.debug.developerAccess | Hidden developer-tools unlock and scanner-testing toggle | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.debug.testingInputs | Deterministic demo card and binder-page scanner inputs | track | Partial | — | Implemented | — | Implemented | Not run | Tracked gap |
| scanner.debug.captureBrowser | Browse, inspect, refresh, and label recent server debug captures | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.debug.livePipeline | Live scanner debug camera, quad overlay, timing, and log | track | Partial | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.debug.liveConfiguration | Debug game, embedding-only, and analysis-interval options | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
| scanner.debug.recording | Record, pause, clear, save, and share live analyzed frames | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.debug.devModeRecording | Record production scans and decision evidence as training data | track | Implemented | — | Implemented | — | Partial | — | Tracked gap |
| scanner.debug.attemptImages | Optionally persist every crop-attempt image | track | Partial | — | Implemented | — | Partial | — | Tracked gap |
| scanner.debug.sessionManagement | Browse, select, share, delete, and export recorded sessions | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.debug.replay | Import and replay extracted scanner recordings | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.debug.referenceSets | Browse labeled reference sets and compare expected results | track | Implemented | Not run | Implemented | — | Partial | — | Tracked gap |
| scanner.debug.assetDiagnostics | Validate scanner models, indexes, hashes, and reference assets | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
| scanner.debug.decisionDiagnostics | Capture per-attempt thresholds, geometry, OCR, gate, and timing evidence | track | Implemented | — | Implemented | — | Partial | — | Tracked gap |
| scanner.debug.feedbackLabels | Correct/wrong/review statuses and structured failure tags | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.debug.performance.vectorizedAnn | Fast vectorized ANN index-search toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.scopeCache | Allowed-index search-scope cache toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.stagedHypotheses | Staged crop-retry hypotheses toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.batchedOrientation | Batched orientation-check toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.concurrentOrientation | Parallel orientation-check toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.warmStart | Scanner-model warm-start toggle | track | Implemented | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.fastCapture | Fast shutter-capture toggle | track | Planned | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.debug.performance.fastFooterOcr | Fast-first footer OCR toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.leanOcrStrips | Lean OCR-strip processing toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.footerFirstOcr | Footer-first OCR ordering toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| data.portableBackup | Portable backup fidelity and recovery | track | Implemented | Not run | Implemented | Not run | Implemented | Not run | Aligned |
| cards.filteredSearch | Filter cards beyond preview limits | track | Implemented | Not run | Implemented | Not run | Implemented | — | Aligned |
| scanner.binderCorners | Correct and persist binder page crops | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
| collections.copyMetadata | Edit and retain physical-copy metadata | track | Implemented | Not run | Implemented | Not run | Implemented | Not run | Aligned |
| collections.smartFolders | Condition and tag smart folders | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| account.management | Profile password signup deletion and preferences | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.binderReview | Save selected cards and reopen saved binder photos | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
| pricing.gradingWorkspace | Grading planner: prices, costs, decision, population, history and receipts | track | Implemented | Not run | Implemented | Not run | Implemented | Not run | Aligned |
| collections.manage | Rename and delete binders | track | Implemented | — | Implemented | Not run | Implemented | — | Aligned |
| server.capabilities | Server capability flags | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| widgets.sessionPrivacy | Clear home screen widget snapshots when sessions change | track | Not applicable | — | Implemented | — | Not applicable | — | Tracked gap |
| storage.containers | Create and edit physical containers and compartments | track | Implemented | — | Implemented | Not run | Implemented | — | Aligned |
| storage.placements | Assign and remove owned copies at physical storage slots | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| decks.checkout | Reserve owned deck copies and display a pull list | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| decks.refile | Check in a deck and retain its location snapshot as a refile guide | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| intake.rapidEntry | Add copies by set and collector number with intake receipts | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
| intake.acquisitionCosts | Allocate purchase costs to physical copies in exact cents | track | Implemented | Not run | Implemented | — | Implemented | Not run | Aligned |
| intake.psaCertification | Look up PSA certifications and confirm the acquired printing | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| pricing.provenance | Read tracked quote source, coverage and provenance | track | Partial | — | Implemented | Not run | Implemented | Not run | Tracked gap |
| storage.audit | Preview and save read-only physical-location audits | track | Implemented | — | Planned | — | Planned | — | Tracked gap |
| collections.historyUndo | Browse collection mutation history and undo eligible changes | track | Partial | — | Partial | — | Partial | — | Aligned |
| games.catalogDownloads | Download and verify publisher game catalogs for offline browsing | track | Implemented | Not run | Implemented | Not run | Implemented | Not run | Aligned |
| games.packageUpdates | Check and install monotonic publisher game-package updates | track | Implemented | — | Implemented | Not run | Implemented | Not run | Aligned |
| games.capability.scannerDownload | Download the game package scanner runtime separately from its catalog | track | Implemented | — | Partial | Not run | Implemented | — | Tracked gap |
| games.capability.priceDownload | Download verified game price snapshots separately from the catalog | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| games.capability.packDownload | Download verified game pack libraries separately from the catalog | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| navigation.appLinks | Open scanner, search, binder and wishlist app links | track | Partial | Not run | Partial | Not run | Partial | Not run | Aligned |
| security.biometricLock | Lock the native app with device authentication | track | Not applicable | — | Partial | Not run | Partial | Not run | Tracked gap |
| release.readiness | Verify production release configuration and signed distribution | track | Partial | Not run | Partial | Not run | Partial | Not run | Aligned |
| collections.copies | Add, edit and move physical copies; remove printing groups | track | Implemented | Not run | Implemented | Not run | Implemented | Not run | Aligned |

## Availability and limitations

These declarations live beside platform implementations. Unspecified modes are unknown, not a promise of support in every mode. Requirements describe prerequisites; this metadata does not replace runtime server, package, or hardware checks.

| ID | Platform | Support | Modes | Requirements | Limitation or fallback | Registration |
|---|---|---|---|---|---|---|
| decks.browse | Web | Implemented | demo, server | — | — | [Source](../frontend/app/decks/page.tsx#L1) |
| decks.browse | iOS | Implemented | server | — | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/DecksView.swift#L1) |
| decks.browse | Android | Implemented | server | — | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/features/social/DeckScreens.kt#L1) |
| trades.browse | Web | Implemented | demo, server | — | — | [Source](../frontend/app/trades/page.tsx#L1) |
| trades.browse | iOS | Implemented | server | — | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/TradesView.swift#L1) |
| trades.browse | Android | Implemented | server | — | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/features/social/TradeScreens.kt#L1) |
| activity.browse | Web | Implemented | demo, server | — | — | [Source](../frontend/src/components/dashboard/dashboard-content.tsx#L1) |
| activity.browse | iOS | Implemented | server | — | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/ActivityView.swift#L1) |
| activity.browse | Android | Implemented | server | — | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/features/social/ActivityScreen.kt#L1) |
| scanner.identify | Web | Partial | Not specified | — | Recognition engines and developer scenarios do not yet have equivalent coverage across all runtimes. | [Source](../frontend/app/scan/page.tsx#L1) |
| scanner.identify | Android | Partial | Not specified | — | Language-aware recognition and granular internal developer diagnostics remain incomplete. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/ScannerScreen.kt#L1) |
| scanner.capture.automatic | Web | Partial | Not specified | — | Consensus capture exists; equivalent camera recognition and acceptance evidence remain incomplete. | [Source](../frontend/src/components/scan/video-scan-lab.tsx#L1) |
| scanner.capture.binderPage | Web | Partial | Not specified | — | Grid and detection workbench exists; equivalent automatic page-recognition coverage remains incomplete. | [Source](../frontend/src/components/scan/use-video-scan-processor.ts#L1) |
| scanner.engine.automatic | Web | Partial | Not specified | — | Automatic cross-engine and cross-game selection is not equivalent across runtimes. | [Source](../frontend/app/scan/page.tsx#L2) |
| scanner.engine.serverHash | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/scan/card-scan-panel.tsx#L6) |
| scanner.engine.serverHash | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/CardScanner/BackendHashScannerStrategy.swift#L1) |
| scanner.engine.serverHash | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L3) |
| scanner.engine.serverEmbedding | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L1) |
| scanner.engine.serverEmbedding | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/CardScanner/BackendHashScannerStrategy.swift#L2) |
| scanner.engine.serverEmbedding | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L4) |
| scanner.model.dinov2 | Web | Partial | Not specified | — | DINOv2 browser paths exist, but production model, gate, and acceptance parity remain incomplete. | [Source](../frontend/src/lib/scan/embedding-matcher.ts#L2) |
| scanner.options.language | Android | Partial | Not specified | — | Language selection is tracked; recognition does not yet implement equivalent language-aware behavior. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L5) |
| scanner.options.torch | Web | Implemented | Not specified | camera-torch | — | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L2) |
| scanner.options.torch | iOS | Implemented | Not specified | camera-torch | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/ScannerSessionControls.swift#L2) |
| scanner.options.torch | Android | Implemented | Not specified | camera-torch | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/ScannerScreen.kt#L8) |
| scanner.results.priceMode | Web | Planned | Not specified | — | Session quotes and currency totals exist; the native price-mode control semantics are not yet equivalent. | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L4) |
| scanner.sharedWebSession | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/scan/shared-scan-session.tsx#L5) |
| scanner.sharedWebSession | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/ScannerSessionControls.swift#L5) |
| scanner.sharedWebSession | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerSharedSessionClient.kt#L1) |
| scanner.debug.serverCapture | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/scan/card-scan-panel.tsx#L8) |
| scanner.debug.serverCapture | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/CardScannerView.swift#L6) |
| scanner.debug.serverCapture | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/ScannerControls.kt#L1) |
| scanner.debug.testingInputs | Web | Partial | Not specified | — | Demo card/video fixtures exist; equivalent runnable binder-page source fixtures remain incomplete. | [Source](../frontend/src/components/scan/scan-review-lab.tsx#L1) |
| scanner.debug.captureBrowser | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/scan/card-scan-panel.tsx#L9) |
| scanner.debug.captureBrowser | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/CardScannerDebugCaptureBrowser.swift#L1) |
| scanner.debug.captureBrowser | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/ServerDebugCapturesScreen.kt#L1) |
| scanner.debug.livePipeline | Web | Partial | Not specified | — | Imported-video diagnostics exist; developer live-camera capture remains incomplete. | [Source](../frontend/src/components/scan/video-scan-lab.tsx#L3) |
| scanner.debug.devModeRecording | Android | Partial | Not specified | — | Production inputs and results are retained; internal per-model-stage hypotheses are not exposed. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerDebugRecorder.kt#L2) |
| scanner.debug.attemptImages | Web | Partial | Not specified | — | Source and derived artifacts are retained; every internal recognition-attempt crop is not exposed. | [Source](../frontend/src/components/scan/card-scan-panel.tsx#L11) |
| scanner.debug.attemptImages | Android | Partial | Not specified | — | Source and canonical guide crop are retained; every internal recognition-attempt crop is not exposed. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerAttemptImages.kt#L1) |
| scanner.debug.referenceSets | Android | Partial | Not specified | — | The production-handler runner exists; its native reference-set browser is not wired. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerReferenceSetRunner.kt#L1) |
| scanner.debug.decisionDiagnostics | Android | Partial | Not specified | — | Boundary engine, OCR, candidates, and timing are available; internal gate, quad, and ANN stages are not exposed. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerBoundaryDiagnostics.kt#L1) |
| scanner.debug.feedbackLabels | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/scan/card-scan-panel.tsx#L14) |
| scanner.debug.feedbackLabels | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/CardScanner/CardScannerModels.swift#L6) |
| scanner.debug.feedbackLabels | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/domain/Models.kt#L1) |
| scanner.debug.performance.vectorizedAnn | Web | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L9) |
| scanner.debug.performance.vectorizedAnn | Android | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L7) |
| scanner.debug.performance.scopeCache | Web | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L10) |
| scanner.debug.performance.scopeCache | Android | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L8) |
| scanner.debug.performance.stagedHypotheses | Web | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L11) |
| scanner.debug.performance.stagedHypotheses | Android | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L9) |
| scanner.debug.performance.batchedOrientation | Web | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L12) |
| scanner.debug.performance.batchedOrientation | Android | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L10) |
| scanner.debug.performance.concurrentOrientation | Web | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L13) |
| scanner.debug.performance.concurrentOrientation | Android | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L11) |
| scanner.debug.performance.warmStart | Android | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L12) |
| scanner.debug.performance.fastCapture | Web | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L15) |
| scanner.debug.performance.fastFooterOcr | Web | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L16) |
| scanner.debug.performance.fastFooterOcr | Android | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L14) |
| scanner.debug.performance.leanOcrStrips | Web | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L17) |
| scanner.debug.performance.leanOcrStrips | Android | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L15) |
| scanner.debug.performance.footerFirstOcr | Web | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../frontend/src/components/scan/scanner-workbench.tsx#L18) |
| scanner.debug.performance.footerFirstOcr | Android | Planned | Not specified | — | No equivalent operational A/B control exists in this runtime; platform optimizations are not claimed as control parity. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/ScannerOptions.kt#L16) |
| server.capabilities | Web | Implemented | server | — | — | [Source](../frontend/src/lib/api/health.ts#L1) |
| server.capabilities | iOS | Implemented | server | — | — | [Source](../mobile-apps/ios/TCGer/TCGer/Services/EnvironmentStore.swift#L2) |
| server.capabilities | Android | Implemented | server | — | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/remote/ApiModels.kt#L1) |
| widgets.sessionPrivacy | Web | Not applicable | Not specified | — | No home screen widget extension is shipped on this surface. | [Source](../frontend/src/components/account/account-settings-dialog.tsx#L2) |
| widgets.sessionPrivacy | Android | Not applicable | Not specified | — | No home screen widget extension is shipped on this surface. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/MainActivity.kt#L2) |
| storage.containers | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/collections/storage-editor.tsx#L1) |
| storage.containers | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/LibraryOperationsView.swift#L1) |
| storage.containers | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/libraryoperations/LibraryOperationsScreens.kt#L1) |
| storage.placements | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/collections/storage-editor.tsx#L2) |
| storage.placements | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/LibraryOperationsView.swift#L2) |
| storage.placements | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/libraryoperations/LibraryOperationsScreens.kt#L2) |
| decks.checkout | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/decks/deck-checkout-panel.tsx#L1) |
| decks.checkout | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/DeckCheckoutView.swift#L1) |
| decks.checkout | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/libraryoperations/LibraryOperationsScreens.kt#L3) |
| decks.refile | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/decks/deck-checkout-panel.tsx#L2) |
| decks.refile | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/DeckCheckoutView.swift#L2) |
| decks.refile | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/libraryoperations/LibraryOperationsScreens.kt#L4) |
| intake.rapidEntry | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/collections/intake-tools.tsx#L1) |
| intake.rapidEntry | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/LibraryOperationsView.swift#L3) |
| intake.rapidEntry | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/libraryoperations/LibraryOperationsScreens.kt#L5) |
| intake.acquisitionCosts | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/collections/intake-tools.tsx#L2) |
| intake.acquisitionCosts | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/LibraryOperationsView.swift#L4) |
| intake.acquisitionCosts | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/libraryoperations/LibraryOperationsScreens.kt#L6) |
| intake.psaCertification | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/collections/intake-tools.tsx#L3) |
| intake.psaCertification | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/LibraryOperationsView.swift#L5) |
| intake.psaCertification | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/libraryoperations/LibraryOperationsScreens.kt#L7) |
| pricing.provenance | Web | Partial | server, local | — | Tracked quote APIs retain source/provenance and package snapshots; a dedicated native-style original-quote, FX and match-confidence inspection view is absent. | [Source](../frontend/src/lib/api/pricing.ts#L1) |
| pricing.provenance | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Views/LibraryOperationsView.swift#L6) |
| pricing.provenance | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/libraryoperations/LibraryOperationsScreens.kt#L8) |
| storage.audit | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/components/collections/storage-audit-dialog.tsx#L1) |
| storage.audit | iOS | Planned | Not specified | — | Storage placement editing exists; location audit observation, preview and commit UI/API calls are absent. | [Source](../mobile-apps/ios/TCGer/TCGer/Views/LibraryOperationsView.swift#L7) |
| storage.audit | Android | Planned | Not specified | — | Storage placement editing exists; location audit observation, preview and commit UI/API calls are absent. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/libraryoperations/LibraryOperationsScreens.kt#L9) |
| collections.historyUndo | Web | Partial | server, demo | — | Server mutation history and eligible undo are available; the offline demo retains 25 recent changes and only the latest may be undone. | [Source](../frontend/src/components/collections/collection-history-dialog.tsx#L1) |
| collections.historyUndo | iOS | Partial | server | authenticated-server | Rapid-entry receipts can be undone; a general collection mutation history browser and undo control are absent. | [Source](../mobile-apps/ios/TCGer/TCGer/Views/LibraryOperationsView.swift#L8) |
| collections.historyUndo | Android | Partial | server | authenticated-server | Rapid-entry receipts can be undone; a general collection mutation history browser and undo control are absent. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/libraryoperations/LibraryOperationsScreens.kt#L10) |
| games.catalogDownloads | Web | Implemented | local | network-for-download, publisher-game-package | — | [Source](../frontend/src/lib/game-packages/game-package-client.ts#L1) |
| games.catalogDownloads | iOS | Implemented | local | network-for-download, publisher-game-package | — | [Source](../mobile-apps/ios/TCGer/TCGer/Services/GamePackageStore.swift#L1) |
| games.catalogDownloads | Android | Implemented | local | network-for-download, publisher-game-package | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/gamepackage/GamePackageStore.kt#L1) |
| games.packageUpdates | Web | Implemented | local | network-for-download, publisher-game-package | — | [Source](../frontend/src/lib/game-packages/game-package-client.ts#L2) |
| games.packageUpdates | iOS | Implemented | local | network-for-download, publisher-game-package | — | [Source](../mobile-apps/ios/TCGer/TCGer/Services/GamePackageStore.swift#L2) |
| games.packageUpdates | Android | Implemented | local | network-for-download, publisher-game-package | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/gamepackage/GamePackageStore.kt#L2) |
| games.capability.scannerDownload | Web | Implemented | local | network-for-download, package-web-scanner-bundle | — | [Source](../frontend/src/lib/game-packages/game-package-client.ts#L3) |
| games.capability.scannerDownload | iOS | Partial | local | network-for-download, package-ios-scanner-bundle | Package scanner bundles install by stable game ID with integrity checks; recognition selectors still use built-in games, so arbitrary-game recognition remains unsupported. | [Source](../mobile-apps/ios/TCGer/TCGer/Services/GamePackageStore.swift#L3) |
| games.capability.scannerDownload | Android | Implemented | local | network-for-download, package-android-scanner-bundle | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/AppViewModel.kt#L1) |
| games.capability.priceDownload | Web | Implemented | local | network-for-download, publisher-game-package | — | [Source](../frontend/src/lib/game-packages/game-package-client.ts#L4) |
| games.capability.priceDownload | iOS | Implemented | local | network-for-download, publisher-game-package | — | [Source](../mobile-apps/ios/TCGer/TCGer/Services/GamePackageStore.swift#L4) |
| games.capability.priceDownload | Android | Implemented | local | network-for-download, publisher-game-package | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/gamepackage/GamePackageStore.kt#L3) |
| games.capability.packDownload | Web | Implemented | local | network-for-download, publisher-game-package | — | [Source](../frontend/src/lib/game-packages/game-package-client.ts#L5) |
| games.capability.packDownload | iOS | Implemented | local | network-for-download, publisher-game-package | — | [Source](../mobile-apps/ios/TCGer/TCGer/Services/GamePackageStore.swift#L5) |
| games.capability.packDownload | Android | Implemented | local | network-for-download, publisher-game-package | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/gamepackage/GamePackageStore.kt#L4) |
| navigation.appLinks | Web | Partial | Not specified | — | Canonical native search/binder/wishlist URLs redirect to web screens and preserve selection; static demo aliases, hosted associations and signed-device cold starts remain unverified. | [Source](../frontend/app/layout.tsx#L1) |
| navigation.appLinks | iOS | Partial | Not specified | — | Custom-scheme and associated-domain routing exists, including pending binder/wishlist resolution; deployed association files and release-device cold starts are not verified. | [Source](../mobile-apps/ios/TCGer/TCGer/ContentView.swift#L1) |
| navigation.appLinks | Android | Partial | Not specified | — | Custom and HTTPS routes share tested destinations and reject untrusted inputs; configured hosted associations and signed-device cold starts remain unverified. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/AppLink.kt#L1) |
| security.biometricLock | Web | Not applicable | Not specified | — | No native app lock or device-authentication overlay is shipped for the browser; web account authentication is separate. | [Source](../frontend/src/components/account/account-settings-dialog.tsx#L1) |
| security.biometricLock | iOS | Partial | Not specified | device-screen-lock | Device-owner authentication supports biometrics and system passcode fallback and fails closed; physical-device enrollment, lockout and release lifecycle checks remain outstanding. | [Source](../mobile-apps/ios/TCGer/TCGer/Utils/BiometricAuthManager.swift#L1) |
| security.biometricLock | Android | Partial | Not specified | device-authentication | Biometric or device-credential lock exists; unavailable authenticators remain locked with device-security setup access; physical-device enrollment, lockout and release lifecycle verification remain outstanding. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/MainActivity.kt#L1) |
| release.readiness | Web | Partial | Not specified | — | Production build and hosted smoke tooling are configured; production deployment, signed app associations and physical PWA install/update checks remain unverified. | [Source](../frontend/src/components/pwa/service-worker-register.tsx#L1) |
| release.readiness | iOS | Partial | Not specified | — | Release archive/export settings and artifact/physical-device readiness tooling are configured; no distribution signing identity, exported IPA or physical-device evidence is verified here. | [Source](../mobile-apps/ios/TCGer/TCGer/SettingsView.swift#L1) |
| release.readiness | Android | Partial | Not specified | — | Direct-install release APK signing and certificate verification are configured; physical-device smoke and deployed domain association are outstanding. Play Store publishing is out of scope. | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/TCGerApp.kt#L1) |
| collections.copies | Web | Implemented | server | authenticated-server | — | [Source](../frontend/src/lib/api/collections.ts#L1) |
| collections.copies | iOS | Implemented | server | authenticated-server | — | [Source](../mobile-apps/ios/TCGer/TCGer/Services/APIService+Collections.swift#L1) |
| collections.copies | Android | Implemented | server | authenticated-server | — | [Source](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/remote/TCGerApi.kt#L1) |
