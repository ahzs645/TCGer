import SwiftUI

struct GameStoreView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @ObservedObject var catalogStore: CatalogStore

    @State private var packages: [OfficialGamePackage] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

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
                            }
                        )
                    }
                }
            }
        }
        .navigationTitle("Game Store")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadPackages() }
        .refreshable { await loadPackages() }
        .onChange(of: environmentStore.sealedProductsEnabled) { _, enabled in
            catalogStore.setSealedProductsEnabled(enabled)
        }
    }

    private func loadPackages() async {
        isLoading = true
        errorMessage = nil
        await catalogStore.refreshManifest()
        let loaded = await catalogStore.officialGamePackages()
        guard !Task.isCancelled else { return }
        packages = loaded
        if loaded.isEmpty, catalogStore.manifest == nil {
            errorMessage = "TCGer could not load the published catalog manifest."
        }
        isLoading = false
    }
}
