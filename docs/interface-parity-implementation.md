# Interface parity implementation

September 4, 2026. Follow-up to [the audit](interface-parity-audit-2026-09-04.md). Changes are in the working tree; existing unrelated scanner, catalog and artwork changes were preserved.

## Changes by finding

| Finding | Implemented behavior |
|---|---|
| 1. Android backup fidelity | Condition, price, acquisition cost and all copy details survive import. Validation precedes writes; Room merges are transactional. Imports save a recovery snapshot and an on-disk journal; startup restores interrupted imports. Recovery also covers preferences, transactions, codes and saved binder photos. |
| 2. Currency | Android converts USD amounts using cached rates when available and otherwise keeps the source currency. Portfolios and scanner sessions separate mixed-currency totals. Sale cost basis is explicitly entered in the sale currency. |
| 3. Game identity | Android and iOS local ownership lookup/merging use game plus printing ID. Android local search/discovery also retain identical IDs from different games. Printing ID case is preserved. |
| 4. Physical copies | Android additions create one identity per physical copy. Room v3→v4 splits existing stacks while retaining the original ID and metadata. Pack saves can consequently retain distinct copy associations. |
| 5. Android inventory editing | Copy editor supports condition, cost, language, notes, serial/date, finish, tags, grading, storage and variant flags; move, additional copies, sales and bulk operations are available. Server market quotes remain read-only. Bulk retries resolve current copy locations. A successful sale followed by failed removal reports that the sale was saved instead of inviting a duplicate sale. |
| 6. Filter completeness | Web and Android use the exhaustive printing-search endpoint; Android no longer discards package results after 200. Web filters see the full fetched result set and renders results in pages of 48. The shared server search still has its explicit 1,000-result limit. |
| 7. Exact Android navigation | Catalog navigation opens the chosen game/printing directly. Search provides a detail view and exact-printing selector. |
| 8. Rules and folders | Android exposes wishlist expansion-rule editing/sync and smart folders. Condition and tag rules on all interfaces match the same physical copy. Legacy iOS folder names normalize to portable rule codes. Smart folders remain locally scoped; backup transfer carries them between interfaces. |
| 9. Portable backups | Shared v2 JSON supports collections/copies, wishlists/rules, sealed inventory and extension sections. Readers accept legacy Android/iOS envelopes. Android CSV import handles quoted and multiline fields. Web account settings provide reviewed import, export and recovery, backed by durable IndexedDB or authenticated Convex transactions. See the exact scope below. |
| 10. Android accounts | Signup, profile, password and deletion interfaces and API calls added. Supported account preferences read/write the shared preferences endpoint; device theme, currency, navigation and credentials remain device-local. |
| 11. Web scanning | Camera and binder workbench supports capability-gated torch, automatic consensus capture, auto-open, server/local engines, grid/YOLO regions, draggable/numeric corners, printing correction, per-currency prices, copy-save checkpoints, saved-page photo review and replacement. Developer recording includes crop images, run import/export/delete and production-engine replay reports. |
| 12. Behavioral evidence | Shared portable fixture, Android/Swift regression cases, host SQLite migration test and four additional browser workflows added. The search smoke now types a query and checks its result. The contract tracks 91 features and keeps declarations separate from execution evidence. |

## Backup scope and recovery

Common inventory fields are restored into each platform's inventory. Transactions, online codes, smart folders, preferences and binder-page photos are restored where the interface supports those categories. Unsupported extension sections remain in subsequent exports. Web-only deck/trade records also restore into the web local store after structural validation; hosted backups include decks, sealed opening ledgers and price alerts. Copy-image archives are retained; native attachment editing/restoration is not equivalent to the hosted photo workflow.

These are portable inventory/document backups, not account/database clones. They exclude credentials, authentication sessions, downloaded catalogs and caches. Scanner recordings have their own export/import. They do not recreate shared-account relationships, trade counterparties, share links, every server audit/history record or every platform's internal scanner state.

Android, web local and hosted imports merge matching stable IDs and preserve unrelated records. iOS keeps its existing explicit replace-library import behavior. Each saves a recovery point before changing covered data. Hosted imports use an optimistic snapshot check and one mutation so concurrent edits or late validation errors cannot commit a partial import. Server recovery covers the exported categories, not unrelated account activity.

Hosted transfer is available on the unified Convex backend. The hybrid backend returns an explicit unsupported-mode message instead of exporting a different data source. Hosted exports cap each indexed category at 1,500 records and imports enforce an atomic write budget; oversize transfers fail explicitly. Image uploads have a 48 MB document limit. Large installations still need a paginated backup protocol before these limits can be removed safely.

## Validation

- Web unit tests: passed, including backup, currency, collection and scanner logic.
- Browser parity: **11/11 passed**. Includes repeated import/export/reload, a filtered printing after 300 preview results, persisted corner correction, and saving a copy plus reopening/re-saving its binder photo.
- Convex: **92/92 tests passed**, including repeated import, late-failure rollback, recovery and user isolation. TypeScript checked separately; functions pushed to the anonymous **local development** deployment on port 3210.
- Android: **178 unit tests passed, 1 skipped**; real host SQLite executed the shipped migration against the exported v3 schema and verified copy metadata and the game-scoped wishlist index.
- iOS: generic simulator **build-for-testing succeeded**, including new portable-fixture and pre-validation tests. This compiles tests; it does not execute them.
- Parity contract generator/checks: passed. Generated reports consume actual browser JUnit; new native behaviors are not marked verified from source or build results alone.

## Remaining verification and implementation limits

No Android device was connected. Xcode exposed generic build destinations but no runnable simulator destination. Native UI, camera/torch, real image recognition, account-service integration and native backup fixture execution still need device runs. Network response-loss after a server write cannot be made fully idempotent by a client checkpoint alone; a shared server idempotency protocol remains necessary for that failure case.

The scanner matrix still tracks engine-specific experimental A/B switches that are not implemented on every runtime. Model preload is operational in the new web workbench; this change does not claim that every native ANN, orientation or OCR experiment has a browser/Android equivalent. See [the granular scanner matrix](../mobile-parity/SCANNER_PACK_MATRIX.md).
