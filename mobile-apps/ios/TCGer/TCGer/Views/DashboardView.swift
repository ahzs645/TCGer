import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.showingSearch) private var showingSearch
    @Environment(\.scrollOffset) private var scrollOffset
    @State private var collections: [Collection] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedCollection: Collection?

    private let apiService = APIService()

    var body: some View {
        NavigationView {
            ScrollView {
                GeometryReader { geometry in
                    Color.clear.preference(
                        key: ScrollOffsetPreferenceKey.self,
                        value: geometry.frame(in: .named("scroll")).minY
                    )
                }
                .frame(height: 0)

                VStack(spacing: 20) {
                    if isLoading {
                        ProgressView("Loading your collection...")
                            .padding()
                    } else if let error = errorMessage {
                        ErrorView(message: error) {
                            Task { await loadData() }
                        }
                    } else {
                        // Stats Section
                        StatsSection(
                            collections: collections,
                            showPricing: environmentStore.showPricing
                        )

                        // Recent Collections
                        if !collections.isEmpty {
                            RecentCollectionsSection(
                                collections: Array(collections.prefix(3)),
                                selectedCollection: $selectedCollection,
                                showPricing: environmentStore.showPricing
                            )
                        } else {
                            EmptyStateView()
                        }
                    }
                }
                .padding()
            }
            .coordinateSpace(name: "scroll")
            .onPreferenceChange(ScrollOffsetPreferenceKey.self) { value in
                scrollOffset.wrappedValue = value
            }
            .navigationTitle("Dashboard")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingSearch.wrappedValue = true
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }
                }
            }
            .refreshable {
                await loadData()
            }
            .sheet(isPresented: Binding(
                get: { selectedCollection != nil },
                set: { if !$0 { selectedCollection = nil } }
            )) {
                if let collection = selectedCollection {
                    CollectionDetailView(collection: collection)
                }
            }
        }
        .task {
            await loadData()
        }
    }

    @MainActor
    private func loadData() async {
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
}

// MARK: - Stats Section
private struct StatsSection: View {
    let collections: [Collection]
    let showPricing: Bool

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
                StatCard(title: "Binders", value: "\(collections.count)", icon: "folder.fill")
                StatCard(title: "Unique Cards", value: "\(totalCards)", icon: "rectangle.stack.fill")
            }

            HStack(spacing: 12) {
                StatCard(title: "Total Copies", value: "\(totalCopies)", icon: "square.on.square")
                if showPricing {
                    StatCard(
                        title: "Est. Value",
                        value: "$\(String(format: "%.2f", totalValue))",
                        icon: "dollarsign.circle.fill"
                    )
                }
            }
        }
    }
}

private struct StatCard: View {
    let title: String
    let value: String
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundColor(.accentColor)
                Spacer()
            }
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

// MARK: - Recent Collections
private struct RecentCollectionsSection: View {
    let collections: [Collection]
    @Binding var selectedCollection: Collection?
    let showPricing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent Binders")
                .font(.headline)

            ForEach(collections) { collection in
                CollectionRowView(collection: collection, showPricing: showPricing)
                    .onTapGesture {
                        selectedCollection = collection
                    }
            }
        }
    }
}

private struct CollectionRowView: View {
    let collection: Collection
    let showPricing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Circle()
                    .fill(Color.fromHex(collection.colorHex))
                    .frame(width: 14, height: 14)
                    .shadow(color: Color.fromHex(collection.colorHex).opacity(0.4), radius: 4, x: 0, y: 2)

                Text(collection.name)
                    .font(.headline)
                    .fontWeight(.semibold)

                Spacer()

                Image(systemName: "chevron.right")
                    .foregroundColor(.secondary)
            }

            HStack(spacing: 12) {
                Label("\(collection.uniqueCards) cards", systemImage: "rectangle.stack")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Label("\(collection.totalCopies) copies", systemImage: "square.on.square")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                if showPricing {
                    Text("$\(String(format: "%.2f", collection.totalValue))")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.green)
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
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

// MARK: - Error View
private struct ErrorView: View {
    let message: String
    let retryAction: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 50))
                .foregroundColor(.orange)
            Text("Error Loading Data")
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
