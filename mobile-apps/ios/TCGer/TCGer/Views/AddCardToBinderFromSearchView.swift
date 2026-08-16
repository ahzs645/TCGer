import SwiftUI

struct AddCardToBinderFromSearchView: View {
    let binderId: String
    let onCardAdded: (String) async -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var selectedGame: TCGGame = .all
    @State private var searchResults: [Card] = []
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var hasSearched = false
    @State private var addSheetCard: Card?

    private let apiService = APIService()

    init(
        binderId: String,
        onCardAdded: @escaping (String) async -> Void = { _ in }
    ) {
        self.binderId = binderId
        self.onCardAdded = onCardAdded
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
                            addSheetCard = card
                        }
                    )
                }
            }
            .navigationTitle("Add Card to Binder")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search for cards..."
            )
            .safeAreaBar(edge: .top, spacing: 0) {
                if environmentStore.shouldShowGamePicker {
                    GamePickerPills(
                        selection: $selectedGame,
                        games: environmentStore.gamePickerGames
                    )
                }
            }
            .scrollEdgeEffectStyle(.soft, for: .top)
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
            .sheet(item: $addSheetCard, onDismiss: {
                addSheetCard = nil
            }) { card in
                AddCardToBinderSheet(card: card, initialBinderId: binderId) { selectedCard, binderId, details in
                    try await apiService.addCardToBinder(
                        config: environmentStore.serverConfiguration,
                        token: environmentStore.authToken,
                        binderId: binderId,
                        card: selectedCard,
                        details: details
                    )
                    await onCardAdded(binderId)
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
                validateSelectedGame()
            }
        }
    }

    private func validateSelectedGame() {
        selectedGame = environmentStore.resolvedGameSelection(selectedGame)
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
