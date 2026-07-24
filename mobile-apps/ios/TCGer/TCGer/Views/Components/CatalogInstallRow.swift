import SwiftUI

struct CatalogInstallRow: View {
    let game: TCGGame
    @ObservedObject var catalogStore: CatalogStore

    @State private var errorMessage: String?
    @State private var showingRemoveConfirmation = false

    private var metadata: CatalogManifestGame? {
        catalogStore.metadata(for: game)
    }

    private var isAvailable: Bool {
        catalogStore.isAvailable(game)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(game.cardBackAssetName)
                .resizable()
                .scaledToFit()
                .frame(width: 42, height: 60)
                .clipShape(RoundedRectangle(cornerRadius: 4))

            VStack(alignment: .leading, spacing: 4) {
                Text(game.displayName)
                    .font(.subheadline.weight(.semibold))

                Text(catalogSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(statusSummary)
                    .font(.caption2)
                    .foregroundStyle(statusColor)

                if catalogStore.installingGames.contains(game) {
                    ProgressView(value: catalogStore.installProgress[game] ?? 0)
                        .progressViewStyle(.linear)
                        .accessibilityLabel("Installing \(game.displayName) catalog")
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption2)
                        .foregroundStyle(.red)
                }
            }

            Spacer(minLength: 8)

            actionButton
                .buttonStyle(.bordered)
                .controlSize(.small)
        }
        .padding(.vertical, 4)
        .alert("Remove \(game.displayName) catalog?", isPresented: $showingRemoveConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Remove", role: .destructive) {
                catalogStore.remove(game)
            }
        } message: {
            Text("Your saved cards will stay on this phone.")
        }
    }

    @ViewBuilder
    private var actionButton: some View {
        if catalogStore.installingGames.contains(game) {
            ProgressView()
                .controlSize(.small)
        } else {
            switch catalogStore.installState(for: game) {
            case .notInstalled:
                Button(isAvailable ? "Install" : "Unavailable") {
                    install()
                }
                .disabled(!isAvailable)
            case .installed:
                if catalogStore.isUpdateAvailable(game), isAvailable {
                    Button("Update") {
                        install()
                    }
                } else {
                    Button("Remove", role: .destructive) {
                        showingRemoveConfirmation = true
                    }
                }
            }
        }
    }

    private var catalogSummary: String {
        guard let metadata else {
            return "Not available in this build"
        }
        let count = metadata.cardCount.formatted(.number)
        return "\(count) cards • ~\(metadata.formattedCatalogSize)"
    }

    private var statusSummary: String {
        guard isAvailable else {
            return "Not available in this build"
        }
        switch catalogStore.installState(for: game) {
        case .notInstalled:
            return "Not installed"
        case .installed(let version):
            return catalogStore.isUpdateAvailable(game)
                ? "Version \(version) installed • update available"
                : "Version \(version) installed"
        }
    }

    private var statusColor: Color {
        guard isAvailable else { return .secondary }
        if catalogStore.isUpdateAvailable(game) { return .orange }
        if case .installed = catalogStore.installState(for: game) { return .green }
        return .secondary
    }

    private func install() {
        errorMessage = nil
        Task {
            do {
                try await catalogStore.install(game)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

extension CatalogManifestGame {
    var formattedCatalogSize: String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}
