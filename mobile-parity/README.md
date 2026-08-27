# Three-platform feature parity execution

TCGer keeps the web app in Next.js, the iOS app in SwiftUI, and the Android app in Jetpack Compose. This directory supplies the shared cross-platform contract plus black-box execution evidence across all three; it does not introduce a shared UI runtime.

The evaluated framework options and the reasons for this hybrid are recorded in
[`FRAMEWORK_DECISION.md`](FRAMEWORK_DECISION.md).

## How it works

1. [`features.json`](features.json) is the source of truth. Every capability has web, iOS, and Android status plus code evidence. `parity` features must be implemented on all declared platforms and own shared execution coverage; `track` features may remain an explicit gap.
2. `npm run parity:generate` creates typed TypeScript, Swift, and Kotlin feature/control IDs plus [`REPORT.md`](REPORT.md). Screens attach those IDs through DOM attributes, accessibility identifiers, or Compose test tags.
3. The same Maestro flow runs against each compiled native app. Platform branches are reserved for real UI differences, while assertions use the shared IDs.
4. The focused frontend Playwright parity suite is the authoritative web runner. [`web-parity.mjs`](../tools/mobile-parity/web-parity.mjs) converts its JUnit into feature-ID cases; the core parity reporter merges those results with iOS and Android. Visual-regression baselines remain a separate concern, and Maestro web beta is not required.
5. CI rejects invalid or stale contracts, runs Playwright plus both native smoke suites, and publishes a three-platform report and test artifacts.

The report distinguishes each platform declaration from current execution evidence. “Not run” means a declared test exists but no JUnit was supplied; “—” means no test is declared for that platform.

Scanner and pack opening are intentionally decomposed into granular records in
[`SCANNER_PACK_MATRIX.md`](SCANNER_PACK_MATRIX.md). An umbrella screen or a
platform-specific fixture is not enough to claim parity for recognition
engines, model variants, pack modes, or developer diagnostics.

## Commands

Requirements: Node 18+, Playwright browsers, JDK 17, Android SDK/ADB, Xcode for iOS, and the [Maestro CLI](https://docs.maestro.dev/getting-started/installing-maestro) for native smoke tests.

```sh
npm run parity:generate   # after changing features.json
npm run parity:check      # schema/semantic tests and generated-file drift
npm run parity:web        # run Playwright and emit raw + feature-ID JUnit
npm run parity:android    # build, install, and test a running Android device
npm run parity:ios        # build, install, and test an iPhone 17 Pro simulator
npm run parity:report     # merge available web, iOS, and Android JUnit results
```

Set `MAESTRO_DEVICE_ID` to target a specific running device, `IOS_SIMULATOR` to choose another simulator, or `PARITY_RESULTS_DIR` to move result artifacts. Web execution writes `web-playwright.xml` (unaltered Playwright output), `web.xml` (one feature-ID case per covered feature), and `web-summary.json`.

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

1. Add or update its record in `features.json`, including real source paths.
2. For a parity-required feature, add one native flow in `maestro/flows`, declare `properties.featureId` in its header, and add Playwright coverage carrying the same ID.
3. Generate the TypeScript, Swift, and Kotlin constants and expose `feature.<feature-id>` on each screen plus shared control IDs for interactions.
4. Run `npm run parity:check` and each platform smoke command. Promote a tracked feature to `parity` only when web, iOS, and Android are implemented and all declared evidence passes.

Do not weaken one platform branch to a screen-visibility assertion while the
other branch exercises behavior. If a capability cannot be driven
deterministically on all platforms, leave it tracked and cover its portable
logic with platform fixture tests until shared execution is available.

The generated report distinguishes contract alignment (`Declared`) from actual device evidence (`Verified`).
