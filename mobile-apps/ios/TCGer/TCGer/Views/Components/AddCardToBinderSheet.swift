import SwiftUI

struct AddCardToBinderSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let card: Card
    let onAdd: (String, BinderCardAddDetails) async throws -> Void

    @State private var collections: [Collection] = []
    @State private var selectedBinderId: String?
    @State private var quantity: Int = 1
    @State private var condition: String = CardCondition.nearMint.rawValue
    @State private var language: String = "English"
    @State private var notes: String = ""
    @State private var isFoil: Bool = false
    @State private var isSigned: Bool = false
    @State private var isAltered: Bool = false
    @State private var finishCode: String = ""
    @State private var edition: String = ""
    @State private var stamp: String = ""
    @State private var isSealedPromo = false
    @State private var isOversized = false
    @State private var isPeelOff = false
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isAdding = false
    @State private var wishlistCard: Card?
    @State private var didAddToWishlist = false

    private let apiService = APIService()

    private let languages = PokemonCardLanguage.allCases.map(\.rawValue)
    private var finishOptions: [PokemonFinishOption] {
        PokemonFinishOption.options(for: card, includeCatalog: true)
    }

    var body: some View {
        NavigationView {
            Form {
                // Card Preview Section
                Section {
                    CardPreviewRow(card: card)
                } header: {
                    Text("Card")
                }

                // Binder Selection
                Section {
                    if isLoading {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                    } else if collections.isEmpty {
                        VStack(spacing: 12) {
                            Text("No Binders Available")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            Text("Create a binder first to add cards")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .padding(.vertical, 8)
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            BinderPickerMenu(
                                binders: collections,
                                selectedBinderId: $selectedBinderId
                            )
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(Color.fromHex(collection(for: selectedBinderId)?.colorHex))
                                    .frame(width: 10, height: 10)
                                Text(collection(for: selectedBinderId)?.name ?? "No binder selected")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Binder")
                } footer: {
                    Text("Choose which binder to add this card to")
                }

                Section {
                    Button {
                        wishlistCard = card
                    } label: {
                        Label("Add to Wishlist", systemImage: "heart")
                    }
                    .disabled(isAdding)
                } header: {
                    Text("Wishlist")
                } footer: {
                    Text("Track this card without adding a copy to a binder")
                }

                // Card Details
                Section {
                    Stepper("Quantity: \(quantity)", value: $quantity, in: 1...99)

                    ConditionPicker(selection: $condition)

                    Picker("Language", selection: $language) {
                        ForEach(languages, id: \.self) { lang in
                            Text(lang).tag(lang)
                        }
                    }
                } header: {
                    Text("Card Details")
                }

                // Attributes
                Section {
                    if card.tcg.lowercased() == "pokemon" {
                        Picker("Finish", selection: $finishCode) {
                            Text("Not specified").tag("")
                            ForEach(finishOptions) { finish in
                                Text(finish.label).tag(finish.code)
                            }
                        }
                        TextField("Edition (e.g. 1st Edition)", text: $edition)
                        TextField("Stamp (e.g. Prerelease, Staff)", text: $stamp)
                        Toggle("Sealed promo", isOn: $isSealedPromo)
                        Toggle("Oversized", isOn: $isOversized)
                        Toggle("Peel-off", isOn: $isPeelOff)
                    } else {
                        Toggle(isOn: $isFoil) {
                            Label("Foil", systemImage: "sparkles")
                        }
                    }
                    Toggle(isOn: $isSigned) {
                        Label("Signed", systemImage: "pencil.line")
                    }
                    Toggle(isOn: $isAltered) {
                        Label("Altered Art", systemImage: "paintpalette")
                    }
                } header: {
                    Text("Attributes")
                }

                // Notes
                Section {
                    TextField("Notes (optional)", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Notes")
                }

                // Error Message
                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Add Card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isAdding)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isAdding ? "Adding..." : "Add") {
                        Task {
                            await addCard()
                        }
                    }
                    .disabled(selectedBinderId == nil || isAdding)
                }
            }
        }
        .task {
            if finishCode.isEmpty {
                finishCode = finishOptions.first?.code ?? ""
            }
            if edition.isEmpty, card.pokemonPrint?.variants?.firstEdition == true {
                edition = "1st Edition"
            }
            await loadCollections()
        }
        .sheet(item: $wishlistCard, onDismiss: {
            if didAddToWishlist {
                didAddToWishlist = false
                dismiss()
            }
        }) { card in
            AddToWishlistSheet(card: card) {
                didAddToWishlist = true
            }
        }
    }

    @MainActor
    private func loadCollections() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token
            ).sortedForDisplay()
            // Auto-select first binder if only one exists
            if selectedBinderId == nil {
                selectedBinderId = collections.first?.id
            }
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func addCard() async {
        guard let binderId = selectedBinderId else {
            errorMessage = "Please select a binder"
            return
        }

        isAdding = true
        errorMessage = nil
        let trimmedEdition = edition.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedStamp = stamp.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            try await onAdd(
                binderId,
                BinderCardAddDetails(
                    quantity: quantity,
                    condition: condition,
                    language: language,
                    notes: notes.isEmpty ? nil : notes,
                    isFoil: card.tcg.lowercased() == "pokemon"
                        ? PokemonFinishOption.isFoil(finishCode)
                        : isFoil,
                    variant: CardCopyVariant(
                        finishCode: finishCode.isEmpty ? nil : finishCode,
                        finishLabel: finishCode.isEmpty ? nil : PokemonFinishOption.label(for: finishCode),
                        edition: trimmedEdition.isEmpty ? nil : trimmedEdition,
                        stamp: trimmedStamp.isEmpty ? nil : trimmedStamp,
                        isSealedPromo: isSealedPromo,
                        isOversized: isOversized,
                        isPeelOff: isPeelOff
                    ),
                    isSigned: isSigned,
                    isAltered: isAltered
                )
            )
            isAdding = false
            HapticManager.notification(.success)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isAdding = false
            HapticManager.notification(.error)
        }
    }

    private func collection(for id: String?) -> Collection? {
        guard let id else { return nil }
        return collections.first { $0.id == id }
    }
}

// MARK: - Card Preview Row
private struct CardPreviewRow: View {
    let card: Card

    var body: some View {
        HStack(spacing: 12) {
            CardArtworkImage(card: card, useFullResolution: false)
                .frame(width: 60, height: 84)

            VStack(alignment: .leading, spacing: 4) {
                Text(card.name)
                    .font(.headline)
                    .lineLimit(2)

                if let setName = card.setName {
                    Text(setName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if let rarity = card.rarity {
                    PokemonRarityBadge(rarity: rarity, tcg: card.tcg)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    struct PreviewWrapper: View {
        @StateObject private var environmentStore = EnvironmentStore()

        var body: some View {
            AddCardToBinderSheet(
                card: Card(
                    id: "1",
                    name: "Dark Magician",
                    tcg: "yugioh",
                    setCode: "YGLD-EN",
                    setName: "Yugi's Legendary Decks",
                    rarity: "Ultra Rare",
                    imageUrl: nil,
                    imageUrlSmall: nil,
                    price: 15.99,
                    collectorNumber: nil,
                    releasedAt: nil
                ),
                onAdd: { binderId, details in
                    print("Adding to binder \(binderId): \(details.quantity)x \(details.condition ?? "N/A") foil:\(details.isFoil) signed:\(details.isSigned) altered:\(details.isAltered)")
                }
            )
            .environmentObject(environmentStore)
        }
    }

    return PreviewWrapper()
}
