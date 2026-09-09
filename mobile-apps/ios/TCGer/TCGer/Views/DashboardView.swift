import SwiftUI

struct DashboardView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.showingSearch) private var showingSearch
    @State private var collections: [Collection] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var selectedCollection: Collection?
    @State private var hasLoaded = false

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
                NavigationStack {
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
                    if !hasLoaded && errorMessage == nil {
                        StatsSection(collections: [], showPricing: environmentStore.showPricing, onOpenCollections: {})
                            .redacted(reason: .placeholder)
                            .disabled(true)
                            .accessibilityLabel("Loading your collection")
                    } else if let error = errorMessage, !hasLoaded {
                        ErrorView(title: "Error Loading Data", message: error) {
                            Task { await loadData() }
                        }
                    } else {
                        if let error = errorMessage {
                            VStack(alignment: .leading, spacing: AppSpacing.small) {
                                Label("Couldn't refresh your collection", systemImage: "exclamationmark.triangle")
                                    .font(.headline)
                                Text(error).font(.subheadline).foregroundStyle(.secondary)
                                Button("Retry") { Task { await loadData() } }
                                    .disabled(isLoading)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        // Stats Section
                        StatsSection(
                            collections: collections,
                            showPricing: environmentStore.showPricing,
                            onOpenCollections: {
                                environmentStore.openTab(.collections)
                            }
                        )

                        // Recent Collections
                        if recentCollections.isEmpty {
                            EmptyStateView()
                        } else {
                            RecentCollectionsSection(
                                collections: recentCollections,
                                showPricing: environmentStore.showPricing,
                                onSelect: { collection in
                                    selectedCollection = collection
                                }
                            )
                        }
                    }
                }
                .padding()
        }
            .scrollEdgeEffectStyle(.soft, for: .top)
            .navigationTitle("Dashboard")
            .toolbar {
                if environmentStore.isAuthenticated {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            showingSearch.wrappedValue = true
                        } label: {
                            Image(systemName: "magnifyingglass")
                        }
                        .accessibilityIdentifier(ParityControlID.actionSearch)
                    }
                }
            }
            .refreshable {
                await loadData()
            }
            .navigationDestination(isPresented: Binding(
                get: { selectedCollection != nil },
                set: { if !$0 { selectedCollection = nil } }
            )) {
                if let collection = selectedCollection {
                    CollectionDetailView(collection: collection, parentProvidesNavigation: true)
                        .onDisappear { Task { await loadData() } }
                }
            }
    }

    @MainActor
    private func loadData() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil

        do {
            collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: environmentStore.authToken,
                useCache: environmentStore.offlineModeEnabled && environmentStore.isAuthenticated
            )
            hasLoaded = true
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

// MARK: - Stats Section
private struct StatsSection: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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

            statLayout {
                statButton(StatItem(title: "Binders", value: "\(binderCount)", color: environmentStore.accentColorChoice.color, icon: "folder.fill"))
                statButton(StatItem(title: "Unique Cards", value: "\(totalCards)", color: environmentStore.accentColorChoice.color, icon: "rectangle.stack.fill"))
            }

            statLayout {
                statButton(StatItem(title: "Total Copies", value: "\(totalCopies)", color: environmentStore.accentColorChoice.color, icon: "square.on.square"))
                if showPricing {
                    statButton(StatItem(
                        title: "Est. Value",
                        value: totalValue.priceText,
                        color: environmentStore.accentColorChoice.color,
                        icon: "dollarsign.circle.fill"
                    ))
                }
            }
        }
    }

    private var statLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: AppSpacing.medium))
            : AnyLayout(HStackLayout(spacing: AppSpacing.medium))
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
                Button {
                    onSelect(collection)
                } label: {
                    CollectionCardView(collection: collection, showPricing: showPricing)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(collection.name)
                .accessibilityValue(accessibilityValue(for: collection))
                .accessibilityHint("Opens this binder")
            }
        }
    }

    private func accessibilityValue(for collection: Collection) -> String {
        var parts = [
            "\(collection.uniqueCards) unique cards",
            CollectionCopyText.total(collection.totalCopies),
        ]
        if showPricing {
            parts.append("estimated value \(collection.totalValue.priceText)")
        }
        return parts.joined(separator: ", ")
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
