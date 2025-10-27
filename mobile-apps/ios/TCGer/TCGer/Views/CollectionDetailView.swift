import SwiftUI

struct CollectionDetailView: View {
    let collection: Collection
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var isEditing = false
    @State private var editedName: String
    @State private var editedDescription: String
    @State private var selectedColor: Color
    @State private var showingAddCard = false
    @State private var errorMessage: String?
    @State private var isSaving = false
    @State private var cards: [CollectionCard]
    @State private var cardPendingDeletion: CollectionCard?
    @State private var editContext: CardEditContext?
    @State private var copySelectionCard: CollectionCard?
    @State private var editingCardId: String?
    @State private var cardBeingMoved: CollectionCard?
    @State private var movingCardId: String?
    @State private var showingDeleteBinderConfirmation = false
    @State private var isDeletingBinder = false
    @State private var previewingCard: CollectionCard?

    private let apiService = APIService()

    init(collection: Collection) {
        self.collection = collection
        _editedName = State(initialValue: collection.name)
        _editedDescription = State(initialValue: collection.description ?? "")
        _selectedColor = State(initialValue: Color.fromHex(collection.colorHex))
        _cards = State(initialValue: collection.cards)
    }

    private var workingCollectionSnapshot: Collection {
        Collection(
            id: collection.id,
            name: isEditing ? editedName : collection.name,
            description: isEditing ? (editedDescription.isEmpty ? nil : editedDescription) : collection.description,
            cards: cards,
            createdAt: collection.createdAt,
            updatedAt: collection.updatedAt,
            colorHex: isEditing ? selectedColor.toHex() : collection.colorHex
        )
    }

    var body: some View {
        ZStack {
            NavigationView {
                ZStack {
                    Color(.systemBackground)
                        .ignoresSafeArea()

                    List {
                        Section {
                            VStack(alignment: .leading, spacing: 8) {
                                if isEditing {
                                    TextField("Binder Name", text: $editedName)
                                        .font(.title)
                                        .fontWeight(.bold)
                                        .textFieldStyle(.roundedBorder)

                                    TextField("Description (optional)", text: $editedDescription, axis: .vertical)
                                        .font(.body)
                                        .foregroundColor(.secondary)
                                        .textFieldStyle(.roundedBorder)
                                        .lineLimit(3...6)

                                    ColorPickerGrid(selectedColor: $selectedColor)
                                        .padding(.top, 12)
                                } else {
                                    Text(collection.name)
                                        .font(.title)
                                        .fontWeight(.bold)
                                    if let description = collection.description, !description.isEmpty {
                                        Text(description)
                                            .font(.body)
                                            .foregroundColor(.secondary)
                                    }
                                }
                            }
                            .padding()
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color(.systemBackground))
                        }

                        Section {
                            CollectionStatsCard(
                                collection: workingCollectionSnapshot,
                                showPricing: environmentStore.showPricing
                            )
                            .padding(.horizontal)
                            .padding(.vertical, 4)
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color(.systemBackground))
                        }

                        Section {
                            if cards.isEmpty {
                                emptyStateView
                            } else {
                                ForEach(cards) { card in
                                    CollectionCardRow(
                                        card: card,
                                        showPricing: environmentStore.showPricing,
                                        onTap: {
                                            withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                                                previewingCard = card
                                            }
                                        }
                                    )
                                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                                    .listRowSeparator(.hidden)
                                    .listRowBackground(Color(.systemBackground))
                                    .swipeActions(edge: .leading) {
                                        Button {
                                            beginEditing(card)
                                        } label: {
                                            Label("Edit", systemImage: "square.and.pencil")
                                        }
                                        .tint(.blue)

                                        if collection.isUnsortedBinder {
                                            Button {
                                                cardBeingMoved = card
                                            } label: {
                                                Label("Move", systemImage: "arrowshape.turn.up.right")
                                            }
                                            .tint(.purple)
                                        }
                                    }
                                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                        Button(role: .destructive) {
                                            cardPendingDeletion = card
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                                }
                            }
                        }

                        if !collection.isUnsortedBinder, isEditing {
                            Section {
                                Button(role: .destructive) {
                                    showingDeleteBinderConfirmation = true
                                } label: {
                                    HStack {
                                        if isDeletingBinder {
                                            ProgressView()
                                        } else {
                                            Image(systemName: "trash")
                                        }
                                        Text(isDeletingBinder ? "Deleting..." : "Delete Binder")
                                    }
                                    .frame(maxWidth: .infinity)
                                }
                                .disabled(isDeletingBinder)
                            }
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color(.systemBackground))
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") {
                            dismiss()
                        }
                    }

                    ToolbarItem(placement: .principal) {
                        Text(collection.name)
                            .font(.headline)
                    }

                    ToolbarItem(placement: .primaryAction) {
                        HStack(spacing: 12) {
                            if isEditing {
                                Button(isSaving ? "Saving..." : "Save") {
                                    Task {
                                        await saveChanges()
                                    }
                                }
                                .disabled(editedName.isEmpty || isSaving)
                                .foregroundColor(.green)
                                .fontWeight(.semibold)
                            } else {
                                Button(action: { isEditing = true }) {
                                    Text("Edit")
                                }

                                Button(action: { showingAddCard = true }) {
                                    Image(systemName: "plus")
                                }
                            }
                        }
                    }
                }
                .sheet(isPresented: $showingAddCard) {
                    AddCardToBinderFromSearchView(binderId: collection.id)
                }
                .sheet(item: $editContext) { context in
                    EditCollectionCardSheet(
                        card: context.card,
                        isIndividualCopy: !context.canEditQuantity,
                        copyDetails: context.copy,
                        isSaving: editingCardId == context.collectionEntryId
                    ) { payload in
#if DEBUG
                        print(
                            "CollectionDetailView.onSave payload -> quantity:\(payload.quantity) " +
                            "condition:\(payload.condition ?? "nil") " +
                            "language:\(payload.language ?? "nil") " +
                            "notes:\(payload.notes ?? "nil") " +
                            "print:\(payload.selectedPrint?.id ?? "nil") " +
                            "canEditQuantity:\(context.canEditQuantity)"
                        )
#endif
                        Task {
                            await updateCard(
                                card: context.card,
                                collectionEntryId: context.collectionEntryId,
                                quantity: context.canEditQuantity ? payload.quantity : nil,
                                condition: payload.condition,
                                language: payload.language,
                                notes: payload.notes,
                                newPrint: payload.selectedPrint
                            )
                        }
                    }
                    .environmentObject(environmentStore)
                }
                .sheet(item: $copySelectionCard) { card in
                    CopySelectionSheet(card: card) { copy in
                        selectCopyForEditing(card: card, copy: copy)
                    }
                }
                .sheet(item: $cardBeingMoved) { card in
                    MoveCardToBinderSheet(
                        card: card,
                        isProcessing: movingCardId == card.id
                    ) { binderId, copyIds in
                        await moveCard(
                            card: card,
                            destinationBinderId: binderId,
                            selectedCopyIds: copyIds
                        )
                    }
                }
                .alert("Error", isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )) {
                    Button("OK", role: .cancel) {
                        errorMessage = nil
                    }
                } message: {
                    if let error = errorMessage {
                        Text(error)
                    }
                }
                .confirmationDialog(
                    "Remove Card?",
                    isPresented: Binding(
                        get: { cardPendingDeletion != nil },
                        set: { if !$0 { cardPendingDeletion = nil } }
                    ),
                    presenting: cardPendingDeletion
                ) { card in
                    Button("Delete \"\(card.name)\"", role: .destructive) {
                        Task {
                            await deleteCard(card)
                        }
                    }
                    Button("Cancel", role: .cancel) {
                        cardPendingDeletion = nil
                    }
                } message: { card in
                    Text("This will remove all copies of \(card.name) from this binder.")
                }
                .alert("Delete Binder?", isPresented: $showingDeleteBinderConfirmation) {
                    Button("Delete", role: .destructive) {
                        Task {
                            await deleteBinder()
                        }
                    }
                    Button("Cancel", role: .cancel) {
                        showingDeleteBinderConfirmation = false
                    }
                } message: {
                    Text("This action permanently removes the binder and its cards.")
                }
            }

            if let card = previewingCard {
                CardImagePreviewView(card: card) {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                        previewingCard = nil
                    }
                }
            }
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "rectangle.stack.badge.plus")
                .font(.system(size: 50))
                .foregroundColor(.secondary)
            Text("No cards in this binder yet")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Button(action: { showingAddCard = true }) {
                HStack(spacing: 10) {
                    Image(systemName: "plus.circle.fill")
                        .font(.title3)
                    Text("Add Your First Card")
                        .font(.headline)
                }
                .padding(.horizontal, 20)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .listRowBackground(Color(.systemBackground))
    }

    @MainActor
    private func saveChanges() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        guard !editedName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Binder name cannot be empty"
            return
        }

        isSaving = true
        errorMessage = nil

        do {
            let updated = try await apiService.updateCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                id: collection.id,
                name: editedName,
                description: editedDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : editedDescription,
                colorHex: selectedColor.toHex()
            )

            cards = updated.cards
            isEditing = false
            isSaving = false
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }

    @MainActor
    private func deleteCard(_ card: CollectionCard) async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            cardPendingDeletion = nil
            return
        }

        defer {
            cardPendingDeletion = nil
        }

        do {
            try await apiService.deleteCardFromBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: collection.id,
                collectionCardId: card.id
            )
            cards.removeAll { $0.id == card.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func updateCard(
        card: CollectionCard,
        collectionEntryId: String,
        quantity: Int?,
        condition: String?,
        language: String?,
        notes: String?,
        newPrint: Card?
    ) async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        editingCardId = collectionEntryId

        do {
#if DEBUG
            print("CollectionDetailView.updateCard -> quantity: \(String(describing: quantity)) condition: \(condition ?? "nil") language: \(language ?? "nil") notes: \(notes ?? "nil") newPrint: \(newPrint?.id ?? "nil")")
#endif
            let updated = try await apiService.updateCardInBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: collection.id,
                collectionCardId: collectionEntryId,
                quantity: quantity,
                condition: condition,
                language: language,
                notes: notes,
                newPrint: newPrint,
                targetBinderId: nil
            )

            if let index = cards.firstIndex(where: { $0.id == card.id }) {
                cards[index] = updated
            }

            editContext = nil
        } catch {
            errorMessage = error.localizedDescription
        }

        editingCardId = nil
    }

    @MainActor
    private func beginEditing(_ card: CollectionCard) {
        let copies = card.copies
        if copies.count > 1 {
            copySelectionCard = card
        } else {
            let copy = copies.first
            editContext = CardEditContext(
                card: card,
                collectionEntryId: copy?.id ?? card.id,
                copy: copy,
                canEditQuantity: true
            )
        }
    }

    @MainActor
    private func selectCopyForEditing(card: CollectionCard, copy: CollectionCardCopy) {
        copySelectionCard = nil
        editContext = CardEditContext(
            card: card,
            collectionEntryId: copy.id,
            copy: copy,
            canEditQuantity: false
        )
    }

    @MainActor
    private func moveCard(
        card: CollectionCard,
        destinationBinderId: String,
        selectedCopyIds: [String]
    ) async {
        guard collection.isUnsortedBinder else {
            cardBeingMoved = nil
            return
        }

        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        movingCardId = card.id
        errorMessage = nil

        do {
            for copyId in selectedCopyIds {
                _ = try await apiService.updateCardInBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: collection.id,
                    collectionCardId: copyId,
                    quantity: nil,
                    condition: nil,
                    language: nil,
                    notes: nil,
                    newPrint: nil,
                    targetBinderId: destinationBinderId
                )
            }
            await reloadBinderCards()
            cardBeingMoved = nil
        } catch {
            errorMessage = error.localizedDescription
        }

        movingCardId = nil
    }

    @MainActor
    private func reloadBinderCards() async {
        guard let token = environmentStore.authToken else { return }

        do {
            let fetchedCollections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: false
            )

            if let updated = fetchedCollections.first(where: { $0.id == collection.id }) {
                cards = updated.cards
            } else if collection.isUnsortedBinder, let unsorted = fetchedCollections.first(where: { $0.isUnsortedBinder }) {
                cards = unsorted.cards
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func deleteBinder() async {
        guard !collection.isUnsortedBinder else {
            showingDeleteBinderConfirmation = false
            return
        }

        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            showingDeleteBinderConfirmation = false
            return
        }

        isDeletingBinder = true
        errorMessage = nil

        do {
            try await apiService.deleteCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                id: collection.id
            )
            isDeletingBinder = false
            showingDeleteBinderConfirmation = false
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isDeletingBinder = false
            showingDeleteBinderConfirmation = false
        }
    }
}

private struct CardEditContext: Identifiable, Equatable {
    let id = UUID()
    let card: CollectionCard
    let collectionEntryId: String
    let copy: CollectionCardCopy?
    let canEditQuantity: Bool
}

private struct CopySelectionSheet: View {
    let card: CollectionCard
    let onSelect: (CollectionCardCopy) -> Void
    @Environment(\.dismiss) private var dismiss

    private var copies: [CollectionCardCopy] {
        card.copies
    }

    var body: some View {
        NavigationView {
            List {
                if copies.isEmpty {
                    Text("No individual copies available for editing.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                        .padding(.vertical, 12)
                } else {
                    ForEach(Array(copies.enumerated()), id: \.element.id) { index, copy in
                        Button {
                            onSelect(copy)
                            dismiss()
                        } label: {
                            CopyRow(copy: copy, index: index)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle("Select Copy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
    }

    private struct CopyRow: View {
        let copy: CollectionCardCopy
        let index: Int

        private func normalized(_ value: String?) -> String? {
            guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
                return nil
            }
            return trimmed
        }

        private var title: String {
            if let serial = normalized(copy.serialNumber) {
                return serial
            }
            return "Copy #\(index + 1)"
        }

        private var detailLine: String? {
            var parts: [String] = []
            if let condition = normalized(copy.condition) {
                parts.append(condition)
            }
            if let language = normalized(copy.language) {
                parts.append(language)
            }
            return parts.isEmpty ? nil : parts.joined(separator: " • ")
        }

        private var tagsLine: String? {
            let labels = copy.tags.map { $0.label }.filter { !$0.isEmpty }
            guard !labels.isEmpty else { return nil }
            return labels.joined(separator: ", ")
        }

        var body: some View {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(title)
                        .font(.headline)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if let detailLine {
                    Text(detailLine)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if let notes = normalized(copy.notes) {
                    Text(notes)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                if let tagsLine {
                    Text("Tags: \(tagsLine)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                } else {
                    Text("No tags")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.vertical, 6)
        }
    }
}
