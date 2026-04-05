# TCGer iOS App - Feature Roadmap

Based on competitive analysis of Collectr, Dex, PriceCharting, and Shiny TCG apps.

---

## Implemented Features

### Core (Pre-existing)
- User authentication (login/signup/admin setup)
- Collections/Binders management (CRUD, tags, colors)
- Card search across multiple TCGs (Yu-Gi-Oh!, Magic, Pokemon)
- Add/edit/remove cards with per-copy tracking (condition, language, foil, signed, altered)
- Card scanning with 4 strategies (backend hash, text OCR, ML embedding, perceptual hash)
- Collection statistics (card count, total value)
- Collection export (CSV/JSON)
- Server configuration with auto-discovery
- Demo mode with in-memory data
- Offline caching

### Round 1 (Competitor Analysis - April 2026)
- **Theme/Appearance Customization** — System/Light/Dark mode + 10 accent colors
- **Wishlist** — Full CRUD with completion tracking, add from search/sets, backend API integration
- **Set Completion Tracking** — Progress bar + owned badges in set browser
- **Bulk Actions** — Multi-select mode with batch move, delete, condition change
- **Home Screen Widgets** — Collection stats + recent cards (WidgetKit, needs Xcode target setup)

### Round 2 (Competitor Analysis - April 2026)
- **Haptic Feedback** — On scan success/failure, card add, bulk actions, wishlist add
- **Biometric App Lock** — Face ID / Touch ID with auto-lock on background
- **Vault (Storage Location)** — Per-copy storage location field with filter support
- **Slab View Mode** — Grading badge display + SlabCardView with company-specific styling
- **Grading Integration** — Company, grade score, cert number fields on card copies
- **Smart Folders** — Rule-based virtual folders (by TCG, rarity, condition, set, foil)
- **Sealed Product Tracking** — Product catalog, inventory CRUD, backend API integration
- **Mark as Sold / Transaction Log** — Sale recording, finance summary, P&L tracking
- **Demo Data** — Full demo mode support for all new features with card back images

---

## Deferred Features - Future Roadmap

### Price History Charts
**What:** Interactive line charts showing card price changes over time (1W/1M/3M/1Y/All).
**Who has it:** Collectr, Dex, PriceCharting (deep), Shiny — all 4 competitors.
**Why deferred:** Requires a reliable pricing data source and historical price storage. The backend has a `PriceHistory` model and `PriceAlert` model in the Prisma schema, but no automated price ingestion pipeline exists yet.
**What's needed to implement:**
- Backend: Price ingestion service that periodically fetches prices from TCGPlayer/Scryfall/eBay APIs and writes to the `PriceHistory` table
- Backend: Endpoint `GET /prices/:tcg/:cardId/history?period=30d` returning time-series data
- iOS: `PriceChartView.swift` using Swift Charts framework (`import Charts`)
- iOS: Integration into card detail views and collection card rows
- Estimated effort: 2-3 days (iOS) + 1-2 weeks (backend price pipeline)
**Existing backend infrastructure:**
- `PriceHistory` model: cardId, price, currency, source, recordedAt
- `PriceAlert` model: cardId, userId, targetPrice, direction (above/below), lastTriggered
- Pricing service at `backend/src/modules/pricing/pricing.service.ts` with multi-source provider pattern
- Price movers endpoint at `GET /prices/analytics/movers?tcg=...&period=7`

### Collection Value Over Time
**What:** Historical chart of total portfolio value, showing growth/decline trends.
**Who has it:** Collectr (P&L tracking), Dex (line charts), PriceCharting (historical), Shiny.
**Why deferred:** Depends on Price History Charts above — without price data flowing, there's no collection value to chart.
**What's needed to implement:**
- Backend: Scheduled job to snapshot portfolio value daily into a `PortfolioSnapshot` table (user_id, total_value, total_cards, snapshot_date)
- Backend: Endpoint `GET /finance/portfolio-history?from=&to=` returning time-series snapshots
- iOS: `PortfolioValueChart.swift` using Swift Charts, displayed on DashboardView
- Estimated effort: 1-2 days (iOS) + 1 week (backend snapshots + scheduler)

### Multi-Currency Support
**What:** Display prices and collection values in user's preferred currency (EUR, GBP, JPY, etc.).
**Who has it:** Collectr (full conversion), Dex (14 currencies), PriceCharting (exchange rates).
**Why deferred:** Depends on having reliable pricing data first. Also needs exchange rate API integration.
**What's needed to implement:**
- Backend: Exchange rate service (e.g., from exchangerate-api.com or Open Exchange Rates)
- Backend: `ExchangeRate` model with currency_code and to_usd rate, refreshed daily
- Backend: User preference for `preferredCurrency` on the User model
- iOS: `EnvironmentStore` property for `preferredCurrency`, format helper `CurrencyFormatter`
- iOS: All price displays wrapped in currency formatter
- Estimated effort: 2-3 days total

### Lot Value Calculator
**What:** A dealer/retailer tool for calculating bulk lot values with markup, sales tax, and receipt generation.
**Who has it:** PriceCharting (sophisticated with receipts, pagination, tax calculation).
**Why deferred:** Niche feature primarily for dealers/retailers. Most collectors won't use it.
**What's needed to implement:**
- iOS-only feature (no backend needed): `LotCalculatorView.swift`
- Model: `Lot` (title, items, flatRateMarkup, percentMarkup, salesTaxPercent)
- Model: `LotItem` (card reference, quantity, price)
- Computed properties for subtotal, markup fees, tax, total
- Receipt view with shareable PDF generation via `UIGraphicsPDFRenderer`
- Store lots in UserDefaults or local CoreData
- Estimated effort: 2-3 days

### Achievements / Badges
**What:** Gamification layer that rewards users for collection milestones (e.g., "First 100 cards", "Complete a set", "Scan 50 cards").
**Who has it:** Dex (badge system with progress tracking, friend comparison).
**What's needed to implement:**
- Define achievement catalog (20-30 achievements with icons, descriptions, thresholds)
- Backend: `Achievement` and `UserAchievement` models tracking unlock state and progress
- Backend: Achievement evaluation triggered on card add, collection create, scan complete, etc.
- iOS: `AchievementsView.swift` with badge grid, progress indicators, locked/unlocked states
- iOS: Toast/celebration animation when achievement unlocked (confetti, haptic)
- Consider: Local-only achievements (stored in UserDefaults) as MVP, backend-synced later
- Estimated effort: 3-5 days

### PSA/CGC Population Reports
**What:** Display grading population data — how many copies of a card exist at each grade level.
**Who has it:** PriceCharting (PSA and CGC pop data integrated into item detail).
**Why deferred:** Requires external data source. PSA and CGC don't have public APIs for population data.
**What's needed to implement:**
- Data source: PSA/CGC pop reports (may require scraping or third-party aggregator)
- Backend: `PopulationReport` model with card reference, grading company, grade, count
- Backend: Endpoint `GET /cards/:tcg/:cardId/population`
- iOS: `PopulationReportView.swift` showing grade distribution as bar chart
- iOS: Integrate into card detail or slab view
- Estimated effort: 1-2 days (iOS) + significant backend work for data sourcing

### Content Creators Corner
**What:** Showcase section highlighting TCG content creators (YouTubers, streamers, influencers).
**Who has it:** Collectr (ContentCreatorCard, ContentCreatorCarousel).
**Why deferred:** Social/community feature. Self-hosted app doesn't have a content discovery platform.
**What's needed to implement:**
- Backend: `ContentCreator` model with name, platform, url, imageUrl, description
- Backend: Admin endpoint to manage creator listings
- iOS: `ContentCreatorsView.swift` with horizontal carousel of creator cards
- iOS: Deep links to YouTube/Twitch/Instagram profiles
- Estimated effort: 1-2 days

### Pokedex Tracking
**What:** Browse Pokemon by species (Pokedex number) rather than by card. See all cards featuring a specific Pokemon across all sets.
**Who has it:** Dex (dedicated Pokedex tab with regional browsing, species detail, friend comparison).
**What's needed to implement:**
- Backend: Endpoint `GET /pokemon/pokedex` returning species list with dex numbers, names, types
- Backend: Endpoint `GET /pokemon/pokedex/:dexNumber/cards` returning all cards for that Pokemon
- iOS: `PokedexView.swift` — scrollable list of Pokemon species with images, dex numbers
- iOS: `PokedexDetailView.swift` — all cards for a species, ownership status, set info
- iOS: New tab or section under Sets
- Data source: Pokemon TCG API already returns `dexEntries` on Pokemon cards
- The iOS `Card` model already has `dexEntries: [PokedexEntry]?` field
- Estimated effort: 2-3 days

### Push Notifications / Price Alerts
**What:** Push notifications for price drops, new set releases, collection milestones.
**Who has it:** All 4 competitors use FCM or OneSignal.
**What's needed to implement:**
- Apple Push Notification service (APNs) setup with certificates
- Backend: `PriceAlert` model exists in schema — wire it to notification delivery
- Backend: Notification service that evaluates alerts and sends via APNs
- iOS: Request notification permission, register device token, handle incoming notifications
- iOS: `NotificationSettingsView.swift` for managing alert preferences
- Estimated effort: 3-5 days (+ APNs certificate setup)

### Social Auth (Google/Apple Sign-In)
**What:** Sign in with Google or Apple account instead of email/password.
**Who has it:** All 4 competitors.
**What's needed to implement:**
- Backend: OAuth provider integration via better-auth (already used) — add Google and Apple providers
- iOS: `AuthenticationServices` framework for Sign in with Apple (native)
- iOS: Google Sign-In SDK for Google auth
- iOS: Update LoginView to show social auth buttons
- Estimated effort: 2-3 days (+ Apple Developer portal configuration)

### Barcode/UPC Scanning
**What:** Scan sealed product barcodes (UPC) to quickly identify and add to sealed inventory.
**Who has it:** Collectr (Google ML Kit), PriceCharting (ZXing).
**What's needed to implement:**
- iOS: `VNBarcodeObservation` via Vision framework (built-in, no third-party SDK needed)
- iOS: Integrate into CardScannerView as a barcode scanning mode
- Backend: Match UPC to SealedProduct via the `upc` field already in the schema
- Estimated effort: 1-2 days

### Deep Linking
**What:** Share cards and collections via URLs that open directly in the app.
**Who has it:** Collectr, Dex, Shiny.
**What's needed to implement:**
- iOS: Universal Links configuration (apple-app-site-association file on server)
- iOS: Handle incoming URLs in `TCGerApp.swift` via `.onOpenURL`
- URL scheme: `tcger://card/{tcg}/{cardId}`, `tcger://binder/{binderId}`
- Backend: Serve apple-app-site-association at `/.well-known/`
- Estimated effort: 1-2 days

### Showcase / Public Portfolio URL
**What:** Generate a shareable URL for your collection that others can browse.
**Who has it:** Collectr (Showcase with unique URLs).
**What's needed to implement:**
- Backend already has `isPublic: Boolean` and `shareToken: String` on the Binder model
- Backend: Public endpoint `GET /public/binders/:shareToken` returning binder data without auth
- iOS: Toggle in binder edit to make public, copy share URL
- Frontend: Public binder view page at `/showcase/:shareToken`
- Estimated effort: 1-2 days

### Custom App Icons
**What:** Let users choose from multiple app icon variants.
**Who has it:** Collectr (~20 variants), Shiny (dynamic icons).
**What's needed to implement:**
- iOS: `UIApplication.shared.setAlternateIconName()` API
- Create 5-10 icon variants in different styles/colors
- iOS: Icon picker grid in Settings (similar to accent color picker)
- Estimated effort: 1 day (+ icon design time)

### In-App Review Prompts
**What:** Prompt users to rate the app at strategic moments.
**Who has it:** Shiny, Collectr.
**What's needed to implement:**
- iOS: `SKStoreReviewController.requestReview()` from StoreKit
- Trigger after milestones: 10th card added, first set completed, first scan
- Track prompt count to avoid over-prompting (Apple limits to 3x/year)
- Estimated effort: 30 minutes

### Easter Egg
**What:** Hidden fun surprises in the app.
**Who has it:** Collectr (hidden snake game triggered by SecretButton).
**What's needed to implement:**
- iOS: Hidden gesture (e.g., 10 taps on app version in Settings)
- Mini-game view (snake, card flip memory, etc.)
- Estimated effort: 1-2 hours for a simple game

---

## Implementation Priority (Next Round)

If implementing more features, recommended order:
1. **In-App Review Prompts** — 30 min, free engagement boost
2. **Barcode/UPC Scanning** — 1-2 days, leverages existing scanner + sealed inventory
3. **Deep Linking** — 1-2 days, improves sharing
4. **Showcase / Public Portfolio** — 1-2 days, backend fields already exist
5. **Custom App Icons** — 1 day + design, visible polish
6. **Pokedex Tracking** — 2-3 days, unique differentiator for Pokemon collectors
7. **Price History Charts** — 2-3 days iOS + backend pipeline needed
