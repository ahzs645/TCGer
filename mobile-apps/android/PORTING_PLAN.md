# iOS to Android porting plan

The Android app should match product behavior and data semantics, not reproduce
iOS-only presentation APIs. Material 3 adaptive components replace Liquid
Glass, while API payloads and offline collection behavior remain shared.

## Milestone 1 — collection vertical slice (implemented)

- Compose app shell with adaptive bottom navigation
- persisted bottom-navigation visibility/order with a four-item plus More overflow
- on-device/server environment selection
- dashboard, binders, binder detail, search, wishlists, settings
- binder create/edit parity for description, color, default condition, container type, and cover URL
- wishlist create/edit/detail parity for description, color, printing matching, owned/needed filtering, and card removal
- card-number visibility, default-game selection, and safe game disabling when saved cards still depend on a game
- Room-backed local collection data
- Retrofit server health, sign-in, collections, card search, and wishlists
- unit coverage for dashboard aggregation and server URL normalization

## Milestone 2 — catalog experience

- published offline catalog manifest and pack downloader
- sets browser, set completion, Pokédex, and card detail/print variants
- collection import/export and recovery points
- WorkManager background catalog refresh

## Milestone 3 — scanner (working vertical slice)

- CameraX still capture, card guide geometry, permission recovery, and photo import — implemented
- shared backend artwork/hash matching for signed-in server mode — implemented
- bundled ML Kit title OCR with a confirm-before-add offline fallback — implemented
- direct binder insertion and deterministic native parity smoke coverage — implemented

Advanced scanner parity remains:

- automatic binder-page/card detector and binder-page photo persistence
- native reference-set browser and internal per-stage decision diagnostics
- physical-device performance and thermal testing

Android now exposes and persists automatic, on-device, server pHash, and server
embedding choices; bulk photo import, automatic consensus, session review,
prices, server debug captures, seven-tap developer access, live configuration,
asset diagnostics, and persistent recording management are wired. ArcFace and
DINOv2 are production-selectable atomic bundles. DINOv2 preserves the 0.45
gate and uses strict manual title/collector-number OCR rescue verified against
the two clean gate-false-negative fixtures on API 34 arm64. Non-operational
performance switches remain unavailable rather than cosmetic toggles.

The complete behavior contract is tracked by granular IDs in
[`../../mobile-parity/SCANNER_PACK_MATRIX.md`](../../mobile-parity/SCANNER_PACK_MATRIX.md).
The umbrella `scanner.identify` record remains partial until automatic
binder-page detection/page-photo persistence, shared sessions, language-aware
recognition, and the remaining granular debug tools are independently
implemented and verified.

The scanner should reuse the portable catalog and recognition assets. Core ML
models themselves are Apple-specific and cannot be copied directly.

## Milestone 4 — extended inventory (pack-opening vertical slice implemented)

- shared pack-core WebView host, native controls/results, and collection saving — implemented
- set search, variants, possible cards, odds UI, 1/5/10 counts, normal/quick,
  orientation, custom artwork, tear/reveal, and grouped results — implemented
- full pull inspection actions, Favorites, managed offline downloads, collection
  saves, and server-backed sealed-inventory ledger linking — implemented
- full Android sealed-inventory browsing, local/server CRUD, opening history,
  and pack-opening linkage — implemented
- online code vault and barcode scanning
- collection guides, pricing, and analytics
- decks, trades, notifications, and server feature gating

Pack opening must preserve the contract's independently testable set/variant
selection, possible-pull and odds views, 1/5/10 count choices, normal/quick
modes, orientation, custom artwork, tear/reveal controls, grouped results,
collection and sealed-ledger saves, and offline downloads. A pack-opening entry
screen alone is not feature parity.

## Milestone 5 — platform integration and release

- Android App Links for search, binder, wishlist, and scanner destinations
- biometric app lock with Android Keystore-backed session storage
- home-screen widgets and scanner shortcuts
- TalkBack, large text, tablet/foldable, and keyboard QA
- baseline profiles, startup/performance tests, Play signing, and store listing
