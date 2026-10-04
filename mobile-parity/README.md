# Three-platform feature parity execution

TCGer keeps the web app in Next.js, the iOS app in SwiftUI, and the Android app in Jetpack Compose. This directory supplies the shared cross-platform contract plus black-box execution evidence across all three; it does not introduce a shared UI runtime.

The evaluated framework options and the reasons for this hybrid are recorded in
[`FRAMEWORK_DECISION.md`](FRAMEWORK_DECISION.md).

## How it works

1. [`features.definitions.json`](features.definitions.json) owns product titles, parity policy, source bindings, and test references. Each platform owns its support status in a `// @tcger-feature` declaration beside the implementation. [`features.json`](features.json) is the generated joined contract; do not edit it by hand. `parity` features must be implemented on all declared platforms and own shared execution coverage; `track` features may remain an explicit gap.
2. `npm run parity:generate` joins the declarations and creates typed TypeScript, Swift, and Kotlin feature/control IDs, support metadata, and [`REPORT.md`](REPORT.md). Screens attach those IDs through DOM attributes, accessibility identifiers, or Compose test tags.
3. The same Maestro flow runs against each compiled native app. Platform branches are reserved for real UI differences, while assertions use the shared IDs.
4. The focused frontend Playwright parity suite is the authoritative web runner. [`web-parity.mjs`](../tools/mobile-parity/web-parity.mjs) converts its JUnit into feature-ID cases; the core parity reporter merges those results with iOS and Android. Visual-regression baselines remain a separate concern, and Maestro web beta is not required.
5. GitHub CI runs source checks, Playwright, Android and the web/Android/provider API suites on Linux. iOS XCTest/API/Maestro execution runs locally only. CI retains the three-platform matrix with iOS marked Not run; its required gate covers web and Android and cannot establish full parity.

The report distinguishes each platform declaration from current execution evidence. “Not run” means a declared test exists but no JUnit was supplied; “—” means no test is declared for that platform.

Scanner and pack opening are intentionally decomposed into granular records in
[`SCANNER_PACK_MATRIX.md`](SCANNER_PACK_MATRIX.md). An umbrella screen or a
platform-specific fixture is not enough to claim parity for recognition
engines, model variants, pack modes, or developer diagnostics.

## Commands

Requirements: Node 18+, Playwright browsers, JDK 17, Android SDK/ADB, Xcode for iOS, and the [Maestro CLI](https://docs.maestro.dev/getting-started/installing-maestro) for native smoke tests.

```sh
npm run parity:generate   # after changing source registrations or product definitions
npm run parity:check      # registrations, policy/evidence checks, and generated-file drift
npm run parity:impact -- --base origin/main # affected features and uncovered source paths
npm run parity:web        # run Playwright and emit raw + feature-ID JUnit
npm run parity:android    # build, install, and test a running Android device
npm run parity:ios        # local only: build, install, and run iOS Maestro
npm run verify:ios:local  # local only: regression + API XCTest, then iOS Maestro
npm run parity:report -- --require-pass # require all core flows and fresh evidence
```

Set `MAESTRO_DEVICE_ID` to target a specific running device, `IOS_SIMULATOR` to choose another simulator, or `PARITY_RESULTS_DIR` to move result artifacts. Web execution writes `web-playwright.xml` (unaltered Playwright output), `web.xml` (one feature-ID case per covered feature), and `web-summary.json`.

For iOS, use `MAESTRO_DEVICE_ID=<simulator-UUID>` or an unambiguous
`IOS_SIMULATOR` name. Boot, build, install and Maestro use that same UUID.
`IOS_DERIVED_DATA` reuses a build directory. The local fixture bootstrap is
restricted to Debug simulator builds; Android's equivalent is Debug only.
Finish XCTest before starting Maestro on the same simulator.
`PARITY_WEBPACK=true` selects webpack for environments where dependencies live
outside the repository and Turbopack cannot resolve them.

Each runner clears old output and writes a `.evidence.json` beside its normalized
JUnit. Evidence binds the XML digest to the checkout revision, source fingerprint,
platform, run ID and timestamps. Reports reject modified XML, changed source,
mixed runs and results older than 24 hours. CI uses its GitHub run ID; local runs
default to a shared revision/fingerprint/UTC-day identity. Set the same explicit
`PARITY_RUN_ID` for all three executions and their report when grouping a local
run across midnight. Fingerprints cover selected source/configuration files;
bundled assets and every transitive dependency are not verified by this hash.
A failed flow remains failed even when its evidence is fresh.

## Carrying feature IDs in Playwright

New Playwright cases can put an ID in the test name or tag using any of these forms:

```text
[feature:home.dashboard]
@feature:home.dashboard
featureId=home.dashboard
[home.dashboard]
```

The normalized JUnit name is always `[home.dashboard] Web Playwright parity`, matching the native report parser. A small exact-title compatibility map covers the current untagged demo suite; explicit IDs take precedence and are the preferred form for future tests.

## Adding or porting a feature

1. Add or update its product record in `features.definitions.json`, including real source paths and a `registration` path for each platform. That path must be listed in `sources` and contain exactly one declaration for the feature/platform pair.
2. For a parity-required feature, add one native flow in `maestro/flows`, declare `properties.featureId` in its header, and add Playwright coverage carrying the same ID.
3. Generate the TypeScript, Swift, and Kotlin constants and expose `feature.<feature-id>` on each screen plus shared control IDs for interactions.
4. Run `npm run parity:check` and each platform smoke command. Promote a tracked feature to `parity` only when web, iOS, and Android are implemented and all declared evidence passes.

Do not weaken one platform branch to a screen-visibility assertion while the
other branch exercises behavior. If a capability cannot be driven
deterministically on all platforms, leave it tracked and cover its portable
logic with platform fixture tests until shared execution is available.

The generated report distinguishes contract alignment (`Declared`) from actual device evidence (`Verified`).

Server-backed compatibility has a separate [API contract workflow](api-contracts/README.md).
Its shared interactions exercise real web/iOS/Android clients and the relevant
Express/Convex providers. API passes are reported separately and never substitute
for the UI evidence required by this matrix.

## Support declarations in implementation code

Use one JSON object on a single comment line in TypeScript, Swift, or Kotlin:

```ts
// @tcger-feature {"id":"scanner.options.torch","platform":"web","status":"implemented","requires":["camera-torch"]}
```

A gap must explain its limitation or fallback in the source declaration:

```kotlin
// @tcger-feature {"id":"scanner.options.language","platform":"android","status":"partial","limitation":"Language selection exists; equivalent language-aware recognition remains incomplete."}
```

Declare reviewed operating modes and prerequisites where known:

```swift
// @tcger-feature {"id":"decks.browse","platform":"ios","status":"implemented","modes":["server"]}
```

Allowed modes are `local`, `server`, and `demo`. Omitted modes mean unknown or not yet inventoried; they do not promise support everywhere. `requires` lists descriptive prerequisites such as `authenticated-server` and `camera-torch`. These declarations describe implementation scope, while actual server, game-package, and hardware checks still govern runtime availability.

Supported statuses are `implemented`, `partial`, `planned`, `unavailable`, `not_applicable`, and `waived`. Every status other than implemented requires `limitation`. A waived declaration additionally requires `waiver` with `reason`, `owner`, and a valid `expires` date. Checks reject expired waivers; expiry dates remain valid through that UTC calendar date.

The scanner walks application source roots, ignoring generated code, test fixtures, and bundled resources. It rejects missing, duplicate, malformed, misplaced, and unknown declarations. Source registration locations appear in the generated contract and report. Every parity-required web feature also needs a matching Playwright source reference; native coverage continues to require a shared flow.

Generated support metadata is available to application code:

```ts
import { ParityFeatureIDs, parityFeatureSupport } from "@/generated/parity.generated";
const support = parityFeatureSupport[ParityFeatureIDs.scannerOptionsTorch];
// support.status, support.limitation, support.modes, support.requirements, support.source
```

Swift exposes `ParityFeatureID.decksBrowse.support`; Kotlin exposes `ParityFeatureIDs.support.getValue(ParityFeatureIDs.DECKS_BROWSE)`. These are generated in the existing compiled files, so no separate native target registration is needed.

## Checks during development and review

Frontend development and build commands run the source contract check before starting. The root test command checks it before workspace tests. Web/Android GitHub CI checks source registrations and generated files, and now also triggers for backend, shared-package, and relevant publishing-tool changes. Standalone Xcode and Gradle builds compile the generated metadata; run `npm run parity:check` before native review to check its source bindings.

`npm run parity:impact -- --base <revision>` compares tracked changes and new untracked files against feature sources, tests, and flows. It lists affected features/platforms and highlights application files without direct feature coverage. Shared infrastructure can legitimately appear in that list. This is a review aid: neither annotations nor path matching can automatically discover every conceptual feature or prove that a handler works. Add a product definition when introducing a new capability and keep behavioral assertions in the execution suites.

The registry migration included all 92 existing features. The current inventory
has 114, including physical storage, deck checkout/refiling, intake, price
provenance, audit/undo, game packages, links, biometrics and release readiness.
Tracked records retain reviewed platform limitations; only seven require parity. Five stale web scanner declarations were reconciled with their existing handlers: server embedding, torch, result auto-open, crop correction, and binder-page photo saving. This changes declarations only; it does not infer passing device/server evidence or promote their parity policy.

## iOS execution policy

iOS tests run on the developer's local Mac. Do not add GitHub macOS jobs, a
manual Mac fallback, or a self-hosted GitHub iOS runner. All three execution
entrypoints reject `GITHUB_ACTIONS=true`.

`npm run verify:ios:local` selects one available iPhone 17 Pro UUID (or uses
`MAESTRO_DEVICE_ID`), runs API XCTest plus the lock/link/repository/package
regressions, and starts Maestro only after successful XCTest. Both use the same
simulator and build directory. Set `IOS_DERIVED_DATA` and `IOS_SIMULATOR` as
needed. The full unit suite is still available through local Xcode Test.

GitHub's report uses `parity:report -- --require-platforms web,android`. That
explicit scope still rejects missing, stale, failed or mixed-run web/Android
evidence. It leaves iOS unverified. The default `--require-pass` still requires
all three platforms. For a full local report, run all three unchanged sources
with one `PARITY_RUN_ID`; to combine CI web/Android with local iOS, check out the
exact CI commit and set `PARITY_RUN_ID` to its GitHub run ID before local iOS
execution and reporting. Never relabel old evidence.
