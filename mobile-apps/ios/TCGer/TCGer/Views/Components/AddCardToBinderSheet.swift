import SwiftUI

struct AddCardToBinderSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let originalCard: Card
    let initialBinderId: String?
    let onAdd: (Card, String, BinderCardAddDetails) async throws -> Void

    @State private var draft: CardEditorDraft
    @State private var collections: [Collection] = []
    @State private var localTags: [CollectionCardTag] = []
    @State private var selectedBinderId: String?
    // Tracks what the picker was last seeded with, so switching binders only
    // re-seeds the condition while the user hasn't picked one themselves.
    @State private var seededCondition: String = CardCondition.nearMint.rawValue
    @State private var errorMessage: String?
    @State private var isAdding = false
    @State private var isCreatingBinder = false
    @State private var wishlistCard: Card?
    @State private var didAddToWishlist = false

    private let apiService = APIService()

    init(
        card: Card,
        initialBinderId: String? = nil,
        onAdd: @escaping (Card, String, BinderCardAddDetails) async throws -> Void
    ) {
        self.originalCard = card
        self.initialBinderId = initialBinderId
        self.onAdd = onAdd
        self._draft = State(initialValue: CardEditorDraft(
            quantity: 1,
            condition: CardCondition.nearMint.rawValue,
            language: "English",
            notes: "",
            isFoil: false,
            isSigned: false,
            isAltered: false,
            finishCode: "",
            edition: "",
            stamp: "",
            isSealedPromo: false,
            isOversized: false,
            isPeelOff: false,
            gradingCompany: "",
            gradingScore: "",
            certNumber: "",
            storageLocation: "",
            selectedTagIds: []
        ))
    }

    var body: some View {
        NavigationStack {
            Form {
                // Card Preview Section
                Section {
                    CardPreviewRow(card: originalCard)
                } header: {
                    Text("Card")
                }

                BinderDestinationSection(
                    binders: $collections,
                    selectedBinderId: $selectedBinderId,
                    isCreatingBinder: $isCreatingBinder,
                    errorMessage: $errorMessage,
                    title: "Binder",
                    footer: "Choose which binder to add this card to",
                    initialBinderId: initialBinderId,
                    isDisabled: isAdding
                )

                Section {
                    Button {
                        wishlistCard = originalCard
                    } label: {
                        Label("Add to Wishlist", systemImage: "heart")
                    }
                    .disabled(isAdding)
                } header: {
                    Text("Wishlist")
                } footer: {
                    Text("Track this card without adding a copy to a binder")
                }

                CardCopyEditorSections(
                    card: originalCard,
                    draft: $draft,
                    tags: $localTags,
                    showsQuantity: true,
                    onCreateTag: createTag
                )

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
                    .disabled(isAdding || isCreatingBinder)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isAdding ? "Adding..." : "Add") {
                        Task {
                            await addCard()
                        }
                    }
                    .disabled(selectedBinderId == nil || isAdding || isCreatingBinder)
                }
            }
        }
        .task {
            if draft.finishCode.isEmpty {
                draft.applyCardDefaults(for: originalCard)
            }
            await loadTags()
        }
        .onChange(of: selectedBinderId) { _, _ in
            applyBinderDefaultCondition()
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
    private func loadTags() async {
        guard let token = environmentStore.authToken else { return }
        do {
            localTags = try await apiService.getTags(
                config: environmentStore.serverConfiguration,
                token: token
            )
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        } catch {
            // Tags are optional; the rest of the add flow remains available.
        }
    }

    @MainActor
    private func createTag(_ label: String) async throws -> CollectionCardTag {
        guard let token = environmentStore.authToken else {
            throw APIService.APIError.unauthorized
        }
        return try await apiService.createTag(
            config: environmentStore.serverConfiguration,
            token: token,
            label: label
        )
    }

    @MainActor
    private func addCard() async {
        guard let binderId = selectedBinderId else {
            errorMessage = "Please select a binder"
            return
        }

        isAdding = true
        errorMessage = nil
        let values = draft.normalizedValues(for: originalCard)

        do {
            try await onAdd(
                originalCard,
                binderId,
                BinderCardAddDetails(
                    quantity: values.quantity,
                    condition: values.condition,
                    language: values.language,
                    notes: values.notes,
                    isFoil: values.isFoil,
                    variant: values.variant,
                    isSigned: values.isSigned,
                    isAltered: values.isAltered,
                    tags: values.tags,
                    gradingCompany: values.gradingCompany,
                    gradingScore: values.gradingScore,
                    certNumber: values.certNumber,
                    storageLocation: values.storageLocation
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

    /// Seeds the condition picker with the selected binder's default (falling
    /// back to Near Mint) unless the user already picked a condition manually.
    private func applyBinderDefaultCondition() {
        let binderDefault = collection(for: selectedBinderId)?.defaultCondition
        let seed = CardCondition.canonicalize(binderDefault ?? CardCondition.nearMint.rawValue)
        if draft.condition == seededCondition {
            draft.condition = seed
        }
        seededCondition = seed
    }
}

// MARK: - Card Preview Row
private struct CardPreviewRow: View {
    let card: Card

    var body: some View {
        CardIdentityRow(card: card) {
            if let setName = card.setName {
                Text(setName)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            if let rarity = card.rarity {
                PokemonRarityBadge(rarity: rarity, tcg: card.tcg)
            }
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
                onAdd: { selectedCard, binderId, details in
                    print("Adding \(selectedCard.name) to binder \(binderId): \(details.quantity)x \(details.condition ?? "N/A") foil:\(details.isFoil) signed:\(details.isSigned) altered:\(details.isAltered)")
                }
            )
            .environmentObject(environmentStore)
        }
    }

    return PreviewWrapper()
}
