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
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isAdding = false
    @State private var isCreatingBinder = false
    @State private var wishlistCard: Card?
    @State private var didAddToWishlist = false
    @State private var printPickerCard: Card?

    private let apiService = APIService()

    private var finishOptions: [PokemonFinishOption] {
        draft.finishOptions(for: originalCard)
    }

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
            selectedPrint: card,
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
                    CardPreviewRow(card: draft.selectedPrint ?? originalCard)
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
                    } else {
                        BinderPickerSheetButton(
                            binders: collections,
                            selectedBinderId: $selectedBinderId,
                            onCreate: { name, description, colorHex, defaultCondition in
                                await createBinder(
                                    name: name,
                                    description: description,
                                    colorHex: colorHex,
                                    defaultCondition: defaultCondition
                                )
                            }
                        )
                        .binderPickerFieldStyle()
                        .disabled(isAdding || isCreatingBinder)
                    }
                } header: {
                    Text("Binder")
                } footer: {
                    Text("Choose which binder to add this card to")
                }

                Section {
                    Button {
                        wishlistCard = draft.selectedPrint ?? originalCard
                    } label: {
                        Label("Add to Wishlist", systemImage: "heart")
                    }
                    .disabled(isAdding)
                } header: {
                    Text("Wishlist")
                } footer: {
                    Text("Track this card without adding a copy to a binder")
                }

                if originalCard.supportsPrintSelection {
                    CardPrintSelectionSection(
                        card: originalCard,
                        selectedPrint: draft.selectedPrint,
                        isDisabled: isAdding,
                        onSelect: showPrintPicker
                    )
                }

                CardEditorDetailsSection(
                    quantity: $draft.quantity,
                    condition: $draft.condition,
                    language: $draft.language,
                    showsQuantity: true
                )

                CardEditorAttributesSection(
                    card: draft.selectedPrint ?? originalCard,
                    finishOptions: finishOptions,
                    isFoil: $draft.isFoil,
                    isSigned: $draft.isSigned,
                    isAltered: $draft.isAltered,
                    finishCode: $draft.finishCode,
                    edition: $draft.edition,
                    stamp: $draft.stamp,
                    isSealedPromo: $draft.isSealedPromo,
                    isOversized: $draft.isOversized,
                    isPeelOff: $draft.isPeelOff
                )

                CardEditorGradingSection(
                    company: $draft.gradingCompany,
                    score: $draft.gradingScore,
                    certNumber: $draft.certNumber
                )

                CardEditorStorageSection(storageLocation: $draft.storageLocation)
                CardEditorNotesSection(notes: $draft.notes)
                CardEditorTagsSection(
                    tags: $localTags,
                    selectedTagIds: $draft.selectedTagIds,
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
                draft.applyPrintDefaults(for: draft.selectedPrint ?? originalCard)
            }
            await loadCollections()
            await loadTags()
        }
        .onChange(of: selectedBinderId) { _, _ in
            applyBinderDefaultCondition()
        }
        .onChange(of: draft.selectedPrint?.id) { _, _ in
            guard let selectedPrint = draft.selectedPrint else { return }
            draft.applyPrintDefaults(for: selectedPrint)
        }
        .sheet(item: $printPickerCard) { print in
            SelectPrintSheet(card: print, selectedPrint: $draft.selectedPrint)
                .environmentObject(environmentStore)
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

    private func showPrintPicker() {
        printPickerCard = draft.selectedPrint ?? originalCard
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
            if let selectedBinderId,
               collections.contains(where: { $0.id == selectedBinderId }) {
                // Preserve a selection the user already made if collections reload.
            } else if let initialBinderId,
                      collections.contains(where: { $0.id == initialBinderId }) {
                selectedBinderId = initialBinderId
            } else {
                selectedBinderId = collections.first?.id
            }
            applyBinderDefaultCondition()
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func createBinder(
        name: String,
        description: String?,
        colorHex: String?,
        defaultCondition: String?
    ) async {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !isCreatingBinder else { return }
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        isCreatingBinder = true
        defer { isCreatingBinder = false }

        do {
            let collection = try await apiService.createCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                name: name,
                description: description,
                colorHex: colorHex,
                defaultCondition: defaultCondition
            )
            collections.removeAll { $0.id == collection.id }
            collections.append(collection)
            collections = collections.sortedForDisplay()
            selectedBinderId = collection.id
            applyBinderDefaultCondition()
            NotificationCenter.default.post(name: .collectionDidChange, object: collection)
        } catch {
            errorMessage = error.localizedDescription
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
        let selectedCard = draft.selectedPrint ?? originalCard

        func trimmed(_ value: String) -> String? {
            let result = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return result.isEmpty ? nil : result
        }

        do {
            try await onAdd(
                selectedCard,
                binderId,
                BinderCardAddDetails(
                    quantity: draft.quantity,
                    condition: trimmed(draft.condition),
                    language: trimmed(draft.language),
                    notes: trimmed(draft.notes),
                    isFoil: selectedCard.tcg.lowercased() == "pokemon"
                        ? draft.variant.isFoil
                        : draft.isFoil,
                    variant: draft.variant,
                    isSigned: draft.isSigned,
                    isAltered: draft.isAltered,
                    tags: draft.selectedTagIds.sorted(),
                    gradingCompany: trimmed(draft.gradingCompany),
                    gradingScore: trimmed(draft.gradingScore),
                    certNumber: trimmed(draft.certNumber),
                    storageLocation: trimmed(draft.storageLocation)
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
                onAdd: { selectedCard, binderId, details in
                    print("Adding \(selectedCard.name) to binder \(binderId): \(details.quantity)x \(details.condition ?? "N/A") foil:\(details.isFoil) signed:\(details.isSigned) altered:\(details.isAltered)")
                }
            )
            .environmentObject(environmentStore)
        }
    }

    return PreviewWrapper()
}
