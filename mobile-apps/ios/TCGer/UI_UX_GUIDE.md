# TCGer iOS - UI/UX Implementation Guide
## Based on CardWizz Flutter App Analysis

This guide documents how CardWizz displays cards, collections, and card details, with specific SwiftUI implementation recommendations for TCGer iOS.

---

## 📱 Screen Breakdown

### 1. Card Display Patterns

CardWizz uses several sophisticated patterns for displaying cards that we should incorporate:

#### **Grid Layout (Primary View)**
```
┌─────────────────────────────────────┐
│  ┌────┐  ┌────┐  ┌────┐            │
│  │IMG │  │IMG │  │IMG │            │
│  │    │  │    │  │    │            │
│  └────┘  └────┘  └────┘            │
│  Name    Name    Name               │
│  #123    #456    #789               │
│  $5.99   $12.99  $3.50              │
│                                     │
│  ┌────┐  ┌────┐  ┌────┐            │
│  │IMG │  │IMG │  │IMG │            │
└─────────────────────────────────────┘
```

**Key Features:**
- **3 columns on phone, 4-6 on tablet**
- **Card aspect ratio**: 2.5:3.5 (standard trading card)
- **Hero animations** between grid → detail
- **Lazy loading** with skeleton placeholders
- **Smart scrolling** - reduces image quality during fast scrolling
- **Multi-select mode** - long-press to activate

**iOS Implementation:**

```swift
// Views/Components/CardGridView.swift

struct CardGridView: View {
    let cards: [CollectionCard]
    @State private var selectedCards: Set<String> = []
    @State private var isMultiSelectMode = false

    private let columns = [
        GridItem(.adaptive(minimum: 110, maximum: 150), spacing: 12)
    ]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(cards) { card in
                    CardGridItemView(
                        card: card,
                        isSelected: selectedCards.contains(card.id),
                        isMultiSelectMode: isMultiSelectMode
                    )
                    .onTapGesture {
                        handleCardTap(card)
                    }
                    .onLongPressGesture {
                        enterMultiSelectMode(card)
                    }
                }
            }
            .padding()
        }
    }

    func handleCardTap(_ card: CollectionCard) {
        if isMultiSelectMode {
            toggleSelection(card)
        } else {
            // Navigate to detail
        }
    }
}

struct CardGridItemView: View {
    let card: CollectionCard
    let isSelected: Bool
    let isMultiSelectMode: Bool

    var body: some View {
        VStack(spacing: 4) {
            // Card Image with Hero animation
            ZStack(alignment: .topTrailing) {
                AsyncImage(url: URL(string: card.imageUrlSmall ?? "")) { phase in
                    switch phase {
                    case .empty:
                        Rectangle()
                            .fill(Color.gray.opacity(0.1))
                            .overlay(ProgressView())
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(2.5/3.5, contentMode: .fit)
                            .cornerRadius(8)
                    case .failure:
                        Rectangle()
                            .fill(Color.gray.opacity(0.1))
                            .overlay(Image(systemName: "photo"))
                    @unknown default:
                        EmptyView()
                    }
                }
                .matchedGeometryEffect(id: "card-\(card.id)", in: namespace)

                // Selection checkbox (multi-select mode)
                if isMultiSelectMode {
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .foregroundColor(isSelected ? .blue : .gray)
                        .padding(8)
                        .background(Color.white.opacity(0.9))
                        .clipShape(Circle())
                        .padding(4)
                }
            }

            // Card Info
            VStack(alignment: .leading, spacing: 2) {
                Text(card.name)
                    .font(.caption2)
                    .fontWeight(.medium)
                    .lineLimit(1)

                HStack {
                    if let number = card.setCode {
                        Text("#\(number)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    if let price = card.price {
                        Text("$\(price, specifier: "%.2f")")
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .foregroundColor(.green)
                    }
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Color(.systemBackground))
            .cornerRadius(6)
        }
        .background(Color(.systemBackground))
        .cornerRadius(8)
        .shadow(radius: 2)
        .scaleEffect(isSelected ? 0.95 : 1.0)
        .animation(.spring(response: 0.3), value: isSelected)
    }
}
```

---

### 2. Card Detail Screen

CardWizz has **TCG-specific detail screens** (Pokemon, MTG, YuGiOh) with rich information:

```
┌─────────────────────────────────────┐
│  < Back              [•••]          │
│                                     │
│     ┌─────────────────┐            │
│     │                 │            │
│     │   CARD IMAGE    │  ← Zoomable
│     │                 │            │
│     │                 │            │
│     └─────────────────┘            │
│                                     │
│  Blue-Eyes White Dragon             │
│  SDK-001 • Ultra Rare               │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Price Chart                 │   │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━ │   │
│  │  $150    $180    $200       │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Current Price               │   │
│  │ $189.99 (eBay Avg)          │   │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━ │   │
│  │ Raw:    $150                │   │
│  │ PSA 9:  $450                │   │
│  │ PSA 10: $1,200              │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Card Details                │   │
│  │ Type: Dragon                │   │
│  │ ATK: 3000 / DEF: 2500       │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Recent Sales (eBay)         │   │
│  │ • $185 - 2 days ago         │   │
│  │ • $192 - 5 days ago         │   │
│  │ • $178 - 1 week ago         │   │
│  └─────────────────────────────┘   │
│                                     │
│  [Add to Collection]  [Share]      │
└─────────────────────────────────────┘
```

**Key Features:**
- **Zoomable card image** with pinch/zoom gestures
- **Card flip animation** (front/back)
- **Price history chart** (line chart)
- **Multiple price sources** (eBay, TCGPlayer, etc.)
- **Recent sales** from eBay
- **TCG-specific attributes** (HP, ATK/DEF, mana cost, etc.)
- **Related cards** section
- **Share functionality**
- **Quick add to collection**

**iOS Implementation:**

```swift
// Views/Details/CardDetailView.swift

struct CardDetailView: View {
    let card: Card
    @State private var showingBack = false
    @State private var priceHistory: [PricePoint] = []
    @State private var recentSales: [Sale] = []
    @State private var imageScale: CGFloat = 1.0

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Zoomable Card Image
                ZStack {
                    if showingBack, let backImageUrl = card.backImageUrl {
                        AsyncImage(url: URL(string: backImageUrl))
                            .cardImageStyle()
                    } else {
                        AsyncImage(url: URL(string: card.imageUrl ?? ""))
                            .cardImageStyle()
                    }
                }
                .scaleEffect(imageScale)
                .gesture(MagnificationGesture()
                    .onChanged { value in
                        imageScale = value
                    }
                    .onEnded { _ in
                        withAnimation {
                            imageScale = 1.0
                        }
                    }
                )
                .onTapGesture(count: 2) {
                    withAnimation(.spring()) {
                        showingBack.toggle()
                    }
                }

                // Card Info Header
                VStack(alignment: .leading, spacing: 8) {
                    Text(card.name)
                        .font(.title2)
                        .fontWeight(.bold)

                    HStack {
                        if let setCode = card.setCode {
                            Text(setCode)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }

                        if let rarity = card.rarity {
                            Text("•")
                                .foregroundColor(.secondary)
                            Text(rarity)
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)

                // Price History Chart
                PriceHistoryChartView(priceHistory: priceHistory)
                    .frame(height: 200)
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(12)
                    .padding(.horizontal)

                // Current Price Section
                CurrentPriceView(card: card)

                // TCG-Specific Attributes
                if card.tcg == "pokemon" {
                    PokemonAttributesView(card: card)
                } else if card.tcg == "magic" {
                    MagicAttributesView(card: card)
                } else if card.tcg == "yugioh" {
                    YuGiOhAttributesView(card: card)
                }

                // Recent Sales
                RecentSalesView(sales: recentSales)

                // Action Buttons
                HStack(spacing: 12) {
                    Button(action: { /* Add to collection */ }) {
                        Label("Add to Collection", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)

                    Button(action: { /* Share */ }) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .buttonStyle(.bordered)
                }
                .padding()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            loadPriceData()
            loadRecentSales()
        }
    }
}

// Price History Chart Component
struct PriceHistoryChartView: View {
    let priceHistory: [PricePoint]

    var body: some View {
        Chart {
            ForEach(priceHistory) { point in
                LineMark(
                    x: .value("Date", point.date),
                    y: .value("Price", point.price)
                )
                .foregroundStyle(.blue)
                .interpolationMethod(.catmullRom)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading)
        }
    }
}

// TCG-Specific Attribute Views
struct PokemonAttributesView: View {
    let card: Card

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Card Details")
                .font(.headline)

            if let hp = card.attributes?["hp"] as? Int {
                HStack {
                    Text("HP")
                        .foregroundColor(.secondary)
                    Spacer()
                    Text("\(hp)")
                        .fontWeight(.medium)
                }
            }

            if let types = card.attributes?["types"] as? [String] {
                HStack {
                    Text("Type")
                        .foregroundColor(.secondary)
                    Spacer()
                    HStack(spacing: 4) {
                        ForEach(types, id: \.self) { type in
                            TypeBadge(type: type)
                        }
                    }
                }
            }

            // Add more attributes...
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
        .padding(.horizontal)
    }
}
```

---

### 3. Collections/Binders Screen

CardWizz has a **beautiful collections overview** with:

```
┌─────────────────────────────────────┐
│  Collections              [+ New]   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 🔵 Binder Alpha             │   │
│  │ Flagship deck staples...    │   │
│  │                             │   │
│  │ [IMG][IMG][IMG][IMG][IMG]   │   │
│  │                             │   │
│  │ 3 games • 25 cards          │   │
│  │ Total Value: $1,245.99      │   │
│  │ Updated: Oct 23, 2025       │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 🟢 Modern Staples           │   │
│  │ Competitive MTG & YGO...    │   │
│  │                             │   │
│  │ [IMG][IMG][IMG][IMG][IMG]   │   │
│  │                             │   │
│  │ 2 games • 18 cards          │   │
│  │ Total Value: $513.30        │   │
│  │ Updated: Sep 28, 2025       │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

**Key Features:**
- **Color-coded binders** (user selectable)
- **Preview card images** (first 5 cards)
- **Quick stats** (game count, card count, total value)
- **Last updated timestamp**
- **Empty state** with helpful onboarding
- **Swipe actions** (edit, delete)
- **Animated background** with particles
- **Smooth page transitions**

**iOS Implementation:**

```swift
// Views/CollectionsListView.swift

struct CollectionsListView: View {
    @StateObject private var viewModel = CollectionsViewModel()
    @State private var showingCreateSheet = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if viewModel.collections.isEmpty {
                    EmptyCollectionsView(onCreate: {
                        showingCreateSheet = true
                    })
                } else {
                    LazyVStack(spacing: 16) {
                        ForEach(viewModel.collections) { collection in
                            NavigationLink(value: collection) {
                                CollectionCardView(collection: collection)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("Collections")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: { showingCreateSheet = true }) {
                        Label("New", systemImage: "plus")
                    }
                }
            }
            .navigationDestination(for: Collection.self) { collection in
                CollectionDetailView(collection: collection)
            }
            .sheet(isPresented: $showingCreateSheet) {
                CreateCollectionSheet()
            }
        }
    }
}

struct CollectionCardView: View {
    let collection: Collection

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header with color and name
            HStack {
                Circle()
                    .fill(Color(hex: collection.colorHex))
                    .frame(width: 12, height: 12)

                Text(collection.name)
                    .font(.headline)
                    .fontWeight(.semibold)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            if let description = collection.description {
                Text(description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }

            // Card Preview Strip
            if !collection.cards.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(collection.cards.prefix(5)) { card in
                            AsyncImage(url: URL(string: card.imageUrlSmall ?? "")) { image in
                                image
                                    .resizable()
                                    .aspectRatio(2.5/3.5, contentMode: .fit)
                                    .frame(height: 80)
                                    .cornerRadius(4)
                            } placeholder: {
                                Rectangle()
                                    .fill(Color.gray.opacity(0.1))
                                    .frame(height: 80)
                                    .aspectRatio(2.5/3.5, contentMode: .fit)
                                    .cornerRadius(4)
                            }
                        }

                        if collection.cards.count > 5 {
                            Text("+\(collection.cards.count - 5)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .frame(height: 80)
                                .padding(.horizontal, 12)
                                .background(Color.gray.opacity(0.1))
                                .cornerRadius(4)
                        }
                    }
                }
            }

            // Stats Row
            HStack(spacing: 16) {
                Label("\(collection.uniqueGames) games", systemImage: "gamecontroller")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Label("\(collection.cards.count) cards", systemImage: "square.stack.3d.up")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                Text("$\(collection.totalValue, specifier: "%.2f")")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(.green)
            }

            // Updated timestamp
            Text("Updated \(collection.updatedAt.formatted(.relative(presentation: .named)))")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
        .shadow(radius: 2)
    }
}
```

---

### 4. Collection Detail Screen

Shows all cards in a specific collection:

```
┌─────────────────────────────────────┐
│  < Binder Alpha        [•••] [Edit] │
│                                     │
│  🔵 Binder Alpha                    │
│  Flagship deck staples, graded...  │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 📊 Quick Stats              │   │
│  │                             │   │
│  │ Total Value:  $1,245.99     │   │
│  │ Cards:        25            │   │
│  │ Games:        3 (MTG, YGO,  │   │
│  │               Pokémon)      │   │
│  └─────────────────────────────┘   │
│                                     │
│  [All] [Yu-Gi-Oh!] [Magic] [Pokémon]
│                                     │
│  Sort: [Price ▼]  Filter: [None]   │
│                                     │
│  ┌────┐  ┌────┐  ┌────┐            │
│  │IMG │  │IMG │  │IMG │            │
│  └────┘  └────┘  └────┘            │
│   Card1   Card2   Card3             │
│  $89.99  $12.99  $150.00            │
└─────────────────────────────────────┘
```

**Key Features:**
- **Collection header** with stats
- **Game filter tabs** (show only Yu-Gi-Oh!, Magic, etc.)
- **Sort options** (price, name, rarity, date added)
- **Advanced filters** (rarity, set, condition)
- **Multi-select** with bulk actions
- **Search within collection**
- **Export options** (CSV, PDF)

**iOS Implementation:**

```swift
// Views/CollectionDetailView.swift

struct CollectionDetailView: View {
    let collection: Collection
    @State private var selectedGame: String = "all"
    @State private var sortOrder: SortOrder = .priceDesc
    @State private var searchText = ""
    @State private var showingFilters = false

    var filteredCards: [CollectionCard] {
        collection.cards
            .filter { card in
                (selectedGame == "all" || card.tcg == selectedGame) &&
                (searchText.isEmpty || card.name.localizedCaseInsensitiveContains(searchText))
            }
            .sorted(by: sortOrder.comparator)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Collection Header
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Circle()
                            .fill(Color(hex: collection.colorHex))
                            .frame(width: 16, height: 16)

                        Text(collection.name)
                            .font(.title2)
                            .fontWeight(.bold)
                    }

                    if let description = collection.description {
                        Text(description)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)

                // Quick Stats Card
                CollectionStatsCard(collection: collection)
                    .padding(.horizontal)

                // Game Filter Tabs
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        GameFilterChip(title: "All", isSelected: selectedGame == "all") {
                            selectedGame = "all"
                        }

                        GameFilterChip(title: "Yu-Gi-Oh!", isSelected: selectedGame == "yugioh") {
                            selectedGame = "yugioh"
                        }

                        GameFilterChip(title: "Magic", isSelected: selectedGame == "magic") {
                            selectedGame = "magic"
                        }

                        GameFilterChip(title: "Pokémon", isSelected: selectedGame == "pokemon") {
                            selectedGame = "pokemon"
                        }
                    }
                    .padding(.horizontal)
                }

                // Sort & Filter Controls
                HStack {
                    Menu {
                        ForEach(SortOrder.allCases) { order in
                            Button(action: { sortOrder = order }) {
                                Label(order.title, systemImage: order.icon)
                            }
                        }
                    } label: {
                        Label("Sort: \(sortOrder.title)", systemImage: "arrow.up.arrow.down")
                            .font(.subheadline)
                    }
                    .buttonStyle(.bordered)

                    Button(action: { showingFilters = true }) {
                        Label("Filters", systemImage: "line.3.horizontal.decrease.circle")
                            .font(.subheadline)
                    }
                    .buttonStyle(.bordered)

                    Spacer()
                }
                .padding(.horizontal)

                // Card Grid
                CardGridView(cards: filteredCards)
            }
        }
        .searchable(text: $searchText, prompt: "Search cards")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button(action: { /* Export */ }) {
                        Label("Export CSV", systemImage: "doc.text")
                    }
                    Button(action: { /* Share */ }) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    Button(action: { /* Edit */ }) {
                        Label("Edit Collection", systemImage: "pencil")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingFilters) {
            FilterSheet(/* ... */)
        }
    }
}

struct CollectionStatsCard: View {
    let collection: Collection

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                StatItem(title: "Total Value", value: "$\(collection.totalValue, specifier: "%.2f")", color: .green)
                Divider()
                StatItem(title: "Cards", value: "\(collection.cards.count)", color: .blue)
                Divider()
                StatItem(title: "Games", value: "\(collection.uniqueGames)", color: .purple)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}
```

---

## 🎨 Design Patterns to Incorporate

### 1. **Hero Transitions**
```swift
// Use matchedGeometryEffect for smooth grid → detail transitions
@Namespace private var namespace

// In grid:
.matchedGeometryEffect(id: "card-\(card.id)", in: namespace)

// In detail:
.matchedGeometryEffect(id: "card-\(card.id)", in: namespace)
```

### 2. **Animated Background Particles**
CardWizz uses subtle particle animations in the background - consider for the collections screen.

### 3. **Smart Loading States**
- Show skeleton placeholders while loading
- Reduce image quality during fast scrolling
- Lazy load images
- Cache aggressively

### 4. **Multi-Select Mode**
Long-press to enter multi-select, then:
- Show checkboxes on all cards
- Show toolbar with bulk actions
- Allow tap to select/deselect
- Clear selection on done

### 5. **Empty States**
Beautiful empty states with:
- Helpful illustration
- Clear call-to-action
- Onboarding tips

### 6. **Swipe Actions**
On collection cards:
- Swipe left for delete
- Swipe right for edit

---

## 📊 Data Display Best Practices

### Price Display
```swift
// Always show:
- Current price (green, bold)
- Source indicator (eBay, TCGPlayer)
- Last updated timestamp

// If available:
- Price history sparkline
- Price change indicator (+5% ↑)
- Raw vs graded comparison
```

### Card Info Hierarchy
```
1. Card name (largest, bold)
2. Set code + Rarity (medium, secondary color)
3. Price (large, green, bold)
4. Card number (small, gray)
5. Quantity/Condition (badges)
```

### Collection Stats
```
Always show:
✓ Total value (prominent)
✓ Card count
✓ Unique games
✓ Last updated

Nice to have:
✓ Value trend (↑ 5% this week)
✓ Most valuable card
✓ Set completion %
```

---

## 🎯 Quick Wins for TCGer iOS

These are features from CardWizz that are **easy to implement** and have **high impact**:

### 1. **Card Preview Strip** (2-3 hours)
Show first 5 card images in collection list - huge visual improvement!

### 2. **Color-Coded Binders** (1 hour)
Let users pick a color for each collection - makes it easy to identify at a glance.

### 3. **Quick Stats Card** (1 hour)
Show total value, card count, game count in a nice card layout.

### 4. **Hero Transitions** (2 hours)
Use `matchedGeometryEffect` for smooth grid → detail animations.

### 5. **Multi-Select Mode** (3-4 hours)
Long-press to select multiple cards for bulk actions.

### 6. **Empty States** (1 hour)
Create a nice "no collections yet" view with clear CTA.

---

## 🚀 Implementation Priority

### Phase 1: Visual Polish (1 week)
1. Implement hero transitions
2. Add card preview strips to collections
3. Create collection stats cards
4. Add color picker for collections
5. Improve empty states

### Phase 2: Interactions (1 week)
1. Multi-select mode
2. Swipe actions
3. Pull to refresh
4. Search within collection
5. Filter & sort UI

### Phase 3: Advanced (2 weeks)
1. Price history charts
2. Recent sales integration
3. Export functionality
4. Share sheets
5. Analytics dashboard

---

## 📝 Code Structure Recommendations

```
TCGer/
├── Views/
│   ├── Collections/
│   │   ├── CollectionsListView.swift
│   │   ├── CollectionDetailView.swift
│   │   ├── CreateCollectionSheet.swift
│   │   └── Components/
│   │       ├── CollectionCardView.swift
│   │       ├── CollectionStatsCard.swift
│   │       └── GameFilterChips.swift
│   ├── Cards/
│   │   ├── CardGridView.swift
│   │   ├── CardGridItemView.swift
│   │   └── Details/
│   │       ├── CardDetailView.swift
│   │       ├── PokemonDetailView.swift
│   │       ├── MagicDetailView.swift
│   │       └── YuGiOhDetailView.swift
│   └── Components/
│       ├── PriceHistoryChart.swift
│       ├── RecentSalesView.swift
│       ├── ZoomableImageView.swift
│       └── EmptyStateView.swift
├── ViewModels/
│   ├── CollectionsViewModel.swift
│   ├── CardDetailViewModel.swift
│   └── PriceHistoryViewModel.swift
└── Models/
    ├── Collection+Stats.swift
    ├── Card+Display.swift
    └── PricePoint.swift
```

---

## 🎨 Design System

### Colors
```swift
// Collection colors (user selectable)
let binderColors: [Color] = [
    .blue, .red, .green, .orange, .purple,
    .teal, .pink, .indigo, .yellow, .cyan
]

// Semantic colors
let pricePositive = Color.green
let priceNegative = Color.red
let secondaryText = Color.secondary
```

### Typography
```swift
// Card name in grid
.font(.caption2)
.fontWeight(.medium)

// Price in grid
.font(.caption2)
.fontWeight(.semibold)

// Collection name
.font(.headline)
.fontWeight(.semibold)

// Card detail title
.font(.title2)
.fontWeight(.bold)
```

### Spacing
```swift
let gridSpacing: CGFloat = 12
let cardPadding: CGFloat = 6
let sectionSpacing: CGFloat = 20
```

---

## 📱 Responsive Design

```swift
// Adaptive grid columns
var gridColumns: [GridItem] {
    [GridItem(.adaptive(
        minimum: UIDevice.current.userInterfaceIdiom == .pad ? 150 : 110,
        maximum: UIDevice.current.userInterfaceIdiom == .pad ? 200 : 150
    ), spacing: 12)]
}

// Tablet layout adjustments
if horizontalSizeClass == .regular {
    // Use 2-column layout for lists
    // Show more cards in preview (8 instead of 5)
    // Larger font sizes
}
```

---

This guide provides a comprehensive blueprint for implementing CardWizz's best UI/UX patterns in your native iOS TCGer app!
