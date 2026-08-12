import SwiftUI

struct SetDetailView: View {
    let set: TcgSet
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var cards: [Card] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var addSheetCard: Card?
    @State private var wishlistSheetCard: Card?
    @State private var ownedCardIds: Set<String> = []
    @State private var ownershipLoaded = false
    @State private var collections: [Collection] = []
    @State private var searchText = ""
    @State private var isSearchPresented = false
    @State private var cardFilter: SetCardFilter = .all
    @State private var cardSort: SetCardSort = .collectorNumber
    @State private var isSelecting = false
    @State private var selectedCardIds: Set<String> = []
    @State private var showingBulkBinderPicker = false
    @State private var isBulkAdding = false
    @State private var wishlistTarget: WishlistBulkTarget?
    @State private var wishlistStatus: String?
    @State private var showingSetScanner = false
    @State private var collectionRevision = 0

    /// Which cards a wishlist bulk-add should send.
    private enum WishlistBulkTarget: String, Identifiable {
        case wholeSet
        case selected

        var id: String { rawValue }

        var title: String {
            switch self {
            case .wholeSet: return "Track Set In"
            case .selected: return "Add Selected To"
            }
        }
    }

    private let apiService = APIService()

    private var scanScope: CardScanScope? {
        guard let game = TCGGame(rawValue: set.tcg.lowercased()) else { return nil }
        let scope = CardScanScope(game: game, setCode: set.code, setName: set.name)
        return scope.scanMode == nil ? nil : scope
    }

    private var completionCards: [Card] {
        cards.filter {
            SetProgressCalculator.includes(
                $0,
                in: set,
                mode: environmentStore.setCompletionMode
            )
        }
    }

    private var completionModeBinding: Binding<SetCompletionMode> {
        Binding(
            get: { environmentStore.setCompletionMode },
            set: { environmentStore.updateSetCompletionMode($0) }
        )
    }

    private var gameBrandColor: Color {
        TCGGame(rawValue: set.tcg.lowercased())?.brandColor ?? .accentColor
    }

    private var displayedCards: [Card] {
        let query = SearchTextNormalizer.key(searchText)

        return cards
            .filter { card in
                let matchesOwnership: Bool
                switch cardFilter {
                case .all:
                    matchesOwnership = true
                case .missing:
                    matchesOwnership = !ownedCardIds.contains(card.id)
                case .owned:
                    matchesOwnership = ownedCardIds.contains(card.id)
                }

                guard matchesOwnership else { return false }
                guard !query.isEmpty else { return true }

                return SearchTextNormalizer.contains(card.name, queryKey: query) ||
                    SearchTextNormalizer.contains(card.collectorNumber, queryKey: query)
            }
            .sorted { left, right in
                switch cardSort {
                case .collectorNumber:
                    return Self.isBeforeByCollectorNumber(left, right)
                case .name:
                    return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
                case .rarity:
                    // Rarest first, so the chase cards sit at the top of the grid.
                    let leftRank = CardRarityRank.rank(for: left.rarity)
                    let rightRank = CardRarityRank.rank(for: right.rarity)
                    if leftRank != rightRank {
                        return leftRank > rightRank
                    }
                    // Same tier: keep the set's own order so the grid stays scannable.
                    return Self.isBeforeByCollectorNumber(left, right)
                }
            }
    }

    private static func isBeforeByCollectorNumber(_ left: Card, _ right: Card) -> Bool {
        let leftNumber = left.collectorNumber ?? left.id
        let rightNumber = right.collectorNumber ?? right.id
        return leftNumber.localizedStandardCompare(rightNumber) == .orderedAscending
    }

    var body: some View {
        VStack(spacing: 0) {
            if isLoading {
                ProgressView("Loading cards...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error = errorMessage {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 50))
                        .foregroundColor(.orange)
                    Text("Failed to Load Cards")
                        .font(.headline)
                    Text(error)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                    Button("Try Again") {
                        Task { await loadCards() }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if cards.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "tray")
                        .font(.system(size: 50))
                        .foregroundColor(.secondary)
                    Text("No Cards Found")
                        .font(.title3)
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    // Set Info Header
                    VStack(spacing: 8) {
                        HStack {
                            SetArtworkView(set: set, size: 44, showsFallback: false)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(set.name)
                                    .font(.subheadline)
                                    .fontWeight(.semibold)
                                    .fixedSize(horizontal: false, vertical: true)
                                HStack(spacing: 6) {
                                    Text(set.code.uppercased())
                                        .font(.caption)
                                        .fontWeight(.bold)
                                        .foregroundColor(gameBrandColor)
                                    GameBadge(tcg: set.tcg, showsName: true)
                                }
                                if let releaseDate = set.formattedReleaseDate {
                                    Text("Released: \(releaseDate)")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                            }
                            Spacer()
                            Text("\(cards.count) cards")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .padding(.horizontal)
                        .padding(.top, 8)
                    }

                    // Set Completion Progress
                    if ownershipLoaded && !cards.isEmpty {
                        let ownedCount = completionCards.filter { ownedCardIds.contains($0.id) }.count
                        let total = completionCards.count
                        let percent = total > 0 ? Int((Double(ownedCount) / Double(total)) * 100) : 0

                        VStack(spacing: 6) {
                            HStack {
                                Text("\(ownedCount) of \(total) owned")
                                    .font(.caption)
                                    .fontWeight(.medium)
                                Spacer()
                                Text("\(percent)%")
                                    .font(.caption)
                                    .fontWeight(.bold)
                                    .foregroundColor(percent == 100 ? .green : gameBrandColor)
                            }
                            ProgressView(value: Double(ownedCount), total: Double(max(1, total)))
                                .tint(percent == 100 ? .green : gameBrandColor)
                        }
                        .padding(.horizontal)
                        .padding(.bottom, 4)
                    }

                    if displayedCards.isEmpty {
                        Group {
                            if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                ContentUnavailableView(
                                    "No Cards in This Filter",
                                    systemImage: "rectangle.stack",
                                    description: Text("Choose another ownership filter to see cards.")
                                )
                            } else {
                                ContentUnavailableView.search(text: searchText)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 48)
                    } else {
                        LazyVGrid(columns: [
                            GridItem(.flexible()),
                            GridItem(.flexible())
                        ], spacing: 16) {
                            ForEach(displayedCards) { card in
                                let isSelected = selectedCardIds.contains(card.id)
                                Button {
                                    if isSelecting {
                                        toggleSelection(card.id)
                                    } else {
                                        addSheetCard = card
                                    }
                                } label: {
                                    SetCardCell(card: card, showPricing: environmentStore.showPricing, isOwned: ownershipLoaded ? ownedCardIds.contains(card.id) : nil)
                                        .overlay(alignment: .topLeading) {
                                            if isSelecting {
                                                Image(
                                                    systemName: isSelected
                                                        ? "checkmark.circle.fill"
                                                        : "circle"
                                                )
                                                .font(.title2)
                                                .foregroundStyle(
                                                    isSelected
                                                        ? Color.accentColor
                                                        : Color.secondary
                                                )
                                                .background(Circle().fill(.background))
                                                .padding(6)
                                            }
                                        }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(card.name)
                                .accessibilityValue(accessibilityValue(for: card))
                                .accessibilityHint(
                                    isSelecting
                                        ? "Selects or deselects this card"
                                        : "Opens options to add this card"
                                )
                                .accessibilityAddTraits(
                                    isSelecting && isSelected ? .isSelected : []
                                )
                                    .cardPreviewContextMenu(card: card, onSelect: {
                                        if isSelecting {
                                            toggleSelection(card.id)
                                        } else {
                                            addSheetCard = card
                                        }
                                    }, onAddToWishlist: {
                                        wishlistSheetCard = card
                                    })
                            }
                        }
                        .padding()
                    }
                }
            }
        }
        .modifier(
            SetSearchPresenter(
                text: $searchText,
                isPresented: $isSearchPresented
            )
        )
        .onChange(of: isSearchPresented) { _, isPresented in
            if !isPresented {
                searchText = ""
            }
        }
        .safeAreaBar(edge: .top, spacing: 0) {
            if !isLoading, errorMessage == nil, !cards.isEmpty {
                cardControlBar
            }
        }
        .scrollEdgeEffectStyle(.soft, for: .all)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    isSearchPresented = true
                } label: {
                    Image(systemName: "magnifyingglass")
                }
                .accessibilityLabel("Search this set")

                Button(isSelecting ? "Done" : "Select") {
                    isSelecting.toggle()
                    if !isSelecting {
                        selectedCardIds.removeAll()
                    }
                }

                Menu {
                    if scanScope != nil {
                        Button {
                            showingSetScanner = true
                        } label: {
                            Label("Scan cards from this set", systemImage: "viewfinder")
                        }
                    }

                    Button {
                        wishlistTarget = .wholeSet
                    } label: {
                        Label("Track this set in a wishlist", systemImage: "heart.text.square")
                    }
                    .disabled(cards.isEmpty || isBulkAdding)

                    Divider()

                    Picker("Completion goal", selection: completionModeBinding) {
                        ForEach(SetCompletionMode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .safeAreaBar(edge: .bottom) {
            if isSelecting && !selectedCardIds.isEmpty {
                VStack(spacing: 8) {
                    Button {
                        showingBulkBinderPicker = true
                    } label: {
                        HStack {
                            if isBulkAdding {
                                ProgressView()
                            }
                            Text(
                                isBulkAdding
                                    ? "Adding cards…"
                                    : "Add \(selectedCardIds.count) selected to binder"
                            )
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isBulkAdding)

                    Button {
                        wishlistTarget = .selected
                    } label: {
                        Text("Add \(selectedCardIds.count) selected to wishlist")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isBulkAdding)
                }
                .padding()
            } else if let wishlistStatus {
                Text(wishlistStatus)
                    .font(.footnote)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            }
        }
        .task {
            await loadCards()
            await loadOwnershipData()
        }
        .refreshable {
            await loadCards()
            await loadOwnershipData(useCache: false)
        }
        .onReceive(NotificationCenter.default.publisher(for: .collectionDidChange)) { _ in
            collectionRevision += 1
        }
        .task(id: collectionRevision) {
            guard collectionRevision > 0 else { return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await loadOwnershipData(useCache: false)
        }
        .sheet(item: $wishlistSheetCard) { card in
            AddToWishlistSheet(card: card)
                .environmentObject(environmentStore)
        }
        .sheet(item: $addSheetCard, onDismiss: {
            addSheetCard = nil
        }) { card in
            AddCardToBinderSheet(card: card) { selectedCard, binderId, details in
                try await apiService.addCardToBinder(
                    config: environmentStore.serverConfiguration,
                    token: environmentStore.authToken,
                    binderId: binderId,
                    card: selectedCard,
                    details: details
                )
                ownedCardIds.insert(selectedCard.id)
            }
        }
        .sheet(isPresented: $showingBulkBinderPicker) {
            BulkBinderPicker(collections: collections) { binderId in
                showingBulkBinderPicker = false
                Task { await bulkAddSelectedCards(to: binderId) }
            }
        }
        .sheet(item: $wishlistTarget) { target in
            WishlistPickerSheet(title: target.title) { wishlist in
                Task { await addToWishlist(wishlist, target: target) }
            }
            .environmentObject(environmentStore)
        }
        .fullScreenCover(isPresented: $showingSetScanner) {
            if let scanScope {
                CardScannerView(scope: scanScope)
                    .environmentObject(environmentStore)
            }
        }
    }

    private var cardControlBar: some View {
        HStack(spacing: 12) {
            Picker("Cards", selection: $cardFilter) {
                ForEach(SetCardFilter.allCases) { filter in
                    Text(filter.title).tag(filter)
                }
            }
            .pickerStyle(.segmented)

            Menu {
                Picker("Sort", selection: $cardSort) {
                    ForEach(SetCardSort.allCases) { sort in
                        Text(sort.title).tag(sort)
                    }
                }
            } label: {
                Label("Sort cards", systemImage: "arrow.up.arrow.down")
                    .labelStyle(.iconOnly)
                    .frame(width: 36, height: 32)
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Sort cards")
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    /// Sends either the whole set (saving a rule so it stays current) or just
    /// the selected cards to a wishlist.
    @MainActor
    private func addToWishlist(_ wishlist: Wishlist, target: WishlistBulkTarget) async {
        guard let token = environmentStore.authToken else { return }
        let payload = target == .wholeSet
            ? cards
            : cards.filter { selectedCardIds.contains($0.id) }
        guard !payload.isEmpty else { return }

        isBulkAdding = true
        wishlistStatus = "Adding \(payload.count) cards to \(wishlist.name)…"

        let service = WishlistSyncService(
            apiService: apiService,
            config: environmentStore.serverConfiguration,
            token: token,
            enabledGames: environmentStore.enabledGames
        )

        do {
            try await service.addCards(payload, toWishlist: wishlist.id) { sent, total in
                Task { @MainActor in
                    wishlistStatus = "Adding \(sent) of \(total) cards…"
                }
            }

            if target == .wholeSet {
                _ = try await apiService.addWishlistRule(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    wishlistId: wishlist.id,
                    type: .set,
                    tcg: set.tcg,
                    setCode: set.code,
                    setName: set.name,
                    includeAllPrintings: true,
                    autoSync: true
                )
                wishlistStatus = "Tracking \(set.name) in \(wishlist.name)."
            } else {
                wishlistStatus = "Added \(payload.count) cards to \(wishlist.name)."
                selectedCardIds.removeAll()
                isSelecting = false
            }
            HapticManager.notification(.success)
        } catch {
            wishlistStatus = error.localizedDescription
        }

        isBulkAdding = false
    }

    private func toggleSelection(_ cardId: String) {
        if selectedCardIds.contains(cardId) {
            selectedCardIds.remove(cardId)
        } else {
            selectedCardIds.insert(cardId)
        }
    }

    private func accessibilityValue(for card: Card) -> String {
        var parts: [String] = []
        if let collectorNumber = card.collectorNumber {
            parts.append("card number \(collectorNumber)")
        }
        if let rarity = card.rarity {
            parts.append(rarity)
        }
        if ownershipLoaded {
            parts.append(ownedCardIds.contains(card.id) ? "owned" : "not owned")
        }
        if environmentStore.showPricing, let price = card.price {
            parts.append(price.priceText)
        }
        return parts.joined(separator: ", ")
    }

    @MainActor
    private func loadOwnershipData(useCache: Bool = true) async {
        guard let token = environmentStore.authToken else { return }

        do {
            let collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: useCache
            )
            self.collections = collections
            var ids = Set<String>()
            for collection in collections {
                for card in collection.cards {
                    ids.insert(card.externalId ?? card.cardId)
                }
            }
            ownedCardIds = ids
            ownershipLoaded = true
        } catch {
            // Silently fail - ownership is an enhancement, not critical
            ownershipLoaded = true
        }
    }

    @MainActor
    private func bulkAddSelectedCards(to binderId: String) async {
        guard let token = environmentStore.authToken else { return }
        let selectedCards = cards.filter { selectedCardIds.contains($0.id) }
        guard !selectedCards.isEmpty else { return }

        isBulkAdding = true
        errorMessage = nil
        do {
            for card in selectedCards {
                try await apiService.addCardToBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: binderId,
                    cardId: card.id,
                    price: card.price,
                    card: card
                )
                ownedCardIds.insert(card.id)
            }
            selectedCardIds.removeAll()
            isSelecting = false
        } catch {
            errorMessage = error.localizedDescription
        }
        isBulkAdding = false
    }

    @MainActor
    private func loadCards() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            cards = try await apiService.getSetCards(
                config: environmentStore.serverConfiguration,
                token: token,
                tcg: set.tcg,
                setCode: set.code
            )
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }
}

private struct SetSearchPresenter: ViewModifier {
    @Binding var text: String
    @Binding var isPresented: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isPresented {
            content.searchable(
                text: $text,
                isPresented: $isPresented,
                prompt: "Search this set"
            )
        } else {
            content
        }
    }
}

private enum SetCardFilter: String, CaseIterable, Identifiable {
    case all
    case missing
    case owned

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

private enum SetCardSort: String, CaseIterable, Identifiable {
    case collectorNumber
    case name
    case rarity

    var id: String { rawValue }
    var title: String {
        switch self {
        case .collectorNumber: return "Collector number"
        case .name: return "Name"
        case .rarity: return "Rarity"
        }
    }
}

private struct BulkBinderPicker: View {
    @Environment(\.dismiss) private var dismiss
    let collections: [Collection]
    let onSelect: (String) -> Void

    var body: some View {
        NavigationStack {
            List(collections) { collection in
                Button {
                    onSelect(collection.id)
                } label: {
                    HStack {
                        Circle()
                            .fill(Color.fromHex(collection.colorHex))
                            .frame(width: 12, height: 12)
                        Text(collection.name)
                        Spacer()
                        Text("\(collection.totalCopies)")
                            .foregroundStyle(.secondary)
                    }
                }
                .foregroundStyle(.primary)
            }
            .navigationTitle("Choose Binder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Set Card Cell
private struct SetCardCell: View {
    let card: Card
    let showPricing: Bool
    var isOwned: Bool?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topTrailing) {
                CachedAsyncImage(card: card) { phase in
                    switch phase {
                    case .empty:
                        Rectangle()
                            .fill(Color(.systemGray5))
                            .aspectRatio(0.7, contentMode: .fit)
                            .overlay(ProgressView())
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    case .failure:
                        Rectangle()
                            .fill(Color(.systemGray5))
                            .aspectRatio(0.7, contentMode: .fit)
                            .overlay(
                                Image(systemName: "photo")
                                    .foregroundColor(.secondary)
                            )
                    @unknown default:
                        Rectangle()
                            .fill(Color(.systemGray5))
                            .aspectRatio(0.7, contentMode: .fit)
                    }
                }
                .cornerRadius(8)

                if isOwned == true {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundColor(.green)
                        .background(Circle().fill(Color.white).frame(width: 14, height: 14))
                        .offset(x: -4, y: 4)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                if let rarity = card.rarity {
                    PokemonRarityBadge(rarity: rarity, tcg: card.tcg)
                }

                Text(card.name)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(2, reservesSpace: true)

                if let collectorNumber = card.collectorNumber {
                    Text("#\(collectorNumber)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }

                if showPricing, let price = card.price {
                    Text(price.priceText)
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .foregroundColor(.green)
                }
            }
        }
        .padding(8)
        .background(Color(.systemGray6))
        .cornerRadius(12)
        .contentShape(Rectangle())
        .opacity(isOwned == false ? 0.6 : 1.0)
    }
}
