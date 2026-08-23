import SwiftUI

struct OfflinePackDownloadsSection: View {
    @ObservedObject var manager: PackOfflineDownloadManager

    var body: some View {
        Section {
            NavigationLink {
                OfflinePackDownloadsView(manager: manager)
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Offline Packs")
                        Text(downloadSummary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "icloud.and.arrow.down")
                        .foregroundStyle(.blue)
                }
            }
        }
    }

    private var downloadSummary: String {
        let downloadedCount = manager.definitions.reduce(into: 0) { count, definition in
            if case .downloaded = manager.status(for: definition) {
                count += 1
            }
        }
        return "\(downloadedCount) of \(manager.definitions.count) sets downloaded"
    }
}

struct OfflinePackDownloadsView: View {
    @ObservedObject var manager: PackOfflineDownloadManager

    var body: some View {
        List {
            Section {
                ForEach(manager.definitions) { definition in
                    OfflinePackSetRow(definition: definition, manager: manager)
                }
            } footer: {
                Text("Downloads each set’s pack wrappers and card artwork so its packs can be opened without an internet connection.")
            }
        }
        .navigationTitle("Offline Packs")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct OfflinePackSetRow: View {
    let definition: PackOfflineSetDefinition
    @ObservedObject var manager: PackOfflineDownloadManager

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(definition.name)
                        .font(.body.weight(.medium))
                    statusLabel
                }

                Spacer(minLength: 12)

                actionButton
            }

            if case .downloading(let progress) = manager.status(for: definition) {
                DownloadableAssetProgressView(
                    progress: progress,
                    accessibilityLabel: "Downloading \(definition.name)"
                )
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var statusLabel: some View {
        switch manager.status(for: definition) {
        case .notDownloaded:
            DownloadableAssetStatusLabel(
                text: "Not downloaded",
                systemImage: "icloud.and.arrow.down",
                tint: .secondary
            )
        case .downloading(let progress):
            DownloadableAssetStatusLabel(
                text: "Downloading \(progress.formatted(.percent.precision(.fractionLength(0))))",
                systemImage: "arrow.down.circle",
                tint: .secondary
            )
        case .downloaded(let record):
            DownloadableAssetStatusLabel(
                text: "\(record.cardCount) cards · \(Self.formattedBytes(record.byteCount))",
                systemImage: "checkmark.circle.fill",
                tint: .green
            )
        case .failed(let message):
            DownloadableAssetStatusLabel(
                text: message,
                systemImage: "exclamationmark.triangle.fill",
                tint: .orange
            )
        }
    }

    private var actionButton: some View {
        DownloadableAssetActionControl(
            state: actionState,
            action: performAction
        )
        .buttonStyle(.borderless)
    }

    private var actionState: DownloadableAssetActionControl.State {
        switch manager.status(for: definition) {
        case .downloading:
            return .busy(accessibilityLabel: "Downloading \(definition.name)")
        case .downloaded:
            return .button(title: "Remove", role: .destructive)
        case .notDownloaded, .failed:
            return .button(
                title: "Download",
                isEnabled: NetworkMonitor.shared.isConnected
            )
        }
    }

    private func performAction() {
        if case .downloaded = manager.status(for: definition) {
            manager.remove(definition)
        } else {
            manager.download(definition)
        }
    }

    private static func formattedBytes(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}

struct PackOfflineAvailabilityLabel: View {
    let status: PackOfflineDownloadManager.Status

    var body: some View {
        switch status {
        case .notDownloaded:
            DownloadableAssetStatusLabel(
                text: "Set not downloaded for offline use",
                systemImage: "icloud.and.arrow.down",
                tint: .secondary
            )
        case .downloading(let progress):
            DownloadableAssetStatusLabel(
                text: "Offline download \(progress.formatted(.percent.precision(.fractionLength(0))))",
                systemImage: "arrow.down.circle",
                tint: .secondary
            )
        case .downloaded(let record):
            DownloadableAssetStatusLabel(
                text: "Downloaded · \(record.cardCount) cards",
                systemImage: "checkmark.circle.fill",
                tint: .green
            )
        case .failed:
            DownloadableAssetStatusLabel(
                text: "Offline download needs attention",
                systemImage: "exclamationmark.triangle.fill",
                tint: .orange
            )
        }
    }
}
