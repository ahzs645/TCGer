import SwiftUI

enum ScannerInitialGameResolution: Equatable {
    case select(ScanMode)
    case choose(ScannerGameChoiceRequest)
    case unavailable
}

struct ScannerGameChoiceRequest: Identifiable, Equatable {
    let modes: [ScanMode]

    var id: String { modes.map(\.rawValue).joined(separator: "|") }

    static func resolve(
        availableModes: [ScanMode],
        requestedMode: ScanMode? = nil
    ) -> ScannerInitialGameResolution {
        let gameModes = availableModes.reduce(into: [ScanMode]()) { result, mode in
            guard mode != .automatic, !result.contains(mode) else { return }
            result.append(mode)
        }
        if let requestedMode, gameModes.contains(requestedMode) {
            return .select(requestedMode)
        }
        switch gameModes.count {
        case 0:
            return .unavailable
        case 1:
            return .select(gameModes[0])
        default:
            return .choose(ScannerGameChoiceRequest(modes: gameModes))
        }
    }
}

struct ScannerGameChoicePrompt: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ScannerAssetStore

    let request: ScannerGameChoiceRequest
    let onSelect: (ScanMode) -> Void

    var body: some View {
        NavigationStack {
            List(request.modes) { mode in
                Button {
                    onSelect(mode)
                    dismiss()
                } label: {
                    HStack(spacing: 14) {
                        scannerIcon(for: mode.tcgGame)

                        VStack(alignment: .leading, spacing: 3) {
                            Text(mode.tcgGame.displayName)
                                .font(.headline)
                                .foregroundStyle(.primary)
                            Text(packageSummary(for: mode.tcgGame))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()
                        Image(systemName: "chevron.forward")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
                .accessibilityLabel("Scan \(mode.tcgGame.displayName)")
                .accessibilityHint(packageSummary(for: mode.tcgGame))
            }
            .listStyle(.plain)
            .contentMargins(.top, 8, for: .scrollContent)
            .navigationTitle("Choose a Game")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Not now")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Color(.systemBackground))
    }

    private func packageSummary(for game: TCGGame) -> String {
        if case .installed = store.installState(for: game) {
            return "Ready to scan"
        }
        guard let manifest = store.manifests[game] else {
            return "Scanner download available"
        }
        let size = ByteCountFormatter.string(fromByteCount: Int64(manifest.downloadBytes), countStyle: .file)
        return "\(manifest.displayedCardCount.formatted(.number)) cards · \(size) download"
    }

    @ViewBuilder
    private func scannerIcon(for game: TCGGame) -> some View {
        if let assetName = game.cardBackAssetName {
            Image(assetName)
                .resizable()
                .scaledToFit()
                .frame(width: 42, height: 58)
                .clipShape(RoundedRectangle(cornerRadius: 5))
        } else {
            Image(systemName: "rectangle.portrait.on.rectangle.portrait")
                .font(.title2)
                .frame(width: 42, height: 58)
                .foregroundStyle(.secondary)
        }
    }
}

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
                        Label("\(manifest.displayedCardCount.formatted(.number)) cards", systemImage: "rectangle.stack")
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
