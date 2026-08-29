# Web, iOS, and Android scanner and pack-opening parity matrix

This matrix defines what “same behavior and options” means across the web,
iOS, and Android apps. The machine-readable status lives in
[`features.json`](features.json).
The umbrella records (`scanner.identify` and `sealed.inventory`) are navigation
and product-area trackers; they are not evidence that every child capability
matches.

Status meanings for this audit:

- **Implemented**: the named behavior exists as a user-selectable or observable
  capability on that platform.
- **Partial**: some underlying behavior exists, but the named choice or complete
  workflow does not. For example, Android can automatically fall back from a
  server scan to local OCR, but does not yet expose iOS's per-session engine
  picker.
- **Planned**: no equivalent implementation was found.
- **Parity** is reserved for capabilities that are implemented on every required
  platform and have deterministic behavioral verification. Matching
  declarations without a cross-platform test remain `track`, even when every
  status says implemented.

## Pack opening

| Contract ID | Required behavior | Web audit status | Android audit status |
|---|---|---|---|
| `packOpening.browse` | Full-screen pack-opening entry point and phase state machine | Implemented through `pack-core` | Implemented |
| `packOpening.selectSet` | Set search plus All/Downloaded/Not Downloaded filtering | Implemented with set/wrapper search, availability filters, offline gating, and empty/reset states | Implemented |
| `packOpening.selectVariant` | Artwork/variation choice within a set | Implemented | Implemented |
| `packOpening.possibleCards` | Searchable possible-pull pool with rarity filter | Implemented with combined name/number search, exact rarity filtering, sorting, and clear state | Implemented |
| `packOpening.oddsReference` | Source title, URL, sample size, and explanatory note | Implemented by the shared scene | Implemented, including the source dialog/link |
| `packOpening.count` | Exact choices: 1, 5, or 10 packs | Implemented | Implemented |
| `packOpening.mode.normal` | Animated tear/open/reveal sequence for a single pack | Implemented | Implemented |
| `packOpening.mode.quick` | Skip animation and go directly to results | Implemented | Implemented |
| `packOpening.orientation` | Front-facing/backwards pack and matching flip/slide reveal semantics | Implemented | Implemented |
| `packOpening.customArtwork` | Choose a photo and upload it as pack art | Implemented | Implemented |
| `packOpening.animation.tear` | Interactive seal tear/opening scene | Implemented through the shared `pack-core` runtime | Implemented through the shared `pack-core` runtime |
| `packOpening.reveal` | Reveal next, flip, slide, show all, finish, and open-more actions | Implemented | Implemented |
| `packOpening.results.grouped` | Results grouped per pack, with a best-pull summary for multi-pack sessions | Implemented | Implemented |
| `packOpening.results.inspect` | Close-up, front/back flip, pinch zoom, swipe navigation, share, favorite, and wishlist | Implemented | Implemented, including Favorites binder create/reuse and save feedback |
| `packOpening.save.collection` | Review and save every pull to a collection | Implemented; individual copies preserve ledger identity | Implemented; individual copies preserve ledger identity |
| `packOpening.save.sealedLedger` | Optionally link the opening to physical sealed inventory and decrement it | Implemented | Implemented for on-device and server-backed inventory, with eligible-booster selection and retry checkpoints |
| `packOpening.offline.downloads` | Download/retry/remove supported set assets and open them without a network | Implemented for the same supported Base Set/Pitch Black scope with Cache Storage, progress/failure/retry/remove controls, service-worker serving, and offline-open gating | Implemented with durable set records, progress/retry/remove UI, and WebView offline asset serving |

The pack simulation contract must also preserve the selected pack pool, set and
variation labels, warning state, pack grouping, reveal order, and pull metadata.
Visual parity does not require Android to use the iOS WebKit bridge; a native
Compose renderer is valid if commands and resulting session data are equivalent.

## Production scanner

| Contract group | Required behavior | Web audit status | Android audit status |
|---|---|---|---|
| Capture | Manual camera, single photo, bulk photos, automatic live consensus, and binder pages | Manual camera frame, photo, and multi-file shared-session upload implemented; imported-video tracking is partial automatic capture; YOLO detects multiple cards but there is no binder-page workflow | Manual, single photo, typed sequential bulk import, and two-frame automatic consensus implemented; binder pages include automatic page-boundary seeding plus an editable guided 3x3 workflow |
| Games | Pokémon, Yu-Gi-Oh!, and Magic | Implemented for classic pHash; the local embedding index is Pokémon-only | Implemented |
| Engines | Automatic-with-fallback, on-device-only, server pHash, and server embedding | On-device and server pHash are implemented; automatic fallback is partial and selectable server embedding is planned | All four are selectable and wired; Android automatic is server-first when configured while iOS is local-first, and embedding is limited to Pokémon |
| Encoder models | ArcFace and DINOv2 as atomic model/index/threshold/gate bundles | ArcFace is the published preferred web bundle; DINOv2 remains an alternate artifact without a user-facing selector | Both are selectable checksum-validated atomic bundles. DINOv2 preserves its calibrated gate and passes real arm64 retrieval plus manual title/footer OCR rescue tests for the two clean gate-false-negative fixtures |
| Session options | Language, torch, automatic result opening, price mode, and shared web session | Shared sessions and a validated persisted language default applied to new sessions/uploads are implemented; torch, auto-open, and session pricing are planned | Torch, stable-consensus auto-open, authenticated per-card prices/running totals, and shared-session uploads are implemented; language is persisted and attached to debug/shared-session records, while collector-aware recognition remains partial |
| Results | Session tray/review, correction, bulk add, and manual corner adjustment | Select all/none, row selection/removal, clear-uncommitted, selected bulk-add, and immutable committed rows are implemented; corner correction is planned | Persistent tray, select/remove/clear review, bulk binder add, four-corner adjustment, perspective crop, and production-handler retry implemented |
| Binder pages | Multi-card detection, per-page review/destinations, saved page photos, replacement on retake | Multi-card YOLO detection exists, but binder review, destination assignment, and page-photo persistence are planned | Automatic page-boundary detection, editable alignment, nine-pocket extraction, sequential recognition, correction/skip, bulk save, and app-private page-photo replacement are implemented |

The web scanner has two distinct production surfaces: authenticated still-image
pHash capture with server diagnostics, and experimental browser-local video
recognition. The browser-local manifest currently chooses ArcFace while the UI
still labels the generic embedding mode “DINOv2”; this is why the declarative
contract records ArcFace as implemented and DINOv2 as partial rather than
claiming two selectable models.

Android now has calibrated ArcFace and real DINOv2 ONNX embedding paths plus ML
Kit title/footer OCR rescue. DINOv2 retrieval and the strict iOS-equivalent
manual rescue policy are verified on API 34 arm64 without weakening the shared
gate; automatic-camera frames still abstain without rescue. Android now also
performs automatic binder-page boundary seeding, manual four-corner correction,
a guided 3x3 binder-page review/save workflow, durable page-photo replacement,
and authenticated shared-session uploads. Language is preserved across the
Android session and its diagnostics/uploads, but collector-aware language
filtering in the recognition engine remains partial. Camera interaction and
image-quality behavior still require a connected-device runtime pass before
release sign-off.

## Scanner debug and model controls

All of these are separate parity obligations:

| Contract ID or family | Required behavior | Web audit status | Android audit status |
|---|---|---|---|
| `scanner.debug.serverCapture` | Upload/store source, crops, guess, timings, and pipeline metadata | Implemented through authenticated still-image capture | Implemented request-side through the shared server API |
| `scanner.debug.developerAccess` | Seven-activation unlock, testing-tools toggle, and hide-developer-tools action | Planned; current diagnostics are not behind this access contract | Implemented with persistent unlock state and reset behavior |
| `scanner.debug.testingInputs` | Deterministic demo card and demo binder-page input | Partial: one bundled Sinnoh video result/ground-truth fixture, no runnable binder-page source input | Implemented with deterministic card and 3×3 binder inputs routed through production capture/cropping and verified by on-device OCR |
| `scanner.debug.captureBrowser` | Browse/refresh captures, inspect artifacts and metrics, and apply review labels/tags | Implemented in the still-image scanner | Implemented through the server capture API and native capture browser |
| `scanner.debug.livePipeline` | Start/stop live pipeline, quad overlay, result, frame timing, and bounded event log | Partial: imported-video start/stop, overlays, tracks, progress, and timeline exist; no debug-camera capture | Implemented with the UI card guide/canonical crop, production-boundary timing, and bounded capture/result events; internal model-stage geometry is not exposed by the current result contract |
| `scanner.debug.liveConfiguration` | Game picker, embedding-only toggle, and analysis-interval slider | Implemented; the 100–2000 ms interval is enforced across detection, hash, and embedding loops | Implemented through live game/engine selection and analysis-interval control |
| `scanner.debug.recording` | Record/pause frames and save/share/clear an exportable run | Planned | Implemented with exact input JPEGs, deterministic guide crops, and portable image-embedded archives |
| `scanner.debug.devModeRecording` | Persist production scans and decision evidence as reusable training data | Implemented for server-saved still-image production captures | Partial: production inputs, guide crops, configuration, results, and timing are retained; hidden per-model-stage hypotheses are not exposed by the production boundary |
| `scanner.debug.attemptImages` | Optional JPEG for every recognition crop attempt | Partial: source and derived artifacts are saved, but not every recognition attempt | Partial: original input and one canonical guide crop are retained, not every internal recognition-attempt crop |
| `scanner.debug.sessionManagement` | List, select, export/share, and delete recorded sessions | Partial: recent captures can be browsed; export/share/delete are absent | Implemented with bounded persistent storage, explicit deletion cleanup, portable export, and a scoped FileProvider Sharesheet |
| `scanner.debug.replay` | Import extracted recordings and produce replay accuracy/timing reports | Partial: the review lab imports precomputed results and video but does not rerun production recognition | Implemented through the production request handler, with sequential accuracy, false-positive/miss, mean, and p95 reporting; legacy metadata-only recordings cannot replay |
| `scanner.debug.referenceSets` | Step through labeled image sets against expected card IDs | Implemented for bundled/imported sets with every labeled window, expected-printing comparison, verdicts/tags, and click-to-seek | Partial: production-handler runner, positive/negative/unlabeled verdicts, and accuracy/latency reports exist; native browser UI is not wired |
| `scanner.debug.assetDiagnostics` | Validate every required model/index/hash/reference asset | Implemented with manifest/index/vector/bytes/hash/encoder/gate/YOLO-shard/reference checks and explicit warnings for undeclared hashes or incompatible gates | Implemented for ArcFace model/index integrity plus ML Kit, camera/flash, storage, and server capability checks; DINO separately enforces its model/index/gate/metadata hashes on production load |
| `scanner.debug.decisionDiagnostics` | Attempt geometry, orientation, gate, OCR, candidates, thresholds, rejection reason, and stage timing | Implemented for saved server captures, including attempts, geometry, OCR, candidates, thresholds, timings, and pipeline revisions | Partial: requested/reported engine, source, candidates/confidence margin, OCR queries, total timing, debug ID, and errors are captured; the production boundary does not expose internal gate/quad/ANN-stage evidence |
| `scanner.debug.feedbackLabels` | Correct/Wrong/Needs Review plus structured reason tags | Implemented with server persistence | Implemented, including notes and server persistence |
| `scanner.debug.performance.*` | Every A/B switch listed below | Planned: underlying code may optimize or cache automatically, but none of the ten switches is user-selectable | Fast Shutter Capture implemented; the other nine remain non-operational/planned |

The iOS performance switches are tracked individually, including their default
values:

| ID suffix | iOS label | Default | Web status |
|---|---|---|---|
| `vectorizedAnn` | Fast Index Search | On | Planned |
| `scopeCache` | Cache Search Scope | On | Planned |
| `stagedHypotheses` | Staged Crop Retries | On | Planned |
| `batchedOrientation` | Batched Orientation Check | Off | Planned |
| `concurrentOrientation` | Parallel Orientation Check | On | Planned |
| `warmStart` | Preload Scanner Models | On | Planned |
| `fastCapture` | Fast Shutter Capture | On | Planned |
| `fastFooterOcr` | Fast Footer OCR | On | Planned |
| `leanOcrStrips` | Lean OCR Strips | On | Planned |
| `footerFirstOcr` | Footer-First OCR | On | Planned |

These switches must control equivalent platform pipeline decisions; automatic
use of an optimization without its declared A/B control is not implementation
parity. ArcFace and DINOv2 must likewise select a matching model, catalog index,
calibrated thresholds, and rejection policy together (the calibrated ArcFace
policy does not currently use the DINOv2-specific rejection gate).

## Promotion checklist

Promote one granular record from `track` to `parity` only after all of the
following are true:

1. Every required platform status is `implemented`, with concrete source
   evidence.
2. Shared semantic accessibility/test IDs exist for every interaction and
   assertion.
3. Deterministic Maestro and/or Playwright flows run the same semantic scenario
   on web, iOS, and Android; platform branches may navigate differently but
   cannot weaken one platform's assertions.
4. Recognition/model features also have shared image fixtures and native unit
   or integration tests that assert card ID, engine/model choice, confidence or
   rejection outcome, and useful diagnostics. A screen-open smoke test is not
   recognition evidence.
5. Pack features use deterministic RNG/fixture sessions so pull order, grouping,
   save payloads, and offline behavior can be compared without flaky randomness
   or network dependencies.

The previous `scanner.identify` Maestro flow was removed because it asserted a
fixture result only on Android and asserted only screen visibility on iOS. It
also had no equivalent web assertion, so it could not support an honest
three-platform parity claim.
