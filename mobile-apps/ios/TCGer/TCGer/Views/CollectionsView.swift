import SwiftUI

struct CollectionsView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.showingSearch) private var showingSearch
    @State private var collections: [Collection] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showingCreateSheet = false
   @State private var selectedCollection: Collection?
    @State private var selectedSmartFolder: SmartFolder?
    @State private var showingSmartFolderEditor = false
    @State private var showingImportSheet = false

    private let apiService = APIService()
    private var displayCollections: [Collection] {
        var visible = collections.filter { !$0.isUnsortedBinder }
        if let unsorted = collections.first(where: { $0.isUnsortedBinder }), !unsorted.cards.isEmpty {
            visible.append(unsorted)
        }
        return visible
    }

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    var body: some View {
        Group {
            if parentProvidesNavigation {
                collectionsContent
            } else {
                NavigationView {
                    collectionsContent
                }
            }
        }
        .task {
            await loadCollections()
        }
        .sheet(item: $selectedSmartFolder) { folder in
            SmartFolderDetailView(folder: folder)
                .environmentObject(environmentStore)
        }
        .sheet(isPresented: $showingSmartFolderEditor) {
            SmartFolderEditorSheet { folder in
                environmentStore.smartFolders.append(folder)
            }
        }
    }

    private var collectionsContent: some View {
        Group {
                if isLoading {
                    ProgressView("Loading binders...")
                } else if let error = errorMessage {
                    ErrorView(message: error) {
                        Task { await loadCollections() }
                    }
                } else if displayCollections.isEmpty {
                    if environmentStore.isAuthenticated {
                        EmptyCollectionsView(onCreate: {
                            showingCreateSheet = true
                        })
                    } else {
                        VStack(spacing: 12) {
                            Image(systemName: "lock")
                                .font(.system(size: 40))
                                .foregroundColor(.secondary)
                            Text("Sign in to manage collections")
                                .font(.headline)
                            Text("Public access is currently limited for collections on this server.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                } else {
                    ScrollView {
                        if !environmentStore.smartFolders.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Smart Folders")
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.secondary)
                                    .textCase(.uppercase)

                                ForEach(environmentStore.smartFolders) { folder in
                                    Button {
                                        selectedSmartFolder = folder
                                    } label: {
                                        HStack(spacing: 10) {
                                            Image(systemName: "wand.and.stars")
                                                .foregroundColor(Color.fromHex(folder.colorHex))
                                                .frame(width: 24)
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(folder.name)
                                                    .font(.subheadline)
                                                    .fontWeight(.medium)
                                                Text("\(folder.rules.count) rules (\(folder.matchMode.rawValue.lowercased()))")
                                                    .font(.caption)
                                                    .foregroundColor(.secondary)
                                            }
                                            Spacer()
                                            Image(systemName: "chevron.right")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                        .padding(12)
                                        .background(Color(.systemGray6))
                                        .cornerRadius(10)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal)
                            .padding(.top, 8)
                        }

                        LazyVStack(spacing: 16) {
                            ForEach(displayCollections) { collection in
                                CollectionCardView(collection: collection, showPricing: environmentStore.showPricing)
                                    .onTapGesture {
                                        selectedCollection = collection
                                    }
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Binders")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    HStack(spacing: 16) {
                        if environmentStore.isAuthenticated {
                            Button {
                                showingSearch.wrappedValue = true
                            } label: {
                                Image(systemName: "magnifyingglass")
                            }
                        }

                        Menu {
                            Button {
                                showingCreateSheet = true
                            } label: {
                                Label("New Binder", systemImage: "folder.badge.plus")
                            }
                            Button {
                                showingSmartFolderEditor = true
                            } label: {
                                Label("New Smart Folder", systemImage: "wand.and.stars")
                            }
                            Button {
                                showingImportSheet = true
                            } label: {
                                Label("Import CSV", systemImage: "square.and.arrow.down")
                            }
                        } label: {
                            Image(systemName: "plus")
                        }
                        .disabled(!environmentStore.isAuthenticated)
                    }
                }
            }
            .refreshable {
                await loadCollections()
            }
            .sheet(isPresented: $showingCreateSheet) {
                CreateBinderSheet { name, description, colorHex in
                    await createCollection(name: name, description: description, colorHex: colorHex)
                }
            }
            .sheet(isPresented: $showingImportSheet) {
                CollectionImportSheet(collections: collections) {
                    await loadCollections()
                }
                .environmentObject(environmentStore)
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

    @MainActor
    private func loadCollections() async {
        let shouldShowLoading = collections.isEmpty
        if shouldShowLoading {
            isLoading = true
            errorMessage = nil
        }

        do {
            collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: environmentStore.authToken,
                useCache: environmentStore.offlineModeEnabled && environmentStore.isAuthenticated
            )
            environmentStore.updateWidgetData(collections: collections)
            isLoading = false
            errorMessage = nil
        } catch {
            if let apiError = error as? APIService.APIError, case .unauthorized = apiError {
                errorMessage = "Sign in is required to view collections."
            }
            if shouldShowLoading {
                if errorMessage == nil {
                    errorMessage = error.localizedDescription
                }
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
