import SwiftUI

struct AddCardToBinderSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let card: Card
    let onAdd: (String, Int, String?, String?, String?) async -> Void

    @State private var collections: [Collection] = []
    @State private var selectedBinderId: String?
    @State private var quantity: Int = 1
    @State private var condition: String = "Near Mint"
    @State private var language: String = "English"
    @State private var notes: String = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isAdding = false

    private let apiService = APIService()

    private let conditions = ["Mint", "Near Mint", "Excellent", "Good", "Light Played", "Played", "Poor"]
    private let languages = ["English", "Japanese", "German", "French", "Italian", "Spanish", "Portuguese", "Korean", "Chinese"]

    var body: some View {
        NavigationView {
            Form {
                // Card Preview Section
                Section {
                    CardPreviewRow(card: card)
                } header: {
                    Text("Card")
                }

                // Binder Selection
                Section {
                    if isLoading {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                    } else if collections.isEmpty {
                        VStack(spacing: 12) {
                            Text("No Binders Available")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            Text("Create a binder first to add cards")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .padding(.vertical, 8)
                    } else {
                        Picker("Select Binder", selection: $selectedBinderId) {
                            Text("Select a binder...").tag(nil as String?)
                            ForEach(collections) { collection in
                                HStack {
                                    Circle()
                                        .fill(Color.fromHex(collection.colorHex))
                                        .frame(width: 12, height: 12)
                                    Text(collection.name)
                                }
                                .tag(collection.id as String?)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                } header: {
                    Text("Binder")
                } footer: {
                    Text("Choose which binder to add this card to")
                }

                // Card Details
                Section {
                    Stepper("Quantity: \(quantity)", value: $quantity, in: 1...99)

                    Picker("Condition", selection: $condition) {
                        ForEach(conditions, id: \.self) { cond in
                            Text(cond).tag(cond)
                        }
                    }

                    Picker("Language", selection: $language) {
                        ForEach(languages, id: \.self) { lang in
                            Text(lang).tag(lang)
                        }
                    }
                } header: {
                    Text("Card Details")
                }

                // Notes
                Section {
                    TextField("Notes (optional)", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Notes")
                }

                // Error Message
                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Add to Binder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isAdding)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isAdding ? "Adding..." : "Add") {
                        Task {
                            await addCard()
                        }
                    }
                    .disabled(selectedBinderId == nil || isAdding)
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
            // Auto-select first binder if only one exists
            if collections.count == 1 {
                selectedBinderId = collections.first?.id
            }
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func addCard() async {
        guard let binderId = selectedBinderId else {
            errorMessage = "Please select a binder"
            return
        }

        isAdding = true
        errorMessage = nil

        await onAdd(
            binderId,
            quantity,
            condition,
            language,
            notes.isEmpty ? nil : notes
        )

        isAdding = false
        dismiss()
    }
}

// MARK: - Card Preview Row
private struct CardPreviewRow: View {
    let card: Card

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
            .frame(width: 60, height: 84)
            .cornerRadius(4)

            VStack(alignment: .leading, spacing: 4) {
                Text(card.name)
                    .font(.headline)
                    .lineLimit(2)

                if let setName = card.setName {
                    Text(setName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if let rarity = card.rarity {
                    Text(rarity)
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.accentColor.opacity(0.2))
                        .foregroundColor(.accentColor)
                        .cornerRadius(4)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    struct PreviewWrapper: View {
        @StateObject private var environmentStore = EnvironmentStore()

        var body: some View {
            AddCardToBinderSheet(
                card: Card(
                    id: "1",
                    name: "Dark Magician",
                    tcg: "yugioh",
                    setCode: "YGLD-EN",
                    setName: "Yugi's Legendary Decks",
                    rarity: "Ultra Rare",
                    imageUrl: nil,
                    imageUrlSmall: nil,
                    price: 15.99
                ),
                onAdd: { binderId, quantity, condition, language, notes in
                    print("Adding to binder \(binderId): \(quantity)x \(condition ?? "N/A")")
                }
            )
            .environmentObject(environmentStore)
        }
    }

    return PreviewWrapper()
}
