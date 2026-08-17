import SwiftUI
import UIKit

struct RecoveryPointsView: View {
    private static let maximumRecoveryPoints = 5

    @State private var recoveryPoints: [LocalRecoveryPoint] = []
    @State private var selection: Set<URL> = []
    @State private var editMode: EditMode = .inactive
    @State private var pendingConfirmation: RecoveryPointConfirmation?
    @State private var shareRequest: RecoveryPointShareRequest?
    @State private var statusMessage: RecoveryPointStatusMessage?

    let onRecoveryPointsChanged: () -> Void

    init(onRecoveryPointsChanged: @escaping () -> Void = {}) {
        self.onRecoveryPointsChanged = onRecoveryPointsChanged
    }

    var body: some View {
        List(selection: $selection) {
            Section {
                if recoveryPoints.isEmpty {
                    ContentUnavailableView(
                        "No Recovery Points",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("Create one now, or TCGer will create them automatically before replacing local data.")
                    )
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(recoveryPoints) { recoveryPoint in
                        NavigationLink {
                            RecoveryPointDetailView(recoveryPoint: recoveryPoint) {
                                refreshRecoveryPoints()
                            }
                        } label: {
                            RecoveryPointRow(
                                recoveryPoint: recoveryPoint,
                                isLatest: recoveryPoint.id == recoveryPoints.first?.id
                            )
                        }
                        .tag(recoveryPoint.url)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                pendingConfirmation = .delete([recoveryPoint.url])
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }

                            Button {
                                shareRequest = RecoveryPointShareRequest(urls: [recoveryPoint.url])
                            } label: {
                                Label("Export", systemImage: "square.and.arrow.up")
                            }
                            .tint(.blue)
                        }
                        .swipeActions(edge: .leading, allowsFullSwipe: false) {
                            Button {
                                pendingConfirmation = .restore(recoveryPoint.url)
                            } label: {
                                Label("Restore", systemImage: "clock.arrow.circlepath")
                            }
                            .tint(.blue)
                        }
                    }
                }
            } footer: {
                Text("TCGer keeps up to five recovery points. Creating a sixth removes the oldest one.")
            }
        }
        .navigationTitle("Recovery Points")
        .environment(\.editMode, $editMode)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if !recoveryPoints.isEmpty {
                    EditButton()
                }

                Button {
                    requestCreateRecoveryPoint()
                } label: {
                    Label("Create Recovery Point", systemImage: "plus")
                }
            }

            if editMode.isEditing {
                ToolbarItemGroup(placement: .bottomBar) {
                    Button(role: .destructive) {
                        pendingConfirmation = .delete(selection)
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    .disabled(selection.isEmpty)

                    Spacer()

                    Button {
                        shareRequest = RecoveryPointShareRequest(urls: selectedURLs)
                    } label: {
                        Label("Export", systemImage: "square.and.arrow.up")
                    }
                    .disabled(selection.isEmpty)

                    Spacer()

                    Button {
                        if let url = selectedURLs.first {
                            pendingConfirmation = .restore(url)
                        }
                    } label: {
                        Label("Restore", systemImage: "clock.arrow.circlepath")
                    }
                    .disabled(selection.count != 1)
                }
            }
        }
        .onAppear {
            refreshRecoveryPoints()
        }
        .sheet(item: $shareRequest) { request in
            RecoveryPointActivityView(urls: request.urls)
        }
        .alert(item: $pendingConfirmation) { confirmation in
            confirmationAlert(for: confirmation)
        }
        .alert(item: $statusMessage) { message in
            Alert(
                title: Text(message.title),
                message: Text(message.message),
                dismissButton: .default(Text("OK"))
            )
        }
    }

    private var selectedURLs: [URL] {
        recoveryPoints.map(\.url).filter(selection.contains)
    }

    private func requestCreateRecoveryPoint() {
        if recoveryPoints.count >= Self.maximumRecoveryPoints {
            pendingConfirmation = .createReplacingOldest
        } else {
            createRecoveryPoint()
        }
    }

    private func createRecoveryPoint() {
        do {
            try LocalStore.shared.createLocalBackup()
            refreshRecoveryPoints()
        } catch {
            showError("TCGer couldn’t create a recovery point", error: error)
        }
    }

    private func restoreRecoveryPoint(at url: URL) {
        do {
            try LocalStore.shared.restoreLocalBackup(from: url)
            selection.removeAll()
            editMode = .inactive
            refreshRecoveryPoints()
            statusMessage = RecoveryPointStatusMessage(
                title: "Recovery Point Restored",
                message: "Your previous library is now active. TCGer preserved the library it replaced as another recovery point."
            )
        } catch {
            refreshRecoveryPoints()
            showError("TCGer couldn’t restore that recovery point", error: error)
        }
    }

    private func deleteRecoveryPoints(at urls: Set<URL>) {
        do {
            for url in urls {
                try LocalStore.shared.removeLocalBackup(at: url)
            }
            selection.subtract(urls)
            if selection.isEmpty {
                editMode = .inactive
            }
            refreshRecoveryPoints()
        } catch {
            refreshRecoveryPoints()
            showError("TCGer couldn’t delete the selected recovery points", error: error)
        }
    }

    private func refreshRecoveryPoints() {
        do {
            recoveryPoints = try LocalStore.shared.availableLocalBackups().map {
                LocalRecoveryPoint(url: $0)
            }
            selection.formIntersection(Set(recoveryPoints.map(\.url)))
            onRecoveryPointsChanged()
        } catch {
            recoveryPoints = []
            selection.removeAll()
            showError("TCGer couldn’t read local recovery points", error: error)
        }
    }

    private func showError(_ title: String, error: Error) {
        statusMessage = RecoveryPointStatusMessage(title: title, message: error.localizedDescription)
    }

    private func confirmationAlert(for confirmation: RecoveryPointConfirmation) -> Alert {
        switch confirmation {
        case .createReplacingOldest:
            return Alert(
                title: Text("Replace Oldest Recovery Point?"),
                message: Text("Only five recovery points are kept. Creating a new one removes the oldest recovery point."),
                primaryButton: .default(Text("Create"), action: createRecoveryPoint),
                secondaryButton: .cancel()
            )
        case .restore(let url):
            return Alert(
                title: Text("Restore This Recovery Point?"),
                message: Text("This replaces the current phone-only library after validating the recovery point. Your current library is preserved first."),
                primaryButton: .default(Text("Restore")) {
                    restoreRecoveryPoint(at: url)
                },
                secondaryButton: .cancel()
            )
        case .delete(let urls):
            let noun = urls.count == 1 ? "recovery point" : "recovery points"
            return Alert(
                title: Text("Delete \(urls.count) \(noun)?"),
                message: Text("Deleted recovery points cannot be restored unless you exported a copy."),
                primaryButton: .destructive(Text("Delete")) {
                    deleteRecoveryPoints(at: urls)
                },
                secondaryButton: .cancel()
            )
        }
    }
}

private struct RecoveryPointDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var pendingConfirmation: RecoveryPointDetailConfirmation?
    @State private var shareRequest: RecoveryPointShareRequest?
    @State private var statusMessage: RecoveryPointStatusMessage?

    let recoveryPoint: LocalRecoveryPoint
    let onRecoveryPointsChanged: () -> Void

    var body: some View {
        List {
            Section("Details") {
                LabeledContent("Created") {
                    Text(recoveryPoint.createdAt, format: .dateTime.year().month().day().hour().minute().second())
                }
                LabeledContent("Size", value: recoveryPoint.formattedSize)
                LabeledContent("Format", value: "TCGer JSON snapshot")
            }

            Section {
                Button {
                    pendingConfirmation = .restore
                } label: {
                    Label("Restore This Recovery Point", systemImage: "clock.arrow.circlepath")
                }

                Button {
                    shareRequest = RecoveryPointShareRequest(urls: [recoveryPoint.url])
                } label: {
                    Label("Export Recovery Point", systemImage: "square.and.arrow.up")
                }

                Button(role: .destructive) {
                    pendingConfirmation = .delete
                } label: {
                    Label("Delete Recovery Point", systemImage: "trash")
                }
            } footer: {
                Text("Restoring validates this snapshot and saves your current library as another recovery point first.")
            }
        }
        .navigationTitle("Recovery Point")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $shareRequest) { request in
            RecoveryPointActivityView(urls: request.urls)
        }
        .alert(item: $pendingConfirmation) { confirmation in
            switch confirmation {
            case .restore:
                return Alert(
                    title: Text("Restore This Recovery Point?"),
                    message: Text("This replaces the current phone-only library after validating the recovery point."),
                    primaryButton: .default(Text("Restore"), action: restore),
                    secondaryButton: .cancel()
                )
            case .delete:
                return Alert(
                    title: Text("Delete Recovery Point?"),
                    message: Text("This cannot be undone unless you exported a copy."),
                    primaryButton: .destructive(Text("Delete"), action: delete),
                    secondaryButton: .cancel()
                )
            }
        }
        .alert(item: $statusMessage) { message in
            Alert(
                title: Text(message.title),
                message: Text(message.message),
                dismissButton: .default(Text("OK"))
            )
        }
    }

    private func restore() {
        do {
            try LocalStore.shared.restoreLocalBackup(from: recoveryPoint.url)
            onRecoveryPointsChanged()
            // Restoring can rotate this file out when it was the oldest point,
            // so return to the refreshed list instead of leaving stale actions.
            dismiss()
        } catch {
            statusMessage = RecoveryPointStatusMessage(
                title: "TCGer couldn’t restore that recovery point",
                message: error.localizedDescription
            )
        }
    }

    private func delete() {
        do {
            try LocalStore.shared.removeLocalBackup(at: recoveryPoint.url)
            onRecoveryPointsChanged()
            dismiss()
        } catch {
            statusMessage = RecoveryPointStatusMessage(
                title: "TCGer couldn’t delete that recovery point",
                message: error.localizedDescription
            )
        }
    }
}

private struct RecoveryPointRow: View {
    let recoveryPoint: LocalRecoveryPoint
    let isLatest: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(recoveryPoint.createdAt, format: .dateTime.year().month().day().hour().minute())
                    .foregroundStyle(.primary)
                if isLatest {
                    Text("Latest")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.blue)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(.blue.opacity(0.12), in: Capsule())
                }
            }
            Text("\(recoveryPoint.formattedSize) · \(recoveryPoint.createdAt.formatted(.relative(presentation: .named)))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }
}

private struct LocalRecoveryPoint: Identifiable, Hashable {
    let url: URL
    let createdAt: Date
    let byteCount: Int64

    var id: URL { url }

    init(url: URL) {
        self.url = url
        let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .creationDateKey, .fileSizeKey])
        createdAt = values?.contentModificationDate ?? values?.creationDate ?? .distantPast
        byteCount = Int64(values?.fileSize ?? 0)
    }

    var formattedSize: String {
        ByteCountFormatter.string(fromByteCount: byteCount, countStyle: .file)
    }
}

private enum RecoveryPointConfirmation: Identifiable {
    case createReplacingOldest
    case restore(URL)
    case delete(Set<URL>)

    var id: String {
        switch self {
        case .createReplacingOldest:
            return "create"
        case .restore(let url):
            return "restore-\(url.path)"
        case .delete(let urls):
            return "delete-\(urls.map(\.path).sorted().joined(separator: "|"))"
        }
    }
}

private enum RecoveryPointDetailConfirmation: String, Identifiable {
    case restore
    case delete

    var id: String { rawValue }
}

private struct RecoveryPointStatusMessage: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

private struct RecoveryPointShareRequest: Identifiable {
    let id = UUID()
    let urls: [URL]
}

private struct RecoveryPointActivityView: UIViewControllerRepresentable {
    let urls: [URL]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: urls, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
