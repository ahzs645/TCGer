# TestFlight screenshot feedback — build 166

Imported from App Store Connect on 2026-08-12. All reports were submitted from
TCGer 1.0 (166) on an iPhone 17 Pro running iOS 26.6.

| Screenshot | Feedback | Code area |
| --- | --- | --- |
| [01-binder-card-behind-tab-bar.jpg](01-binder-card-behind-tab-bar.jpg) | Bulk-selection actions render behind the app tab bar. | `CollectionDetailView` |
| [02-compact-text-info-symbol.jpg](02-compact-text-info-symbol.jpg) | Make offline-catalog rows more compact and move detailed metadata behind an information control. | `CatalogInstallRow` |
| [03-pack-opening-message.jpg](03-pack-opening-message.jpg) | Pack opening reports `TypeError: Load failed`. | `PackOpeningView` WebKit resource bridge |
| [04-adding-cards-progress.jpg](04-adding-cards-progress.jpg) | The final `Adding 272 of 272 cards…` progress message can remain after completion. | `WishlistSyncService`, `CollectionGuideDetailView` |
| [05-unfollow-popup.jpg](05-unfollow-popup.jpg) | Present unfollow confirmation as a modal alert instead of an anchored confirmation popover. | `CollectionGuideDetailView` |
| [06-analytics-filter.jpg](06-analytics-filter.jpg) | Replace the oversized `30D` toolbar control with a compact filter icon. | `AnalyticsView` |

The older build-92 “Encoding error?” report was also reviewed in App Store
Connect. Current code already supplies explicit UTF-8 encodings for embedded
HTML, JavaScript, JSON, and OBJ resources, so this batch keeps that handling and
focuses the pack-opening fix on WebKit's rejected custom-scheme `fetch` calls.
