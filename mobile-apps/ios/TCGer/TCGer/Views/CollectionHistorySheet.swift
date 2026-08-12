import SwiftUI

struct CollectionHistorySheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let onChanged: () async -> Void

    @State private var entries: [APIService.CollectionMutationAuditEntry] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var undoingID: String?
    @State private var pendingUndo: APIService.CollectionMutationAuditEntry?

    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Group {
                if environmentStore.serverConfiguration.isOnDevice {
                    ContentUnavailableView(
                        "History requires a server",
                        systemImage: "clock.badge.exclamationmark",
                        description: Text("On-device mode does not keep the immutable audit snapshots needed for safe undo.")
                    )
                } else if isLoading && entries.isEmpty {
                    ProgressView("Loading history…")
                } else if let errorMessage, entries.isEmpty {
                    ErrorView(title: "Couldn’t Load History", message: errorMessage) {
                        Task { await loadHistory() }
                    }
                } else if entries.isEmpty {
                    ContentUnavailableView(
                        "No Collection Changes",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("Per-copy collection changes will appear here.")
                    )
                } else {
                    List(entries) { entry in
                        historyRow(entry)
                    }
                    .refreshable { await loadHistory() }
                }
            }
            .navigationTitle("Collection History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                if !environmentStore.serverConfiguration.isOnDevice {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            Task { await loadHistory() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .disabled(isLoading || undoingID != nil)
                        .accessibilityLabel("Refresh history")
                    }
                }
            }
            .task { await loadHistory() }
            .alert(
                "History Error",
                isPresented: Binding(
                    get: { errorMessage != nil && !entries.isEmpty },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .confirmationDialog(
                "Undo this change?",
                isPresented: Binding(
                    get: { pendingUndo != nil },
                    set: { if !$0 { pendingUndo = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Undo Change", role: .destructive) {
                    guard let entry = pendingUndo else { return }
                    pendingUndo = nil
                    Task { await undo(entry) }
                }
                Button("Cancel", role: .cancel) { pendingUndo = nil }
            } message: {
                if let pendingUndo {
                    Text("“\(pendingUndo.summary)” will be reverted only if its affected copies have not changed since.")
                }
            }
        }
    }

    private func historyRow(_ entry: APIService.CollectionMutationAuditEntry) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon(for: entry.operationKind))
                .foregroundStyle(entry.operationKind == "undo" ? Color.secondary : Color.accentColor)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(label(for: entry.operationKind))
                        .font(.caption.weight(.semibold))
                    Text("\(entry.affectedCopies) \(entry.affectedCopies == 1 ? "copy" : "copies")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(entry.summary)
                    .font(.subheadline)
                if let date = auditDate(from: entry.createdAt) {
                    Text(date.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 8)

            if entry.canUndo {
                Button {
                    pendingUndo = entry
                } label: {
                    if undoingID == entry.id {
                        ProgressView()
                    } else {
                        Label("Undo", systemImage: "arrow.uturn.backward")
                            .labelStyle(.iconOnly)
                    }
                }
                .disabled(undoingID != nil)
                .accessibilityLabel("Undo \(entry.summary)")
            }
        }
        .padding(.vertical, 4)
    }

    @MainActor
    private func loadHistory() async {
        guard !environmentStore.serverConfiguration.isOnDevice else {
            isLoading = false
            return
        }
        guard let token = environmentStore.authToken else {
            isLoading = false
            errorMessage = "Sign in to view collection history."
            return
        }
        isLoading = true
        errorMessage = nil
        do {
            entries = try await apiService.getCollectionMutationHistory(
                config: environmentStore.serverConfiguration,
                token: token
            )
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    private func undo(_ entry: APIService.CollectionMutationAuditEntry) async {
        guard let token = environmentStore.authToken else { return }
        undoingID = entry.id
        errorMessage = nil
        do {
            _ = try await apiService.undoCollectionMutation(
                config: environmentStore.serverConfiguration,
                token: token,
                auditId: entry.id,
                idempotencyKey: "undo:\(entry.id):\(UUID().uuidString)"
            )
            await onChanged()
            await loadHistory()
        } catch {
            errorMessage = error.localizedDescription
        }
        undoingID = nil
    }

    private func label(for kind: String) -> String {
        switch kind {
        case "add": return "Added"
        case "update": return "Updated"
        case "remove": return "Removed"
        case "move": return "Moved"
        case "bulk": return "Bulk"
        case "import": return "Imported"
        case "undo": return "Undo"
        default: return kind.capitalized
        }
    }

    private func icon(for kind: String) -> String {
        switch kind {
        case "add": return "plus.circle"
        case "update": return "pencil.circle"
        case "remove": return "minus.circle"
        case "move": return "arrow.right.circle"
        case "bulk": return "square.stack.3d.up"
        case "import": return "square.and.arrow.down"
        case "undo": return "arrow.uturn.backward.circle"
        default: return "clock"
        }
    }

    private func auditDate(from value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
