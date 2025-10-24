# TCGer iOS App - Feature Roadmap
## Inspired by CardWizz Flutter App

Based on analysis of CardWizz (`/Users/ahmadjalil/Downloads/CardWizz-main`), here are the recommended features to incorporate into the native iOS TCGer app.

---

## Current Features (Already Implemented ✅)

### Core Functionality
- ✅ User authentication (login/signup)
- ✅ Collections/Binders management (create, view, edit, delete)
- ✅ Card search across multiple TCGs (Yu-Gi-Oh!, Magic, Pokémon)
- ✅ Add cards to collections
- ✅ Basic collection statistics (card count, total value)
- ✅ Card images and details
- ✅ Backend API integration

---

## Priority 1: Essential Features (High Impact, Should Implement Next)

### 1. Card Scanner 📷
**CardWizz Implementation**: `scanner_screen.dart`, `scanner_service.dart`
- Camera-based card recognition
- Barcode/QR code scanning
- Set number OCR detection
- Card frame overlay guide
- Scanning tips and tutorials

**iOS Implementation Plan**:
```swift
// New Files Needed:
- Views/ScannerView.swift
- Services/ScannerService.swift
- Services/VisionService.swift (iOS Vision framework)

// Key Technologies:
- AVFoundation for camera
- Vision framework for text recognition
- VNRecognizeTextRequest for card numbers
- VNBarcodeObservationRequest for barcodes
```

**Benefits**:
- Much faster card addition
- Reduces manual entry errors
- Greatly improves UX

---

### 2. Price Tracking & History 📈
**CardWizz Implementation**: `price_service.dart`, `price_change_tracker.dart`
- eBay sold listings integration
- Price history tracking
- Price change notifications
- Average price calculation
- Multiple price sources (eBay, TCGPlayer)

**iOS Implementation Plan**:
```swift
// New Files Needed:
- Services/PriceService.swift
- Services/EbayAPIService.swift
- Models/PriceHistory.swift
- Views/Components/PriceChartView.swift

// Backend Updates Needed:
- Add priceHistory table
- Add price tracking endpoints
- Integrate eBay API
- Add background job for price updates
```

**Benefits**:
- Know real market value
- Track collection value over time
- Make informed buying/selling decisions

---

### 3. Analytics Dashboard 📊
**CardWizz Implementation**: `analytics_screen.dart`, `chart_service.dart`
**Features**:
- Portfolio value over time (line chart)
- Rarity distribution (pie chart)
- TCG breakdown (bar chart)
- Acquisition timeline
- Top movers (price changes)
- Market insights

**iOS Implementation Plan**:
```swift
// New Files Needed:
- Views/AnalyticsView.swift
- Services/AnalyticsService.swift
- Components/Charts/
  - PortfolioValueChart.swift
  - RarityDistributionChart.swift
  - TCGBreakdownChart.swift

// Use Swift Charts framework (iOS 16+)
// Or: SwiftUICharts library for iOS 14-15
```

**Benefits**:
- Visual insights into collection
- Track growth over time
- Identify investment opportunities

---

## Priority 2: Enhanced UX (Medium Impact)

### 4. Advanced Search & Filters 🔍
**CardWizz Implementation**: `search_screen.dart`
- Search history
- Advanced filters (rarity, type, set, price range)
- Sort options
- Recent searches
- Quick filters

**iOS Implementation**:
```swift
// Enhance existing:
- Views/CardSearchView.swift

// Add:
- Components/FilterSheet.swift
- Services/SearchHistoryService.swift
- Models/SearchFilters.swift
```

---

### 5. Collection Insights 📋
**CardWizz Implementation**: Built into `collections_screen.dart`
- Duplicate card detection
- Missing cards from sets
- Completion percentage by set
- Value distribution
- Condition breakdown

**iOS Implementation**:
```swift
// New Views:
- Views/CollectionInsightsView.swift
- Components/SetCompletionView.swift
- Components/DuplicatesListView.swift
```

---

### 6. Card Detail Enhancements 🎴
**CardWizz Implementation**: `pokemon_card_details_screen.dart`, `mtg_card_details_screen.dart`
**Features**:
- Price history chart
- Market listings
- Similar cards
- Set information
- Card attributes (for MTG: mana cost, for Pokémon: HP, attacks)
- Add to wishlist
- Share card

**iOS Implementation**:
```swift
// Create TCG-specific detail views:
- Views/Details/PokemonCardDetailView.swift
- Views/Details/MagicCardDetailView.swift
- Views/Details/YuGiOhCardDetailView.swift

// Shared components:
- Components/PriceHistoryView.swift
- Components/MarketListingsView.swift
```

---

## Priority 3: Nice-to-Have Features (Lower Priority)

### 7. Wishlist System 💭
- Track cards you want to buy
- Price alerts for wishlist items
- Move from wishlist to collection

### 8. Export & Sharing 📤
**CardWizz Implementation**: Export functionality in `collections_screen.dart`
- CSV export for grading services
- PDF collection reports
- Share collection with friends
- Backup/restore

### 9. Dark Mode & Themes 🎨
**CardWizz Implementation**: `theme_provider.dart`
- Full dark mode support
- Custom color schemes per TCG
- Theme persistence

### 10. Offline Mode 📴
- Cache card data
- Offline search in owned cards
- Sync when online

---

## Backend API Updates Required

### New Endpoints Needed:

```typescript
// Price Tracking
POST   /cards/:id/track-price
GET    /cards/:id/price-history
GET    /cards/price-changes (for analytics)

// Scanner
POST   /cards/search-by-number
POST   /cards/search-by-barcode

// Analytics
GET    /collections/:id/analytics
GET    /collections/:id/insights
GET    /portfolio/history?from=&to=

// Wishlist
GET    /wishlist
POST   /wishlist
DELETE /wishlist/:id

// Export
GET    /collections/:id/export?format=csv|pdf
```

### Database Schema Updates:

```sql
-- Price History
CREATE TABLE price_history (
  id UUID PRIMARY KEY,
  card_id VARCHAR NOT NULL,
  tcg VARCHAR NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  source VARCHAR NOT NULL, -- 'ebay', 'tcgplayer', etc
  recorded_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(card_id, tcg, recorded_at)
);

-- Wishlist
CREATE TABLE wishlist (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  card_id VARCHAR NOT NULL,
  tcg VARCHAR NOT NULL,
  target_price DECIMAL(10,2),
  notify_on_price_drop BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, card_id, tcg)
);

-- Portfolio Snapshots (for analytics)
CREATE TABLE portfolio_snapshots (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  total_value DECIMAL(10,2) NOT NULL,
  total_cards INTEGER NOT NULL,
  snapshot_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, snapshot_date)
);
```

---

## Implementation Timeline Recommendation

### Phase 1 (2-3 weeks): Price Tracking Foundation
1. Add price history backend
2. Integrate eBay API
3. Create price tracking service
4. Add basic price charts to card details

### Phase 2 (1-2 weeks): Scanner
1. Implement camera view
2. Add Vision framework integration
3. Create OCR for card numbers
4. Test with physical cards

### Phase 3 (2-3 weeks): Analytics Dashboard
1. Create analytics calculations
2. Implement chart views
3. Add portfolio tracking
4. Create insights view

### Phase 4 (1-2 weeks): Enhanced Search
1. Add search history
2. Implement advanced filters
3. Add sort options
4. Create filter UI

### Phase 5 (1 week): Polish
1. Dark mode
2. Export features
3. Wishlist
4. Offline mode basics

---

## Key Technologies to Use

### iOS Native
- **SwiftUI** - Already using, continue
- **Swift Charts** - For analytics (iOS 16+)
- **Vision** - Card scanning, OCR
- **AVFoundation** - Camera access
- **Core Data** - Offline caching
- **UserDefaults** - Settings persistence

### Backend
- **eBay Finding API** - Price data
- **TCGPlayer API** - Price data (if available)
- **Prisma** - Already using
- **Node-cron** - Price update jobs

---

## CardWizz Features NOT to Port (and why)

❌ **Firebase Authentication** - We're using our own backend auth
❌ **Premium/IAP System** - Not needed for MVP
❌ **Google Sign-In** - Can add later if needed
❌ **Multiple Languages** - English only for now
❌ **Performance Monitoring** - Use iOS native analytics instead

---

## Quick Wins (Easiest to Implement First)

1. **Search History** - Just localStorage, very simple
2. **Dark Mode** - SwiftUI makes this trivial
3. **Basic Charts** - Swift Charts is built-in
4. **Card Sharing** - iOS share sheet is native

---

## Next Steps

1. Review this roadmap with the team
2. Prioritize which features to implement first
3. Start with Price Tracking backend (needed for most features)
4. Implement Scanner (huge UX improvement)
5. Add Analytics dashboard (high visual impact)

---

## Questions to Consider

- Which features provide the most value to users?
- What's the minimum viable improvement over current app?
- Which features require the most backend work?
- Should we do iOS-first or ensure web app has same features?
