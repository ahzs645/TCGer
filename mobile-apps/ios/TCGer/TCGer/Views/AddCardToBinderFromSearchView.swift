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
    @State private var addSheetCard: Card?

    private let apiService = APIService()

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Game Filter - Only show if more than one game is enabled
                if environmentStore.enabledGames.count > 1 {
                    GamePickerPills(
                        selection: $selectedGame,
                        games: environmentStore.gamePickerGames
                    )
                    .background(Color(.systemBackground))

                    Divider()
                }

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
                } else if !hasSearched {
                    SearchPlaceholderView(
                        icon: "magnifyingglass",
                        title: "Search for Cards",
                        message: "Search for cards to add to this binder."
                    )
                } else {
                    CardSearchResultsList(
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
                AddCardToBinderSheet(card: card) { binderId, details in
                    try await apiService.addCardToBinder(
                        config: environmentStore.serverConfiguration,
                        token: environmentStore.authToken,
                        binderId: binderId,
                        card: card,
                        details: details
                    )
                    dismiss()
                }
            }
            .onChange(of: environmentStore.enabledYugioh) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledMagic) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledPokemon) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledOnepiece) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledLorcana) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledDragonball) { validateSelectedGame() }
            .onChange(of: selectedGame) {
                if hasSearched && !searchText.isEmpty {
                    Task { await performSearch() }
                }
            }
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

