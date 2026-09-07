# Android compared with iOS: setup, options, usability, and polish

Reviewed September 5, 2026 against the current working tree, including existing uncommitted parity work. This is a source-based product review, not a walkthrough of installed release builds. No application source was changed.

Implementation follow-up: [Android product improvements](android-product-improvements-2026-09-05.md). The findings below describe the pre-implementation snapshot.

Android already contains most major product areas. Its remaining gaps are concentrated in onboarding, finding and managing cards, capability-aware navigation, settings depth, and the quality of individual interactions. Finish these journeys before adding more top-level screens.

## Evidence and limits

- Read both native app shells, setup/settings, collection/search, account, pricing, scanner controls, platform configuration, and existing parity documents.
- `npm run parity:check` passed: 12 tests; 91 feature declarations and 108 controls validated. These checks establish contract consistency, not native usability or complete feature equivalence.
- XcodeBuildMCP reported zero available iOS simulators. `adb devices -l` reported no Android devices. No native builds, UI tests, touch walkthroughs, screenshots, physical-camera tests, or authenticated server changes were performed in this review.
- **Confirmed** below means directly supported by current source. **Device check** marks an interaction/layout consequence that still needs execution. Recommendations are product judgments.
- The [September 4 audit](interface-parity-audit-2026-09-04.md) predates much of the current work. Its [implementation follow-up](interface-parity-implementation.md) should be read alongside it; those earlier missing-feature claims must not be repeated wholesale.

## Setup and options

| Area | Current difference | Android acceptance target |
|---|---|---|
| First launch | **Confirmed:** iOS has an explicit local/server choice, restore entry, optional catalog setup, and sample-data choice. Android defaults to local mode with Pokémon, Magic, and Yu-Gi-Oh! enabled, without an equivalent guided setup. | Offer Start on this device, Connect to server, and Restore backup, followed by game choices and a clear route into the app. Keep downloads optional where possible. |
| No active games | **Confirmed:** Android replaces its entire navigation with installation when no games are enabled and no packages are installed. Settings, server configuration, and backup import are then unreachable. iOS also has a restrictive no-games gate after setup. This is conditional, not Android's normal fresh-install default. | From the no-games state, reach Settings, restore, and connection setup even if the store is offline. |
| New/public servers | **Confirmed:** iOS checks whether initial administrator setup is required and supports public/single-user access decisions. Android's normal connection path verifies health, then requires a token for repository server operations. No equivalent initial-admin setup path was found. | Test a fresh server, authenticated server, and no-login/public server. Show the appropriate setup or access flow for each. |
| Game/catalog choices | **Confirmed:** both have package installation and enabled/default games. iOS additionally exposes a Sealed Products download/feature switch; no equivalent Android preference was found. Android's “Community game libraries” copy exposes `HTTPS GamePackageManifest` and checksum terminology. | Separate game availability, offline downloads, and scanner downloads clearly. Add the sealed-data choice and use publisher/library language in ordinary screens. |
| Currency | **Confirmed:** Android exposes USD, CAD, EUR, GBP chips. iOS has searchable currencies, rate/date/source details, refresh, and error state. Currency conversion has already been added to Android; it is not still merely relabeling USD. | Select any supported currency and inspect the rate used, its age, and fallback behavior offline. |
| Local pricing | **Confirmed:** iOS exposes personal JustTCG-key setup and condition/language preferences. Android's local source list contains Best available and Scryfall; the equivalent personal-key workflow was not found. Its local “Test active source” returns success with zero latency without a network test. | Define supported local providers, port the needed configuration, and distinguish a configured provider from a successfully tested live connection. |
| Maintenance/help | **Confirmed:** iOS has sample-data load/remove, reset settings, erase local cards/binders, Privacy Policy, Support, and version information. Android Settings has navigation reset, cache clearing, backup/recovery and account deletion, but no equivalent complete set of these maintenance/help actions was found. Its footer says “Android parity build …”. | Add real app/build information and support/privacy destinations; give reset preferences, erase local collection, and delete server account distinct names and scopes. Sample data is optional, lower priority. |

Sources: [iOS setup](../mobile-apps/ios/TCGer/TCGer/Views/ServerSetupView.swift), [iOS root](../mobile-apps/ios/TCGer/TCGer/Views/RootView.swift), [Android preferences](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/preferences/PreferencesStore.kt), [Android shell](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/TCGerApp.kt), [Android package screens](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/CommunityGamePackages.kt), [Android repository](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/repository/DefaultTCGerRepository.kt), [Android Settings](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/SettingsScreen.kt), [iOS Settings](../mobile-apps/ios/TCGer/TCGer/SettingsView.swift), [iOS currency](../mobile-apps/ios/TCGer/TCGer/Views/CurrencySettingsView.swift), [Android pricing](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/feature/settingsparity/SettingsParityFeature.kt), [iOS pricing](../mobile-apps/ios/TCGer/TCGer/Views/PricingSourceSettingsView.swift).

## Highest-priority everyday improvements

### 1. Make an installed game's cards searchable under its normal game filter

**Confirmed source defect:** Android builds ordinary game chips such as `pokemon` and separate package chips such as `package:pokemon`. The search merger includes installed package cards only when the selected filter is All or matches a `package:` ID. Selecting ordinary Pokémon excludes those packages. In local mode, the repository branch searches owned cards only.

Thus a downloaded Pokémon card that is not already owned can appear under All/the package chip and disappear under the ordinary Pokémon chip. Setting Pokémon as the default game can expose this immediately.

**Acceptance:** on an empty local collection, install a Pokémon package and search for a known card. All, Pokémon, and the relevant publisher filter must return the appropriate installed result. Repeat with a default game and with a community package whose package ID differs from its game ID.

Also add explicit **All Cards / My Collection** scope, which iOS provides. Android's subtitle and no-results guidance currently imply local mode is only saved cards and recommend a server even though package search exists.

Evidence: [Android search chips/copy](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/SearchScreen.kt), [search merger](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/AppViewModel.kt) (`runSearchDebounced`), [local search](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/repository/DefaultTCGerRepository.kt) (`searchCards`), [iOS scopes](../mobile-apps/ios/TCGer/TCGer/Views/CardSearchView.swift).

### 2. Finish binder browsing and simplify copy editing

**Confirmed:** Android binder detail lists copies and provides editing, bulk actions, deletion, sharing, and binder editing. It does not expose in-binder search, sorting, inventory filters, or a grid/list choice. iOS collection detail has search, sorting, condition/tag filters, and richer grouping/presentation.

Each Android row places a checkbox, “Edit copy,” quantity, and delete control alongside the card image and text. **Device check:** expect pressure on title space at narrow widths and large text; measure rather than treating clipping as already observed.

The copy editor is a long dialog mixing ordinary metadata, grading, all destination binders, extra copies, and sale recording. Condition/language are free text; users see “Finish code,” comma-separated tags, and “Acquired at (ISO date/time).” Use a dedicated editor with normal pickers, numeric keyboards, a date picker, and expandable advanced details. Put sale recording in its own action.

Single-copy deletion directly calls removal, with no confirmation or undo in that path. Add undo or an explicit confirmation. Empty binders should offer Add card and Scan directly rather than only instructing users to visit Search.

**Acceptance:** locate a card in a 500-copy binder, filter by condition/tag, edit its language/cost, move it, and recover from accidental deletion. Run at 200% text size on a narrow phone.

Evidence: [Android binder detail](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/BinderDetailScreen.kt), [copy editor](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/CollectionCopyEditor.kt), [shared card row](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/Common.kt), [iOS collection detail](../mobile-apps/ios/TCGer/TCGer/Views/CollectionDetailView.swift).

### 3. Make navigation reflect what users can actually do

**Confirmed:** Android filters Pokédex availability in its shell, but does not similarly remove Decks, Trades, and Activity in local mode. Those features then show server-required states. iOS centrally excludes server-only tabs locally. Android also exposes Server access controls to any signed-in user; iOS checks administrator status before showing those controls. This is a UI gating finding, not a claim that backend authorization can be bypassed.

Android defaults every destination to visible. Search and scanner are outside the first four entries; the exact first four vary with Pokédex availability. Settings customization is useful, but the initial arrangement asks new users to navigate a large More list.

The shell also redirects away from any destination hidden from navigation. **Device check:** hide Scan, then tap Home's Scan action; the route logic predicts a return to a visible tab. Hiding a tab should not unintentionally disable valid contextual actions.

**Acceptance:** make local/server/role availability consistent in navigation and customization. Preserve preferences across mode switches. Test contextual actions when their tab is hidden. Choose a simpler default centered on collection, search, and scanning.

Evidence: [Android shell](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/TCGerApp.kt), [navigation model](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/domain/Models.kt), [Android Settings](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/SettingsScreen.kt), [iOS tab availability](../mobile-apps/ios/TCGer/TCGer/Services/EnvironmentStore.swift) (`isTabAvailable`).

### 4. Make backup transfer reviewable and resilient to interruptions

**Confirmed:** Android now has portable JSON, CSV import/export, recovery snapshots, and substantially richer metadata preservation. Its import picker immediately sends the file contents to the importer; there is no UI preview/summary before applying it. iOS validates and presents a summary before its explicit replacement operation. Android's merge behavior is intentional and should be explained, not changed merely to imitate iOS.

**Device check:** Settings holds pending export text in plain `remember`. Biometric locking replaces `TCGerApp` with the lock screen on backgrounding, removing its composition. File pickers, activity recreation, and returning from authentication therefore need focused testing for lost export payloads, navigation, and editor drafts. This review did not reproduce data loss.

**Acceptance:** preview counts, destination, merge semantics, and recovery scope; cancel without writes. Export/import a large backup through the system picker with app lock on, rotate, return, and verify a nonempty faithful file. Preserve nonsensitive drafts across recreation.

Evidence: [Android transfer UI](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/SettingsScreen.kt), [Android lifecycle/lock](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/MainActivity.kt), [iOS backup UI](../mobile-apps/ios/TCGer/TCGer/Views/LocalDataBackupView.swift).

## Polish and platform integration

- **Theme correctness — confirmed:** choosing Blue on Android 12+ selects wallpaper-derived dynamic colors. Expose System colors separately from an actual Blue option. Custom accents replace primary/secondary only; check the full palette, contrast, and dark mode before considering this finished. [Theme](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/theme/Theme.kt).
- **Card viewing — confirmed:** Android's catalog detail is a scrollable alert with a fixed-height image, raw attribute keys, and printing buttons. Give card artwork an intentional aspect ratio, a readable detail hierarchy, and zoom/fullscreen inspection. Shared artwork has no explicit loading/error painter for failed non-null URLs. Visual sizing/failure behavior needs device checks. [Detail](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/CatalogCardDetailDialog.kt), [artwork](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/ui/screens/Common.kt).
- **Settings hierarchy — recommendation:** group Account & connection, Appearance, Collection, Games & downloads, Scanner, and Data & backup into navigable sections. Keep developer diagnostics behind developer access; server scan debug captures currently appears for every signed-in user. Use short summaries of current values.
- **Accessibility/adaptive layout — device checks:** test TalkBack names for copy selection and switches, large text, keyboard/IME actions, landscape, tablets, dark mode, reduced animation, image failures, and long translated labels. The top-level Android shell uses a bottom bar without an adaptive rail branch. This is not evidence that every screen is inaccessible.
- **Platform entry points — confirmed missing from inspected Android configuration:** no App Links intent filters, widget receivers, or launcher-shortcut declarations/implementation were found. iOS has universal-link/App Shortcut code and a widget target. Port useful Scan/Search/Binder entry points after core navigation is reliable. [Android manifest](../mobile-apps/android/app/src/main/AndroidManifest.xml), [iOS shortcuts](../mobile-apps/ios/TCGer/TCGer/Intents/TCGerAppShortcuts.swift).
- **Session storage — release setup gap:** Android stores its token as an ordinary DataStore string; backup rules exclude scanner recordings/images but not that preference file. The Android README already calls for Keystore-backed storage before production. Separate credentials from portable/device-backup data and verify restore behavior. This review did not inspect or expose any actual credentials. [Preferences](../mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/preferences/PreferencesStore.kt), [backup rules](../mobile-apps/android/app/src/main/res/xml/backup_rules.xml), [README](../mobile-apps/android/README.md).

## What is already present

Do not schedule these as entirely missing: account signup/profile/password/deletion, appearance and biometric lock, navigation customization, binder/copy editing and bulk actions, smart folders, wishlist rules, exact-card preview, sets/Pokédex/guides, sealed inventory/history, code vault, finance/prices/analytics, server social screens, portable backups/CSV/recovery, and substantial scanner/pack workflows. Presence does not establish identical options or runtime quality.

The scanner already exposes manual/automatic/photo/bulk capture, binder review/photos, torch, crop correction, session review/pricing, engine choices and diagnostics. Its language picker exists, but local OCR explicitly supports Latin scripts only. The [scanner matrix](../mobile-parity/SCANNER_PACK_MATRIX.md) still tracks deeper diagnostic/reference/recording differences and iOS performance experiments; prioritize recognition quality and recovery over duplicating experimental toggles.

## Suggested walkthrough and implementation order

1. **Setup and finding cards:** fresh local install, restore, no-games/offline escape, fresh/existing server, package search under normal game filters.
2. **Daily collection work:** binder search/sort/filter, card preview, add/scan, copy editing, move, sale, deletion recovery, wishlist rules.
3. **Settings and navigation:** mode/role gating, hidden-tab actions, currencies/rates, local pricing setup, download controls, app information/support.
4. **Interruption and device polish:** locked-app file picker, rotation/draft retention, TalkBack/large text, camera permission denial, background/resume, offline image/download failures.
5. **Platform completion:** secure session persistence and backup exclusions, links/shortcuts/widgets, tablet layouts, measured startup and scanner performance.

Use the same small sample collection on both devices and repeat the main journeys in local and server modes. For visual review, capture matching empty, populated, loading, error, and large-text states. Record each result as executed/pass/fail separately from the source evidence above.
