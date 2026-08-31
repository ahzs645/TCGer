import SwiftUI

struct GameStoreView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @ObservedObject var catalogStore: CatalogStore
    @StateObject private var gamePackages = GamePackageStore.shared
    @StateObject private var scannerAssets = ScannerAssetStore.shared
    @StateObject private var packDownloads = PackOfflineDownloadManager.shared

    @State private var packages: [OfficialGamePackage] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    init(catalogStore: CatalogStore) {
        self.catalogStore = catalogStore
    }

    var body: some View {
        List {
            Section {
                Toggle(isOn: $environmentStore.sealedProductsEnabled) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Sealed Products")
                        Text("Include available boxes, packs, decks, and other sealed products")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } footer: {
                Text("This preference applies to official packages. Turning it off removes downloaded product catalogs but keeps your sealed inventory.")
            }

            Section("Official Packages") {
                if isLoading {
                    HStack {
                        Spacer()
                        ProgressView("Loading Game Store…")
                        Spacer()
                    }
                } else if let errorMessage {
                    ContentUnavailableView(
                        "Store Unavailable",
                        systemImage: "wifi.exclamationmark",
                        description: Text(errorMessage)
                    )
                } else if packages.isEmpty {
                    ContentUnavailableView(
                        "No Published Packages",
                        systemImage: "shippingbox",
                        description: Text("The catalog manifest does not currently publish any official game packages.")
                    )
                } else {
                    ForEach(packages) { package in
                        CatalogInstallRow(
                            game: package.game,
                            catalogStore: catalogStore,
                            includeSealedProducts: environmentStore.sealedProductsEnabled,
                            packageManifest: package.manifest,
                            isGameEnabled: environmentStore.isGameEnabled(package.game),
                            onActivated: { game in
                                Task { await environmentStore.activateInstalledGame(game) }
                            },
                            onRemoved: removeOfficialPackageData
                        )
                    }
                }
            }

            Section {
                NavigationLink {
                    InstallGamePackageView(store: gamePackages)
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Install from URL")
                            Text("Add and manage packages from other publishers")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "link.badge.plus")
                    }
                }
            } header: {
                Text("Other Sources")
            } footer: {
                Text("Packages installed from a URL remain on this device if their source later becomes unavailable.")
            }
        }
        .navigationTitle("Game Store")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadPackages() }
        .refreshable { await refreshPackages() }
        .onChange(of: environmentStore.sealedProductsEnabled) { _, enabled in
            catalogStore.setSealedProductsEnabled(enabled)
        }
    }

    private func loadPackages() async {
        isLoading = true
        errorMessage = nil
        let loaded = await catalogStore.officialGamePackages()
        guard !Task.isCancelled else { return }
        packages = loaded
        if loaded.isEmpty, catalogStore.manifest == nil {
            errorMessage = "TCGer could not load the published catalog manifest."
        }
        isLoading = false

        await refreshPackages()
    }

    private func refreshPackages() async {
        await catalogStore.refreshManifest()
        let loaded = await catalogStore.officialGamePackages()
        guard !Task.isCancelled else { return }
        if !loaded.isEmpty {
            packages = loaded
            errorMessage = nil
        } else if packages.isEmpty, catalogStore.manifest == nil {
            errorMessage = "TCGer could not load the published catalog manifest."
        }
        isLoading = false
    }

    private func removeOfficialPackageData(_ game: TCGGame) {
        scannerAssets.remove(game)
        for definition in packDownloads.definitions(for: game) {
            packDownloads.remove(definition)
        }

        guard environmentStore.serverConfiguration.isOnDevice else { return }
        environmentStore.setGameEnabled(game, enabled: false)
        if environmentStore.defaultGame == game.rawValue {
            environmentStore.defaultGame = nil
        }
    }
}
