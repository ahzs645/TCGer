import SwiftUI

struct MoveCardToBinderSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let card: CollectionCard
    let maxQuantity: Int
    let isProcessing: Bool
    let onMove: (String, Int) async -> Void

    @State private var availableBinders: [Collection] = []
    @State private var selectedBinderId: String?
    @State private var quantity: Int
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let apiService = APIService()

    init(
        card: CollectionCard,
        maxQuantity: Int,
        isProcessing: Bool,
        onMove: @escaping (String, Int) async -> Void
    ) {
        self.card = card
        self.maxQuantity = maxQuantity
        self.isProcessing = isProcessing
        self.onMove = onMove
        _quantity = State(initialValue: max(1, min(maxQuantity, 1)))
    }

    var body: some View {
        NavigationView {
            Form {
                Section {
                    CardSummaryRow(card: card)
                } header: {
                    Text("Card")
                } footer: {
                    Text("Select how many copies to move into another binder.")
                }

                Section {
                    if isLoading {
                        ProgressView()
                            .frame(maxWidth: .infinity, alignment: .center)
                    } else if availableBinders.isEmpty {
                        VStack(spacing: 12) {
                            Text("No binders available")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            Text("Create a binder first to assign cards.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .padding(.vertical, 8)
                    } else {
                        Menu {
                            ForEach(availableBinders) { binder in
                                Button {
                                    selectedBinderId = binder.id
                                } label: {
                                    HStack(spacing: 10) {
                                        Circle()
                                            .fill(Color.fromHex(binder.colorHex))
                                            .frame(width: 14, height: 14)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(binder.name)
                                            if let description = binder.description, !description.isEmpty {
                                                Text(description)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 10) {
                                Circle()
                                    .fill(Color.fromHex(selectedBinder?.colorHex))
                                    .frame(width: 14, height: 14)
                                Text(selectedBinder?.name ?? "Select a binder...")
                                    .foregroundColor(selectedBinderId == nil ? .secondary : .primary)
                                Spacer()
                                Image(systemName: "chevron.down")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(Color(.systemGray6))
                            )
                        }
                    }
                } header: {
                    Text("Destination Binder")
                }

                Section {
                    Stepper(value: $quantity, in: 1...maxQuantity) {
                        Text("Quantity: \(quantity)")
                    }
                    .disabled(maxQuantity == 1)
                } header: {
                    Text("Copies to Move")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Move Card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isProcessing)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isProcessing ? "Moving..." : "Move") {
                        Task { await performMove() }
                    }
                    .disabled(isProcessing || selectedBinderId == nil || availableBinders.isEmpty)
                }
            }
        }
        .task {
            await loadBinders()
        }
    }

    private var selectedBinder: Collection? {
        guard let selectedBinderId else { return nil }
        return availableBinders.first { $0.id == selectedBinderId }
    }

    @MainActor
    private func loadBinders() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            let fetched = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token
            )
            availableBinders = fetched.filter { !$0.isUnsortedBinder }
            if selectedBinderId == nil {
                selectedBinderId = availableBinders.first?.id
            }
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func performMove() async {
        guard let binderId = selectedBinderId else {
            errorMessage = "Select a binder"
            return
        }

        await onMove(binderId, quantity)
    }
}

private struct CardSummaryRow: View {
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
            .frame(width: 60, height: 84)
            .cornerRadius(6)

            VStack(alignment: .leading, spacing: 6) {
                Text(card.name)
                    .font(.headline)
                if let setCode = card.setCode {
                    Text(setCode)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Text("Currently ×\(card.quantity)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
        }
    }
}
