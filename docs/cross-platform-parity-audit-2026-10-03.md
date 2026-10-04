# TCGer platform parity audit

Reviewed October 3, 2026 against checkout `ed957cef07e44be57677630467cd5a55d9d9ac3e` and the matching GitHub Actions run. This audit covers the Next.js application, SwiftUI iOS application, Compose Android application, public marketing/demo website, shared API contracts, platform setup, and parity tooling.

TCGer already has a useful parity framework, but it does not currently establish complete product parity. The feature inventory is incomplete, some declarations are stale, most capabilities are only tracked, and the matching native CI suites fail. Implementation status, operating-mode availability, and verified behavior need separate treatment.

This is a source and execution-evidence audit. I ran the parity contract checks, inspected the matching CI results and logs, and requested the public site's integration endpoints. I did not manually exercise every screen, run physical-device camera or biometric tests, inspect App Store Connect or Play Console, or verify deployed self-hosted installations. Findings below distinguish confirmed gaps from declarations and further verification work. This document proposes changes; it does not change product behavior or promote feature statuses.

## Current tracking and evidence

The source of truth is [features.json](../mobile-parity/features.json). It generates TypeScript, Swift, and Kotlin feature/control IDs plus [REPORT.md](../mobile-parity/REPORT.md). Playwright produces web results; shared Maestro flows produce native results. The reporter joins JUnit by feature ID. [The framework decision](../mobile-parity/FRAMEWORK_DECISION.md) correctly defines parity as equivalent product behavior across independent UI implementations.

| Current declaration | Web | iOS | Android |
|---|---:|---:|---:|
| Implemented | 69 | 92 | 77 |
| Partial | 8 | 0 | 6 |
| Planned | 15 | 0 | 9 |

These are declarations, not verified feature counts. Of 92 features, **7 require parity and 85 are tracked**. Those seven cover dashboard, binder browsing/creation, card search, wishlist browsing/creation, and settings. There are 64 features declared implemented everywhere, including 57 that still use `track`; 28 features have differing declarations. No feature currently uses `unavailable`, `not_applicable`, or `waived`.

The local `npm run parity:check` passed all 12 tooling tests and validated 92 features and 108 controls. It establishes contract consistency and generated-file freshness, not application correctness.

The [matching CI run](https://github.com/ahzs645/TCGer/actions/runs/34863438896), created September 14, has these results:

| Suite | Actual result |
|---|---|
| Contract | Passed |
| Web | 12 of 12 cases passed |
| Android | 7 of 8 flows passed; grading workspace navigation failed |
| iOS | 0 of 8 flows passed; seven could not reach expected screens/controls, grading could not dismiss the keyboard |
| Report | Generated successfully despite native failures |

A successful report job means that a report was produced. The workflow overall failed. No feature was verified on all three platforms in that run. Failure to reach an iOS screen is evidence of a failing test journey; it does not prove that the underlying feature implementation is absent.

## Confirmed gaps in tracking and enforcement

### Native parity execution needs repair

The [iOS log](https://github.com/ahzs645/TCGer/actions/runs/34863438896/job/104041303598) reports missing `action.search`, navigation IDs, and the dashboard feature ID. Its build also reports three missing catalog manifests, although it proceeds to execute flows. Current [RootView](../mobile-apps/ios/TCGer/TCGer/Views/RootView.swift) has a game-installation gate, while the [parity bootstrap](../mobile-apps/ios/TCGer/TCGer/Services/EnvironmentStore.swift) configures local mode and tabs. That gate is a likely cause requiring confirmation from failure screenshots; do not treat it as a proven diagnosis.

The [Android log](https://github.com/ahzs645/TCGer/actions/runs/34863438896/job/104041303766) shows the grading flow cannot find Library operations. [SettingsScreen](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/SettingsScreen.kt) now puts that action inside Data & storage, but [the shared flow](../mobile-parity/maestro/flows/grading-workspace.yaml) searches from the Settings landing page. Update the navigation and use a platform-appropriate keyboard dismissal on iOS.

Acceptance: deterministic empty-install bootstrap followed by passing native flows on the same commit, with screenshots and JUnit retained. Add a separate real onboarding scenario so test bootstrapping does not hide installation problems.

### Current tests exercise different amounts of behavior

The [native search flow](../mobile-parity/maestro/flows/cards-search.yaml) only opens the screen. The [web search case](../frontend/tests/parity/feature-parity.spec.ts) types Pikachu and checks a result. Several other native flows assert screen visibility. The grading web case checks missing data, cost changes, persistence, population/history views, and receipts; its native flow only checks one positive economics example.

Acceptance: shared scenario definitions with the same outcomes on every surface. Search should return an expected exact printing; inventory should preserve copy identity and metadata after save/reload; grading should assert the same calculations and missing-data behavior. Native presentation and navigation may differ.

### Scanner declarations are stale

These web records remain `planned`, but [scanner-workbench.tsx](../frontend/src/components/scan/scanner-workbench.tsx) contains corresponding controls and handlers:

| Feature | Code evidence requiring declaration review |
|---|---|
| `scanner.engine.serverEmbedding` | Authenticated server embedding selector and recognition handler |
| `scanner.options.torch` | Capability probe and camera-track torch constraints |
| `scanner.results.autoOpen` | Open card after capture toggle and result detail action |
| `scanner.results.cropCorrection` | Editable binder region corners |
| `scanner.binder.savePagePhotos` | Save page and photo, reopen, replace review/photo |

`scanner.results.priceMode` also remains planned while the workbench supports session quotes and per-currency totals. Its full intended mode semantics need comparison before changing the status. Automatic capture and binder-page recognition remain partial in the manifest despite substantial implementations; inspect the missing acceptance requirements before promoting them.

There is already browser execution evidence for corner persistence and binder photo review. The [scanner matrix](../mobile-parity/SCANNER_PACK_MATRIX.md), [September implementation report](interface-parity-implementation.md), and JSON contract disagree on parts of this scope. Reconcile them in one change; do not mark features verified from source inspection.

### Important capabilities have no independent feature records

The inventory covers grading but has no dedicated entries for physical storage/placement, deck checkout and refiling, rapid set entry, acquisition cost splitting, PSA intake, printed identity corrections, price provenance, inventory audit/undo, cost/return analysis, first-run game installation/update/removal, app-link routing, biometric locking, widgets/shortcuts, or release/distribution readiness. These are visible in sources such as [iOS Library Operations](../mobile-apps/ios/TCGer/TCGer/Views/LibraryOperationsView.swift), [Android Library Operations](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/libraryoperations/LibraryOperationsScreens.kt), and [web collection components](../frontend/src/components/collections).

Transactions and alerts are also too coarse or indirectly covered. `account.management` groups signup, profile, password, deletion, and preference sync under one status without declared tests. A single screen record cannot certify all those operations.

Acceptance: inventory these capabilities, split high-risk operations into independently testable records, and require a feature-record change whenever a product capability is introduced or changed.

### The validator allows unsupported evidence claims

[parity.mjs](../tools/mobile-parity/parity.mjs) checks that source/test files exist and that shared flows declare an ID. It does not require Playwright evidence for each parity feature, inspect behavioral assertions, or enforce waiver expiry. During this audit, in-memory copies of the manifest still validated after removing the dashboard's web test and after inserting a waiver expiring in 2000.

The reporter accepts result files without a commit, build, mode, or freshness check. Local result files date from August 26 for native and September 4 for web. It can combine those historical results with today's manifest. Native unit/instrumentation tests listed in the manifest are not automatically executed or normalized by the parity workflow; native smoke uses Maestro only. The web normalizer also treats a pass plus a skipped case for the same feature as a pass, while the native parser treats that combination as skipped.

Acceptance: require matching test declarations, validate dates and reject expired waivers, preserve required-case results, and attach commit/build/time/mode metadata to evidence. Keep UI, unit, API, and hardware evidence separate instead of letting one passing case stand in for all of them.

### Shared changes do not always trigger parity CI

[mobile-parity.yml](../.github/workflows/mobile-parity.yml) triggers for client and parity paths, but omits `backend/**`, `convex-backend/**`, `packages/api-types/**`, `packages/pack-core/**`, and relevant publishing tools/assets. A shared payload, calculation, pack runtime, or manifest change can therefore bypass this workflow.

The three-platform job tests a desktop Chromium demo and native local-mode debug builds. It does not establish signed-in server behavior, hybrid versus Convex compatibility, mobile Safari behavior, production static-export behavior, or release-binary behavior. The image publishing and Pages workflows have no dependency on successful parity jobs; repository branch-protection and external Xcode Cloud policies were not verified.

Acceptance: expand triggers and add API/provider and portable fixture jobs. Require a passing commit-specific parity result in the release process. Retain separate target-specific acceptance for cameras, browser capabilities, accessibility, and signed releases.

## Setup gaps across the actual surfaces

### Native app links are not deployed end to end

The [iOS entitlements](../mobile-apps/ios/TCGer/TCGer.entitlements) and [Android manifest](../mobile-apps/android/app/src/main/AndroidManifest.xml) advertise `tcger.ahmadjalil.com`. Direct requests during this audit returned:

| Public path | HTTP result |
|---|---|
| `/.well-known/apple-app-site-association` | 404 |
| `/.well-known/assetlinks.json` | 404 |
| `/scan` | 404 |
| `/search` | 404 |
| `/binder/test` | 404 |
| `/demo/scan/` | 200 |
| `/manifest.webmanifest` | 200 |

An Apple association file exists in [marketing-site/public](../marketing-site/public/.well-known/apple-app-site-association), and Pages checks for it in the build artifact. It is not currently served at the advertised public URL. An Android association file is absent from that source directory. Native route handlers alone do not complete domain verification or provide a browser fallback.

Acceptance: serve both association files with actual production identities, add useful fallback pages for the advertised routes, and exercise link handling both with and without each installed app. Confirm deployment rather than inferring it from files in the build artifact.

### The public website and full web application have different capabilities

[Pages deployment](../.github/workflows/pages.yml) publishes the marketing site, documentation, and static demo. It does not deploy the full authenticated application. [ServiceWorkerRegister](../frontend/src/components/pwa/service-worker-register.tsx) explicitly disables registration for that static demo. `/sw.js` returned 404 during this audit. This is intentional in source, so it should be documented as a surface difference rather than described as a broken full-app worker.

The public PWA manifest starts at `/`, the marketing page, and its scanner shortcut targets `/scan`, which returned 404. It does not describe the currently deployed demo routes. If the demo is intended to be installable, give it a scoped manifest and suitable offline behavior; otherwise present install/offline claims for the full application separately.

The [marketing source](../marketing-site/src/App.jsx) still says Mobile Coming. Its privacy and support wording largely addresses iOS and Keychain, although Android has distinct storage, credential, backup, and account flows. Update the product copy and platform-specific support information to match actual distribution status. Store-console settings and publication status were not inspected.

### Android distribution setup is incomplete in this repository

[Android Gradle configuration](../mobile-apps/android/app/build.gradle.kts) defines a minified release but no release signing configuration and keeps version code 1/version 0.1.0. Checked-in workflows build a debug APK for parity; there is no Android store publishing pipeline. In contrast, [iOS documentation](../mobile-apps/ios/README.md) describes Xcode Cloud/TestFlight and exact-build submission.

This establishes a repository automation gap, not proof that no manually signed Android build exists. Acceptance: establish reproducible release versioning/signing, build an AAB, verify the release artifact and app-link signing identity, and record store readiness separately from debug feature implementation.

### Availability contracts drift between clients and documentation

The web [health parser](../frontend/src/lib/api/health.ts) omits `onlineCodes` from its parsed keys even though the [navigation shell](../frontend/src/components/layout/app-shell.tsx) gates Code Vault on that flag. Consequently, an explicit server `onlineCodes: false` is ignored by web navigation. Native navigation respects that flag. Add it to the parser and cover false/unknown/unreachable states across clients.

The root [README](../README.md) says Convex prices, notifications, alerts, and automations return 501. Current [route registration](../backend/src/api/routes/index.ts) mounts their implementations, and [health flags](../backend/src/api/routes/health.router.ts) advertise them as supported. Shops and shipments remain unsupported in Convex mode. Setup guidance needs to match current routing.

Server flags, game-package capabilities, client implementation, authentication, configured providers, and browser/hardware support are different requirements. The existing feature JSON does not encode their combinations. For example, library operations require a server, a PSA integration requires configuration, and browser torch depends on the actual camera track.

## Differences that need an explicit limitation policy

| Area | Current difference or limit | Recommended treatment |
|---|---|---|
| Local decks, trades, activity | Hidden on native local mode; web demo has local deck/trade structures | Track local and server availability separately. Decide whether local decks belong in the common product scope. |
| Library operations | Native storage, checkout, cert, and audit operations require server access; grading planner works offline | Record prerequisites per operation and show a consistent explanation. |
| Portable import | iOS validates then replaces the local library; Android and web merge stable IDs | Document explicitly or add an equivalent merge option. Test collisions, repeated imports, rollback, and unrelated records. |
| Portable extensions | Unsupported sections can survive re-export without becoming editable features | Distinguish preservation from restoration and active editing. |
| Hosted backups | Convex-only; 1,500-row indexed-category limits, atomic import budget, 48 MB request limit | Track as capacity/backend restrictions. Add paginated transfer if larger libraries are supported. |
| Smart folders and preferences | Some state is device-local or transferred by backup rather than live account synchronization | Record sync scope per field/category. Do not promise automatic cross-device sync for local state. |
| Scanner engines | Core ML, ONNX, and browser runtimes differ; several iOS performance experiments lack equivalent controls | Verify shared image outcomes, rejection, printing identity, and latency. Mark internal implementation choices platform-specific when equivalent controls are not a product requirement. |
| Android scanner language/debug | Language remains partial; reference browsing and internal attempt/stage evidence remain partial | Keep concrete missing behaviors with owners and acceptance criteria. |
| Camera and browser storage | Torch varies by camera/browser; cached assets may be unavailable or evicted | Capability-gate and provide useful fallback behavior; verify offline after restart and permission denial. |
| OS integration | iOS 26 minimum and Apple UI APIs; Android API 26 minimum; native biometrics/widgets differ from web | Define native-equivalent outcomes or explicitly mark non-applicable surfaces. Avoid forcing identical APIs or appearance. |
| Notifications | Activity inbox exists; no native push registration or web push implementation was found in the searched client sources | Track inbox separately from background notification delivery. Decide whether push is required. |

Some retry-safe operations already use server idempotency, including audit undo. That does not establish a common protocol for every scanner/pack save. Verify response-loss retries for those saves before claiming they cannot duplicate physical copies or decrement sealed stock twice.

## Proposed maintenance workflow

Keep the current native stacks and build on the existing registry. A replacement UI framework would not solve evidence, mode, or deployment gaps.

1. **Repair current evidence first.** Fix native bootstrap/navigation/keyboard flows, obtain a green run for one commit, and preserve both failures and successes in the report.
2. **Reconcile the inventory.** Review all 92 records against source, add missing product/setup features, and replace umbrella statuses with testable operations where needed. Preserve honest partial statuses until missing requirements are identified and satisfied.
3. **Extend the contract with context.** Each capability should describe required surfaces, local/server/demo availability, backend/provider/game/hardware prerequisites, expected behavior, and synchronization scope. Every gap needs a reason, responsible owner, linked work item, and target release or review date. Temporary waivers need an enforced expiry; permanent non-applicability needs a durable rationale and fallback.
4. **Require equivalent evidence.** Define shared scenarios and fixtures for copy identity, metadata, backup, search, grading, scanner outcomes, and seeded pack sessions. Feed normalized unit/API/UI results into separate evidence columns. Test authenticated operations with the real supported backend combinations.
5. **Enforce changes and releases.** Trigger checks for shared contracts/backends/assets. Reject missing required cases, failed/skipped required cases, stale commit evidence, and expired waivers. Verify production routes, association endpoints, offline behavior, and release artifacts after deployment/build.

A capability should progress through declaration, implemented behavior, relevant automated evidence, and required device/deployment acceptance. The public matrix should show those states directly. A limitation is resolved when the supported scope, explanation, fallback, and acceptance checks are explicit, even when a platform cannot supply the same implementation.

## Verification performed for this audit

- Ran `npm run parity:check`: 12 tooling tests passed; generated contract was current.
- Retrieved the latest matching CI report and inspected native failure logs: web 12/12, Android 7/8, iOS 0/8.
- Demonstrated missing-web-test and expired-waiver acceptance using in-memory manifests; repository declarations were not altered.
- Demonstrated inconsistent pass/skip aggregation using an in-memory JUnit sample.
- Requested public association, scanner/search/binder fallback, PWA manifest, demo scanner, and worker URLs.
- Reviewed feature records, platform navigation/availability, scanner workbench, portable backup scope, library operations, manifests/entitlements, and CI/release setup.

Physical devices, full authenticated account journeys, published store builds, and production self-hosted servers still need targeted execution. Historical implementation reports remain useful source context but do not substitute for evidence on this checkout.

## Complete registered feature matrix

This snapshot reproduces the 92 registered feature declarations and matching CI evidence. Planned and partial labels below are the existing declarations; the stale scanner entries discussed above have not been silently corrected. An em dash means no declared execution coverage; Not run means declared coverage did not produce supplied evidence. This table is historical audit evidence, not a replacement for the generated registry report.

| ID | Feature | Policy | Web declaration | Web evidence | iOS declaration | iOS evidence | Android declaration | Android evidence | Result |
|---|---|---|---|---|---|---|---|---|---|
| home.dashboard | Dashboard | parity | Implemented | Pass | Implemented | Fail | Implemented | Pass | Failed |
| collections.browse | Browse binders | parity | Implemented | Pass | Implemented | Fail | Implemented | Pass | Failed |
| collections.create | Create a binder | parity | Implemented | Pass | Implemented | Fail | Implemented | Pass | Failed |
| cards.search | Search cards | parity | Implemented | Pass | Implemented | Fail | Implemented | Pass | Failed |
| wishlists.browse | Browse wishlists | parity | Implemented | Pass | Implemented | Fail | Implemented | Pass | Failed |
| wishlists.create | Create a wishlist | parity | Implemented | Pass | Implemented | Fail | Implemented | Pass | Failed |
| settings.browse | Settings | parity | Implemented | Pass | Implemented | Fail | Implemented | Pass | Failed |
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
| data.portableBackup | Portable backup fidelity and recovery | track | Implemented | Pass | Implemented | Not run | Implemented | Not run | Aligned |
| cards.filteredSearch | Filter cards beyond preview limits | track | Implemented | Pass | Implemented | Not run | Implemented | — | Aligned |
| scanner.binderCorners | Correct and persist binder page crops | track | Implemented | Pass | Implemented | — | Implemented | — | Aligned |
| collections.copyMetadata | Edit and retain physical-copy metadata | track | Implemented | Not run | Implemented | Not run | Implemented | Not run | Aligned |
| collections.smartFolders | Condition and tag smart folders | track | Implemented | — | Implemented | — | Implemented | Not run | Aligned |
| account.management | Profile password signup deletion and preferences | track | Implemented | — | Implemented | — | Implemented | — | Aligned |
| scanner.binderReview | Save selected cards and reopen saved binder photos | track | Implemented | Pass | Implemented | — | Implemented | — | Aligned |
| pricing.gradingWorkspace | Grading planner: prices, costs, decision, population, history and receipts | track | Implemented | Pass | Implemented | Fail | Implemented | Fail | Failed |
