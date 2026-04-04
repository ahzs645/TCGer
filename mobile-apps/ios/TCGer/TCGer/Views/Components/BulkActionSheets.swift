import SwiftUI

// MARK: - Bulk Condition Sheet

struct BulkConditionSheet: View {
    let selectedCount: Int
    let onSelect: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    private let conditions = [
        "MINT", "NEAR MINT", "EXCELLENT", "GOOD",
        "LIGHT PLAYED", "PLAYED", "POOR"
    ]

    var body: some View {
        NavigationView {
            List {
                Section {
                    ForEach(conditions, id: \.self) { condition in
                        Button {
                            onSelect(condition)
                            dismiss()
                        } label: {
                            Text(condition)
                        }
                    }
                } header: {
                    Text("Set condition for \(selectedCount) card(s)")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Change Condition")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Bulk Move Sheet

struct BulkMoveSheet: View {
    let sourceBinderId: String
    let selectedCount: Int
    let isProcessing: Bool
    let onMove: (String) async -> Void
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var binders: [Collection] = []
    @State private var isLoading = true

    private let apiService = APIService()

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading binders...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if binders.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "folder.badge.questionmark")
                            .font(.system(size: 40))
                            .foregroundColor(.secondary)
                        Text("No other binders available")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        Section {
                            ForEach(binders) { binder in
                                Button {
                                    Task { await onMove(binder.id) }
                                } label: {
                                    HStack(spacing: 12) {
                                        Circle()
                                            .fill(Color.fromHex(binder.colorHex))
                                            .frame(width: 10, height: 10)
                                        Text(binder.name)
                                            .font(.body)
                                        Spacer()
                                        if isProcessing {
                                            ProgressView()
                                                .scaleEffect(0.8)
                                        }
                                    }
                                }
                                .disabled(isProcessing)
                            }
                        } header: {
                            Text("Move \(selectedCount) card(s) to:")
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Move Cards")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                await loadBinders()
            }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func loadBinders() async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            return
        }

        do {
            let collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: true
            )
            binders = collections.filter { $0.id != sourceBinderId && !$0.isUnsortedBinder }
            isLoading = false
        } catch {
            isLoading = false
        }
    }
}
