import SwiftUI

struct SetDetailView: View {
    let set: TcgSet
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var cards: [Card] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedCard: Card?
    @State private var showingPrintSelection = false
    @State private var selectedPrint: Card?
    @State private var currentPrintOptions: [Card] = []
    @State private var addSheetCard: Card?

    private let apiService = APIService()

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
                            VStack(alignment: .leading, spacing: 4) {
                                Text(set.code.uppercased())
                                    .font(.caption)
                                    .fontWeight(.bold)
                                    .foregroundColor(.accentColor)
                                if let releaseDate = set.releaseDate {
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

                    LazyVGrid(columns: [
                        GridItem(.flexible()),
                        GridItem(.flexible())
                    ], spacing: 16) {
                        ForEach(cards) { card in
                            SetCardCell(card: card, showPricing: environmentStore.showPricing)
                                .cardPreviewContextMenu(card: card, onSelect: {
                                    Task { await handleCardSelection(card) }
                                })
                        }
                    }
                    .padding()
                }
            }
        }
        .navigationTitle(set.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadCards()
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
            selectedPrint = nil
            currentPrintOptions = []
            addSheetCard = nil
        }) { card in
            AddCardToBinderSheet(card: card) { binderId, quantity, condition, language, notes, isFoil, isSigned, isAltered in
                await addCardToBinder(
                    card: card,
                    binderId: binderId,
                    quantity: quantity,
                    condition: condition,
                    language: language,
                    notes: notes,
                    isFoil: isFoil,
                    isSigned: isSigned,
                    isAltered: isAltered
                )
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
                    selectedCard = nil
                }
            }
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
        isSigned: Bool = false,
        isAltered: Bool = false
    ) async {
        guard let token = environmentStore.authToken else { return }

        do {
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
                isSigned: isSigned,
                isAltered: isAltered,
                card: card
            )
        } catch {
            errorMessage = error.localizedDescription
        }
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

// MARK: - Set Card Cell
private struct SetCardCell: View {
    let card: Card
    let showPricing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
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
                }
            }
            .cornerRadius(8)

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

                if let collectorNumber = card.collectorNumber {
                    Text("#\(collectorNumber)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
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
