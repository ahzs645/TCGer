import SwiftUI

struct PackSelectionSheet: View {
    @Environment(\.dismiss) private var dismiss

    let packSets: [PackOpeningInterfaceState.PackSet]
    let selectedPackID: String
    @ObservedObject var downloadManager: PackOfflineDownloadManager
    let onSelect: (String) -> Void

    var body: some View {
        NavigationStack {
            List {
                ForEach(packSets) { set in
                    Section {
                        NavigationLink {
                            PackVariantSelectionView(
                                packSet: set,
                                selectedPackID: selectedPackID,
                                onSelect: select
                            )
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Choose a pack")
                                    .font(.body.weight(.semibold))
                                Text("\(set.options.count) \(set.options.count == 1 ? "variant" : "variants")")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } header: {
                        HStack(spacing: 10) {
                            Text(set.label)
                            Spacer()
                            if let definition = PackOfflineSetDefinition.matching(set.id) {
                                PackSetDownloadControl(
                                    definition: definition,
                                    manager: downloadManager
                                )
                            }
                        }
                        .textCase(nil)
                    }
                }
            }
            .navigationTitle("Choose a Set")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func select(_ optionID: String) {
        onSelect(optionID)
        dismiss()
    }
}

private struct PackVariantSelectionView: View {
    let packSet: PackOpeningInterfaceState.PackSet
    let selectedPackID: String
    let onSelect: (String) -> Void

    var body: some View {
        List(packSet.options) { option in
            Button {
                onSelect(option.id)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "rectangle.portrait.on.rectangle.portrait")
                        .foregroundStyle(.blue)
                    Text(option.resolvedVariationLabel)
                        .foregroundStyle(.primary)
                    Spacer()
                    if option.id == selectedPackID {
                        Image(systemName: "checkmark")
                            .fontWeight(.semibold)
                            .foregroundStyle(.blue)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(option.resolvedVariationLabel) pack")
            .accessibilityAddTraits(option.id == selectedPackID ? .isSelected : [])
        }
        .navigationTitle(packSet.label)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PackSetDownloadControl: View {
    let definition: PackOfflineSetDefinition
    @ObservedObject var manager: PackOfflineDownloadManager

    var body: some View {
        switch manager.status(for: definition) {
        case .notDownloaded:
            downloadButton(systemImage: "arrow.down.circle", label: "Download \(definition.name)")
        case .downloading:
            ProgressView()
                .controlSize(.small)
                .accessibilityLabel("Downloading \(definition.name)")
        case .downloaded:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .accessibilityLabel("\(definition.name) downloaded")
        case .failed:
            downloadButton(systemImage: "arrow.clockwise.circle", label: "Retry \(definition.name) download")
        }
    }

    private func downloadButton(systemImage: String, label: String) -> some View {
        Button {
            manager.download(definition)
        } label: {
            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
        }
        .buttonStyle(.borderless)
        .disabled(!NetworkMonitor.shared.isConnected)
        .accessibilityLabel(label)
    }
}
