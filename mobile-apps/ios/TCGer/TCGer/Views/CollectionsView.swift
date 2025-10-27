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

        let shouldShowLoading = collections.isEmpty
        if shouldShowLoading {
            isLoading = true
            errorMessage = nil
        }

        do {
            collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: environmentStore.offlineModeEnabled
            )
            isLoading = false
            errorMessage = nil
        } catch {
            if shouldShowLoading {
                errorMessage = error.localizedDescription
            }
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
