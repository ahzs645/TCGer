import SwiftUI

struct AddCardToBinderFromSearchView: View {
    let binderId: String
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var selectedGame: TCGGame = .all
    @State private var searchResults: [Card] = []
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var hasSearched = false
    @State private var selectedCard: Card?
    @State private var showingPrintSelection = false
    @State private var selectedPrint: Card?
    @State private var currentPrintOptions: [Card] = []

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
                        showCardNumbers: environmentStore.showCardNumbers,
                        onCardTap: { card in
                            Task { await handleCardSelection(card) }
                        }
                    )
                }
            }
            .navigationTitle("Add Card to Binder")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Search for cards...")
            .onSubmit(of: .search) {
                Task { await performSearch() }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
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
                // When print selection sheet is dismissed and we have a selected print,
                // keep selectedCard set so the add-to-binder sheet shows
                if !newValue && selectedPrint != nil && selectedCard?.supportsPrintSelection == true {
                    // Sheet will automatically show because selectedCard is still set
                }
            }
            .sheet(item: $selectedCard, onDismiss: {
                // Clean up state when sheet is dismissed
                selectedPrint = nil
                currentPrintOptions = []
            }) { card in
                // Cards that support print selection only proceed once the picker is complete
                let requiresPrintSelection = card.supportsPrintSelection
                let shouldShowForPrintSupported = requiresPrintSelection && !showingPrintSelection && selectedPrint != nil
                let shouldShowForOthers = !requiresPrintSelection

                if shouldShowForPrintSupported {
                    if let print = selectedPrint {
                        AddCardToBinderSheet(card: print) { binderId, quantity, condition, language, notes in
                            await addCardToBinder(
                                cardId: print.id,
                                binderId: binderId,
                                quantity: quantity,
                                condition: condition,
                                language: language,
                                notes: notes
                            )
                        }
                    }
                } else if shouldShowForOthers {
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
                selectedCard = card
                showingPrintSelection = false
            }
        }
    }

    private func preparePrintSelection(for card: Card) async {
        await MainActor.run {
            selectedCard = card
            selectedPrint = nil
            currentPrintOptions = []
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
                    selectedPrint = nil
                    currentPrintOptions = []
                    showingPrintSelection = false
                }
            }
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
            dismiss()
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
    let showCardNumbers: Bool
    let onCardTap: (Card) -> Void

    var groupedCards: [(String, [Card])] {
        if selectedGame != .all {
            return [(selectedGame.rawValue, cards)]
        }

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
    let showCardNumbers: Bool

    private var supportsPrintSelection: Bool {
        card.supportsPrintSelection
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topTrailing) {
                CachedAsyncImage(url: URL(string: card.imageUrlSmall ?? card.imageUrl ?? "")) { phase in
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
                            .overlay(
                                Image(systemName: "photo")
                                    .foregroundColor(.secondary)
                            )
                    }
                }
            }
            .cornerRadius(8)

            // Print selection indicator for games that support multiple printings
            if supportsPrintSelection {
                Image(systemName: "doc.on.doc.fill")
                    .font(.caption2)
                    .foregroundColor(.white)
                    .padding(4)
                    .background(Color.accentColor)
                    .cornerRadius(6)
                    .padding(6)
            }

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
            Text("Search for Cards")
                .font(.title2)
                .fontWeight(.semibold)
            Text("Search for cards to add to this binder.")
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
