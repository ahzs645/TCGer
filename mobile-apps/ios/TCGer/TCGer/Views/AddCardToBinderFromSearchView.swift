import SwiftUI

struct AddCardToBinderFromSearchView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss

    let binderId: String
    let onCardAdded: (String) async -> Void

    @State private var searchModel = CatalogCardSearchModel()
    @State private var selectedGame: TCGGame = .all
    @State private var addSheetCard: Card?
    @State private var scannerInput: CardScannerInput?

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
                        title: "Add a Card",
                        message: "Search by name, scan a card, or choose a photo to add to this binder."
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
                VStack(spacing: 8) {
                    HStack(spacing: 12) {
                        Button {
                            scannerInput = .camera
                        } label: {
                            Label("Scan card", systemImage: "camera.viewfinder")
                                .frame(maxWidth: .infinity)
                        }
                        .accessibilityIdentifier("addCard.scan")

                        Button {
                            scannerInput = .photoLibrary
                        } label: {
                            Label("Choose photo", systemImage: "photo")
                                .frame(maxWidth: .infinity)
                        }
                        .accessibilityIdentifier("addCard.photo")
                    }
                    .buttonStyle(.bordered)
                    .disabled(!canScanSelectedGame)
                    .padding(.horizontal)
                    .padding(.top, 8)

                    if !canScanSelectedGame {
                        Text("Scanning isn’t available for the selected game. You can still search by name.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal)
                    }
                    if environmentStore.shouldShowGamePicker {
                        GamePickerPills(
                            selection: $selectedGame,
                            games: environmentStore.gamePickerGames
                        )
                    }
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
            .fullScreenCover(item: $scannerInput, onDismiss: {
                Task { await onCardAdded(binderId) }
            }) { input in
                CardScannerView(
                    startingBinderID: binderId,
                    startingGame: selectedGame == .all ? nil : selectedGame,
                    initialInput: input,
                    onCardAdded: onCardAdded
                )
                .environmentObject(environmentStore)
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

    private var canScanSelectedGame: Bool {
        ScannerAssetStore.downloadableGames.contains {
            environmentStore.isGameEnabled($0) && (selectedGame == .all || selectedGame == $0)
        }
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
