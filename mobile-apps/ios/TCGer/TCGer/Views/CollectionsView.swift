import SwiftUI

struct CollectionsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.showingSearch) private var showingSearch
    @State private var collections: [Collection] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showingCreateSheet = false
   @State private var selectedCollection: Collection?

    private let apiService = APIService()
    private var displayCollections: [Collection] {
        var visible = collections.filter { !$0.isUnsortedBinder }
        if let unsorted = collections.first(where: { $0.isUnsortedBinder }), !unsorted.cards.isEmpty {
            visible.append(unsorted)
        }
        return visible
    }

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading binders...")
                } else if let error = errorMessage {
                    ErrorView(message: error) {
                        Task { await loadCollections() }
                    }
                } else if displayCollections.isEmpty {
                    EmptyCollectionsView(onCreate: {
                        showingCreateSheet = true
                    })
                } else {
                    CollectionsList(
                        collections: displayCollections,
                        selectedCollection: $selectedCollection,
                        showPricing: environmentStore.showPricing
                    )
                }
            }
            .navigationTitle("Binders")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    HStack(spacing: 16) {
                        Button {
                            showingSearch.wrappedValue = true
                        } label: {
                            Image(systemName: "magnifyingglass")
                        }

                        Button {
                            showingCreateSheet = true
                        } label: {
                            Image(systemName: "plus")
                        }
                    }
                }
            }
            .refreshable {
                await loadCollections()
            }
            .sheet(isPresented: $showingCreateSheet) {
                CreateCollectionSheet { name, description, colorHex in
                    await createCollection(name: name, description: description, colorHex: colorHex)
                }
            }
            .sheet(
                isPresented: Binding(
                    get: { selectedCollection != nil },
                    set: { if !$0 { selectedCollection = nil } }
                ),
                onDismiss: {
                    Task { await loadCollections() }
                },
                content: {
                    if let collection = selectedCollection {
                        CollectionDetailView(collection: collection)
                    }
                }
            )
        }
        .task {
            await loadCollections()
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
                token: token,
                useCache: environmentStore.offlineModeEnabled
            )
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func createCollection(name: String, description: String?, colorHex: String?) async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        do {
            let newCollection = try await apiService.createCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                name: name,
                description: description,
                colorHex: colorHex
            )
            collections.append(newCollection)
            showingCreateSheet = false
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Collections List
private struct CollectionsList: View {
    let collections: [Collection]
    @Binding var selectedCollection: Collection?
    let showPricing: Bool

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(collections) { collection in
                    CollectionCardView(collection: collection, showPricing: showPricing)
                        .onTapGesture {
                            selectedCollection = collection
                        }
                }
            }
            .padding()
        }
    }
}

// MARK: - Create Collection Sheet
private struct CreateCollectionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var selectedColor: Color = Color.binderColors[0]
    let onCreate: (String, String?, String?) async -> Void

    var body: some View {
        NavigationView {
            Form {
                Section {
                    TextField("Binder Name", text: $name)
                } header: {
                    Text("Name")
                } footer: {
                    Text("Give your binder a memorable name")
                }

                Section {
                    TextField("Description (optional)", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Description")
                }

                Section {
                    ColorPickerGrid(selectedColor: $selectedColor)
                        .padding(.vertical, 8)
                } header: {
                    Text("Binder Color")
                }
            }
            .navigationTitle("New Binder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            await onCreate(name, description.isEmpty ? nil : description, selectedColor.toHex())
                            dismiss()
                        }
                    }
                    .disabled(name.isEmpty)
                }
            }
        }
    }
}

// MARK: - Collection Detail View
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
    @State private var cardBeingEdited: CollectionCard?
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
                                    .frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.borderedProminent)
                                .buttonBorderShape(.capsule)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 40)
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color(.systemBackground))
                        } else {
                            ForEach(cards) { card in
                                CollectionCardRow(
                                    card: card,
                                    showPricing: environmentStore.showPricing,
                                    onTap: {
                                        previewingCard = card
                                    }
                                )
                                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                                .listRowSeparator(.hidden)
                            .listRowBackground(Color(.systemBackground))
                            .swipeActions(edge: .leading) {
                                Button {
                                    cardBeingEdited = card
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
            .sheet(item: $cardBeingEdited) { card in
                EditCollectionCardSheet(
                    card: card,
                    isSaving: editingCardId == card.id
                ) { quantity, condition, language, notes in
                    await updateCard(
                        card: card,
                        quantity: quantity,
                        condition: condition,
                        language: language,
                        notes: notes
                    )
                }
            }
            .sheet(item: $cardBeingMoved) { card in
                MoveCardToBinderSheet(
                    card: card,
                    maxQuantity: card.quantity,
                    isProcessing: movingCardId == card.id
                ) { binderId, quantity in
                    await moveCard(
                        card: card,
                        destinationBinderId: binderId,
                        quantity: quantity
                    )
                }
            }
            .fullScreenCover(item: $previewingCard) { card in
                CardImagePreviewView(card: card)
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
    }

    @MainActor
    private func saveChanges() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        isSaving = true
        errorMessage = nil

        do {
            _ = try await apiService.updateCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                id: collection.id,
                name: editedName,
                description: editedDescription.isEmpty ? nil : editedDescription,
                colorHex: selectedColor.toHex()
            )

            isEditing = false
            isSaving = false

            // Dismiss to let parent views refresh their data
            dismiss()
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
        quantity: Int,
        condition: String?,
        language: String?,
        notes: String?
    ) async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        editingCardId = card.id

        do {
            let updated = try await apiService.updateCardInBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: collection.id,
                collectionCardId: card.id,
                quantity: quantity,
                condition: condition,
                language: language,
                notes: notes
            )

            if let index = cards.firstIndex(where: { $0.id == card.id }) {
                cards[index] = updated
            }

            cardBeingEdited = nil
        } catch {
            errorMessage = error.localizedDescription
        }

        editingCardId = nil
    }

    @MainActor
    private func moveCard(
        card: CollectionCard,
        destinationBinderId: String,
        quantity: Int
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
            try await apiService.addCardToBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: destinationBinderId,
                cardId: card.cardId,
                quantity: quantity,
                condition: card.condition,
                language: card.language,
                notes: card.notes
            )

            if quantity >= card.quantity {
                try await apiService.deleteCardFromBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: collection.id,
                    collectionCardId: card.id
                )
                cards.removeAll { $0.id == card.id }
            } else {
                let updated = try await apiService.updateCardInBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: collection.id,
                    collectionCardId: card.id,
                    quantity: card.quantity - quantity,
                    condition: card.condition,
                    language: card.language,
                    notes: card.notes
                )

                if let index = cards.firstIndex(where: { $0.id == card.id }) {
                    cards[index] = updated
                }
            }

            cardBeingMoved = nil
        } catch {
            errorMessage = error.localizedDescription
        }

        movingCardId = nil
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

private struct CollectionCardRow: View {
    let card: CollectionCard
    let showPricing: Bool
    let onTap: (() -> Void)?

    init(card: CollectionCard, showPricing: Bool, onTap: (() -> Void)? = nil) {
        self.card = card
        self.showPricing = showPricing
        self.onTap = onTap
    }

    private var conditionText: String? {
        guard let condition = card.condition, !condition.isEmpty else { return nil }
        return condition
    }

    private var languageText: String? {
        guard let language = card.language, !language.isEmpty else { return nil }
        return language
    }

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: card.imageUrlSmall ?? card.imageUrl ?? "")) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                case .empty, .failure:
                    Rectangle()
                        .fill(Color(.systemGray5))
                        .overlay(
                            Image(systemName: "photo")
                                .foregroundColor(.secondary)
                        )
                @unknown default:
                    Rectangle()
                        .fill(Color(.systemGray5))
                        .overlay(
                            Image(systemName: "photo")
                                .foregroundColor(.secondary)
                        )
                }
            }
            .frame(width: 50, height: 70)
            .cornerRadius(4)

            VStack(alignment: .leading, spacing: 6) {
                Text(card.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                if let rarity = card.rarity {
                    Text(rarity)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                HStack {
                    Text("×\(card.quantity)")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.accentColor)
                    if showPricing, let price = card.price {
                        Text("$\(String(format: "%.2f", price * Double(card.quantity)))")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                }
                if conditionText != nil || languageText != nil {
                    HStack(spacing: 8) {
                        if let condition = conditionText {
                            Label(condition, systemImage: "wand.and.stars")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                        if let language = languageText {
                            Label(language, systemImage: "globe")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                if let notes = card.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(3)
                }
            }
            Spacer()
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(8)
        .contentShape(Rectangle())
        .onTapGesture {
            onTap?()
        }
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
            Text("Error Loading Binders")
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            Button("Try Again", action: retryAction)
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
