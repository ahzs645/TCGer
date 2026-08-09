import SwiftUI

/// Scanner Debug controls for dev-mode recording: a persistent toggle plus
/// the recorded sessions with per-session share (zip) and delete. Sessions
/// live in Documents/ScannerDevMode and use the device-recording schema, so
/// they also appear in Browse Reference Sets and can be replayed directly.
struct ScannerDevModeSection: View {
    @AppStorage(ScannerDevModeStore.enabledDefaultsKey) private var devModeEnabled = false
    @State private var sessions: [ScannerDevModeStore.SessionInfo] = []
    @State private var shareArchive: DevModeShareArchive?
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $devModeEnabled) {
                Label("Dev Mode Recording", systemImage: "record.circle")
            }

            Text("Records every scan — live frames, shutter captures, and imports — with the raw input image, each crop attempt, and the gate/retrieval/OCR evidence behind the decision. Sessions appear under Browse Reference Sets, can be replayed against future model builds, and export as training data.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption2)
                    .foregroundStyle(.red)
            }

            ForEach(sessions) { session in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.url.lastPathComponent)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                        Text("\(session.frameCount) frame\(session.frameCount == 1 ? "" : "s") · \(Self.sizeFormatter.string(fromByteCount: session.sizeBytes))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        share(session)
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .buttonStyle(.bordered)
                    Button(role: .destructive) {
                        ScannerDevModeStore.deleteSession(at: session.url)
                        refresh()
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.bordered)
                }
            }

            if sessions.isEmpty {
                Text("No recorded sessions yet.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            } else {
                Button {
                    shareAll()
                } label: {
                    Label("Export All Sessions", systemImage: "square.and.arrow.up.on.square")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                Text("Bundles every recorded session into one zip to send over AirDrop, Messages, or Files.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .onAppear(perform: refresh)
        .onChange(of: devModeEnabled) { refresh() }
        .sheet(item: $shareArchive) { archive in
            DevModeActivityView(items: [archive.url])
        }
    }

    private func refresh() {
        sessions = ScannerDevModeStore.listSessions()
    }

    private func share(_ session: ScannerDevModeStore.SessionInfo) {
        shareDirectory(session.url, as: "TCGer-DevMode-\(session.url.lastPathComponent).zip")
    }

    /// Zips the whole ScannerDevMode root — every session — into one archive
    /// so a tester can hand over everything they have collected in one send.
    private func shareAll() {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        shareDirectory(
            ScannerDevModeStore.rootDirectory(),
            as: "TCGer-DevMode-All-\(formatter.string(from: Date())).zip"
        )
    }

    private func shareDirectory(_ directory: URL, as filename: String) {
        do {
            let zip = try ScannerDebugViewModel.packageDirectoryForExport(directory)
            let named = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
            try? FileManager.default.removeItem(at: named)
            try FileManager.default.moveItem(at: zip, to: named)
            errorMessage = nil
            shareArchive = DevModeShareArchive(url: named)
        } catch {
            errorMessage = "Share failed: \(error.localizedDescription)"
        }
    }

    private static let sizeFormatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter
    }()
}

private struct DevModeShareArchive: Identifiable {
    let url: URL
    var id: String { url.path }
}

private struct DevModeActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
