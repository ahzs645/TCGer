import SwiftUI

struct ScannerAssetInstallRow: View {
    let game: TCGGame
    @ObservedObject var store: ScannerAssetStore

    @State private var errorMessage: String?
    @State private var showingRemoveConfirmation = false
    @State private var showingDetails = false

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            gameImage

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
                        progress: store.installProgress[game] ?? 0,
                        accessibilityLabel: "Installing \(game.displayName) scanner model"
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
                .accessibilityLabel("About \(game.displayName) scanner model")

                DownloadableAssetActionControl(state: actionState, action: performAction)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 2)
        .popover(isPresented: $showingDetails) {
            details
                .presentationCompactAdaptation(.popover)
        }
        .alert("Remove \(game.displayName) scanner model?", isPresented: $showingRemoveConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Remove", role: .destructive) { store.remove(game) }
        } message: {
            Text("Yu-Gi-Oh! on-device embedding scans will be unavailable until the model is installed again. Your cards and catalog stay on this phone.")
        }
        .task {
            if store.manifests[game] == nil {
                try? await store.refreshManifest(for: game)
            }
        }
    }

    @ViewBuilder
    private var gameImage: some View {
        if let assetName = game.cardBackAssetName {
            Image(assetName)
                .resizable()
                .scaledToFit()
                .frame(width: 34, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 4))
        } else {
            RoundedRectangle(cornerRadius: 4)
                .fill(.secondary.opacity(0.15))
                .frame(width: 34, height: 48)
                .overlay { Image(systemName: "viewfinder").foregroundStyle(.secondary) }
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("On-device recognition", systemImage: "viewfinder")
                .font(.headline)
            if let manifest = store.manifests[game] {
                Text("\(manifest.cardCount.formatted(.number)) cards • \(manifest.dimension)-dimension ArcFace index")
                Text("\(formattedBytes(manifest.downloadBytes)) download. The matching model, vectors, and card metadata are integrity-checked and activated together.")
            } else {
                Text("Model information is unavailable while offline.")
            }
            Text("After installation, close and reopen the scanner, then select Yu-Gi-Oh! mode.")
                .foregroundStyle(.secondary)
        }
        .font(.subheadline)
        .padding()
        .frame(idealWidth: 320, alignment: .leading)
    }

    private var actionState: DownloadableAssetActionControl.State {
        if isInstalling {
            return .busy(accessibilityLabel: "Installing \(game.displayName) scanner model")
        }
        switch store.installState(for: game) {
        case .notInstalled:
            return .button(title: store.isAvailable(game) ? "Install" : "Unavailable", isEnabled: store.isAvailable(game))
        case .installed:
            return store.isUpdateAvailable(game)
                ? .button(title: "Update")
                : .button(title: "Remove", role: .destructive)
        }
    }

    private var statusSummary: String {
        switch store.installState(for: game) {
        case .notInstalled:
            guard let manifest = store.manifests[game] else { return "Not available while offline" }
            return "Not installed • \(formattedBytes(manifest.downloadBytes))"
        case .installed(let version):
            return store.isUpdateAvailable(game)
                ? "Version \(version) installed • update available"
                : "Version \(version) installed"
        }
    }

    private var statusSystemImage: String {
        if isInstalling { return "arrow.down.circle" }
        if store.isUpdateAvailable(game) { return "arrow.down.circle" }
        if case .installed = store.installState(for: game) { return "checkmark.circle.fill" }
        return "circle.dashed"
    }

    private var statusColor: Color {
        if store.isUpdateAvailable(game) { return .orange }
        if case .installed = store.installState(for: game) { return .green }
        return .secondary
    }

    private var isInstalling: Bool {
        store.installingGames.contains(game)
    }

    private func performAction() {
        switch store.installState(for: game) {
        case .notInstalled:
            install()
        case .installed:
            if store.isUpdateAvailable(game) {
                install()
            } else {
                showingRemoveConfirmation = true
            }
        }
    }

    private func install() {
        errorMessage = nil
        Task {
            do {
                try await store.install(game)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func formattedBytes(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}
