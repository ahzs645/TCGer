# TCGer audit remediation — 31 October 2026

This change continues [PR #40](https://github.com/ahzs645/TCGer/pull/40) from the
original audit at `c025b6db4724e3eec6cd4d17989f0dba8fad0c88`. It covers the
inventory, session, finance, collector-workflow, provider and deployment repairs
in the supplied audit. The implementation and its test evidence are separate
from native hardware and release qualification.

## Decisions that govern the repairs

A physical copy has a stable identity. Editing or deleting it preserves its
siblings; the existing printing-group DELETE remains an explicit group
operation. Legacy quantity rows are normalized deliberately, with a bounded
preview/commit path and preserved metadata, photos and relationships.

Account data and pending work belong to the normalized server and authenticated
session. A session change invalidates publication by earlier requests, including
their errors, auth credentials, query caches, selection state and widget updates.
Authentication also has an intent generation so a superseded login/bootstrap
cannot undo a later logout or server selection.

Full Convex is the primary account server. Inventory/finance operations that need
one transaction are explicitly unavailable in hybrid. Hybrid remains a defined
compatibility path with real Prisma identity and persistence acceptance tests.
See [supported modes and upgrade instructions](backend-modes.md).

Original amounts retain their currencies. Missing legacy currencies remain
unknown, separate from USD and other known currencies. Simulated openings save
to simulation history. Actual owned cards enter inventory through reviewed
physical intake, with an exact replayable receipt.

## Audit item mapping

The rows below group the supplied findings by their observable outcome. They
describe implemented behavior and the tests that establish it; they do not
promote tracked features to verified cross-platform parity.

| Audit concern | Implemented outcome | Main implementation and evidence |
| --- | --- | --- |
| 1. Delete Copy removed a printing group | New copy-specific DELETE; web/iOS use it. Android copy removal also uses the new route. The old group endpoint remains unchanged in meaning. | Shared `collections.physicalCopyDelete.*` fixtures; real PostgreSQL and Convex sibling-preservation checks; native API tests. |
| 2. Correcting one printing changed siblings | Printing overrides target only the selected physical copy in Convex, Prisma and phone-only storage. | `convex/inventoryIntegrity.test.ts`; real PostgreSQL acceptance; `InventoryOperationTests`. |
| 3. Notes-only edits reduced legacy quantity | Legacy rows expose truthful copy counts/addresses and normalize before mutation. Group arithmetic counts all materialized siblings. Metadata, photos, costs and sealed cents are preserved. | `copy-model.service.ts`, its unit tests, bounded migration tests and real PostgreSQL synthetic-address/multiple-row cases. |
| 4. Web private data survived account changes | Session transport fences response/body completion; stores and query clients reset; auth intent prevents stale cookie/session/bootstrap publication. | `private-session.test.ts`, `auth-lifecycle.test.ts`, scoped query/provider code. |
| 5. Native login completed against a different server | Environment generation is captured before login/configuration work and checked before token, preference, error or widget publication. | `EnvironmentStore.swift`; `SessionIsolationTests.swift` added for local XCTest. |
| 6. Native wishlist mutations outlived a session | Mutations, picker/set/guide callers, and batch sync capture the store/session generation. Old reads cannot overwrite a later confirmed mutation. | `WishlistStore.swift`, caller guards and native session tests. |
| 7. Acquisition amounts were mislabeled as USD | Currency travels with copy costs through APIs, imports, exports and portable backups. Unknown currency is retained. Summaries separate currencies and scalar USD totals exclude other/unknown currencies. | Shared cost types; Convex finance/import tests; web purchase-performance tests; native/Android round-trip tests. |
| 8. Acquisition undo left purchases and totals behind | Allocation receipts replay; acquisition undo reverses its exact purchases and spending summary atomically. Linked purchase CRUD updates the copy in the same transaction. Raw copy edits cannot bypass a linked purchase. | `collectionOperations.ts`, `collectionAudit.ts`, `finance.ts`, integrity tests and legacy linked-acquisition guards. |
| 9. Sale and inventory removal could partially commit | Atomic sale owns exact selected copies, amount/currency and stable operation ID. Clients retain pending requests and recovery receipts. Hybrid rejects before writing. | `inventory.sales` shared fixtures; server replay/conflict tests; web durable-sale tests; native inventory operation tests. |
| 10. Interrupted scanner/opening saves duplicated or mislinked copies | Frozen operation IDs and row IDs survive lost responses; receipts identify exact copies and optional opening. No binder-difference inference remains. | Atomic-intake contracts; `durable-intake.test.ts`; browser lost-response/reload scenario; native journal/tests. |
| 11. Deck and trade commitments overlapped | Primary server uses one availability policy for deck allocations, trade reservations/settlement, sales, deletion and storage. | `inventoryAvailability.ts` and domain conflict/rollback regressions. |
| 12. Native stocktake was missing; history metadata was stale | Native observe/import/latest scan → preview → commit stocktake is implemented. Existing history/undo registration now reflects its actual server behavior. | `StorageAuditView.swift`, transport/models and library operation test; regenerated feature registry. |
| 13. Demo, phone-only and connected experiences were conflated | Website, README and mode documentation identify where each experience stores data and when synchronization exists. | `marketing-site/src/App.jsx`, README and `backend-modes.md`. |
| 14. Successful saves left dependent screens stale | A common inventory publication layer invalidates collections, tags, wishlist ownership, finance queries and portable-backup views. Native notifications carry source identity. | `inventory-events.ts`, scoped stores, backup import/recovery paths and source-tagged native notifications. |
| 15. No-game gate hid recovery and owned data | Native settings, backup/recovery, server switching and owned collections remain reachable without installed catalogs. | `RootView.swift`, `GameInstallationView.swift` and settings/recovery routes. Device execution remains pending. |
| 16. Collections ignored the global game filter | Collections derives its scope from the shared game selection. | Collection sandbox and game-filter store; browser verification. |
| 17. Dashboard dropped community games | Dashboard derives game buckets from observed data and retains unknown game identifiers. | `dashboard-stats.ts` and direct community-game regression. |
| 18. Wishlist IDs collided between games | Selection and lookup use game-qualified identity. | Wishlist view/store and web identity regressions. |
| 19. Stale prices appeared under another printing | Quote publication binds to exact game/printing/finish/condition/language and session; replaced successes and failures are rejected. Scanner price mode tracks freshness and separate currencies. | Card preview request fencing; scanner pricing controller/hook and race tests. |
| 20. Native wishlist create could be submitted repeatedly | Pending state and synchronous reentry checks prevent duplicate concurrent creation and discard obsolete completion. | Native creation flows and session tests. |
| 21. Provider support overpromised settlement/email | Operation flags distinguish listing from settlement. Web/iOS disable unsupported acceptance; hybrid sale/intake/linked purchases fail before writes. Email logging is replaced with explicit unavailable delivery. | Health/guard tests, trade routes and client capability checks. |
| 22. Fresh legacy writes had no provisioned user | Authenticated subject is provisioned before Prisma writes. Email/username collisions require explicit migration; no email-based account adoption. Missing historical foundation migrations are restored. | `legacy-identity.test.ts`; fresh PostgreSQL migration and HTTP acceptance workflow. |
| 23. First-admin setup raced | Admin-exists check and promotion execute in the same mutation. A second caller is rejected. | `setupAtomic.test.ts` and atomic bridge mutation. |
| 24. Simulated pulls changed owned inventory | Simulation save writes simulation history only. Physical opening is an explicitly reviewed scanner/intake operation. | Separate web/native simulation stores and truthful feature registrations. |
| 25. Deployment and public guidance disagreed with the product | Compose forwards provider/FX/scan settings, defaults to usable direct APIs, persists uploads, and uses migrations. Gateway limit accommodates the backup limit. Marketing reflects current clients, games, frameworks and distribution. | Actual Compose validation, fresh PostgreSQL migrations, marketing build and updated OpenAPI. |

## Additional correctness found while completing the fixes

Real PostgreSQL startup failed before reaching application code because the
historical chain altered `DeckCard`, `SealedInventory` and `Transaction` without
ever creating those tables. An additive foundation migration supplies missing
tables before those ALTER migrations, leaves already-existing tables intact,
preserves legacy credential columns, and removes obsolete uniqueness indexes
that prevented separate physical copies. Existing installations created with
`db push` still need an inspected migration baseline; startup does not erase or
automatically reshape their data.

Legacy copy addresses now remain resolvable after normalization, including when
the first copy has been removed. Shared photo bytes remain while another copy
references the image. Splitting sealed-opening records distributes integer
cents instead of multiplying realized proceeds.

Undo also preserves physical and financial relationships. Copy restoration
reattaches the relevant sealed-opening/purchase/storage lineage and rejects an
intervening reassignment or ledger change. Physical normalization is retained in
history but cannot be undone through a generic copy snapshot. Atomic sale,
physical opening and trade settlement likewise require their domain-specific
semantics rather than generic inventory undo.

Development now initializes the Convex function environment explicitly. Custom
secrets passed only to the CLI process previously left functions using different
settings. The local-only bootstrap applies the declared values without logging
them, preserves the selected database, and checks the authenticated bridge before
readiness. Live acceptance also verifies the session signature uses the custom
auth secret and that restarting retains the original account and inventory.

## Evidence and reproducible checks

The final PR description records the final commit and exact completed test
counts. Counts overlap: shared contract tests are included in some provider
suites and must not be added as a distinct total.

| Layer | Evidence boundary |
| --- | --- |
| Full Convex live acceptance | Disposable anonymous local backend deployed with strict type checking; real Better Auth signup/session; shipping Express gateway; first writes, intake/sale replay and ownership isolation. No production deployment was changed. |
| Prisma acceptance | PostgreSQL 15 created empty, all versioned migrations applied, real Express/Prisma HTTP writes, legacy copy addresses, sibling metadata, currency and undo/link integrity. Identity lookup is controlled and optional remote pricing deliberately unavailable. |
| Hybrid provider matrix | All four collection/wishlist Convex/Prisma selections exercised through real signup, actual gateway routing, first binder/copy and wishlist/card writes, foreign ownership rejection, and atomic-operation 501 gates. Each run used a separate empty migrated PostgreSQL database. |
| Backend/domain tests | Full backend and Convex suites, shared types, strict server type checks and targeted rollback/conflict regressions. |
| Browser | Actual Chrome/Playwright exercises the configured parity suite, including durable intake after a committed response is lost and copy IDs surviving reload. |
| Shared API compatibility | 54 interactions across nine features. Production web/iOS/Android transports plus Express/Convex providers. API compatibility remains separate from UI and live-device evidence. |
| Android | Real Gradle/JDK/SDK compilation and JVM contract/backup tests where executed; Room's additive currency migration preserves unknown legacy currency. Device/UI qualification is distinct. |
| iOS | Swift source and new XCTest cases prepared; local verifier includes session, inventory, API and storage regressions. Linux cannot execute Xcode/SwiftUI or native hardware tests. |
| Deployment/public | Both Compose files parsed by the official Compose CLI; OpenAPI parsed and synchronized to marketing; production marketing build. This is not a running production-container or hosted-origin acceptance. |

Main repeatable commands:

```sh
npm --workspace=@tcg/api-types run build
npx prisma generate --schema backend/prisma/schema.prisma
npm --workspace=@tcg/backend test -- --runInBand
npm --workspace=@tcg/convex-backend run test:once
npm --workspace=@tcg/frontend test
npm run parity:generate
npm run parity:check
npm run api-contracts:test
npm run api-contracts:android
npm run parity:web
npm run verify:ios:local
npm run release:test
node --test tools/dev/*.test.mjs
npm --prefix marketing-site run build
```

The three integration scripts under `backend/src/integration/` document and enforce
their disposable/local prerequisites. The PostgreSQL workflow never points at
user data. Use the normal [API contract report](../mobile-parity/api-contracts/README.md)
and [parity report](../mobile-parity/README.md) to inspect stale, missing or scoped
evidence; never relabel a previous run after code changes.

## Explicit remaining qualification and product boundaries

The repository requires iOS regression/API/Maestro execution on a local Mac.
There is no GitHub iOS runner fallback. Before release, run the new tests on the
target simulator, then verify logout/server-switch races and recovery on the
actual iPhone. Camera recognition, biometrics, widget lifecycle and retained
photo restoration need their real device paths.

Signed-device app links and installed-browser PWA offline/update behavior remain
artifact- and deployment-bound checks in [release readiness](release-readiness.md).
Passing source, API or browser-demo checks does not replace them. Native ANN,
Core ML and OCR tuning controls retain their explicit browser limitations; they
are developer diagnostics rather than missing collector-facing equivalents.

Native binder-page saves persist the reviewed image bytes, positions, frozen
intake request and exact receipt before uploads continue. Pending saves can
resume after relaunch without adding the cards again. Page and image updates use
atomic revision checks; a changed page or an ambiguous lost image response opens
an explicit saved/current-page review. Keeping the current page preserves the
already committed inventory. Older servers without the revision capability keep
the pending save for a compatible server rather than silently ignoring the guard.

Phone-only decks/trades/activity retain their declared server requirement;
offline deck construction is not newly promised. Android has the typed atomic
sale transport and receipt but its unsafe standalone sale/delete flow is disabled
until a durable sale recovery UI is implemented; web and iOS provide that flow.
These limitations stay visible in the generated registry. No feature's parity
policy is weakened to make the checks pass, and no new feature is promoted based
on declarations or compilation alone.
