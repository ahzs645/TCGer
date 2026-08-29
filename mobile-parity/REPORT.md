# Cross-platform feature parity

Generated from [features.json](features.json). Do not edit this report by hand.

- Platforms: Web, iOS, Android.
- 7 features are parity-required.
- 77 features are explicitly tracked.
- A declaration is backed by source paths in the manifest. “Verified” additionally requires passing current JUnit evidence on every declared platform; a declared test that was not supplied is “Not run.”

## Declaration summary

| Platform | Implemented | Partial | Planned | Unavailable | Not applicable | Waived |
|---|---|---|---|---|---|---|
| Web | 56 | 10 | 18 | 0 | 0 | 0 |
| iOS | 84 | 0 | 0 | 0 | 0 | 0 |
| Android | 69 | 6 | 9 | 0 | 0 | 0 |

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
| packOpening.offline.downloads | Download, retry, remove, and open supported packs offline | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
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
| scanner.engine.serverEmbedding | Selectable server embedding recognition engine | track | Planned | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.model.arcface | ArcFace model, matching index, thresholds, and rejection policy | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.model.dinov2 | DINOv2 model, matching index, thresholds, and rejection policy | track | Partial | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.options.language | Assumed card-language scanner default | track | Implemented | Not run | Implemented | — | Partial | — | Tracked gap |
| scanner.options.torch | Scanner flashlight control | track | Planned | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.results.autoOpen | Automatically open each recognition result | track | Planned | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.results.priceMode | Per-card market prices and running scan-session total | track | Planned | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.results.sessionTray | Persistent multi-card scan-session tray | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.results.sessionReview | Select, remove, clear, and bulk-add scan-session results | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
| scanner.results.addToBinder | Add a recognized card directly to a binder | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.results.cropCorrection | Adjust card corners and retry recognition | track | Planned | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.sharedWebSession | Sync scanner results into a shared web session | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| scanner.binder.savePagePhotos | Save binder-page photos and replace them on retake | track | Planned | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.debug.serverCapture | Persist server-side scan images, crops, timings, and metadata | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.debug.developerAccess | Hidden developer-tools unlock and scanner-testing toggle | track | Planned | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.debug.testingInputs | Deterministic demo card and binder-page scanner inputs | track | Partial | — | Implemented | — | Implemented | Not run | Tracked gap |
| scanner.debug.captureBrowser | Browse, inspect, refresh, and label recent server debug captures | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.debug.livePipeline | Live scanner debug camera, quad overlay, timing, and log | track | Partial | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.debug.liveConfiguration | Debug game, embedding-only, and analysis-interval options | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
| scanner.debug.recording | Record, pause, clear, save, and share live analyzed frames | track | Planned | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.debug.devModeRecording | Record production scans and decision evidence as training data | track | Implemented | — | Implemented | — | Partial | — | Tracked gap |
| scanner.debug.attemptImages | Optionally persist every crop-attempt image | track | Partial | — | Implemented | — | Partial | — | Tracked gap |
| scanner.debug.sessionManagement | Browse, select, share, delete, and export recorded sessions | track | Partial | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.debug.replay | Import and replay extracted scanner recordings | track | Partial | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.debug.referenceSets | Browse labeled reference sets and compare expected results | track | Implemented | Not run | Implemented | — | Partial | — | Tracked gap |
| scanner.debug.assetDiagnostics | Validate scanner models, indexes, hashes, and reference assets | track | Implemented | Not run | Implemented | — | Implemented | — | Aligned |
| scanner.debug.decisionDiagnostics | Capture per-attempt thresholds, geometry, OCR, gate, and timing evidence | track | Implemented | — | Implemented | — | Partial | — | Tracked gap |
| scanner.debug.feedbackLabels | Correct/wrong/review statuses and structured failure tags | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.debug.performance.vectorizedAnn | Fast vectorized ANN index-search toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.scopeCache | Allowed-index search-scope cache toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.stagedHypotheses | Staged crop-retry hypotheses toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.batchedOrientation | Batched orientation-check toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.concurrentOrientation | Parallel orientation-check toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.warmStart | Scanner-model warm-start toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.fastCapture | Fast shutter-capture toggle | track | Planned | — | Implemented | — | Implemented | — | Tracked gap |
| scanner.debug.performance.fastFooterOcr | Fast-first footer OCR toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.leanOcrStrips | Lean OCR-strip processing toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
| scanner.debug.performance.footerFirstOcr | Footer-first OCR ordering toggle | track | Planned | — | Implemented | — | Planned | — | Tracked gap |
