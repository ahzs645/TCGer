import SwiftUI

struct CardSearchView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var searchText = ""
    @State private var selectedGame: TCGGame = .all
    @State private var searchResults: [Card] = []
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var hasSearched = false
    @State private var selectedCard: Card?
    @State private var addCardSuccessMessage: String?
    @State private var showingPrintSelection = false
    @State private var selectedPrint: Card?
    @State private var currentPrintOptions: [Card] = []
    @State private var addSheetCard: Card?
    @State private var wishlistSheetCard: Card?
    @State private var isAddingAllMatches = false
    @State private var bulkWishlistStatus: String?
    @State private var keepWishlistUpdated = true

    var addToWishlistId: String?
    var onCardAdded: (() -> Void)?

    private let apiService = APIService()

    var availableGames: [TCGGame] {
        var games: [TCGGame] = [.all]
        games.append(contentsOf: environmentStore.enabledGames)
        return games
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Game Filter - Only show if more than one game is enabled
                if environmentStore.enabledGames.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(availableGames) { game in
                                GameFilterChip(
                                    game: game,
                                    isSelected: selectedGame == game
                                ) {
                                    selectedGame = game
                                    if hasSearched && !searchText.isEmpty {
                                        Task { await performSearch() }
                                    }
                                }
                            }
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 12)
                    }
                    .background(Color(.systemBackground))

                    Divider()
                }

                // Bulk add banner — only when this search is feeding a wishlist
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
                    .background(Color(.secondarySystemBackground))

                    Divider()
                }

                // Search Results
                if isSearching {
                    ProgressView("Searching...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = errorMessage {
                    ErrorView(message: error) {
                        Task { await performSearch() }
                    }
                } else if hasSearched && searchResults.isEmpty {
                    EmptySearchView()
                } else if !hasSearched {
                    InitialSearchView()
                } else {
                    SearchResultsList(
                        cards: searchResults,
                        selectedGame: selectedGame,
                        enabledGames: environmentStore.enabledGames,
                        showPricing: environmentStore.showPricing,
                        showCardNumbers: environmentStore.showCardNumbers,
                        onCardTap: { card in
                            Task { await handleCardSelection(card) }
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
            .searchable(text: $searchText, prompt: "Search for cards...")
            .onSubmit(of: .search) {
                Task { await performSearch() }
            }
            .sheet(isPresented: $showingPrintSelection) {
                if let card = selectedCard {
                    SelectPrintSheet(
                        card: card,
                        selectedPrint: $selectedPrint,
                        initialPrints: currentPrintOptions,
                        onCancel: {
                            selectedPrint = nil
                            selectedCard = nil
                            currentPrintOptions = []
                        }
                    )
                    .environmentObject(environmentStore)
                }
            }
            .onChange(of: showingPrintSelection) { oldValue, newValue in
                if !newValue,
                   let baseCard = selectedCard,
                   baseCard.supportsPrintSelection,
                   let chosenPrint = selectedPrint {
                    addSheetCard = chosenPrint
                    selectedCard = nil
                }
            }
            .sheet(item: $addSheetCard, onDismiss: {
                // Clean up state when sheet is dismissed
                selectedPrint = nil
                currentPrintOptions = []
                addSheetCard = nil
            }) { card in
                AddCardToBinderSheet(card: card) { binderId, quantity, condition, language, notes, isFoil, isSigned, isAltered, variant in
                    try await addCardToBinder(
                        card: card,
                        binderId: binderId,
                        quantity: quantity,
                        condition: condition,
                        language: language,
                        notes: notes,
                        isFoil: isFoil,
                        variant: variant,
                        isSigned: isSigned,
                        isAltered: isAltered
                    )
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
            }
        }
    }

    private func handleCardSelection(_ card: Card) async {
        if card.supportsPrintSelection {
            await preparePrintSelection(for: card)
        } else {
            await MainActor.run {
                currentPrintOptions = []
                selectedPrint = nil
                selectedCard = nil
                addSheetCard = card
                showingPrintSelection = false
            }
        }
    }

    private func preparePrintSelection(for card: Card) async {
        await MainActor.run {
            selectedCard = card
            selectedPrint = nil
            currentPrintOptions = []
            addSheetCard = nil
            showingPrintSelection = false
        }

        guard let token = environmentStore.authToken else {
            await MainActor.run {
                errorMessage = "Not authenticated"
                selectedCard = nil
            }
            return
        }

        do {
            let prints = try await apiService.getCardPrints(
                config: environmentStore.serverConfiguration,
                token: token,
                tcg: card.tcg,
                cardId: card.id
            )

            await MainActor.run {
                guard selectedCard?.id == card.id else { return }

                currentPrintOptions = prints
                selectedPrint = prints.first ?? card

                if prints.count <= 1 {
                    addSheetCard = selectedPrint
                    selectedCard = nil
                    showingPrintSelection = false
                } else {
                    showingPrintSelection = true
                }
            }
        } catch {
            await MainActor.run {
                if selectedCard?.id == card.id {
                    errorMessage = error.localizedDescription
                    selectedCard = nil
                    addSheetCard = nil
                    selectedPrint = nil
                    currentPrintOptions = []
                    showingPrintSelection = false
                }
            }
        }
    }

    private func validateSelectedGame() {
        if !environmentStore.isGameEnabled(selectedGame) {
            selectedGame = .all
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
            token: token
        )

        do {
            let matches = try await apiService.searchAllCards(
                config: environmentStore.serverConfiguration,
                token: token,
                query: query,
                game: selectedGame
            )

            guard !matches.isEmpty else {
                bulkWishlistStatus = "No cards found for \"\(query)\"."
                return
            }

            try await service.addCards(matches, toWishlist: wishlistId) { sent, total in
                Task { @MainActor in
                    bulkWishlistStatus = "Adding \(sent) of \(total) cards…"
                }
            }

            if keepWishlistUpdated {
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

            bulkWishlistStatus = "Added \(matches.count) card\(matches.count == 1 ? "" : "s") for \"\(query)\"."
            HapticManager.notification(.success)
            onCardAdded?()
        } catch {
            bulkWishlistStatus = error.localizedDescription
        }
    }

    @MainActor
    private func addCardToBinder(
        card: Card,
        binderId: String,
        quantity: Int,
        condition: String?,
        language: String?,
        notes: String?,
        isFoil: Bool = false,
        variant: CardCopyVariant = .empty,
        isSigned: Bool = false,
        isAltered: Bool = false
    ) async throws {
        guard let token = environmentStore.authToken else {
            throw APIService.APIError.unauthorized
        }

        try await apiService.addCardToBinder(
            config: environmentStore.serverConfiguration,
            token: token,
            binderId: binderId,
            cardId: card.id,
            quantity: quantity,
            condition: condition,
            language: language,
            notes: notes,
            price: card.price,
            acquisitionPrice: nil,
            isFoil: isFoil,
            variant: variant,
            isSigned: isSigned,
            isAltered: isAltered,
            card: card
        )
        addCardSuccessMessage = "Card added to binder successfully!"
    }

    @MainActor
    private func performSearch() async {
        guard !searchText.isEmpty else {
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
            let response = try await apiService.searchCards(
                config: environmentStore.serverConfiguration,
                token: token,
                query: searchText,
                game: selectedGame
            )
            searchResults = response.cards
            isSearching = false
        } catch {
            errorMessage = error.localizedDescription
            isSearching = false
        }
    }
}

// MARK: - Game Filter Chip
private struct GameFilterChip: View {
    let game: TCGGame
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let customIcon = game.iconName {
                    Image(customIcon)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 14, height: 14)
                        .foregroundColor(isSelected ? .white : .accentColor)
                } else {
                    Image(systemName: game.systemIconName)
                        .font(.caption)
                        .foregroundColor(isSelected ? .white : .primary)
                }
                Text(game.displayName)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(isSelected ? Color.accentColor : Color(.systemGray5))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(20)
        }
    }
}

// MARK: - Search Results List
private struct SearchResultsList: View {
    let cards: [Card]
    let selectedGame: TCGGame
    let enabledGames: [TCGGame]
    let showPricing: Bool
    let showCardNumbers: Bool
    let onCardTap: (Card) -> Void
    var onAddToWishlist: ((Card) -> Void)?

    // Group cards by TCG
    var groupedCards: [(String, [Card])] {
        if selectedGame != .all {
            return [(selectedGame.rawValue, cards)]
        }

        // Filter cards to only include enabled games
        let enabledGameRawValues = Set(enabledGames.map { $0.rawValue })
        let filteredCards = cards.filter { card in
            enabledGameRawValues.contains(card.tcg)
        }

        let groups = Dictionary(grouping: filteredCards, by: { $0.tcg })
        return groups.sorted { $0.key < $1.key }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 20, pinnedViews: [.sectionHeaders]) {
                ForEach(groupedCards, id: \.0) { tcg, tcgCards in
                    Section {
                        LazyVGrid(columns: [
                            GridItem(.flexible()),
                            GridItem(.flexible())
                        ], spacing: 16) {
                            ForEach(tcgCards) { card in
                                CardCell(card: card, showPricing: showPricing, showCardNumbers: showCardNumbers)
                                    .cardPreviewContextMenu(card: card, onSelect: { onCardTap(card) }, onAddToWishlist: {
                                        onAddToWishlist?(card)
                                    })
                            }
                        }
                    } header: {
                        HStack {
                            Text(tcgCards.first?.tcgDisplayName ?? tcg.uppercased())
                                .font(.headline)
                                .padding(.horizontal)
                            Spacer()
                            Text("\(tcgCards.count) cards")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .padding(.horizontal)
                        }
                        .padding(.vertical, 8)
                        .background(Color(.systemBackground))
                    }
                }
            }
            .padding()
        }
    }
}

// MARK: - Card Cell
private struct CardCell: View {
    let card: Card
    let showPricing: Bool
    let showCardNumbers: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Card Image
            CachedAsyncImage(card: card) { phase in
                switch phase {
                case .empty:
                    Rectangle()
                        .fill(Color(.systemGray5))
                        .aspectRatio(0.7, contentMode: .fit)
                        .overlay(
                            ProgressView()
                        )
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
                        .overlay(
                            Image(systemName: "photo")
                                .foregroundColor(.secondary)
                        )
                }
            }
            .cornerRadius(8)

            // Card Info
            VStack(alignment: .leading, spacing: 4) {
                if let rarity = card.rarity {
                    Text(rarity)
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.accentColor.opacity(0.2))
                        .foregroundColor(.accentColor)
                        .cornerRadius(4)
                }

                Text(card.name)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(2)

                if showCardNumbers, let setName = card.setName {
                    Text(setName)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                // Pokemon TCG format legality & dex number
                if card.tcg == "pokemon" {
                    HStack(spacing: 4) {
                        if let supertype = card.supertype {
                            Text(supertype)
                                .font(.system(size: 9))
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Color(.systemGray4))
                                .cornerRadius(3)
                        }
                        if card.formatLegality?.standard == true {
                            Text("Standard")
                                .font(.system(size: 9))
                                .foregroundColor(.green)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Color.green.opacity(0.15))
                                .cornerRadius(3)
                        }
                        if card.formatLegality?.expanded == true {
                            Text("Expanded")
                                .font(.system(size: 9))
                                .foregroundColor(.blue)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Color.blue.opacity(0.15))
                                .cornerRadius(3)
                        }
                        if let dexNum = card.pokedexNumber {
                            Text("#\(dexNum)")
                                .font(.system(size: 9))
                                .foregroundColor(.secondary)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Color(.systemGray5))
                                .cornerRadius(3)
                        }
                    }
                }

                if showPricing, let price = card.price {
                    Text("$\(String(format: "%.2f", price))")
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
    }
}

// MARK: - Initial Search View
private struct InitialSearchView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            Text("Search Your TCG Collection")
                .font(.title2)
                .fontWeight(.semibold)
            Text("Search for Yu-Gi-Oh!, Magic, or Pokémon cards by name, set, or code.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Empty Search View
private struct EmptySearchView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "questionmark.folder")
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            Text("No Cards Found")
                .font(.title2)
                .fontWeight(.semibold)
            Text("Try a different search term or game filter.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error View
private struct ErrorView: View {
    let message: String
    let retryAction: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 50))
                .foregroundColor(.orange)
            Text("Search Failed")
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            Button("Try Again", action: retryAction)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
