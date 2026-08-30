import SwiftUI

struct OfflineDownloadsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    @ObservedObject var catalogStore: CatalogStore
    @ObservedObject var scannerAssets: ScannerAssetStore
    @ObservedObject var packDownloads: PackOfflineDownloadManager

    var body: some View {
        List {
            if environmentStore.serverConfiguration.isOnDevice {
                Section {
                    Toggle(isOn: $environmentStore.sealedProductsEnabled) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Sealed Products")
                            Text("Include boxes, packs, decks, and other sealed products")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Catalog Options")
                } footer: {
                    Text("Turning this off removes optional product catalogs but keeps your sealed inventory. The setting applies to every game.")
                }
            }

            Section {
                ForEach(downloadGames) { game in
                    NavigationLink {
                        GameOfflineDownloadsView(
                            game: game,
                            catalogStore: catalogStore,
                            scannerAssets: scannerAssets,
                            packDownloads: packDownloads
                        )
                        .environmentObject(environmentStore)
                    } label: {
                        GameDownloadMenuLabel(
                            game: game,
                            isLocalMode: environmentStore.serverConfiguration.isOnDevice,
                            catalogStore: catalogStore,
                            scannerAssets: scannerAssets,
                            packDownloads: packDownloads
                        )
                    }
                }
            } header: {
                Text("Games")
            } footer: {
                Text("Catalogs, scanner models, and offline pack sets are managed inside their relevant game.")
            }
        }
        .navigationTitle("Offline Downloads")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var downloadGames: [TCGGame] {
        TCGGame.catalogGames.filter { game in
            environmentStore.serverConfiguration.isOnDevice ||
                ScannerAssetStore.downloadableGames.contains(game) ||
                !packDownloads.definitions(for: game).isEmpty
        }
    }
}

private struct GameOfflineDownloadsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let game: TCGGame
    @ObservedObject var catalogStore: CatalogStore
    @ObservedObject var scannerAssets: ScannerAssetStore
    @ObservedObject var packDownloads: PackOfflineDownloadManager

    var body: some View {
        List {
            if environmentStore.serverConfiguration.isOnDevice,
               TCGGame.catalogGames.contains(game) {
                Section {
                    CatalogInstallRow(
                        game: game,
                        catalogStore: catalogStore,
                        includeSealedProducts: environmentStore.sealedProductsEnabled
                    )
                } header: {
                    Text("Offline Catalog")
                } footer: {
                    Text(catalogFooter)
                }
            }

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
        }
        .navigationTitle(game.displayName)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var catalogFooter: String {
        if environmentStore.sealedProductsEnabled {
            return "Includes the card catalog and available sealed-product data for \(game.displayName)."
        }
        return "Includes the searchable card catalog for \(game.displayName)."
    }
}

private struct GameDownloadMenuLabel: View {
    let game: TCGGame
    let isLocalMode: Bool
    @ObservedObject var catalogStore: CatalogStore
    @ObservedObject var scannerAssets: ScannerAssetStore
    @ObservedObject var packDownloads: PackOfflineDownloadManager

    var body: some View {
        HStack(spacing: 12) {
            gameIcon

            VStack(alignment: .leading, spacing: 3) {
                Text(game.displayName)
                Text(contentSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var gameIcon: some View {
        if let iconName = game.iconName {
            Image(iconName)
                .resizable()
                .scaledToFit()
                .frame(width: 26, height: 26)
        } else {
            Image(systemName: game.systemIconName)
                .foregroundStyle(.tint)
                .frame(width: 26, height: 26)
        }
    }

    private var contentSummary: String {
        var parts: [String] = []

        if isLocalMode, TCGGame.catalogGames.contains(game) {
            switch catalogStore.installState(for: game) {
            case .notInstalled:
                parts.append("Catalog not installed")
            case .installed:
                parts.append(catalogStore.isUpdateAvailable(game) ? "Catalog update available" : "Catalog installed")
            }
        }

        if ScannerAssetStore.downloadableGames.contains(game) {
            switch scannerAssets.installState(for: game) {
            case .notInstalled:
                parts.append("Scanner not installed")
            case .installed:
                parts.append(scannerAssets.isUpdateAvailable(game) ? "Scanner update available" : "Scanner installed")
            }
        }

        let definitions = packDownloads.definitions(for: game)
        if !definitions.isEmpty {
            let installed = definitions.reduce(into: 0) { count, definition in
                if case .downloaded = packDownloads.status(for: definition) {
                    count += 1
                }
            }
            parts.append("\(installed)/\(definitions.count) pack sets")
        }

        return parts.joined(separator: " · ")
    }
}
