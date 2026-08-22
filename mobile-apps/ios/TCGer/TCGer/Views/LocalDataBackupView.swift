import SwiftUI
import UniformTypeIdentifiers

struct LocalDataBackupView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var exportDocument: LocalDataBackupDocument?
    @State private var exportFilename = "TCGer-Backup"
    @State private var showingExporter = false
    @State private var statusMessage: LocalDataBackupStatus?

    let onDataChanged: () -> Void

    init(onDataChanged: @escaping () -> Void = {}) {
        self.onDataChanged = onDataChanged
    }

    var body: some View {
        List {
            Section {
                Label("Collections, cards, and binders", systemImage: "rectangle.stack")
                Label("Code Vault and wishlists", systemImage: "qrcode")
                Label("Sealed items and transactions", systemImage: "shippingbox")
                Label("Smart folders and app preferences", systemImage: "folder.badge.gearshape")
            } header: {
                Text("Included")
            } footer: {
                Text("Downloaded catalogs, artwork, and scanner diagnostics are replaceable cache data and are not included. Backup files contain your actual vault codes, so keep them private.")
            }

            Section {
                Button(action: prepareExport) {
                    Label("Export All Data", systemImage: "square.and.arrow.up")
                }

                LocalDataBackupImportButton(title: "Import Backup") { _ in
                    onDataChanged()
                }
            } header: {
                Text("Transfer")
            } footer: {
                Text("Import validates the whole backup before replacing this phone’s data. TCGer keeps the data it replaces as a local recovery point.")
            }

            Section {
                NavigationLink {
                    RecoveryPointsView(onRecoveryPointsChanged: onDataChanged)
                } label: {
                    Label("Recovery Points", systemImage: "clock.arrow.circlepath")
                }
            } footer: {
                Text("Recovery points are automatic local snapshots. Portable backups are files you can save to iCloud Drive, AirDrop, or another device.")
            }
        }
        .navigationTitle("Backup & Restore")
        .fileExporter(
            isPresented: $showingExporter,
            document: exportDocument,
            contentType: .json,
            defaultFilename: exportFilename
        ) { result in
            if case .failure(let error) = result {
                statusMessage = LocalDataBackupStatus(
                    title: "TCGer couldn’t export the backup",
                    message: error.localizedDescription
                )
            }
            exportDocument = nil
        }
        .alert(item: $statusMessage) { status in
            Alert(
                title: Text(status.title),
                message: Text(status.message),
                dismissButton: .default(Text("OK"))
            )
        }
    }

    private func prepareExport() {
        do {
            let data = try LocalStore.shared.exportPortableBackup(
                appPreferences: environmentStore.localDataBackupPreferences()
            )
            exportDocument = LocalDataBackupDocument(data: data)
            exportFilename = LocalStore.portableBackupFilename()
                .replacingOccurrences(of: ".json", with: "")
            showingExporter = true
        } catch {
            statusMessage = LocalDataBackupStatus(
                title: "TCGer couldn’t create the backup",
                message: error.localizedDescription
            )
        }
    }
}

struct LocalDataBackupImportButton: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var showingImporter = false
    @State private var activeAlert: LocalDataImportAlert?

    let title: String
    let onRestored: (LocalDataBackupSummary) -> Void

    var body: some View {
        Button {
            showingImporter = true
        } label: {
            Label(title, systemImage: "square.and.arrow.down")
        }
        .fileImporter(
            isPresented: $showingImporter,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false,
            onCompletion: handleSelection
        )
        .alert(item: $activeAlert) { alert in
            switch alert {
            case .confirmation(let pending):
                return Alert(
                    title: Text("Replace This Phone’s Data?"),
                    message: Text(confirmationMessage(for: pending.summary)),
                    primaryButton: .default(Text("Import")) {
                        restore(pending)
                    },
                    secondaryButton: .cancel()
                )
            case .status(let status):
                return Alert(
                    title: Text(status.title),
                    message: Text(status.message),
                    dismissButton: .default(Text("OK"))
                )
            }
        }
    }

    private func handleSelection(_ result: Result<[URL], Error>) {
        do {
            let url = try result.get().first
            guard let url else { return }
            let hasAccess = url.startAccessingSecurityScopedResource()
            defer {
                if hasAccess { url.stopAccessingSecurityScopedResource() }
            }
            let data = try Data(contentsOf: url)
            let summary = try LocalStore.shared.portableBackupSummary(from: data)
            activeAlert = .confirmation(PendingLocalDataImport(data: data, summary: summary))
        } catch {
            activeAlert = .status(LocalDataBackupStatus(
                title: "TCGer couldn’t read that backup",
                message: error.localizedDescription
            ))
        }
    }

    private func restore(_ pending: PendingLocalDataImport) {
        do {
            let appPreferences = try LocalStore.shared.importPortableBackup(pending.data)
            environmentStore.applyUserPreferences(LocalStore.shared.getUserPreferences())
            if let appPreferences {
                environmentStore.applyLocalDataBackupPreferences(appPreferences)
            }
            onRestored(pending.summary)
            DispatchQueue.main.async {
                activeAlert = .status(LocalDataBackupStatus(
                    title: "Backup Imported",
                    message: "Your collection, Code Vault, and other local data are ready."
                ))
            }
        } catch {
            DispatchQueue.main.async {
                activeAlert = .status(LocalDataBackupStatus(
                    title: "TCGer couldn’t import that backup",
                    message: error.localizedDescription
                ))
            }
        }
    }

    private func confirmationMessage(for summary: LocalDataBackupSummary) -> String {
        let date = summary.exportedAt.map {
            "Backup from \($0.formatted(date: .abbreviated, time: .shortened)). "
        } ?? ""
        return date + [
            "\(summary.binderCount) binders",
            "\(summary.cardCopyCount) card copies",
            "\(summary.wishlistCount) wishlists",
            "\(summary.onlineCodeCount) codes",
            "\(summary.sealedItemCount) sealed items",
            "\(summary.transactionCount) transactions",
        ].joined(separator: " · ") + ". The current data will be saved as a recovery point first."
    }
}

private struct LocalDataBackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }

    let data: Data

    init(data: Data) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw LocalDataTransferError.invalidBackup
        }
        self.data = data
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

private struct PendingLocalDataImport: Identifiable {
    let id = UUID()
    let data: Data
    let summary: LocalDataBackupSummary
}

private enum LocalDataImportAlert: Identifiable {
    case confirmation(PendingLocalDataImport)
    case status(LocalDataBackupStatus)

    var id: UUID {
        switch self {
        case .confirmation(let pending):
            return pending.id
        case .status(let status):
            return status.id
        }
    }
}

private struct LocalDataBackupStatus: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}
