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

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading binders...")
                } else if let error = errorMessage {
                    ErrorView(message: error) {
                        Task { await loadCollections() }
                    }
                } else if collections.isEmpty {
                    EmptyCollectionsView(onCreate: {
                        showingCreateSheet = true
                    })
                } else {
                    CollectionsList(
                        collections: collections,
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
            .sheet(isPresented: Binding(
                get: { selectedCollection != nil },
                set: { if !$0 { selectedCollection = nil } }
            )) {
                if let collection = selectedCollection {
                    CollectionDetailView(collection: collection)
                }
            } onDismiss: {
                Task {
                    await loadCollections()
                }
            }
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
                token: token
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

    private let apiService = APIService()

    init(collection: Collection) {
        self.collection = collection
        _editedName = State(initialValue: collection.name)
        _editedDescription = State(initialValue: collection.description ?? "")
        _selectedColor = State(initialValue: Color.fromHex(collection.colorHex))
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header
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

                    // Stats Card
                    CollectionStatsCard(
                        collection: collection,
                        showPricing: environmentStore.showPricing
                    )
                        .padding(.horizontal)

                    // Cards List
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Cards")
                                .font(.headline)
                            Spacer()
                        }
                        .padding(.horizontal)

                        if collection.cards.isEmpty {
                            VStack(spacing: 16) {
                                Image(systemName: "rectangle.stack.badge.plus")
                                    .font(.system(size: 50))
                                    .foregroundColor(.secondary)
                                Text("No cards in this binder yet")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)

                                Button(action: { showingAddCard = true }) {
                                    Label("Add Your First Card", systemImage: "plus.circle.fill")
                                        .font(.headline)
                                }
                                .buttonStyle(.borderedProminent)
                                .buttonBorderShape(.capsule)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 40)
                        } else {
                            ForEach(collection.cards) { card in
                                CollectionCardRow(
                                    card: card,
                                    showPricing: environmentStore.showPricing
                                )
                                    .padding(.horizontal)
                            }
                        }
                    }
                }
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
}

private struct CollectionCardRow: View {
    let card: CollectionCard
    let showPricing: Bool

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

            VStack(alignment: .leading, spacing: 4) {
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
            }
            Spacer()
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(8)
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
