import SwiftUI

struct MoveCardToBinderSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let card: CollectionCard
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
        isProcessing: Bool,
        onMove: @escaping (String, [String]) async -> Void
    ) {
        self.card = card
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

    private func normalized(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private var title: String {
        if let serial = normalized(copy.serialNumber) {
            return serial
        }
        return "Copy #\(index + 1)"
    }

    private var detailLine: String? {
        var parts: [String] = []
        if let condition = normalized(copy.condition) {
            parts.append(condition)
        }
        if let language = normalized(copy.language) {
            parts.append(language)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " • ")
    }

    private var tagsLine: String? {
        let labels = copy.tags.map { $0.label }.filter { !$0.isEmpty }
        guard !labels.isEmpty else { return nil }
        return labels.joined(separator: ", ")
    }

    var body: some View {
        Button {
            onToggle(!isSelected)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isSelected ? .accentColor : .secondary)
                    .font(.title3)

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.caption)
                        .fontWeight(.semibold)

                    if let detailLine {
                        Text(detailLine)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }

                    if let notes = normalized(copy.notes) {
                        Text(notes)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }

                    if let tagsLine {
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
            CachedAsyncImage(url: URL(string: card.imageUrlSmall ?? card.imageUrl ?? "")) { phase in
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
