import SwiftUI

struct DashboardView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.showingSearch) private var showingSearch
    @State private var collections: [Collection] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var activeSheet: ActiveSheet?

    private let apiService = APIService()
    private var recentCollections: [Collection] {
        Array(collections.sortedForDisplay().filter { !$0.isUnsortedBinder }.prefix(3))
    }

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    var body: some View {
        Group {
            if parentProvidesNavigation {
                dashboardContent
            } else {
                NavigationView {
                    dashboardContent
                }
            }
        }
        .task {
            await loadData()
        }
    }

    private var dashboardContent: some View {
        ScrollView {
                VStack(spacing: 20) {
                    if isLoading {
                        ProgressView("Loading your collection...")
                            .padding()
                    } else if let error = errorMessage {
                        ErrorView(title: "Error Loading Data", message: error) {
                            Task { await loadData() }
                        }
                    } else {
                        // Stats Section
                        StatsSection(
                            collections: collections,
                            showPricing: environmentStore.showPricing,
                            onOpenCollections: {
                                environmentStore.openTab(.collections)
                            }
                        )

                        // Frontend entry for the tilt demo is disabled for now.
                        // Button {
                        //     activeSheet = .tiltTester
                        // } label: {
                        //     Label("Open Tilt Card Demo", systemImage: "sparkles")
                        //         .font(.headline)
                        //         .frame(maxWidth: .infinity)
                        // }
                        // .buttonStyle(.borderedProminent)
                        // .tint(.accentColor)

                        // Recent Collections
                        if recentCollections.isEmpty {
                            EmptyStateView()
                        } else {
                            RecentCollectionsSection(
                                collections: recentCollections,
                                showPricing: environmentStore.showPricing,
                                onSelect: { collection in
                                    activeSheet = .collection(collection)
                                }
                            )
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Dashboard")
            .toolbar {
                if environmentStore.isAuthenticated {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            showingSearch.wrappedValue = true
                        } label: {
                            Image(systemName: "magnifyingglass")
                        }
                    }
                }
            }
            .refreshable {
                await loadData()
            }
            .sheet(item: $activeSheet) { sheet in
                switch sheet {
                case .collection(let collection):
                    CollectionDetailView(collection: collection)
                        .onDisappear {
                            Task { await loadData() }
                        }
                case .tiltTester:
                    TiltTesterView(cards: collections.flatMap { $0.cards })
                }
        }
    }

    @MainActor
    private func loadData() async {
        isLoading = true
        errorMessage = nil

        do {
            collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: environmentStore.authToken,
                useCache: environmentStore.offlineModeEnabled && environmentStore.isAuthenticated
            )
            environmentStore.updateWidgetData(collections: collections)
            isLoading = false
        } catch {
            if let apiError = error as? APIService.APIError, case .unauthorized = apiError {
                errorMessage = "Sign in is required to view dashboard collections."
            } else {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
}

private enum ActiveSheet: Identifiable {
    case collection(Collection)
    case tiltTester

    var id: String {
        switch self {
        case .collection(let collection):
            return "collection-\(collection.id)"
        case .tiltTester:
            return "tiltTester"
        }
    }
}

// MARK: - Stats Section
private struct StatsSection: View {
    let collections: [Collection]
    let showPricing: Bool
    let onOpenCollections: () -> Void

    /// Matches the widget and Recent Binders: the Unsorted Library pseudo-binder
    /// is not counted as a binder.
    var binderCount: Int {
        collections.filter { !$0.isUnsortedBinder }.count
    }

    var totalCards: Int {
        collections.reduce(0) { $0 + $1.uniqueCards }
    }

    var totalCopies: Int {
        collections.reduce(0) { $0 + $1.totalCopies }
    }

    var totalValue: Double {
        collections.reduce(0) { $0 + $1.totalValue }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Overview")
                .font(.headline)

            HStack(spacing: 12) {
                statButton(StatItem(title: "Binders", value: "\(binderCount)", color: .blue, icon: "folder.fill"))
                statButton(StatItem(title: "Unique Cards", value: "\(totalCards)", color: .indigo, icon: "rectangle.stack.fill"))
            }

            HStack(spacing: 12) {
                statButton(StatItem(title: "Total Copies", value: "\(totalCopies)", color: .orange, icon: "square.on.square"))
                if showPricing {
                    statButton(StatItem(
                        title: "Est. Value",
                        value: totalValue.priceText,
                        color: .green,
                        icon: "dollarsign.circle.fill"
                    ))
                }
            }
        }
    }

    private func statButton(_ item: StatItem) -> some View {
        Button(action: onOpenCollections) {
            item
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Recent Collections
private struct RecentCollectionsSection: View {
    let collections: [Collection]
    let showPricing: Bool
    let onSelect: (Collection) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent Binders")
                .font(.headline)

            ForEach(collections) { collection in
                CollectionCardView(collection: collection, showPricing: showPricing)
                    .onTapGesture {
                        onSelect(collection)
                    }
            }
        }
    }
}

// MARK: - Empty State
private struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "folder.badge.plus")
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            Text("No Binders Yet")
                .font(.title2)
                .fontWeight(.semibold)
            Text("Create your first binder to start organizing your TCG collection.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .padding(.vertical, 40)
    }
}
