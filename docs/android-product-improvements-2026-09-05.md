# Android product improvements — September 5, 2026

Implementation follow-up to the [iOS comparison](android-ios-product-review-2026-09-05.md). Changes build on the existing uncommitted parity work. This report distinguishes implemented behavior from device verification; it does not claim complete iOS parity or release readiness.

## Delivered

| Journey | Android changes |
|---|---|
| First launch | Explicit on-device, server connection, and restore choices; optional game selection; navigation remains available with no active games. Existing users are not forced through onboarding again. Home points empty collections toward binders and game libraries. |
| Finding cards | Ordinary game filters include installed libraries for that game, including differently named publisher packages. Separate All cards and My collection scopes. Search content scrolls at large text sizes. |
| Binder inventory | Search, name/number/value/condition sorting, condition/tag filters, grid/list layouts, explicit selection mode, direct Add and Scan actions, and confirmation before individual copy removal. Read-only public binders hide mutation controls. |
| Copy editing | Dedicated scrollable editor with condition/language/binder choices, numeric amount keyboards, date selection, tag chips, expandable grading/advanced fields, separate sale recording, and discard confirmation. Draft values use saved state. |
| Navigation | Home, Binders, Search, and Scan prioritized for new users. Server-only destinations disappear in local mode. Explicit server feature flags are respected. Hidden navigation items remain reachable through valid contextual actions. Reordering skips unavailable entries. Wide layouts use a rail; large text reduces bottom-bar density. |
| Settings | Separate Account & connection, Appearance, Collection display, Games, Security, Scanner, Data & storage, and About sections with current-value summaries. Real version/build, support/privacy links, reset-display options, and separately confirmed local cards/binders erasure with recovery. Developer diagnostics and administrator controls are gated. |
| Currency and pricing | Searchable currency choices; rate, date, source, refresh and fallback status. Optional encrypted personal JustTCG key, connection test and condition/language preferences. Explicit local Prices refresh requests exact printing/variant quotes, with Scryfall fallback for eligible Magic printings. Unmatched values retain their saved prices and show a warning. |
| Backup transfer | JSON/CSV selection validates and stages private payloads before a counts/destination/merge review. Import requires confirmation and rejects a changed destination. Export payloads survive ViewModel recreation using private files rather than large saved-state strings. Existing import recovery remains in place. |
| App interruptions | Lock overlay preserves navigation and drafts while suspending lifecycle-bound work. A consumed app link is not replayed when the activity is recreated. |
| Appearance | Actual Blue is separate from System/wallpaper colors. Custom accents set coordinated light/dark component colors. Card artwork uses its aspect ratio, explicit loading/error artwork, and fullscreen zoom/pan inspection. |
| Platform integration | Scan/Search launcher shortcuts; a two-action home-screen widget; custom-scheme and HTTPS handlers for search, scanner, binders and wishlists. Sessions migrate to Android Keystore-backed AES-GCM encryption. Credential-bearing preferences are excluded from OS backup/device transfer. |

## Verification

Built using JDK 17 and the repository Gradle wrapper. A dedicated Pixel 7 API 34 arm64 emulator was created for this review; no real account or collection was used.

- `testDebugUnitTest`: **188 tests, 187 passed, 1 skipped, 0 failed**. Coverage includes game/package selection, owned-card scope, same-copy filters, number sorting, navigation availability, authenticated encryption failure behavior, exact pricing matches, and trusted link parsing, alongside existing tests.
- `assembleDebug` and `assembleDebugAndroidTest`: passed.
- Focused emulator tests: **7 passed**. Binder search/filtering, removal confirmation/cancel, dedicated copy editing, export payload recreation, import review recreation/destination rejection, explicit import confirmation, and app-link activity recreation passed.
- Manual first-launch walkthrough: welcome → on-device → deselect all games → Home passed. Settings and navigation remained accessible. Local More excluded Decks, Trades, and Activity.
- Manual app-link walkthrough: `tcger://search?q=Pikachu` opened Search and populated its query.
- Large-text inspection exposed bottom-bar crowding and non-scrolling Search content; both were corrected. Activity recreation after an app-link launch exposed link replay, also corrected.
- `npm run parity:check`: 12 tests passed; 91 feature declarations and 108 controls validated across three platforms. This validates registry consistency, not complete product equivalence.
- `git diff --check -- mobile-apps/android`: passed.

Tests: [collection workflows](../mobile-apps/android/app/src/androidTest/java/com/ahmadjalil/tcger/ui/ProductWorkflowTest.kt), [backup transfer](../mobile-apps/android/app/src/androidTest/java/com/ahmadjalil/tcger/ui/BackupTransferTest.kt), [app-link recreation](../mobile-apps/android/app/src/androidTest/java/com/ahmadjalil/tcger/ui/AppEntryPointTest.kt), [product logic](../mobile-apps/android/app/src/test/java/com/ahmadjalil/tcger/ui/AndroidProductReviewTest.kt).

## Remaining work and release checks

1. **Server access:** first-administrator setup and read-only public collection loading are implemented, but need live integration against fresh/existing servers and administrator/non-administrator accounts. Full no-login single-user mutation parity remains unfinished; authenticated feature repositories still expect a session token. Public browsing must not be presented as full no-login support.
2. **Pricing:** no personal API key was used and no billable pricing request was made. Verify provider entitlement, live rate limits, variant coverage, and fresh/offline currency metadata with the intended account. Quote selection is conservative and the request cache lasts only for one refresh.
3. **Biometric/file-picker acceptance:** transfer-state recreation is tested independently. Complete the full system document-picker → lock → unlock journey with a large populated backup and real biometric hardware; verify restored drafts and exported bytes. The lock/lifecycle changes are not a substitute for that device check.
4. **HTTPS verification:** the manifest handles links, but verified production App Links require the release signing SHA-256 in the hosted `/.well-known/assetlinks.json`. No signing credentials or website deployment were changed. Launcher/widget placement and lifecycle need host-launcher QA.
5. **Accessibility and adaptive QA:** complete TalkBack, larger binder fixtures, landscape/tablet/foldable layouts, dark-mode contrast, keyboard navigation, translated labels, and camera-permission/background recovery. Current emulator checks are a limited sample.
6. **Optional parity:** sample-data load/remove is not added. The sealed-products setting controls feature visibility; it is not a separate sealed-data download manager. Scanner recognition/diagnostic depth, measured startup/thermal performance, release signing, and store work remain tracked separately.

The debug APK is generated at `mobile-apps/android/app/build/outputs/apk/debug/app-debug.apk`. Changes are uncommitted for review.
