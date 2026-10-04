# Cross platform reliability work and next actions

The six initial reliability tasks and all four remaining iOS audit tasks have been implemented. The follow-up also expanded API coverage and the code-owned feature inventory. This document describes the resulting behavior and its verification boundaries. The [initial parity audit](cross-platform-parity-audit-2026-10-03.md) remains historical evidence.

## Implemented reliability work

| Area | Result | Coverage |
| --- | --- | --- |
| Account isolation | iOS collection caches hash server and credential; session changes clear widgets and wishlist state. Delayed producers cannot publish across sessions. | Credential/server switches, offline fallback, unauthorized responses, widget transitions and mutation invalidation. |
| Durable local saves | Throwing recovery rotation precedes atomic commit; cleanup cannot report a failed save after committing. | Fault injection and agreement between memory, disk and relaunched state. |
| Recovery photos | Immutable photos remain while referenced by live state or retained recovery points. Unreadable snapshots conservatively retain bytes. | Replacement/removal/binder deletion, recovery, relaunch and pruning. |
| Image request lifecycle | A replacement cancels its predecessor and owns publication through a request identity. Stale success/failure and cancelled requests cannot replace the current image. | Delayed A/B responses, cancellation, nil URL, cached replacement and retry after failure. |
| Explicit offline downloads | Renderer bytes and native artwork use throwing durable writes. Completion requires verified required assets; relaunch and opening reject missing assets. | Renderer/native write failures, invalid artwork, real successful offline relaunch and asset removal. Legacy completion records without complete asset lists require re-downloading. |
| Credential persistence | Injectable Keychain storage updates existing items before adding. Read/write/delete failures are surfaced; failed migration retains legacy credentials. Successful login remains usable in memory if persistence fails. Failed logout deletion leaves a tombstone preventing silent restoration. Local mode never overwrites a saved server token. | Add/update/read/delete errors, concurrent add, migration retry, legacy fallback, in-memory session and logout relaunch. |
| LocalStore ownership | HTTP transport remains in the 108-line APIService file. LocalStore moved into its own domain file; portable/legacy mapping, recovery persistence and photo filesystem ownership are separate services. | Existing local persistence, mutation, backup, photo and API tests exercise the moved code. This is a bounded extraction; the remaining large domain file is not claimed to be fully decomposed. |
| Capability recovery | Web parses every typed flag, including `onlineCodes`, and refreshes after recovery. iOS caches successes, permits same-server retries, preserves known restrictions, rejects superseded responses and offers Retry/reconnect/foreground refresh. | Web failure/recovery ordering; five iOS refresh tests including source changes and coalescing. Android parses health flags but does not yet apply capability gates or automatic recovery; its record is partial. |
| Portable imports | All three default to stable-ID merge. Incoming metadata wins, unrelated records survive and copies move once. Recovery and explicit iOS replacement remain distinct; replacement clears old unsorted cards. | Shared merge fixture, repeated import, copy identity, metadata, counters, durable library, rollback and photos. |
| UI execution evidence | One iOS UUID drives build/install/Maestro. Debug-only fixtures and keyboard/navigation fixes restore execution. Each runner clears old evidence before building and binds XML to source/revision/run/time. | Three-platform local/demo baseline and tooling checks rejecting stale, mixed, expired, modified or unbound results. |

## Expanded parity and API coverage

The inventory contains 114 capabilities: seven parity-required and 107 tracked. New granular records cover physical containers/placements, deck checkout/refiling, rapid intake and exact acquisition-cost allocation, certification lookup, price provenance, audit/undo, game-package installation/update/downloads, app links, biometric lock and release readiness. Declarations retain actual limitations; they do not imply that missing implementations were built or that release configuration was verified.

The shared contract has 42 interactions across eight features. Production web, iOS and Android clients cover copy add/edit/explicit clearing/move, grouped removal, scan-result saving and sealed opening, in addition to the original collection/search/import operations. Express executes actual routing, authentication middleware, schemas and errors with injected domain services/backup transport. Convex executes real HTTP actions and mutations in isolated storage, including ownership, stock decrements, linked copies and sibling preservation. Live identity and deployed gateways remain separate verification.

PATCH addresses a physical copy and preserves its sibling. The existing DELETE endpoint removes the printing group, including all copies; the contract deliberately retains this behavior. Scan-save cases cover the HTTP persistence request, not camera recognition, review UI or retry idempotency. Sealed-opening cases cover owned stock and linked-copy ledgers; they do not promise offline opening or idempotent resubmission. Import fixtures establish their tested behavior rather than arbitrary-backup idempotency.

## Verification and delivery

Use [the local UI report](../mobile-parity/results/REPORT.md) and [the API report](../mobile-parity/results/api/REPORT.md) for execution evidence. These are ignored local artifacts; CI publishes reports for its own checkout. Both commands below require complete current evidence:

```sh
npm run parity:report -- --require-pass
npm run api-contracts:report -- --require-pass
```

The full iOS unit suite passed 439 tests with zero failures on the iPhone 17 Pro simulator (iOS 26.5). Six tests skipped because their external inputs were absent: crop-parity inputs, a candidate Magic package URL, two performance recording cases and two external replay cases. The suite includes the new lifecycle, durability, Keychain and health tests along with existing scanner/model, mutation and backup tests. The focused Playwright/Maestro baseline is not exhaustive product equivalence: native card search currently checks screen availability while web performs a query. Device camera behavior, live login, hosted associations and signed releases are outside these local runs.

Source fingerprints and checkout revision must match execution. After committing, rerun final API/UI evidence against that commit before pushing. Do not relabel earlier evidence as current. Keep XCTest and Maestro sequential on the same simulator. Dependencies can be installed in an isolated temporary directory; webpack is available for the web baseline when Turbopack cannot resolve that directory.

## Remaining tracked work

| Area | Reviewed gap |
| --- | --- |
| Android server capabilities | Parsed flags are not yet retained/applied by feature gates or refreshed on recovery. |
| Biometrics | iOS's passcode-labelled cancellation path lacks credential fallback; Android unlocks when authenticators are unavailable. Hardware and release-build behavior needs dedicated verification. |
| Arbitrary game packages | iOS scanner downloads require a built-in game identifier. The limitation is explicit rather than hidden by an umbrella download record. |
| App links | Some web fallback paths differ from native paths. Live association files and deployed routing need verification. |
| Release readiness | Signed Android configuration, iOS distribution and production web checks remain planned. Unsigned Debug success does not satisfy them. |
| Broader verification | Physical workflows, audit/undo, price provenance and other tracked capabilities need equivalent user-journey coverage before parity promotion. Opening submissions still lack replay idempotency. |
| Further refactoring | The transport/domain separation is complete; further LocalStore decomposition and additional detail workflow repository injection can proceed independently with current behavior coverage. |

Follow [AGENTS.md](../AGENTS.md), [the parity workflow](../mobile-parity/README.md) and [the API contract workflow](../mobile-parity/api-contracts/README.md). Update implementation, declarations, definitions and tests together; preserve deliberate differences and keep UI/API evidence separate.
