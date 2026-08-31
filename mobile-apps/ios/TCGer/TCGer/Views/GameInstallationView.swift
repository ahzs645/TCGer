import SwiftUI

nonisolated enum GameInstallationState {
    static func needsInstallation(enabledGameCount: Int, installedPackageCount: Int) -> Bool {
        enabledGameCount == 0 && installedPackageCount == 0
    }
}

struct GameInstallationView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @ObservedObject var catalogStore: CatalogStore
    @ObservedObject var gamePackages: GamePackageStore

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Install a Game", systemImage: "shippingbox")
            } description: {
                Text("TCGer has no active game libraries. Download an official package or connect one from another publisher.")
            } actions: {
                VStack(spacing: 12) {
                    NavigationLink {
                        GameStoreView(catalogStore: catalogStore)
                            .environmentObject(environmentStore)
                    } label: {
                        Label("Browse Game Store", systemImage: "storefront")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)

                    NavigationLink {
                        InstallGamePackageView(store: gamePackages)
                    } label: {
                        Label("Install from URL", systemImage: "link.badge.plus")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                .frame(maxWidth: 320)
            }
            .padding()
            .navigationTitle("Game Libraries")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
