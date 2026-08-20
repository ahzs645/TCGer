import SwiftUI

struct AddCardToBinderFromSearchView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss

    let binderId: String
    let onCardAdded: (String) async -> Void

    @State private var searchModel = CatalogCardSearchModel()
    @State private var selectedGame: TCGGame = .all
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
        @Bindable var searchModel = searchModel

        NavigationStack {
            VStack(spacing: 0) {
                // Search Results
                if searchModel.isSearching {
                    ProgressView("Searching...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = searchModel.errorMessage {
                    ErrorView(title: "Search Failed", message: error) {
                        Task { await performSearch() }
                    }
                } else if searchModel.hasSearched && searchModel.results.isEmpty {
                    EmptySearchView()
                } else if !searchModel.hasSearched {
                    SearchPlaceholderView(
                        icon: "magnifyingglass",
                        title: "Search for Cards",
                        message: "Search for cards to add to this binder."
                    )
                } else {
                    CardSearchResultsList(
                        cards: searchModel.results,
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
                text: $searchModel.query,
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
                if searchModel.hasSearched && !searchModel.normalizedQuery.isEmpty {
                    Task { await performSearch() }
                }
            }
            .onChange(of: searchModel.query) {
                searchModel.resetIfQueryIsEmpty()
            }
            .onAppear {
                if let defaultGame = environmentStore.defaultGame,
                   let game = TCGGame(rawValue: defaultGame),
                   environmentStore.isGameEnabled(game),
                   !searchModel.hasSearched {
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
        await searchModel.search(
            config: environmentStore.serverConfiguration,
            authToken: environmentStore.authToken,
            game: selectedGame
        )
    }
}
