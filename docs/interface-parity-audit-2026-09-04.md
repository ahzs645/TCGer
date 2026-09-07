# Web, iOS, and Android interface audit

Audited September 4, 2026 against the current working tree, including existing uncommitted changes. This compares the TCGer web application, iOS application, Android application, and their data/API boundaries. It does not audit the public marketing site or a deployed production build.

**Conclusion:** matching screen names and the existing “implemented” declarations overstate parity. The largest gaps are Android collection data semantics and editing, backup/restore, search behavior, and the web scanner. Several differences can change or lose user data.

Evidence below is **source-confirmed** unless explicitly labeled otherwise. Reproduction steps are focused acceptance cases derived from the code, not claims that every case was executed on a device.

## Validation

- `npm run parity:check`: passed all 12 contract/reporter tests; 84 feature declarations and 108 control IDs validated.
- `npm run parity:web`: passed all seven Playwright smoke tests in 35 seconds. These run the local web app in demo mode.
- Native UI walkthroughs, physical-camera behavior, and authenticated production-server flows were not executed. An iOS simulator was not booted at inspection time.
- Focused Android tests passed: `CollectionBackupTest`, `DashboardStatsTest`, and `WishlistInputTest` via `testDebugUnitTest`; Gradle completed successfully in 52 seconds. The backup test validates JSON encode/decode, not the actual restore path, so its passing result does not contradict finding 1.

## Prioritized findings

### 1. P1 — Android backup restoration silently drops saved card condition and price

The backup serializes `condition` and `price`, but `importPortableBackup` only passes the card and quantity to `repository.addCard`. That method restores a binder default condition and leaves a new entry's price unset. The import can report success after losing both values. Acquisition price is omitted from the export schema altogether.

The importer also creates new binders and wishlists unconditionally. Reimporting the same file duplicates them, and a failure partway through can leave an incomplete import behind. iOS validates a whole backup and keeps a recovery point before replacement.

Evidence: [Android backup schema](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/backup/CollectionBackup.kt), [Android importer, line 197](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/AppViewModel.kt), [addCard, line 536](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/repository/DefaultTCGerRepository.kt), [iOS backup UI](../mobile-apps/ios/TCGer/TCGer/Views/LocalDataBackupView.swift).

Acceptance case: restore a backup containing two differently conditioned and priced cards; compare every field, then repeat the import and inject a mid-import failure. Define merge/replace behavior and make it recoverable.

### 2. P1 — Currency display and portfolio totals do not have shared semantics

Android's dashboard and binder totals call `asCurrency(preferences.currency)`, which changes the currency formatter without converting the numeric amount. A stored USD 100 becomes CAD 100 when CAD is selected. iOS's `CurrencyDisplay` applies a matching exchange rate, or retains the source currency when no valid rate is available. The web binder helper defaults to USD.

There is a second Android problem: live tracked quotes retain their native currency, but `PricePortfolio.totalValue` sums their amounts and the UI labels the result using the first card's currency. Mixed USD/EUR quotes therefore produce an invalid aggregate.

Evidence: [Android formatter, line 123](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/Common.kt), [dashboard, line 97](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/DashboardScreen.kt), [portfolio aggregation, lines 125–133 and 192](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/portfolio/PortfolioFeature.kt), [portfolio label, line 100](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/portfolio/PortfolioScreens.kt), [iOS conversion, line 272](../mobile-apps/ios/TCGer/TCGer/Services/CurrencyConversion.swift), [web formatter](../frontend/src/lib/format-money.ts).

Acceptance case: use fixed USD/CAD conversion data and a portfolio containing both USD and EUR quotes. All interfaces must either convert consistently or show separate currency totals.

### 3. P1 — Android local identity matching can combine cards from different games

`findOwnedCard` matches only binder ID and external card ID. Adding another game's card with the same external ID reuses the existing row ID and quantity, while overwriting its game/name/card metadata. Exact-print wishlist ownership also queries only external ID. This matters particularly with independently published game packages, whose identifiers need not be globally unique.

Evidence: [DAO identity and ownership queries, lines 43 and 52](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/local/TCGerDao.kt), [addCard, lines 538–556](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/repository/DefaultTCGerRepository.kt). By comparison, the Android search result merge already uses `tcg:id` in [AppViewModel, line 356](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/AppViewModel.kt).

Acceptance case: add cards from two games with external ID `001` to one binder, then create corresponding wishlist entries. Keep both collection entries and ownership counts separate. Apply a shared identity contract to every platform; iOS's local merge also warrants checking because its lookup compares `cardId` alone.

### 4. P2 — Android pack saves do not preserve individual copy identity in local mode

The pack-saving loop requests a copy ID for each pull, but local `addCard` merges duplicate printings into one `OwnedCardEntity` and returns the same ID. The local sealed-opening ledger then deduplicates those IDs. Two identical pulls, or pulls matching an already-owned card, cannot be tracked individually by that ledger.

iOS aggregates the card row while retaining distinct entries in `copies`; the web pack review adds pulls with quantity one to retain copy references. The parity matrix currently claims individual-copy ledger identity on Android, which this local path does not provide.

Evidence: [pack-save loop, line 540](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/AppViewModel.kt), [local insertion and ledger deduplication, lines 536 and 833](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/repository/DefaultTCGerRepository.kt), [iOS copy creation, line 1691](../mobile-apps/ios/TCGer/TCGer/Services/APIService.swift), [web pack review, line 190](../frontend/src/components/packs/pack-opening-review-sheet.tsx).

Acceptance case: open two packs containing the same printing, with another copy already owned. Each new physical copy must have its own identity and opening association.

### 5. P2 — Android binder browsing lacks the core inventory editor

Android's binder detail exposes binder editing, sharing, quantity labels, and card deletion. It has no card-edit action for quantity, condition, language, notes, purchase cost, tags, finish, grading, or sale details; no individual-card move action; and no bulk selection/actions. Its `OwnedCard` model cannot represent most of those fields.

Web and iOS have card/copy editors and collection operations. Android's separate server-only Library Operations tools do not replace the missing normal collection editor.

Evidence: [Android binder detail, lines 49–145](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/BinderDetailScreen.kt), [OwnedCard, line 111](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/domain/Models.kt), [repository interface](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/domain/TCGerRepository.kt), [iOS collection actions, line 905 onward](../mobile-apps/ios/TCGer/TCGer/Views/CollectionDetailView.swift), [web copy editor](../frontend/src/components/collections/sandbox/detail-panel.tsx).

Acceptance case: create a graded, tagged, priced copy on web; open, edit, move, and sell that same copy on each native client without dropping metadata.

### 6. P2 — Advanced search filters operate on different result universes

Web and Android filter their currently returned search results locally. Their ordinary server search uses the capped preview endpoint; changing a rarity, set, or stat filter does not request the full matching universe. Android package search additionally truncates results to 200 before applying UI filters. A matching card outside that initial batch cannot appear, and its set may not be selectable.

iOS explicitly fetches the selected set's cards or calls exhaustive search when detail filters are active. Thus the same query/filter can return a card on iOS and “no filtered matches” on web/Android.

Evidence: [web search/filtering, lines 92–138](../frontend/src/components/cards/card-search-panel.tsx), [preview/exhaustive API distinction](../frontend/src/lib/api/cards.ts), [Android local filters, line 65](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/SearchScreen.kt), [Android truncation, line 355](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/AppViewModel.kt), [iOS exhaustive/set branches, line 598](../mobile-apps/ios/TCGer/TCGer/Views/CardSearchView.swift).

Acceptance case: use a broad query with a rare matching printing beyond the preview cap, then apply its set/rarity filter on all three interfaces.

### 7. P2 — Opening an Android catalog card loses the selected printing

The shared Android `openCatalogCard` callback starts a new search using only `card.name`. It discards game, set, and external ID and leaves the current search-game filter intact. Selecting a card in Sets, Pokédex, or Guides can therefore show unrelated printings or no results under another game's existing filter. Search rows expose an Add dialog rather than the rich card/printing preview found on web and iOS.

Evidence: [Android callback, line 290](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/TCGerApp.kt), [Android search actions, line 129](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/SearchScreen.kt), [web card preview and print options](../frontend/src/components/cards/card-preview.tsx), [iOS set detail](../mobile-apps/ios/TCGer/TCGer/Views/SetDetailView.swift).

Acceptance case: leave Search filtered to Magic, then open a Pokémon card from a set. The exact Pokémon printing should open directly.

### 8. P2 — Wishlist automation and smart-folder organization are missing on Android

Web and iOS expose saved wishlist expansion rules and re-sync actions. Android's wishlist model and repository only support manually stored cards and basic wishlist options. An existing rule-based wishlist can be displayed as cards without its automation being visible or manageable.

Web and iOS also have smart-folder editors and matching logic; no equivalent Android model, editor, or navigation was found. These are separate capabilities from “browse/create wishlist” or “browse collections.”

Evidence: [web wishlist rules, line 734](../frontend/src/components/wishlists/wishlist-content.tsx), [iOS rules, line 151](../mobile-apps/ios/TCGer/TCGer/Views/WishlistDetailView.swift), [Android wishlist model, line 191](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/domain/Models.kt), [web smart folders](../frontend/src/components/collections/smart-folder-manager.tsx), [iOS smart folders, line 167](../mobile-apps/ios/TCGer/TCGer/Views/CollectionsView.swift).

Acceptance case: create an auto-updating wishlist and a condition/tag-based smart folder, then inspect and manage each on every interface.

### 9. P2 — Backup scope and formats are incompatible across interfaces

Android's “Export complete JSON backup” contains binders, wishlist cards, and sealed inventory in a top-level `formatVersion` envelope. It omits code-vault contents, transactions, preferences, opening history, and other user-created state. iOS's backup uses a different `format/schemaVersion/payload` envelope and includes substantially more data, including saved binder-page images. The two native importers do not share a portable contract.

Android offers CSV export but its import picker/parser accepts JSON backups only. iOS and web have collection CSV import workflows. No equivalent complete-data backup/restore UI was found in the web account settings.

Evidence: [Android backup schema](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/backup/CollectionBackup.kt), [Android labels and import, lines 393–419](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/SettingsScreen.kt), [iOS envelope, line 266](../mobile-apps/ios/TCGer/TCGer/Services/APIService.swift), [iOS backup scope](../mobile-apps/ios/TCGer/TCGer/Views/LocalDataBackupView.swift), [web CSV import](../frontend/src/components/collections/collection-import-dialog.tsx).

Acceptance case: export on one platform and restore on another using a fixture containing every user-data category. Until that works, describe exports by their actual scope and supported destination.

### 10. P2 — Android account management and server preference synchronization are incomplete

Android supports server verification and sign-in but has no discovered signup, profile-edit, password-change, or account-deletion interface/API path. Web and iOS expose richer account management. Android preferences are persisted locally; its main API interface has no `users/me/preferences` operations, while web and iOS read/write that endpoint.

This means settings can diverge between clients connected to the same account, beyond intentional device-specific settings such as camera or navigation configuration.

Evidence: [Android repository, lines 64–65](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/domain/TCGerRepository.kt), [Android settings/sign-in](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/SettingsScreen.kt), [Android local preferences](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/preferences/PreferencesStore.kt), [iOS profile/password UI](../mobile-apps/ios/TCGer/TCGer/Views/ProfileView.swift), [iOS preferences endpoints, lines 477 and 594](../mobile-apps/ios/TCGer/TCGer/Services/APIService+Settings.swift), [web preferences API](../frontend/src/lib/api/user-preferences.ts).

Acceptance case: change account-level display/game preferences on web and reload both native clients. Define which settings follow the account and which remain device-local.

### 11. P2 — The web scanner remains a materially different workflow

The web has still-image scanning, local video recognition, shared sessions, and session review, but no equivalent complete binder-page capture/review/photo-retake workflow, manual corner correction, torch control, automatic result-opening setting, or scan-session pricing mode was found. Native interfaces have explicit controls/workflows for these capabilities. Several debug recording and performance controls also remain native-only.

These gaps are already partly recorded, but the product should distinguish browser limitations from unimplemented workflows. Browser torch support can be capability-gated; binder review and crop correction need their own implementations.

Evidence: [web scan entry points](../frontend/app/scan/page.tsx), [web still scanner](../frontend/src/components/scan/card-scan-panel.tsx), [native scanner controls](../mobile-apps/ios/TCGer/TCGer/Views/ScannerSessionControls.swift), [Android scanner controls](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/ScannerControls.kt), [granular scanner matrix](../mobile-parity/SCANNER_PACK_MATRIX.md).

Acceptance case: scan a binder page, correct one crop, replace the page photo, review prices, and save selected cards using the same fixture on all three platforms.

### 12. P2 — Parity checks validate declarations much more than behavior

Only seven of 84 feature records are parity-required. The current web suite's “cards can be searched” test checks a heading and textbox without typing a query or verifying a result. The native search flow similarly asserts screen visibility. Backup fidelity, per-copy editing, money conversion, wishlist rules, and filtered-result completeness are outside these checks.

Documentation also contains stale claims. The root README calls Android a placeholder. The scanner matrix says Android Automatic is server-first, but the current dispatch selects a local embedding model for Automatic before the repository reaches the server request. The pack matrix claims individual-copy ledger preservation despite finding 4.

Evidence: [generated report](../mobile-parity/REPORT.md), [web search smoke, line 59](../frontend/tests/parity/feature-parity.spec.ts), [native search smoke](../mobile-parity/maestro/flows/cards-search.yaml), [Android local dispatch, line 10](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/model/LocalEmbeddingDispatch.kt), [scanner/pack matrix](../mobile-parity/SCANNER_PACK_MATRIX.md), [root README](../README.md).

Acceptance case: add shared fixtures and behavioral cases for the first eleven findings. Record platform + local/server mode separately, and reserve “verified” for executed behavior rather than presence of a source file.

## Suggested implementation order

1. Protect stored data: faithful and recoverable backup import, game-scoped identity, distinct physical-copy records, and currency-safe totals.
2. Complete Android's normal collection editor and exact-card navigation; unify exhaustive filtered search.
3. Port wishlist rules, smart folders, account flows, and the agreed preference-sync contract.
4. Complete web scanner workflows using capability checks where browser hardware APIs differ.
5. Expand the parity contract and behavioral tests alongside each change; update stale documentation from verified evidence.

Matching iOS, Material, and web styling is not a requirement. Matching the meaning of a card, copy, price, filter, save operation, and backup is.
