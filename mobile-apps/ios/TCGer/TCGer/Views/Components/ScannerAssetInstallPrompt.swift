import SwiftUI

enum ScannerAssetPromptKind: String, Equatable {
    case install
    case update
}

struct ScannerAssetPromptRequest: Identifiable, Equatable {
    let game: TCGGame
    let kind: ScannerAssetPromptKind

    var id: String { "\(game.rawValue)-\(kind.rawValue)" }

    static func recommended(
        for game: TCGGame,
        installState: ScannerAssetInstallState,
        updateAvailable: Bool
    ) -> ScannerAssetPromptRequest? {
        switch installState {
        case .notInstalled:
            return ScannerAssetPromptRequest(game: game, kind: .install)
        case .installed:
            return updateAvailable
                ? ScannerAssetPromptRequest(game: game, kind: .update)
                : nil
        }
    }
}

struct ScannerAssetInstallPrompt: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ScannerAssetStore

    let request: ScannerAssetPromptRequest

    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Label(title, systemImage: request.kind == .install ? "arrow.down.circle" : "arrow.triangle.2.circlepath")
                    .font(.title2.bold())

                Text(message)
                    .foregroundStyle(.secondary)

                if let manifest = store.manifests[request.game] {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("\(manifest.cardCount.formatted(.number)) cards", systemImage: "rectangle.stack")
                        Label(formattedBytes(manifest.downloadBytes), systemImage: "internaldrive")
                        Label("Verified model, index, and metadata", systemImage: "checkmark.shield")
                    }
                    .font(.subheadline)
                } else {
                    Label("Connect to the internet to load package details.", systemImage: "wifi.exclamationmark")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if isInstalling {
                    ProgressView(value: store.installProgress[request.game] ?? 0) {
                        Text(request.kind == .install ? "Installing…" : "Updating…")
                    }
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Spacer()

                Button(actionTitle) {
                    install()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
                .disabled(isInstalling || store.manifests[request.game] == nil)

                Button(request.kind == .install ? "Not now" : "Use installed version") {
                    dismiss()
                }
                .frame(maxWidth: .infinity)
                .disabled(isInstalling)
            }
            .padding(24)
            .navigationTitle(request.game.displayName)
            .navigationBarTitleDisplayMode(.inline)
        }
        .interactiveDismissDisabled(isInstalling)
        .presentationDetents([.medium, .large])
        .task {
            if store.manifests[request.game] == nil {
                try? await store.refreshManifest(for: request.game)
            }
        }
        .onChange(of: store.installedVersions[request.game], initial: false) { oldVersion, newVersion in
            guard let newVersion, newVersion != oldVersion || request.kind == .install else { return }
            dismiss()
        }
    }

    private var title: String {
        request.kind == .install ? "Install before scanning" : "Scanner update available"
    }

    private var actionTitle: String {
        request.kind == .install ? "Install and scan" : "Update scanner"
    }

    private var message: String {
        switch request.kind {
        case .install:
            return "TCGer downloads each game's recognition package only when you use it, keeping the app smaller while preserving full offline scanning afterward."
        case .update:
            return "A newer recognition package is available. The installed version remains usable if you update later or the download fails."
        }
    }

    private var isInstalling: Bool {
        store.installingGames.contains(request.game)
    }

    private func install() {
        errorMessage = nil
        Task {
            do {
                try await store.install(request.game)
            } catch is CancellationError {
                return
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func formattedBytes(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}
