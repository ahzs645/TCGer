import SwiftUI

enum BinderSortOption: String, CaseIterable, Identifiable {
    case lastOpened = "Last Opened"
    case lastEdited = "Last Edited"
    case name = "Name"
    case value = "Value"
    case cardCount = "Card Count"

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .lastOpened: return "clock"
        case .lastEdited: return "pencil"
        case .name: return "textformat"
        case .value: return "dollarsign.circle"
        case .cardCount: return "square.stack.3d.up"
        }
    }
}

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
    @State private var searchText = ""
    @AppStorage("binderSortOption") private var sortOptionRaw = BinderSortOption.lastOpened.rawValue

    private let apiService = APIService()

    private var sortOption: BinderSortOption {
        BinderSortOption(rawValue: sortOptionRaw) ?? .lastOpened
    }

    private var sortedCollections: [Collection] {
        let base = collections.sortedForDisplay(hidingEmptyUnsortedLibrary: true)
        switch sortOption {
        case .lastOpened:
            // Never-opened binders have no local timestamp; base order
            // (most recently updated) breaks those ties.
            return base.sortedKeepingUnsortedFirst {
                let lhs = BinderAccessLog.lastOpened($0.id) ?? .distantPast
                let rhs = BinderAccessLog.lastOpened($1.id) ?? .distantPast
                if lhs != rhs { return lhs > rhs }
                return $0.updatedAt > $1.updatedAt
            }
        case .lastEdited:
            return base
        case .name:
            return base.sortedKeepingUnsortedFirst {
                $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
        case .value:
            return base.sortedKeepingUnsortedFirst { $0.totalValue > $1.totalValue }
        case .cardCount:
            return base.sortedKeepingUnsortedFirst { $0.uniqueCards > $1.uniqueCards }
        }
    }

    private var displayCollections: [Collection] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return sortedCollections }
        return sortedCollections.filter {
            $0.name.localizedCaseInsensitiveContains(query) ||
            ($0.description?.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    private var displaySmartFolders: [SmartFolder] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return environmentStore.smartFolders }
        return environmentStore.smartFolders.filter {
            $0.name.localizedCaseInsensitiveContains(query)
        }
    }

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    var body: some View {
        Group {
            if parentProvidesNavigation {
                collectionsContent
            } else {
                NavigationStack {
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
        VStack(spacing: 0) {
            binderControlBar

            Group {
                if isLoading {
                    ProgressView("Loading binders...")
                } else if let error = errorMessage {
                    ErrorView(title: "Error Loading Binders", message: error) {
                        Task { await loadCollections() }
                    }
                } else if sortedCollections.isEmpty && environmentStore.smartFolders.isEmpty {
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
                        if displayCollections.isEmpty && displaySmartFolders.isEmpty {
                            ContentUnavailableView.search(text: searchText)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 80)
                        }

                        if !displaySmartFolders.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Smart Folders")
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.secondary)
                                    .textCase(.uppercase)

                                ForEach(displaySmartFolders) { folder in
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
                                Button {
                                    selectedCollection = collection
                                } label: {
                                    CollectionCardView(
                                        collection: collection,
                                        showPricing: environmentStore.showPricing,
                                        showUpdatedDate: sortOption == .lastEdited
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding()
                    }
                }
            }
        }
            .navigationTitle("Binders")
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search binders"
            )
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    if environmentStore.isAuthenticated {
                        Button {
                            showingSearch.wrappedValue = true
                        } label: {
                            Image(systemName: "rectangle.and.text.magnifyingglass")
                        }
                        .accessibilityLabel("Search card catalog")
                    }
                }
            }
            .refreshable {
                await loadCollections()
            }
            .sheet(isPresented: $showingCreateSheet) {
                CreateBinderSheet { name, description, colorHex, defaultCondition in
                    await createCollection(
                        name: name,
                        description: description,
                        colorHex: colorHex,
                        defaultCondition: defaultCondition
                    )
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

    private var binderControlBar: some View {
        HStack(spacing: 12) {
            Menu {
                Picker("Sort by", selection: $sortOptionRaw) {
                    ForEach(BinderSortOption.allCases) { option in
                        Label(option.rawValue, systemImage: option.systemImage)
                            .tag(option.rawValue)
                    }
                }
            } label: {
                Label(sortOption.rawValue, systemImage: "arrow.up.arrow.down")
            }
            .buttonStyle(.bordered)

            Spacer()

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
                Label("Add", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
            .disabled(!environmentStore.isAuthenticated)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
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
    private func createCollection(
        name: String,
        description: String?,
        colorHex: String?,
        defaultCondition: String? = nil
    ) async {
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
                colorHex: colorHex,
                defaultCondition: defaultCondition
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
