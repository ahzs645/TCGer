import Combine
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
    @StateObject private var collectionStore: CollectionListStore
    @State private var showingCreateSheet = false
    @State private var selectedCollection: Collection?
    @State private var selectedCollectionStartsInEditMode = false
    @State private var selectedSmartFolder: SmartFolder?
    @State private var lastHandledDeepLinkID: UUID?
    @State private var pendingBinderID: String?
    @State private var showingSmartFolderEditor = false
    @State private var showingImportSheet = false
    @State private var showingHistorySheet = false
    @State private var searchText = ""
    @AppStorage("binderSortOption") private var sortOptionRaw = BinderSortOption.lastOpened.rawValue

    private var collections: [Collection] { collectionStore.collections }
    private var isLoading: Bool { collectionStore.isLoading }
    private var errorMessage: String? { collectionStore.errorMessage }
    private var hasLoadedCollections: Bool { collectionStore.hasLoaded }

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

    init(
        parentProvidesNavigation: Bool = false,
        repository: any CollectionRepository
    ) {
        self.parentProvidesNavigation = parentProvidesNavigation
        _collectionStore = StateObject(
            wrappedValue: CollectionListStore(repository: repository)
        )
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
        .onAppear {
            handleDeepLink(environmentStore.pendingDeepLinkRequest)
        }
        .onReceive(environmentStore.$pendingDeepLinkRequest.dropFirst()) { request in
            handleDeepLink(request)
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
                List {
                    if displayCollections.isEmpty && displaySmartFolders.isEmpty {
                        ContentUnavailableView.search(text: searchText)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 80)
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
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
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                    }

                    ForEach(displayCollections) { collection in
                        if environmentStore.isAuthenticated,
                           !collection.isUnsortedBinder {
                            binderRow(for: collection)
                                .swipeActions(edge: .leading, allowsFullSwipe: false) {
                                    Button {
                                        presentCollection(collection, editing: true)
                                    } label: {
                                        Label("Edit", systemImage: "pencil")
                                    }
                                    .tint(.blue)
                                }
                        } else {
                            binderRow(for: collection)
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .environment(\.defaultMinListRowHeight, 1)
            }
        }
            .navigationTitle("Binders")
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search binders"
            )
            .scrollEdgeEffectStyle(.soft, for: .top)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
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
                            Label("Import Collection", systemImage: "square.and.arrow.down")
                        }
                        Button {
                            showingHistorySheet = true
                        } label: {
                            Label("Collection History", systemImage: "clock.arrow.circlepath")
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!environmentStore.isAuthenticated)
                    .accessibilityIdentifier(ParityControlID.actionCollectionsCreate)
                    .accessibilityLabel("Add")
                    .accessibilityHint("Shows options for adding content")
                }

                ToolbarItemGroup(placement: .primaryAction) {
                    if environmentStore.isAuthenticated {
                        Button {
                            showingSearch.wrappedValue = true
                        } label: {
                            Image(systemName: "rectangle.and.text.magnifyingglass")
                        }
                        .accessibilityLabel("Search card catalog")
                    }

                    if !sortedCollections.isEmpty {
                        Menu {
                            Picker("Sort by", selection: $sortOptionRaw) {
                                ForEach(BinderSortOption.allCases) { option in
                                    Label(option.rawValue, systemImage: option.systemImage)
                                        .tag(option.rawValue)
                                }
                            }
                        } label: {
                            AppFilterMenuLabel(
                                kind: .overflow,
                                isActive: sortOption != .lastOpened
                            )
                        }
                        .accessibilityLabel("Binder list options")
                        .accessibilityValue("Sorted by \(sortOption.rawValue)")
                    }
                }
            }
            .refreshable {
                await loadCollections()
            }
            .navigationDestination(isPresented: selectedCollectionIsPresented) {
                if let collection = selectedCollection {
                    CollectionDetailView(
                        collection: collection,
                        startsInEditMode: selectedCollectionStartsInEditMode,
                        parentProvidesNavigation: true
                    )
                }
            }
            .navigationDestination(isPresented: selectedSmartFolderIsPresented) {
                if let folder = selectedSmartFolder {
                    SmartFolderDetailView(folder: folder, parentProvidesNavigation: true)
                        .environmentObject(environmentStore)
                }
            }
            .sheet(isPresented: $showingCreateSheet) {
                CreateBinderSheet(onCreateWithPresentation: { name, description, colorHex, defaultCondition, presentation in
                    await createCollection(
                        name: name,
                        description: description,
                        colorHex: colorHex,
                        defaultCondition: defaultCondition,
                        presentation: presentation
                    )
                })
            }
            .sheet(isPresented: $showingImportSheet) {
                CollectionImportSheet(collections: collections) {
                    await loadCollections()
                }
                .environmentObject(environmentStore)
            }
            .sheet(isPresented: $showingHistorySheet) {
                CollectionHistorySheet {
                    await loadCollections()
                }
                .environmentObject(environmentStore)
            }
    }

    private var selectedCollectionIsPresented: Binding<Bool> {
        Binding(
            get: { selectedCollection != nil },
            set: { isPresented in
                guard !isPresented else { return }
                selectedCollection = nil
                selectedCollectionStartsInEditMode = false
                Task { await loadCollections() }
            }
        )
    }

    private var selectedSmartFolderIsPresented: Binding<Bool> {
        Binding(
            get: { selectedSmartFolder != nil },
            set: { if !$0 { selectedSmartFolder = nil } }
        )
    }

    private func binderRow(for collection: Collection) -> some View {
        Button {
            presentCollection(collection, editing: false)
        } label: {
            CollectionCardView(
                collection: collection,
                showPricing: environmentStore.showPricing,
                showUpdatedDate: sortOption == .lastEdited
            )
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
    }

    private func presentCollection(_ collection: Collection, editing: Bool) {
        selectedCollectionStartsInEditMode = editing
        selectedCollection = collection
    }

    @MainActor
    private func loadCollections() async {
        await collectionStore.load(
            config: environmentStore.serverConfiguration,
            token: environmentStore.authToken,
            useCache: environmentStore.offlineModeEnabled && environmentStore.isAuthenticated
        )

        if collectionStore.errorMessage == nil {
            environmentStore.updateWidgetData(collections: collections)
            resolvePendingBinder()
        }
    }

    private func handleDeepLink(_ request: AppDeepLinkRequest?) {
        guard let request,
              request.id != lastHandledDeepLinkID,
              case .binder(let binderID) = request.destination else { return }
        lastHandledDeepLinkID = request.id
        pendingBinderID = binderID
        resolvePendingBinder(request: request)
    }

    private func resolvePendingBinder(request: AppDeepLinkRequest? = nil) {
        guard let pendingBinderID else { return }
        let currentRequest = request ?? environmentStore.pendingDeepLinkRequest
        guard let currentRequest,
              case .binder = currentRequest.destination else { return }
        guard let collection = collections.first(where: { $0.id == pendingBinderID }) else {
            if hasLoadedCollections,
               environmentStore.claimDeepLinkRequest(currentRequest, for: .collections) {
                self.pendingBinderID = nil
            }
            return
        }
        guard environmentStore.claimDeepLinkRequest(currentRequest, for: .collections) else {
            self.pendingBinderID = nil
            return
        }
        self.pendingBinderID = nil
        presentCollection(collection, editing: false)
    }

    @MainActor
    private func createCollection(
        name: String,
        description: String?,
        colorHex: String?,
        defaultCondition: String?,
        presentation: BinderPresentationInput
    ) async {
        guard let token = environmentStore.authToken else {
            collectionStore.reportAuthenticationRequired()
            return
        }

        do {
            _ = try await collectionStore.create(
                config: environmentStore.serverConfiguration,
                token: token,
                input: CreateCollectionInput(
                    name: name,
                    description: description,
                    colorHex: colorHex,
                    defaultCondition: defaultCondition,
                    containerType: presentation.containerType,
                    imageUrl: presentation.imageUrl,
                    associatedTcg: presentation.associatedTcg,
                    associatedSetCode: presentation.associatedSetCode,
                    associatedSetName: presentation.associatedSetName
                )
            )
            showingCreateSheet = false
        } catch {
            // The store publishes the actionable message used by this screen.
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
