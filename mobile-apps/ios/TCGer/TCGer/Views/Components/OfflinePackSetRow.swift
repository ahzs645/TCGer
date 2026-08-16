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
                ProgressView(value: progress)
                    .accessibilityLabel("Downloading \(definition.name)")
                    .accessibilityValue(
                        Text(progress, format: .percent.precision(.fractionLength(0)))
                    )
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var statusLabel: some View {
        switch manager.status(for: definition) {
        case .notDownloaded:
            Label("Not downloaded", systemImage: "icloud.and.arrow.down")
                .foregroundStyle(.secondary)
        case .downloading(let progress):
            Label("Downloading \(progress, format: .percent.precision(.fractionLength(0)))", systemImage: "arrow.down.circle")
                .foregroundStyle(.secondary)
        case .downloaded(let record):
            Label(
                "Available offline · \(record.cardCount) cards · \(Self.formattedBytes(record.byteCount))",
                systemImage: "checkmark.circle.fill"
            )
            .foregroundStyle(.green)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        }
    }

    @ViewBuilder
    private var actionButton: some View {
        switch manager.status(for: definition) {
        case .downloading:
            ProgressView()
                .controlSize(.small)
        case .downloaded:
            Button("Remove", role: .destructive) {
                manager.remove(definition)
            }
            .buttonStyle(.borderless)
        case .notDownloaded, .failed:
            Button("Download") {
                manager.download(definition)
            }
            .buttonStyle(.borderless)
            .disabled(!NetworkMonitor.shared.isConnected)
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
            Label("Set not downloaded for offline use", systemImage: "icloud.and.arrow.down")
                .foregroundStyle(.secondary)
        case .downloading(let progress):
            Label(
                "Offline download \(progress, format: .percent.precision(.fractionLength(0)))",
                systemImage: "arrow.down.circle"
            )
            .foregroundStyle(.secondary)
        case .downloaded(let record):
            Label("Available offline · \(record.cardCount) cards", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .failed:
            Label("Offline download needs attention", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        }
    }
}
