import SwiftUI

struct GameOfflineDownloadsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let game: TCGGame
    @ObservedObject var catalogStore: CatalogStore
    @ObservedObject var scannerAssets: ScannerAssetStore
    @ObservedObject var packDownloads: PackOfflineDownloadManager

    var body: some View {
        NavigationStack {
            GameOfflineDownloadsView(
                game: game,
                catalogStore: catalogStore,
                scannerAssets: scannerAssets,
                packDownloads: packDownloads
            )
            .environmentObject(environmentStore)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

struct GameOfflineDownloadsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let game: TCGGame
    @ObservedObject var catalogStore: CatalogStore
    @ObservedObject var scannerAssets: ScannerAssetStore
    @ObservedObject var packDownloads: PackOfflineDownloadManager

    var body: some View {
        List {
            if ScannerAssetStore.downloadableGames.contains(game) {
                Section {
                    ScannerAssetInstallRow(game: game, store: scannerAssets)
                } header: {
                    Text("Scanner Model")
                } footer: {
                    Text("Runs card recognition for \(game.displayName) entirely on this phone.")
                }
            }

            if !packDownloads.definitions(for: game).isEmpty {
                OfflinePackDownloadsSection(game: game, manager: packDownloads)
            }

            if !hasOfflineDownloads {
                ContentUnavailableView(
                    "No Offline Downloads",
                    systemImage: "icloud.slash",
                    description: Text("Nothing is currently available to download for \(game.displayName).")
                )
                .listRowBackground(Color.clear)
            }
        }
        .navigationTitle("\(game.displayName) Offline")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var hasOfflineDownloads: Bool {
        ScannerAssetStore.downloadableGames.contains(game) ||
            !packDownloads.definitions(for: game).isEmpty
    }
}

struct GameOfflineDownloadStatus {
    let installedCount: Int
    let availableCount: Int
    let hasUpdate: Bool

    @MainActor
    init(
        game: TCGGame,
        isLocalMode: Bool,
        includeSealedProducts: Bool,
        catalogStore: CatalogStore,
        scannerAssets: ScannerAssetStore,
        packDownloads: PackOfflineDownloadManager
    ) {
        var installedCount = 0
        var availableCount = 0
        var hasUpdate = false

        if ScannerAssetStore.downloadableGames.contains(game) {
            availableCount += 1
            if case .installed = scannerAssets.installState(for: game) {
                installedCount += 1
            }
            hasUpdate = hasUpdate || scannerAssets.isUpdateAvailable(game)
        }

        let packDefinitions = packDownloads.definitions(for: game)
        availableCount += packDefinitions.count
        for definition in packDefinitions {
            if case .downloaded = packDownloads.status(for: definition) {
                installedCount += 1
            }
        }

        self.installedCount = installedCount
        self.availableCount = availableCount
        self.hasUpdate = hasUpdate
    }

    var systemImage: String {
        if isComplete {
            return "checkmark.icloud.fill"
        }
        if installedCount > 0 {
            return "icloud.fill"
        }
        return "icloud.and.arrow.down"
    }

    var tint: Color {
        if hasUpdate {
            return .orange
        }
        if isComplete {
            return .green
        }
        if installedCount > 0 {
            return .blue
        }
        return .secondary
    }

    func accessibilityLabel(for game: TCGGame) -> String {
        if availableCount == 0 {
            return "No offline downloads available for \(game.displayName)"
        }
        if hasUpdate {
            return "Manage \(game.displayName) offline downloads, update available, \(installedCount) of \(availableCount) downloaded"
        }
        return "Manage \(game.displayName) offline downloads, \(installedCount) of \(availableCount) downloaded"
    }

    private var isComplete: Bool {
        availableCount > 0 && installedCount == availableCount && !hasUpdate
    }
}
