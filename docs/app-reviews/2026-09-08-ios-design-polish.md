# iOS design polish — 2026-09-08

Applied the transferable SwiftUI guidance from the local Appllama app-design skill.

## Changes

- Added shared unsaved-change confirmation to smart-folder, card-copy, and new-binder forms. Cancel and attempted sheet dismissal use the same confirmation; untouched forms remain swipe-dismissible. Card saving and binder creation disable cancellation while the request is running, and binder creation prevents repeat taps.
- Dashboard preserves loaded content during refresh and presents refresh failures inline with Retry. Initial loading uses redacted statistics. Concurrent dashboard loads are coalesced by an in-flight guard.
- Dashboard binder details use a navigation push with the enclosing stack, matching the Binders screen.
- Search uses one column at accessibility Dynamic Type sizes, scalable metadata text, and a wrapping metadata layout. Header height is no longer fixed. Card title/number layout can fall back to a vertical arrangement.
- Replaced the tall empty-collection layout with a scrolling native empty state and one Create Binder action.
- Dashboard statistics use the selected app accent for icons and neutral surfaces. Shared statistic backgrounds are semantic. Dashboard statistics stack vertically at accessibility text sizes. Meaningful game, rarity, and status colors remain.

## Verification

Built the final source with Xcode for the iOS 26.5 simulator (iPhone 17 Pro device configuration). `xcodebuild` reported **BUILD SUCCEEDED**, and `git diff --check` passed.

Manually exercised in the simulator:

- Light-mode empty binder state and Create Binder entry point.
- Untouched binder form: swipe down, reopen successfully.
- Modified binder form: Cancel confirmation, attempted swipe confirmation, discard, and successful creation.
- Smart-folder form on the final build: visible Discard Changes and Keep Editing actions; Keep Editing preserves the entered name; discard returns to the list.
- Dashboard → binder detail → edge-swipe back to Dashboard.
- Dashboard in dark mode at accessibility-extra-large text size: statistics stack and content scrolls.
- Populated Pokémon search in dark mode at accessibility-extra-large: one column, readable title/number and metadata, scrolling under native chrome.
- Populated search at normal text size in light mode: two-column layout.

The iOS 26 confirmation popover omits cancel-role actions, so Keep Editing deliberately uses a normal action to stay visible.

## Remaining validation limits

- Server refresh-failure behavior and in-flight save dismissal were source-reviewed, not exercised against a delayed/failing server.
- The shared card-copy editor guard compiled but its complete save/edit flow was not manually exercised.
- Empty-state accessibility sizing was source-reviewed; the populated dashboard and search were the large-text simulator checks.
- The recording tool reported recording started, but stopping it returned no usable video file. A complete recorded motion review, Reduce Motion matrix, and release-build frame-rate measurements on physical hardware remain outstanding. No 60 fps or full accessibility certification is claimed.
- The full unit-test suite was not run for this UI pass.
