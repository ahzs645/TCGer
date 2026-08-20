import SwiftUI

/// Shared loading, creation, filtering, and selection for any form that needs
/// a binder destination. Callers retain the selected ID and binder collection
/// so their domain-specific actions remain outside this component.
struct BinderDestinationSection: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    @Binding var binders: [Collection]
    @Binding var selectedBinderId: String?
    @Binding var isCreatingBinder: Bool
    @Binding var errorMessage: String?

    let title: String
    var footer: String? = nil
    var initialBinderId: String? = nil
    var excludedBinderIds: Set<String> = []
    var includesUnsortedLibrary = true
    let isDisabled: Bool

    @State private var isLoading = true

    private let apiService = APIService()

    var body: some View {
        Section {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .center)
            } else {
                BinderPickerSheetButton(
                    binders: binders,
                    selectedBinderId: $selectedBinderId,
                    onCreate: createBinder
                )
                .binderPickerFieldStyle()
                .disabled(isDisabled || isCreatingBinder)
            }
        } header: {
            Text(title)
        } footer: {
            if let footer {
                Text(footer)
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
            binders = filteredAndSorted(fetched)
            if let selectedBinderId,
               binders.contains(where: { $0.id == selectedBinderId }) {
                // Preserve the caller's current selection.
            } else if let initialBinderId,
                      binders.contains(where: { $0.id == initialBinderId }) {
                selectedBinderId = initialBinderId
            } else {
                selectedBinderId = binders.first?.id
            }
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func createBinder(
        name: String,
        description: String?,
        colorHex: String?,
        defaultCondition: String?
    ) async {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !isCreatingBinder else { return }
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        isCreatingBinder = true
        defer { isCreatingBinder = false }

        do {
            let collection = try await apiService.createCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                name: name,
                description: description,
                colorHex: colorHex,
                defaultCondition: defaultCondition
            )
            binders.removeAll { $0.id == collection.id }
            binders.append(collection)
            binders = filteredAndSorted(binders)
            selectedBinderId = collection.id
            NotificationCenter.default.post(name: .collectionDidChange, object: collection)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func filteredAndSorted(_ collections: [Collection]) -> [Collection] {
        collections
            .filter { !excludedBinderIds.contains($0.id) }
            .filter { includesUnsortedLibrary || !$0.isUnsortedBinder }
            .sortedForDisplay()
    }
}

/// A binder-selection field that presents available binders and, when an
/// `onCreate` action is supplied, the shared new-binder form in one flow.
struct BinderPickerSheetButton: View {
    let binders: [Collection]
    @Binding var selectedBinderId: String?
    var placeholder = "Choose or create a binder"
    var onCreate: ((String, String?, String?, String?) async -> Void)? = nil

    @State private var presentedSheet: BinderPickerSheetDestination?
    @State private var presentsCreationAfterSelection = false

    private var selectedBinder: Collection? {
        guard let selectedBinderId else { return nil }
        return binders.first { $0.id == selectedBinderId }
    }

    var body: some View {
        Button {
            presentedSheet = .selection
        } label: {
            HStack(spacing: 10) {
                Circle()
                    .fill(Color.fromHex(selectedBinder?.colorHex))
                    .frame(width: 14, height: 14)
                Text(selectedBinder?.name ?? placeholder)
                    .foregroundStyle(selectedBinderId == nil ? .secondary : .primary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 8)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Binder")
        .accessibilityValue(selectedBinder?.name ?? "None selected")
        .accessibilityHint(onCreate == nil ? "Shows binder choices" : "Shows binder choices and the new binder option")
        .sheet(item: $presentedSheet, onDismiss: presentPendingCreation) { destination in
            switch destination {
            case .selection:
                BinderSelectionSheet(
                    binders: binders,
                    selectedBinderId: $selectedBinderId,
                    onRequestCreate: onCreate == nil ? nil : {
                        presentsCreationAfterSelection = true
                        presentedSheet = nil
                    }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            case .creation:
                if let onCreate {
                    CreateBinderSheet(onCreate: onCreate)
                }
            }
        }
    }

    private func presentPendingCreation() {
        guard presentsCreationAfterSelection else { return }
        presentsCreationAfterSelection = false
        presentedSheet = .creation
    }
}

private enum BinderPickerSheetDestination: String, Identifiable {
    case selection
    case creation

    var id: String { rawValue }
}

extension View {
    func binderPickerFieldStyle() -> some View {
        padding(.horizontal, 14)
            .frame(height: 52)
            .background(
                Color(.tertiarySystemBackground),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color(.separator).opacity(0.28), lineWidth: 1)
            }
    }
}

private struct BinderSelectionSheet: View {
    @Environment(\.dismiss) private var dismiss

    let binders: [Collection]
    @Binding var selectedBinderId: String?
    let onRequestCreate: (() -> Void)?

    var body: some View {
        NavigationStack {
            List {
                if let onRequestCreate {
                    Section {
                        Button(action: onRequestCreate) {
                            Label("New Binder", systemImage: "folder.badge.plus")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                        }
                        .accessibilityHint("Opens the new binder form")
                    }
                }

                if binders.isEmpty {
                    ContentUnavailableView(
                        "No Binders Yet",
                        systemImage: "rectangle.stack.badge.plus",
                        description: Text("Create a binder to continue.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section("Binders") {
                        ForEach(binders) { binder in
                            Button {
                                selectedBinderId = binder.id
                                dismiss()
                            } label: {
                                HStack(spacing: 12) {
                                    Circle()
                                        .fill(Color.fromHex(binder.colorHex))
                                        .frame(width: 14, height: 14)

                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(binder.name)
                                            .foregroundStyle(.primary)

                                        if let description = binder.description,
                                           !description.isEmpty {
                                            Text(description)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }

                                    Spacer()

                                    if selectedBinderId == binder.id {
                                        Image(systemName: "checkmark")
                                            .font(.body.weight(.semibold))
                                            .foregroundStyle(.tint)
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(binder.name)
                            .accessibilityValue(selectedBinderId == binder.id ? "Selected" : "")
                        }
                    }
                }
            }
            .navigationTitle("Choose Binder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
    }
}
