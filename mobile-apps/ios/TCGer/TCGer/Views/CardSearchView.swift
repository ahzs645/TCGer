import SwiftUI

private enum CardSearchScope: String, CaseIterable, Identifiable {
    case catalog = "All Cards"
    case collection = "My Collection"

    var id: String { rawValue }
}

private struct OwnedCardSearchResult: Identifiable {
    let collection: Collection
    let card: CollectionCard

    var id: String { "\(collection.id):\(card.id)" }
    var previewCard: Card { card.previewCard }
}

struct CardSearchView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var searchText: String
    @State private var isSearchPresented = false
    @State private var searchScope = CardSearchScope.catalog
    @State private var selectedGame: TCGGame = .all
    @State private var searchResults: [Card] = []
    @State private var ownedSearchResults: [OwnedCardSearchResult] = []
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var hasSearched = false
    @State private var detailCard: Card?
    @State private var addCardSuccessMessage: String?
    @State private var addSheetCard: Card?
    @State private var wishlistSheetCard: Card?
    @State private var isAddingAllMatches = false
    @State private var bulkWishlistStatus: String?
    @State private var keepWishlistUpdated = true
    @State private var showingFilters = false
    @State private var searchFilters = CardSearchFilterState()
    @State private var selectedOwnedResult: OwnedCardSearchResult?
    @State private var loadedCollections: [Collection]?

    private let initialSearchText: String

    var addToWishlistId: String?
    var onCardAdded: (() -> Void)?

    private let apiService = APIService()

    init(
        initialSearchText: String = "",
        addToWishlistId: String? = nil,
        onCardAdded: (() -> Void)? = nil
    ) {
        self.initialSearchText = initialSearchText
        _searchText = State(initialValue: initialSearchText)
        self.addToWishlistId = addToWishlistId
        self.onCardAdded = onCardAdded
    }

    private var filteredSearchResults: [Card] {
        searchResults.filter { searchFilters.matches($0, game: selectedGame) }
    }

    private var filteredOwnedSearchResults: [OwnedCardSearchResult] {
        ownedSearchResults.filter {
            searchFilters.matches($0.previewCard, game: selectedGame)
        }
    }

    private var hasOwnedCards: Bool {
        loadedCollections?.contains(where: { !$0.cards.isEmpty }) == true
    }

    private var rawResultsAreEmpty: Bool {
        switch searchScope {
        case .catalog: searchResults.isEmpty
        case .collection: ownedSearchResults.isEmpty
        }
    }

    private var filteredResultsAreEmpty: Bool {
        switch searchScope {
        case .catalog: filteredSearchResults.isEmpty
        case .collection: filteredOwnedSearchResults.isEmpty
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isSearching {
                    ProgressView("Searching...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = errorMessage {
                    ErrorView(title: "Search Failed", message: error) {
                        Task { await performSearch() }
                    }
                } else if hasSearched && rawResultsAreEmpty {
                    if searchScope == .collection {
                        SearchPlaceholderView(
                            icon: "rectangle.stack.badge.minus",
                            title: "No Owned Cards Found",
                            message: "No cards in your binders match this search."
                        )
                    } else {
                        EmptySearchView()
                    }
                } else if hasSearched && filteredResultsAreEmpty {
                    FilteredSearchEmptyView {
                        clearSearchFilters()
                    }
                } else if !hasSearched {
                    InitialSearchView(scope: searchScope)
                } else if searchScope == .collection {
                    OwnedCardSearchResultsList(
                        results: filteredOwnedSearchResults,
                        showPricing: environmentStore.showPricing,
                        showCardNumbers: environmentStore.showCardNumbers,
                        onOpenBinder: { result in
                            selectedOwnedResult = result
                        },
                        onShowDetails: { result in
                            detailCard = result.previewCard
                        }
                    )
                } else {
                    CardSearchResultsList(
                        cards: filteredSearchResults,
                        selectedGame: selectedGame,
                        enabledGames: environmentStore.enabledGames,
                        showPricing: environmentStore.showPricing,
                        showCardNumbers: environmentStore.showCardNumbers,
                        onCardTap: { card in
                            addSheetCard = card
                        },
                        onShowDetails: { card in
                            detailCard = card
                        },
                        onAddToWishlist: { card in
                            if let wishlistId = addToWishlistId {
                                Task { await addCardToWishlistDirectly(card: card, wishlistId: wishlistId) }
                            } else {
                                wishlistSheetCard = card
                            }
                        }
                    )
                }
            }
            .safeAreaBar(edge: .top, spacing: 0) {
                supplementalSearchControls
            }
            .navigationTitle("Search Cards")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: $searchText,
                isPresented: $isSearchPresented,
                prompt: "Cards, sets, or codes"
            )
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }

                ToolbarItem(placement: .bottomBar) {
                    Button {
                        showingFilters = true
                    } label: {
                        Label(
                            searchFilters.isActive ? "Filters, \(searchFilters.activeCount) active" : "Filters",
                            systemImage: searchFilters.isActive
                                ? "line.3.horizontal.decrease.circle.fill"
                                : "line.3.horizontal.decrease.circle"
                        )
                    }
                    .badge(searchFilters.activeCount)
                }

                ToolbarSpacer(.flexible, placement: .bottomBar)
                DefaultToolbarItem(kind: .search, placement: .bottomBar)
            }
            .scrollEdgeEffectStyle(.soft, for: .top)
            .onSubmit(of: .search) {
                isSearchPresented = false
                Task { await performSearch() }
            }
            .sheet(isPresented: $showingFilters) {
                CardSearchFilterSheet(
                    game: selectedGame,
                    filters: searchFilters,
                    resultCards: searchResults
                ) { game, filters in
                    selectedGame = game
                    searchFilters = filters
                    if hasSearched && !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Task { await performSearch() }
                    }
                }
                .environmentObject(environmentStore)
            }
            .sheet(item: $detailCard) { card in
                CardDetailSheet(
                    card: card,
                    showPricing: environmentStore.showPricing,
                    showCardNumbers: environmentStore.showCardNumbers
                )
            }
            .sheet(item: $selectedOwnedResult) { result in
                CollectionDetailView(
                    collection: result.collection,
                    initialSearchText: result.card.name
                )
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
                    addCardSuccessMessage = "Card added to binder successfully!"
                }
            }
            .sheet(item: $wishlistSheetCard) { card in
                AddToWishlistSheet(card: card)
                    .environmentObject(environmentStore)
            }
            .alert("Success", isPresented: Binding(
                get: { addCardSuccessMessage != nil },
                set: { if !$0 { addCardSuccessMessage = nil } }
            )) {
                Button("OK") {
                    addCardSuccessMessage = nil
                }
            } message: {
                Text(addCardSuccessMessage ?? "")
            }
            .onChange(of: environmentStore.enabledYugioh) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledMagic) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledPokemon) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledOnepiece) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledLorcana) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledDragonball) { validateSelectedGame() }
            .onReceive(NotificationCenter.default.publisher(for: .collectionDidChange)) { _ in
                loadedCollections = nil
                Task { await loadCollectionAvailability() }
            }
            .onChange(of: searchScope) {
                searchResults = []
                ownedSearchResults = []
                errorMessage = nil
                hasSearched = false
                if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Task { await performSearch() }
                }
            }
            .onChange(of: initialSearchText) { _, nextQuery in
                guard nextQuery != searchText else { return }
                searchText = nextQuery
                hasSearched = false
                Task { await performSearch() }
            }
            .onAppear {
                if let defaultGame = environmentStore.defaultGame,
                   let game = TCGGame(rawValue: defaultGame),
                   environmentStore.isGameEnabled(game),
                   !hasSearched {
                    selectedGame = game
                }
                validateSelectedGame()
            }
            .task {
                await loadCollectionAvailability()
                if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                   !hasSearched {
                    await performSearch()
                }
            }
        }
    }

    @ViewBuilder
    private var supplementalSearchControls: some View {
        VStack(spacing: 0) {
            if addToWishlistId == nil,
               hasOwnedCards {
                Picker("Search Scope", selection: $searchScope) {
                    ForEach(CardSearchScope.allCases) { scope in
                        Text(scope.rawValue).tag(scope)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)
            }

            if environmentStore.shouldShowGamePicker {
                GamePickerPills(
                    selection: Binding(
                        get: { selectedGame },
                        set: { selectGame($0) }
                    ),
                    games: environmentStore.gamePickerGames
                )
                .padding(.vertical, 8)
            }

            if let wishlistId = addToWishlistId,
               hasSearched,
               !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 12) {
                        Image(systemName: "rectangle.stack.badge.plus")
                            .font(.title3)
                            .foregroundStyle(.tint)
                            .frame(width: 28)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Add All Matches")
                                .font(.subheadline.weight(.semibold))
                            Text("Includes cards beyond this preview")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Button {
                            Task { await addAllMatches(to: wishlistId) }
                        } label: {
                            if isAddingAllMatches {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Text("Add All")
                            }
                        }
                        .buttonStyle(.glassProminent)
                        .disabled(isAddingAllMatches)
                    }

                    Toggle(isOn: $keepWishlistUpdated) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Keep Wishlist Updated")
                                .font(.subheadline)
                            Text("Automatically add future matches")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let bulkWishlistStatus {
                        Label(bulkWishlistStatus, systemImage: "info.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 12)
            }
        }
    }

    private func validateSelectedGame() {
        let resolvedGame = environmentStore.resolvedGameSelection(selectedGame)
        if resolvedGame != selectedGame {
            selectedGame = resolvedGame
            searchFilters.clearIncompatibleValues(for: resolvedGame)
            if hasSearched && !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Task { await performSearch() }
            }
        }
    }

    private func selectGame(_ game: TCGGame) {
        guard game != selectedGame else { return }
        selectedGame = game
        searchFilters.clearIncompatibleValues(for: game)
        if hasSearched && !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Task { await performSearch() }
        }
    }

    private func clearSearchFilters() {
        guard searchFilters.isActive else { return }
        searchFilters = CardSearchFilterState()
        if hasSearched && !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Task { await performSearch() }
        }
    }

    @MainActor
    private func loadCollectionAvailability() async {
        guard loadedCollections == nil else { return }

        do {
            let collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: environmentStore.authToken,
                useCache: environmentStore.offlineModeEnabled && environmentStore.isAuthenticated
            )
            loadedCollections = collections
            if !hasOwnedCards, searchScope == .collection {
                searchScope = .catalog
            }
        } catch {
            // Availability is supplemental; catalog search should remain usable
            // if collections cannot be loaded.
        }
    }

    @MainActor
    private func addCardToWishlistDirectly(card: Card, wishlistId: String) async {
        guard let token = environmentStore.authToken else { return }
        do {
            _ = try await apiService.addCardToWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                wishlistId: wishlistId,
                card: card
            )
            addCardSuccessMessage = "Added \(card.name) to wishlist"
            onCardAdded?()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Adds every card matching the current query — the exhaustive search, not
    /// the preview page — and optionally saves it as a rule.
    @MainActor
    private func addAllMatches(to wishlistId: String) async {
        guard let token = environmentStore.authToken else { return }
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }

        isAddingAllMatches = true
        bulkWishlistStatus = "Searching every printing…"
        defer { isAddingAllMatches = false }

        let service = WishlistSyncService(
            apiService: apiService,
            config: environmentStore.serverConfiguration,
            token: token,
            enabledGames: environmentStore.enabledGames
        )

        do {
            let matches = try await apiService.searchAllCards(
                config: environmentStore.serverConfiguration,
                token: token,
                query: query,
                game: selectedGame
            )
            let enabledGameRawValues = Set(
                environmentStore.enabledGames.map { $0.rawValue.lowercased() }
            )
            let enabledMatches = matches.filter {
                enabledGameRawValues.contains($0.tcg.lowercased()) &&
                    searchFilters.matches($0, game: selectedGame)
            }

            guard !enabledMatches.isEmpty else {
                bulkWishlistStatus = "No cards found for \"\(query)\"."
                return
            }

            try await service.addCards(enabledMatches, toWishlist: wishlistId) { sent, total in
                bulkWishlistStatus = "Adding \(sent) of \(total) cards…"
            }

            if keepWishlistUpdated && !searchFilters.isActive {
                _ = try await apiService.addWishlistRule(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    wishlistId: wishlistId,
                    type: .name,
                    tcg: selectedGame == .all ? nil : selectedGame.rawValue,
                    query: query,
                    includeAllPrintings: true,
                    autoSync: true
                )
            }

            bulkWishlistStatus = "Added \(enabledMatches.count) card\(enabledMatches.count == 1 ? "" : "s") for \"\(query)\"."
            HapticManager.notification(.success)
            onCardAdded?()
        } catch {
            bulkWishlistStatus = error.localizedDescription
        }
    }

    @MainActor
    private func performSearch() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            hasSearched = false
            searchResults = []
            ownedSearchResults = []
            return
        }

        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        isSearching = true
        errorMessage = nil
        hasSearched = true

        do {
            if searchScope == .collection {
                let collections: [Collection]
                if let loadedCollections {
                    collections = loadedCollections
                } else {
                    collections = try await apiService.getCollections(
                        config: environmentStore.serverConfiguration,
                        token: token,
                        useCache: environmentStore.offlineModeEnabled
                    )
                    self.loadedCollections = collections
                }
                ownedSearchResults = collections.flatMap { collection in
                    collection.cards.compactMap { card in
                        let preview = card.previewCard
                        guard selectedGame == .all ||
                                preview.tcg.caseInsensitiveCompare(selectedGame.rawValue) == .orderedSame,
                              preview.matchesSearchText(query) else {
                            return nil
                        }
                        return OwnedCardSearchResult(collection: collection, card: card)
                    }
                }
                .sorted {
                    let nameOrder = $0.card.name.localizedCaseInsensitiveCompare($1.card.name)
                    if nameOrder != .orderedSame { return nameOrder == .orderedAscending }
                    return $0.collection.name.localizedCaseInsensitiveCompare($1.collection.name) == .orderedAscending
                }
                searchResults = ownedSearchResults.map(\.previewCard)
            } else if let set = searchFilters.set {
                let cards = try await apiService.getSetCards(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    tcg: set.tcg,
                    setCode: set.code
                )
                searchResults = cards.filter { $0.matchesSearchText(query) }
            } else if searchFilters.hasDetailFilters {
                searchResults = try await apiService.searchAllCards(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    query: query,
                    game: selectedGame
                )
            } else {
                let response = try await apiService.searchCards(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    query: query,
                    game: selectedGame
                )
                searchResults = response.cards
            }
            isSearching = false
        } catch {
            errorMessage = error.localizedDescription
            isSearching = false
        }
    }
}

private extension Card {
    func matchesSearchText(_ query: String) -> Bool {
        let queryKey = SearchTextNormalizer.key(query)
        let worldsFields = pokemonPrint?.worldChampionship.map { worlds in
            [
                name,
                setName,
                setCode,
                String(worlds.year),
                worlds.playerName,
                worlds.deckName,
                worlds.stamp,
                "world worlds world championship wcd replica memorabilia"
            ].compactMap { $0 }
        } ?? []
        let worldsMatch = pokemonPrint?.worldChampionship != nil &&
            SearchTextNormalizer.termKeys(query).allSatisfy { term in
                worldsFields.contains { SearchTextNormalizer.contains($0, queryKey: term) }
            }
        return SearchTextNormalizer.contains(name, queryKey: queryKey) ||
            SearchTextNormalizer.contains(collectorNumber, queryKey: queryKey) ||
            SearchTextNormalizer.contains(rarity, queryKey: queryKey) ||
            SearchTextNormalizer.contains(setCode, queryKey: queryKey) ||
            SearchTextNormalizer.contains(setName, queryKey: queryKey) ||
            SearchTextNormalizer.contains(pokemonPrint?.worldChampionship?.playerName, queryKey: queryKey) ||
            SearchTextNormalizer.contains(pokemonPrint?.worldChampionship?.deckName, queryKey: queryKey) ||
            pokemonPrint?.worldChampionship.map { String($0.year) == queryKey } == true ||
            worldsMatch
    }
}

private struct FilteredSearchEmptyView: View {
    let onClear: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("No Cards Match These Filters")
                .font(.headline)
            Text("Try another set or remove one of the filters.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Clear Filters", action: onClear)
                .buttonStyle(.borderedProminent)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Initial Search View
private struct InitialSearchView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    let scope: CardSearchScope

    private var searchDescription: String {
        if scope == .collection {
            return "Search cards you own across every binder by name, set, number, or rarity."
        }
        let gameNames = environmentStore.enabledGames.map(\.shortName)
        guard !gameNames.isEmpty else {
            return "Search cards by name, set, or code."
        }

        let gameList: String
        switch gameNames.count {
        case 1:
            gameList = gameNames[0]
        case 2:
            gameList = gameNames.joined(separator: " or ")
        default:
            gameList = "\(gameNames.dropLast().joined(separator: ", ")), or \(gameNames.last!)"
        }
        return "Search for \(gameList) cards by name, set, or code."
    }

    var body: some View {
        SearchPlaceholderView(
            icon: "magnifyingglass",
            title: scope == .collection ? "Search My Collection" : "Search All Cards",
            message: searchDescription
        )
    }
}

private struct OwnedCardSearchResultsList: View {
    let results: [OwnedCardSearchResult]
    let showPricing: Bool
    let showCardNumbers: Bool
    let onOpenBinder: (OwnedCardSearchResult) -> Void
    let onShowDetails: (OwnedCardSearchResult) -> Void

    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(results) { result in
                    Button {
                        onOpenBinder(result)
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            CardSearchResultCell(
                                card: result.previewCard,
                                showPricing: showPricing,
                                showCardNumbers: showCardNumbers
                            )

                            HStack(spacing: 6) {
                                Image(systemName: result.collection.isUnsortedBinder ? "tray" : "folder")
                                Text(result.collection.name)
                                    .lineLimit(1)
                                Spacer(minLength: 4)
                                Text("×\(result.card.quantity)")
                                    .fontWeight(.semibold)
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 4)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens \(result.collection.name) filtered to this card")
                    .contextMenu {
                        Button {
                            onOpenBinder(result)
                        } label: {
                            Label("Open Binder", systemImage: "folder")
                        }
                        Button {
                            onShowDetails(result)
                        } label: {
                            Label("Card Details", systemImage: "info.circle")
                        }
                    }
                }
            }
            .padding()
        }
    }
}
