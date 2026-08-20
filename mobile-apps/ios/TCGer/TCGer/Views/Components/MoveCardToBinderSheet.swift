import SwiftUI

struct MoveCardToBinderSheet: View {
    @Environment(\.dismiss) private var dismiss

    let card: CollectionCard
    let targetCopy: CollectionCardCopy?
    let sourceBinderId: String
    let isProcessing: Bool
    let onMove: (String, [String]) async -> Void

    @State private var availableBinders: [Collection] = []
    @State private var selectedBinderId: String?
    @State private var isCreatingBinder = false
    @State private var errorMessage: String?
    @State private var selectedCopyIds: Set<String>

    init(
        card: CollectionCard,
        targetCopy: CollectionCardCopy? = nil,
        sourceBinderId: String,
        isProcessing: Bool,
        onMove: @escaping (String, [String]) async -> Void
    ) {
        self.card = card
        self.targetCopy = targetCopy
        self.sourceBinderId = sourceBinderId
        self.isProcessing = isProcessing
        self.onMove = onMove
        _selectedCopyIds = State(initialValue: Set(targetCopy.map { [$0.id] } ?? card.copies.map { $0.id }))
    }

    private var copies: [CollectionCardCopy] {
        targetCopy.map { [$0] } ?? card.copies
    }

    private var singleCopy: CollectionCardCopy? {
        copies.count == 1 ? copies[0] : nil
    }

    private var showsCopySelection: Bool {
        copies.count > 1
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    CardSummaryRow(
                        card: card,
                        copy: singleCopy,
                        isTargetedCopy: targetCopy != nil
                    )
                } header: {
                    Text("Card")
                } footer: {
                    if showsCopySelection {
                        Text("Select how many copies to move into another binder.")
                    }
                }

                BinderDestinationSection(
                    binders: $availableBinders,
                    selectedBinderId: $selectedBinderId,
                    isCreatingBinder: $isCreatingBinder,
                    errorMessage: $errorMessage,
                    title: "Destination Binder",
                    excludedBinderIds: [sourceBinderId],
                    isDisabled: isProcessing
                )

                if showsCopySelection {
                    Section {
                        ForEach(Array(copies.enumerated()), id: \.element.id) { index, copy in
                            CopySelectionRow(
                                copy: copy,
                                index: index,
                                totalCount: copies.count,
                                isSelected: selectedCopyIds.contains(copy.id)
                            ) { isSelected in
                                if isSelected {
                                    selectedCopyIds.insert(copy.id)
                                } else {
                                    selectedCopyIds.remove(copy.id)
                                }
                            }
                        }
                        if copies.count > 2, selectedCopyIds.count < copies.count {
                            Button("Select All Copies") {
                                selectedCopyIds = Set(copies.map { $0.id })
                            }
                            .buttonStyle(.borderless)
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
                    .disabled(isProcessing || isCreatingBinder)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isProcessing ? "Moving..." : "Move") {
                        Task { await performMove() }
                    }
                    .disabled(isProcessing || isCreatingBinder || selectedBinderId == nil || availableBinders.isEmpty || (!copies.isEmpty && selectedCopyIds.isEmpty))
                }
            }
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

        if !copies.isEmpty {
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
    let totalCount: Int
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
                    if let title = copy.displayTitle(index: index, totalCount: totalCount) {
                        Text(title)
                            .font(.caption)
                            .fontWeight(.semibold)
                    }

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
    let copy: CollectionCardCopy?
    let isTargetedCopy: Bool

    var body: some View {
        CardIdentityRow(card: card.previewCard) {
            if let setCode = card.setCode {
                Text(setCode)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            Text(
                isTargetedCopy
                    ? "Moving 1 of \(CollectionCopyText.count(card.quantity))"
                    : "Currently ×\(card.quantity)"
            )
                .font(.caption)
                .foregroundColor(.secondary)

            if let copy {
                if let detailLine = copy.detailLine {
                    Text(detailLine)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if let notes = copy.normalizedNotes {
                    Text(notes)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                if let tagsLine = copy.tagsLine {
                    Text("Tags: \(tagsLine)")
                    .font(.caption)
                    .foregroundColor(.secondary)
                }
            }
        }
    }
}
