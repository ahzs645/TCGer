import SwiftUI

struct CollectionsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
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
                    EmptyCollectionsView {
                        showingCreateSheet = true
                    }
                } else {
                    CollectionsList(collections: collections, selectedCollection: $selectedCollection)
                }
            }
            .navigationTitle("Binders")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingCreateSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .refreshable {
                await loadCollections()
            }
            .sheet(isPresented: $showingCreateSheet) {
                CreateCollectionSheet { name, description in
                    await createCollection(name: name, description: description)
                }
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
    private func createCollection(name: String, description: String?) async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        do {
            let newCollection = try await apiService.createCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                name: name,
                description: description
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

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(collections) { collection in
                    CollectionCardView(collection: collection)
                        .onTapGesture {
                            selectedCollection = collection
                        }
                }
            }
            .padding()
        }
    }
}

// MARK: - Collection Card View
private struct CollectionCardView: View {
    let collection: Collection

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(collection.name)
                        .font(.headline)
                    if let description = collection.description {
                        Text(description)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundColor(.secondary)
            }

            // Games Badge
            if !collection.uniqueGames.isEmpty {
                HStack(spacing: 8) {
                    ForEach(Array(collection.uniqueGames).sorted(), id: \.self) { game in
                        GameBadge(game: game)
                    }
                }
            }

            Divider()

            // Stats
            HStack(spacing: 20) {
                StatItem(icon: "rectangle.stack", value: "\(collection.uniqueCards)", label: "Cards")
                StatItem(icon: "square.on.square", value: "\(collection.totalCopies)", label: "Copies")
                Spacer()
                Text("$\(String(format: "%.2f", collection.totalValue))")
                    .font(.headline)
                    .foregroundColor(.green)
            }

            // Updated date
            Text("Updated \(formattedDate(collection.updatedAt))")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    private func formattedDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: dateString) else {
            return "recently"
        }

        let displayFormatter = RelativeDateTimeFormatter()
        displayFormatter.unitsStyle = .short
        return displayFormatter.localizedString(for: date, relativeTo: Date())
    }
}

private struct GameBadge: View {
    let game: String

    var displayName: String {
        switch game.lowercased() {
        case "yugioh": return "YGO"
        case "magic": return "MTG"
        case "pokemon": return "PKM"
        default: return game.prefix(3).uppercased()
        }
    }

    var body: some View {
        Text(displayName)
            .font(.caption2)
            .fontWeight(.semibold)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.accentColor.opacity(0.2))
            .foregroundColor(.accentColor)
            .cornerRadius(4)
    }
}

private struct StatItem: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                Text(value)
                    .font(.subheadline)
                    .fontWeight(.semibold)
            }
            Text(label)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Empty Collections View
private struct EmptyCollectionsView: View {
    let createAction: () -> Void

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
            Button("Create Binder", action: createAction)
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}

// MARK: - Create Collection Sheet
private struct CreateCollectionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    let onCreate: (String, String?) async -> Void

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
                            await onCreate(name, description.isEmpty ? nil : description)
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
private struct CollectionDetailView: View {
    let collection: Collection
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header
                    VStack(alignment: .leading, spacing: 8) {
                        Text(collection.name)
                            .font(.title)
                            .fontWeight(.bold)
                        if let description = collection.description {
                            Text(description)
                                .font(.body)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding()

                    // Stats
                    HStack(spacing: 12) {
                        DetailStatCard(title: "Unique Cards", value: "\(collection.uniqueCards)", icon: "rectangle.stack")
                        DetailStatCard(title: "Total Copies", value: "\(collection.totalCopies)", icon: "square.on.square")
                    }
                    .padding(.horizontal)

                    DetailStatCard(
                        title: "Estimated Value",
                        value: "$\(String(format: "%.2f", collection.totalValue))",
                        icon: "dollarsign.circle",
                        fullWidth: true
                    )
                    .padding(.horizontal)

                    // Cards List
                    if !collection.cards.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Cards")
                                .font(.headline)
                                .padding(.horizontal)

                            ForEach(collection.cards) { card in
                                CollectionCardRow(card: card)
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
            }
        }
    }
}

private struct DetailStatCard: View {
    let title: String
    let value: String
    let icon: String
    var fullWidth: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
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
        .frame(maxWidth: fullWidth ? .infinity : nil, alignment: .leading)
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

private struct CollectionCardRow: View {
    let card: CollectionCard

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
                    if let price = card.price {
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
