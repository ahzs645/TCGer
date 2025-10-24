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
                        onCardTap: { card in
                            selectedCard = card
                        }
                    )
                }
            }
            .navigationTitle("Search Cards")
            .searchable(text: $searchText, prompt: "Search for cards...")
            .onSubmit(of: .search) {
                Task { await performSearch() }
            }
            .sheet(item: $selectedCard) { card in
                AddCardToBinderSheet(card: card) { binderId, quantity, condition, language, notes in
                    await addCardToBinder(
                        cardId: card.id,
                        binderId: binderId,
                        quantity: quantity,
                        condition: condition,
                        language: language,
                        notes: notes
                    )
                }
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
        }
    }

    private func validateSelectedGame() {
        if !environmentStore.isGameEnabled(selectedGame) {
            selectedGame = .all
        }
    }

    @MainActor
    private func addCardToBinder(
        cardId: String,
        binderId: String,
        quantity: Int,
        condition: String?,
        language: String?,
        notes: String?
    ) async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        // Find the card from search results to pass full data
        let card = searchResults.first { $0.id == cardId }

        do {
            try await apiService.addCardToBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: binderId,
                cardId: cardId,
                quantity: quantity,
                condition: condition,
                language: language,
                notes: notes,
                price: nil,
                acquisitionPrice: nil,
                card: card
            )
            addCardSuccessMessage = "Card added to binder successfully!"
        } catch {
            errorMessage = error.localizedDescription
        }
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
    let onCardTap: (Card) -> Void

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
                                CardCell(card: card, showPricing: showPricing)
                                    .onTapGesture {
                                        onCardTap(card)
                                    }
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

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Card Image
            AsyncImage(url: URL(string: card.imageUrlSmall ?? card.imageUrl ?? "")) { phase in
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

                if let setName = card.setName {
                    Text(setName)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
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
