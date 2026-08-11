import SwiftUI

struct CardSearchView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var searchText = ""
    @State private var selectedGame: TCGGame = .all
    @State private var searchResults: [Card] = []
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

    var addToWishlistId: String?
    var onCardAdded: (() -> Void)?

    private let apiService = APIService()

    private var filteredSearchResults: [Card] {
        searchResults.filter { searchFilters.matches($0, game: selectedGame) }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search Results
                if isSearching {
                    ProgressView("Searching...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = errorMessage {
                    ErrorView(title: "Search Failed", message: error) {
                        Task { await performSearch() }
                    }
                } else if hasSearched && searchResults.isEmpty {
                    EmptySearchView()
                } else if hasSearched && filteredSearchResults.isEmpty {
                    FilteredSearchEmptyView {
                        clearSearchFilters()
                    }
                } else if !hasSearched {
                    InitialSearchView()
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
            .navigationTitle("Search Cards")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search for cards..."
            )
            .safeAreaBar(edge: .top, spacing: 0) {
                searchControlBar
            }
            .scrollEdgeEffectStyle(.soft, for: .top)
            .onSubmit(of: .search) {
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
            .onAppear {
                if let defaultGame = environmentStore.defaultGame,
                   let game = TCGGame(rawValue: defaultGame),
                   environmentStore.isGameEnabled(game),
                   !hasSearched {
                    selectedGame = game
                }
                validateSelectedGame()
            }
        }
    }

    private var searchControlBar: some View {
        VStack(spacing: 0) {
            if environmentStore.shouldShowGamePicker {
                GamePickerPills(
                    selection: Binding(
                        get: { selectedGame },
                        set: { selectGame($0) }
                    ),
                    games: environmentStore.gamePickerGames
                )
            }

            CardSearchFilterBar(
                filters: searchFilters,
                onOpen: { showingFilters = true },
                onClear: clearSearchFilters
            )

            if let wishlistId = addToWishlistId,
               hasSearched,
               !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Add every match")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            Text("Not just the results shown below")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        Button {
                            Task { await addAllMatches(to: wishlistId) }
                        } label: {
                            if isAddingAllMatches {
                                ProgressView().scaleEffect(0.8)
                            } else {
                                Text("Add all")
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .disabled(isAddingAllMatches)
                    }

                    Toggle("Keep this wishlist updated", isOn: $keepWishlistUpdated)
                        .font(.caption)

                    if let bulkWishlistStatus {
                        Text(bulkWishlistStatus)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 10)
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
                Task { @MainActor in
                    bulkWishlistStatus = "Adding \(sent) of \(total) cards…"
                }
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
            if let set = searchFilters.set {
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

    private var searchDescription: String {
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
            title: "Search Your TCG Collection",
            message: searchDescription
        )
    }
}
