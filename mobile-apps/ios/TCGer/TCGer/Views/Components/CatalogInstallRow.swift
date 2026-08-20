import SwiftUI

struct CatalogInstallRow: View {
    let game: TCGGame
    @ObservedObject var catalogStore: CatalogStore
    let includeSealedProducts: Bool

    @State private var errorMessage: String?
    @State private var showingRemoveConfirmation = false
    @State private var showingDetails = false

    init(
        game: TCGGame,
        catalogStore: CatalogStore,
        includeSealedProducts: Bool = false
    ) {
        self.game = game
        self.catalogStore = catalogStore
        self.includeSealedProducts = includeSealedProducts
    }

    private var metadata: CatalogManifestGame? {
        catalogStore.metadata(for: game)
    }

    private var isAvailable: Bool {
        catalogStore.isAvailable(game)
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            catalogImage

            VStack(alignment: .leading, spacing: 3) {
                Text(game.displayName)
                    .font(.subheadline.weight(.semibold))

                DownloadableAssetStatusLabel(
                    text: statusSummary,
                    systemImage: statusSystemImage,
                    tint: statusColor,
                    lineLimit: 2
                )
                    .font(.caption)

                if isInstalling {
                    DownloadableAssetProgressView(
                        progress: currentProgress,
                        accessibilityLabel: "Installing \(game.displayName) catalog"
                    )
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption2)
                        .foregroundStyle(.red)
                }
            }

            Spacer(minLength: 8)

            VStack(spacing: 8) {
                Button {
                    showingDetails = true
                } label: {
                    Image(systemName: "info.circle")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("About \(game.displayName) catalog")

                DownloadableAssetActionControl(
                    state: actionState,
                    action: performAction
                )
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 2)
        .popover(isPresented: $showingDetails) {
            catalogDetails
                .presentationCompactAdaptation(.popover)
        }
        .alert("Remove \(game.displayName) catalog?", isPresented: $showingRemoveConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Remove", role: .destructive) {
                catalogStore.remove(game)
                catalogStore.removeSealed(game)
            }
        } message: {
            Text("Your saved cards and sealed inventory will stay on this phone.")
        }
    }

    @ViewBuilder
    private var catalogImage: some View {
        if let cardBackAssetName = game.cardBackAssetName {
            Image(cardBackAssetName)
                .resizable()
                .scaledToFit()
                .frame(width: 34, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 4))
        } else {
            RoundedRectangle(cornerRadius: 4)
                .fill(.secondary.opacity(0.15))
                .frame(width: 34, height: 48)
                .overlay {
                    Image(systemName: "photo")
                        .foregroundStyle(.secondary)
                }
        }
    }

    private var catalogDetails: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(game.displayName, systemImage: "internaldrive")
                .font(.headline)
            Text(catalogSummary)
            if let sealedCatalogSummary {
                Text(sealedCatalogSummary)
            }
            Text(statusSummary)
                .foregroundStyle(statusColor)
        }
        .font(.subheadline)
        .padding()
        .frame(idealWidth: 300, alignment: .leading)
    }

    private var actionState: DownloadableAssetActionControl.State {
        guard !isInstalling else {
            return .busy(accessibilityLabel: "Installing \(game.displayName) catalog")
        }

        switch catalogStore.installState(for: game) {
        case .notInstalled:
            return .button(
                title: isAvailable ? "Install" : "Unavailable",
                isEnabled: isAvailable
            )
        case .installed:
            if needsCatalogUpdate, isAvailable {
                return .button(title: "Update")
            }
            if needsSealedInstall {
                return .button(title: "Add Products")
            }
            return .button(title: "Remove", role: .destructive)
        }
    }

    private var removesCatalog: Bool {
        guard case .installed = catalogStore.installState(for: game) else { return false }
        return !(needsCatalogUpdate && isAvailable) && !needsSealedInstall
    }

    private var catalogSummary: String {
        guard let metadata else {
            return "Not available in this build"
        }
        let count = metadata.cardCount.formatted(.number)
        return "\(count) cards • ~\(metadata.formattedDownloadSize) download"
    }

    private var sealedCatalogSummary: String? {
        guard includeSealedProducts,
              let metadata = catalogStore.sealedMetadata(for: game) else {
            return nil
        }
        return "\(metadata.productCount.formatted(.number)) sealed products • ~\(metadata.formattedDownloadSize) download"
    }

    private var statusSummary: String {
        guard isAvailable else {
            return "Not available in this build"
        }
        switch catalogStore.installState(for: game) {
        case .notInstalled:
            return "Not installed"
        case .installed(let version):
            if needsCatalogUpdate { return "Version \(version) installed • update available" }
            if needsSealedInstall { return "Cards installed • sealed products not installed" }
            return includeSealedProducts && catalogStore.isSealedAvailable(game)
                ? "Cards and sealed products installed"
                : "Version \(version) installed"
        }
    }

    private var statusColor: Color {
        guard isAvailable else { return .secondary }
        if needsCatalogUpdate || needsSealedInstall { return .orange }
        if case .installed = catalogStore.installState(for: game) { return .green }
        return .secondary
    }

    private var statusSystemImage: String {
        guard isAvailable else { return "exclamationmark.triangle" }
        if needsCatalogUpdate || needsSealedInstall { return "arrow.down.circle" }
        if case .installed = catalogStore.installState(for: game) { return "checkmark.circle.fill" }
        return "circle.dashed"
    }

    private func install() {
        errorMessage = nil
        Task {
            do {
                try await catalogStore.install(game)
                if includeSealedProducts, catalogStore.isSealedAvailable(game) {
                    try await catalogStore.installSealed(game)
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func performAction() {
        if removesCatalog {
            showingRemoveConfirmation = true
        } else {
            install()
        }
    }

    private var isInstalling: Bool {
        catalogStore.installingGames.contains(game) ||
            catalogStore.installingSealedGames.contains(game)
    }

    private var currentProgress: Double {
        if catalogStore.installingSealedGames.contains(game) {
            return catalogStore.sealedInstallProgress[game] ?? 0
        }
        return catalogStore.installProgress[game] ?? 0
    }

    private var needsSealedInstall: Bool {
        guard includeSealedProducts, catalogStore.isSealedAvailable(game) else { return false }
        if case .notInstalled = catalogStore.sealedInstallState(for: game) { return true }
        return catalogStore.isSealedUpdateAvailable(game)
    }

    private var needsCatalogUpdate: Bool {
        catalogStore.isUpdateAvailable(game) ||
            (includeSealedProducts && catalogStore.isSealedUpdateAvailable(game))
    }
}

extension CatalogManifestGame {
    var formattedDownloadSize: String {
        ByteCountFormatter.string(
            fromByteCount: Int64(compressedBytes ?? bytes),
            countStyle: .file
        )
    }
}

extension SealedCatalogManifestEntry {
    var formattedDownloadSize: String {
        ByteCountFormatter.string(
            fromByteCount: Int64(compressedBytes ?? bytes),
            countStyle: .file
        )
    }
}
