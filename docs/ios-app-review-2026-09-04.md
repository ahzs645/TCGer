# iOS app review — September 4, 2026

Reviewed the current working tree, including existing uncommitted changes. App source was not changed during this review.

## Fixes verified — September 5, 2026

The four confirmed issues have been addressed in the working tree. The original findings below describe the pre-fix behavior.

| Area | iOS | Web local mode | Android | Hosted backends |
| --- | --- | --- | --- | --- |
| Game-scoped identity | Move lookup and returned destination now include the game. | Regression covers two games sharing an external ID; metadata fallback is also game-scoped. | Existing copy-based moves retain identity. | Fixed self-hosted card resolution so adds, bulk adds, library adds, and printing changes use the resolved game-scoped card ID. Convex already resolves by game. |
| Tag clearing | Explicit empty selections clear tags; omitted selections preserve them. Copy and entry scopes are tested. | Tags now survive row conversion and are persisted on add/update; explicit empty PATCH clears them. | Existing edit payload and local copies support empty tags. | Existing explicit tag-clearing paths were retained. |
| Metadata retention | Ordinary edits, adds to existing entries, and moves preserve the whole card value. New cards and printing changes copy catalog metadata. | Full catalog metadata is persisted on printing rows and survives moves/reloads; copy image URLs are preserved too. | Existing local edits copy the stored entity rather than rebuilding its card identity. | Ordinary edits retain separate card records; sparse self-hosted refreshes retain extended metadata. |
| Search ordering | A shared request owner cancels superseded searches/Discover requests and discards late completion. | Package search and Discover discard stale responses/errors. Normal search remains query-keyed. | Search and Discover share cancellation and generation checks; cancelled requests cannot surface an error or clear a newer loading state. | Search response ordering is handled by each client. |

Also corrected an Android compile error in tab customization: the removed `interfaces.pokedex` property is now queried through `supportsFeature("pokedex")`.

Executed verification:

- iOS simulator build and **22 tests passed**: `LocalCollectionMutationTests`, `LatestSearchRequestTests`, and `LocalStorePersistenceTests`.
- Android build and **10 tests passed**: `LatestSearchRequestTest` and `PortableParityTest`.
- Web **68 tests passed** across search ordering, collection rules, REST adaptation, metadata conversion, and persisted store behavior. Frontend TypeScript and focused ESLint checks passed.
- Convex **12 tests passed** covering collection semantics and audit behavior.
- Self-hosted backend **22 tests passed**, including the new identity regression tests, bulk-add tests, and existing collection/tag contracts. Backend TypeScript check passed.
- Shared API types build and `git diff --check` passed.

These are automated build/unit/contract checks, including a simulator-hosted iOS test run. The interactive walkthrough, physical-camera checks, and optional onboarding/hidden-tab product decisions below remain separate work. No deployment or production data migration was performed.

## Validation

- Passed: `xcodebuild -project mobile-apps/ios/TCGer/TCGer.xcodeproj -scheme TCGer -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`.
- Build log: `/tmp/tcger-ios-review-build.log`. Compiler warnings include redundant `await` expressions in `APIService+Cards.swift`.
- Findings below are derived from code inspection, not executed UI reproductions. No simulator was booted; unit tests, interactive navigation, authenticated server flows, and physical-camera behavior were not exercised.

## Fix first

### 1. High: moving cards can merge different games

In local mode, adding a card matches both card ID and game, but moving a card matches the destination using only `cardId`. If two games or independently published packages share an ID, moving a copy into the other card's binder appends it to the wrong card. The returned destination lookup has the same problem.

Evidence: [move merge and return](../mobile-apps/ios/TCGer/TCGer/Services/APIService.swift#L1991); compare [add identity check](../mobile-apps/ios/TCGer/TCGer/Services/APIService.swift#L1852).

Reproduction to run: create two cards with ID `001` from different games in separate binders; move one into the other's binder. Expect two separate entries with their original copy IDs and metadata. Also verify that moving an identical printing from the same game still merges correctly.

Suggested fix: use the same game-scoped identity for both destination lookups and add a local-store regression test.

### 2. Medium: removing every tag preserves the old tags

The local card editor resolves the selected tags, but copy reconstruction uses `selectedTags.isEmpty ? copy.tags : selectedTags`. An explicit empty selection therefore means “keep existing tags.” If tags are the only change, the surrounding update condition can skip the copy update altogether.

Evidence: [copy update condition and tag assignment](../mobile-apps/ios/TCGer/TCGer/Services/APIService.swift#L2084).

Reproduction to run: tag a card, edit it, deselect every tag, save, and reopen it. Repeat for an individual copy and an entire card entry.

Suggested fix: distinguish an omitted tag update from an explicitly empty tag list. Test clearing, replacing, and leaving tags unchanged.

### 3. High: editing can discard extended card metadata

`replaceCard` constructs a new `CollectionCard` using a subset of its fields. It does not preserve `baseExternalId`, functional identity, printing metadata, legality, Pokédex data, and other optional properties. These properties default to nil. Normal copy edits call this helper, and add/move paths also reconstruct partial card records.

This matters for cards carrying this metadata, such as restored collection records: any-printing wishlist ownership reads `baseExternalId`, and collection grouping reads functional identity. A routine edit can change how the same card is counted or grouped.

Evidence: [replacement helper](../mobile-apps/ios/TCGer/TCGer/Services/APIService.swift#L2792), [full model](../mobile-apps/ios/TCGer/TCGer/Models/TCGModels.swift#L703), [ownership aggregation](../mobile-apps/ios/TCGer/TCGer/Services/APIService.swift#L3061).

Reproduction to run: restore a card with populated identity and printing fields, edit one copy's condition, then export it. Compare all card-level fields and any-printing wishlist ownership before and after. Repeat after moving and adding another copy.

Suggested fix: centralize copy-preserving card reconstruction and test metadata retention for ordinary edits, adds, and moves. Printing changes need deliberate replacement of printing-specific fields.

### 4. Medium: an older search can replace newer results

Search submission, scope changes, and filter changes start independent tasks. `performSearch` updates shared result, error, and loading state after awaits without cancellation or a request-generation check. A slower earlier request can finish after a later request and overwrite its results; it can also end the loading indicator while another search is still running.

Evidence: [search triggers](../mobile-apps/ios/TCGer/TCGer/Views/CardSearchView.swift#L193), [scope changes](../mobile-apps/ios/TCGer/TCGer/Views/CardSearchView.swift#L264), [async search](../mobile-apps/ios/TCGer/TCGer/Views/CardSearchView.swift#L547).

Reproduction to run: delay query A, submit query B, allow B to finish first, and then release A. Repeat while changing between All Cards and My Collection. Results, errors, and loading state must belong to the latest request.

Suggested fix: capture each request's query/scope/filters, cancel superseded work, and guard all state commits with the current request identity.

## Product improvements to evaluate in the walkthrough

- Keep Settings and backup restoration reachable when no games are enabled or installed. `RootView` currently replaces the main app with an installation screen whose only action opens the Game Store.
- Decide whether hiding a tab should also prevent opening it through a widget or shortcut. The app shell currently requires the destination to be in the visible tab list. Hiding navigation and disabling a feature may deserve separate behavior.
- Prioritize collection correctness before visual polish: identity, metadata retention, tag editing, and search reliability affect everyday use.

## Walkthrough order

1. First launch: choose local mode, install a game, cancel/retry a failed download, and restore a backup.
2. Search: switch games, apply filters, open an exact printing, add it to a binder, and repeat with delayed requests.
3. Collections: edit a copy, clear tags, move across binders, compare metadata, and export/restore.
4. Wishlists: compare exact-printing and any-printing ownership before and after collection edits.
5. Scanner on a physical iPhone: permission denial, model installation, recognition, crop correction, duplicate handling, and saving selected cards.
6. Packs and settings: save repeated pulls, inspect individual copies, verify offline behavior, and check shortcuts and accessibility.
