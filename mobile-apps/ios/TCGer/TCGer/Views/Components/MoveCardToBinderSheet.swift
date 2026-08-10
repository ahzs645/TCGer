import SwiftUI

struct MoveCardToBinderSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let card: CollectionCard
    let sourceBinderId: String
    let isProcessing: Bool
    let onMove: (String, [String]) async -> Void

    @State private var availableBinders: [Collection] = []
    @State private var selectedBinderId: String?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var selectedCopyIds: Set<String>

    private let apiService = APIService()

    init(
        card: CollectionCard,
        sourceBinderId: String,
        isProcessing: Bool,
        onMove: @escaping (String, [String]) async -> Void
    ) {
        self.card = card
        self.sourceBinderId = sourceBinderId
        self.isProcessing = isProcessing
        self.onMove = onMove
        _selectedCopyIds = State(initialValue: Set(card.copies.map { $0.id }))
    }

    private var copies: [CollectionCardCopy] {
        card.copies
    }

    private var supportsCopySelection: Bool {
        !copies.isEmpty
    }

    var body: some View {
        NavigationStack {
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
                        BinderPickerSheetButton(
                            binders: availableBinders,
                            selectedBinderId: $selectedBinderId
                        )
                    }
                } header: {
                    Text("Destination Binder")
                }

                if supportsCopySelection {
                    Section {
                        if copies.isEmpty {
                            Text("No copies available.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        } else {
                            ForEach(Array(copies.enumerated()), id: \.element.id) { index, copy in
                                CopySelectionRow(
                                    copy: copy,
                                    index: index,
                                    isSelected: selectedCopyIds.contains(copy.id)
                                ) { isSelected in
                                    if isSelected {
                                        selectedCopyIds.insert(copy.id)
                                    } else {
                                        selectedCopyIds.remove(copy.id)
                                    }
                                }
                            }
                            if selectedCopyIds.count < copies.count {
                                Button("Select All Copies") {
                                    selectedCopyIds = Set(copies.map { $0.id })
                                }
                                .buttonStyle(.borderless)
                            }
                        }
                    } header: {
                        Text("Copies to Move")
                    } footer: {
                        Text("Choose one or more individual copies to move into the selected binder.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
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
                    .disabled(isProcessing || selectedBinderId == nil || availableBinders.isEmpty || (supportsCopySelection && selectedCopyIds.isEmpty))
                }
            }
        }
        .task {
            await loadBinders()
        }
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
            availableBinders = fetched.filter { $0.id != sourceBinderId }.sortedForDisplay()
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

        guard binderId != sourceBinderId else {
            errorMessage = "Select a different destination binder."
            return
        }

        if supportsCopySelection {
            guard !selectedCopyIds.isEmpty else {
                errorMessage = "Select at least one copy"
                return
            }
            await onMove(binderId, Array(selectedCopyIds))
        } else {
            await onMove(binderId, [card.id])
        }
    }
}

private struct CopySelectionRow: View {
    let copy: CollectionCardCopy
    let index: Int
    let isSelected: Bool
    let onToggle: (Bool) -> Void

    var body: some View {
        Button {
            onToggle(!isSelected)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isSelected ? .accentColor : .secondary)
                    .font(.title3)

                VStack(alignment: .leading, spacing: 4) {
                    Text(copy.displayTitle(index: index))
                        .font(.caption)
                        .fontWeight(.semibold)

                    if let detailLine = copy.detailLine {
                        Text(detailLine)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }

                    if let notes = copy.normalizedNotes {
                        Text(notes)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }

                    if let tagsLine = copy.tagsLine {
                        Text("Tags: \(tagsLine)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    } else {
                        Text("No tags")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
                Spacer()
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }
}

private struct CardSummaryRow: View {
    let card: CollectionCard

    var body: some View {
        HStack(spacing: 12) {
            CardArtworkImage(card: card.previewCard, useFullResolution: false)
                .frame(width: 60, height: 84)

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
