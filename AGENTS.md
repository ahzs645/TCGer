# Repository agent instructions

Follow more specific instructions in nested `AGENTS.md` files as well.

## Cross-platform feature tracking

TCGer has a web app (`frontend`), a SwiftUI iOS app
(`mobile-apps/ios/TCGer/TCGer`), and a Compose Android app
(`mobile-apps/android/app/src/main/java`). Product capabilities must be tracked
across all three, including capabilities that currently exist on only one.
Keep tracking changes in the same change as the implementation.

Read [the parity workflow](mobile-parity/README.md) when changing a capability.
[The framework decision](mobile-parity/FRAMEWORK_DECISION.md) explains the design
and compares approaches used by other projects.

### What owns each fact

| Location | Ownership |
| --- | --- |
| `mobile-parity/features.definitions.json` | Stable feature IDs, product titles, `track`/`parity` policy, source paths, registration paths, and test references. Edit this file. |
| `// @tcger-feature {...}` in application source | Each platform's implementation status, limitations, operating modes, prerequisites, and temporary waiver. Edit this beside the implementation. |
| `mobile-parity/features.json`, `mobile-parity/REPORT.md`, and generated TypeScript/Swift/Kotlin IDs and support metadata | Derived outputs. Regenerate; do not edit by hand. |
| Playwright and shared Maestro flows, plus their JUnit results | Behavioral assertions and execution evidence. A declaration or successful compilation does not prove parity. |
| `mobile-parity/api-contracts/interactions.json` and consumer/provider tests | Shared REST interactions, product feature bindings, and API compatibility evidence. Keep this separate from UI verification. |

### Workflow for a feature change

1. Inspect the product record and all three platform registrations before
   changing behavior. Run `npm run parity:impact -- --base <revision>` using a
   real comparison revision; use `HEAD` for current uncommitted work. Review
   uncovered application paths and consider all three clients for backend or
   shared-package changes. The impact report matches paths and cannot discover
   every conceptual feature or downstream dependency.
2. For a new capability, add a stable product ID and a record for every platform
   in `features.definitions.json`. Each `registration` must appear in that
   platform's `sources`. Keep IDs stable when moving files or renaming screens.
   Use granular records for distinct scanner engines, pack modes, and controls;
   an umbrella screen is insufficient coverage.
3. Add or update exactly one source declaration per feature/platform pair.
   Put it in the registered production TypeScript, Swift, or Kotlin file,
   including a planned or unavailable platform. The scanner reads `frontend/app`,
   `frontend/src`, and the native application roots above; generated code,
   bundled resources, and test fixtures are excluded. Update registration and
   source paths when moving an implementation.
4. Update behavior coverage and its product references. Parity-required features
   need Playwright coverage carrying the feature ID and a shared native Maestro
   flow with `properties.featureId`. Use generated feature/control IDs in app
   selectors. Assert equivalent outcomes across platforms, with branches only
   for genuine UI differences.
5. Run `npm run parity:generate`, then `npm run parity:check`. Run the relevant
   behavior suites (`parity:web`, `parity:ios`, `parity:android`) for the change
   and `parity:report -- --require-pass` to require fresh core evidence. Run all
   three against unchanged source and the same `PARITY_RUN_ID` when explicitly
   set. Finish XCTest before Maestro on the same simulator. Native builds alone
   do not run the source contract check; run it before native review.
6. Report affected surfaces, remaining limitations, and exactly what was tested.
   Distinguish passed checks/builds from executed UI tests. If a suite could not
   run, say so and retain the verification gap.

### Server-backed API changes

Follow [the API contract workflow](mobile-parity/api-contracts/README.md) when
changing a covered endpoint, request serializer, response decoder, or shared
server-backed capability. Update the shared interaction and consumer/provider
assertions together. Retain failure cases, metadata, and equivalent outcomes;
do not widen response matchers merely to hide a regression.

Run `npm run api-contracts:test` for web and provider coverage, plus
`npm run api-contracts:android` and `npm run api-contracts:ios` for affected native
clients. `npm run api-contracts:report -- --require-pass` requires every declared
consumer/provider interaction to pass. Missing, skipped, failed, or stale
evidence is insufficient. These checks validate API compatibility within the
documented test boundaries; they do not verify UI flows or live authentication.
`parity:generate` also refreshes the iOS test fixture, and `parity:check` checks
contract bindings and fixture drift without running device or provider suites.

### Declaring support and limitations

A declaration is one JSON object on one comment line. For example:

```ts
// @tcger-feature {"id":"scanner.options.torch","platform":"web","status":"implemented","requires":["camera-torch"]}
```

| Status | Use when |
| --- | --- |
| `implemented` | The declared capability is implemented within its stated scope. Execution verification is separate. |
| `partial` | Some behavior exists; explain exactly what is missing or different. |
| `planned` | The platform implementation is still outstanding. |
| `unavailable` | A platform or environment constraint prevents support; explain the constraint and any fallback. |
| `not_applicable` | The capability has no meaningful application on that surface; explain why. |
| `waived` | A temporary exception is explicitly recorded with a reason, owner, and expiry. |

Every status except `implemented` requires `limitation`. A `waived` declaration
also requires `waiver.reason`, `waiver.owner`, and a real `waiver.expires` date in
`YYYY-MM-DD` form. Checks reject expired waivers; they remain valid through the
specified UTC date. Do not invent owners or extend dates just to pass checks.

Use `modes` (`local`, `server`, `demo`) only for reviewed support. Omitted modes
mean unknown, not universal availability. Use `requires` for prerequisites such
as `authenticated-server` or `camera-torch`. Generated metadata describes scope;
it does not replace runtime checks for servers, hardware, or game packages.

Keep incomplete capabilities under `track`. Promote to `parity` only after all
three implementations and equivalent automated coverage are available and the
required suites pass. Fix regressions instead of weakening assertions or
changing policy solely to make checks green. Permanent constraints need explicit
limitations; temporary exceptions need accountable, expiring waivers.

### Data and session invariants

Portable imports merge by stable record ID on web, iOS and Android. Incoming
metadata wins; unrelated records remain; a physical copy moves to its incoming
parent without duplication. Repeated imports must preserve copy count. Recovery
restoration replaces state; explicit iOS replacement remains a distinct API.
Use `mobile-parity/fixtures/portable-backup-merge-v2.json` when changing these
semantics, and preserve unknown sections and platform-specific limitations.

Private caches must be scoped to the normalized server and authenticated session.
iOS currently hashes the opaque credential because collection responses do not
provide a trustworthy stable account ID; credential rotation requires a fresh
fetch. Never use the legacy global collection key or put secrets in filenames.
Capture session identity before asynchronous work and reject late publication
after logout or reconfiguration, including widgets and wishlist state.

A thrown local save must mean the live file did not commit. Keep throwing backup
rotation before the atomic live write and post-commit cleanup best effort. Keep
photo bytes while any live state or retained recovery point references them.
Test actual restoration/relaunch and failure injection when modifying these
paths. Preserve native ID counters across merge so new records cannot overwrite
unrelated imported or existing records.

### iOS reliability boundaries

`APIService.swift` owns HTTP transport. `LocalStore.swift` owns local domain state
and atomic commit coordination; `LocalStorePersistence.swift` owns recovery files,
`LocalStoreBackupCodec.swift` owns portable/legacy mapping, and
`LocalStorePhotoRepository.swift` owns immutable photo files and lifetime checks.
Keep these boundaries intact and retain their injected repositories.

Image requests need per-request identity and cancellation. A late success or
failure must not publish after replacement, even if its transport ignores
cancellation. Explicit offline downloads use throwing, synchronous durable writes
and verify all required renderer/native assets before saving completion. Ordinary
browsing caches may remain best effort. Legacy completion markers without an
asset list require a new verified download.

Use the injected throwing `AuthTokenStore`. Update existing Keychain items before
adding; do not delete a usable credential to replace it. Remove legacy copies only
after successful migration. Distinguish unreadable credentials from missing ones,
present persistence warnings, and keep the logout tombstone if deletion fails.
Health refresh must permit same-server retries, preserve known restrictions on
failure and reject responses for superseded sources.

Copy PATCH changes the addressed physical copy and preserves its siblings;
the established DELETE card endpoint removes the whole printing group. Scan-save
contracts verify persistence requests, not recognition or UI review. Sealed opening
contracts verify ownership, decrements and linked-copy ledgers, not offline or
idempotent replay. Keep these distinctions in tests and feature declarations.
