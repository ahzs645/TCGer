import SwiftUI

/// Settings/debug controls for dev-mode recording: a persistent toggle, an
/// Export All button, and a submenu listing the recorded sessions with
/// per-session share and delete. Sessions live in Documents/ScannerDevMode
/// and use the device-recording schema, so they also appear in Browse
/// Reference Sets and can be replayed directly.
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

            Text("Saves every scan with its crop attempts and decision evidence as reusable training data.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption2)
                    .foregroundStyle(.red)
            }

            NavigationLink {
                ScannerDevModeSessionsView()
            } label: {
                HStack {
                    Label("Recorded Sessions", systemImage: "film.stack")
                    Spacer()
                    Text(sessionSummary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button {
                do {
                    shareArchive = try DevModeExporter.zipAllSessions()
                    errorMessage = nil
                } catch {
                    errorMessage = "Export failed: \(error.localizedDescription)"
                }
            } label: {
                Label("Export All Sessions", systemImage: "square.and.arrow.up.on.square")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(sessions.isEmpty)
        }
        .onAppear(perform: refresh)
        .onChange(of: devModeEnabled) { refresh() }
        .sheet(item: $shareArchive) { archive in
            DevModeActivityView(items: [archive.url])
        }
    }

    private var sessionSummary: String {
        guard !sessions.isEmpty else { return "None" }
        let bytes = sessions.reduce(Int64(0)) { $0 + $1.sizeBytes }
        return "\(sessions.count) · \(DevModeExporter.sizeFormatter.string(fromByteCount: bytes))"
    }

    private func refresh() {
        sessions = ScannerDevModeStore.listSessions()
    }
}

/// Submenu listing each recorded session with share and explicit delete actions.
struct ScannerDevModeSessionsView: View {
    @State private var sessions: [ScannerDevModeStore.SessionInfo] = []
    @State private var shareArchive: DevModeShareArchive?
    @State private var errorMessage: String?
    @State private var sessionPendingDeletion: ScannerDevModeStore.SessionInfo?
    @State private var isConfirmingDeleteAll = false

    var body: some View {
        List {
            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            ForEach(sessions) { session in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Self.displayName(for: session))
                            .font(.subheadline.weight(.semibold))
                        Text(Self.details(for: session))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    HStack(spacing: 4) {
                        Button {
                            do {
                                shareArchive = try DevModeExporter.zip(session: session)
                                errorMessage = nil
                            } catch {
                                errorMessage = "Share failed: \(error.localizedDescription)"
                            }
                        } label: {
                            Image(systemName: "square.and.arrow.up")
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Share \(Self.displayName(for: session))")

                        Button(role: .destructive) {
                            sessionPendingDeletion = session
                        } label: {
                            Image(systemName: "trash")
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Delete \(Self.displayName(for: session))")
                    }
                }
                .swipeActions {
                    Button(role: .destructive) {
                        sessionPendingDeletion = session
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }

            if sessions.isEmpty {
                Text("No recorded sessions yet. Turn on Dev Mode Recording and scan — every pass is saved here.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Recorded Sessions")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Delete All", role: .destructive) {
                    isConfirmingDeleteAll = true
                }
                .disabled(sessions.isEmpty)
            }
        }
        .onAppear(perform: refresh)
        .sheet(item: $shareArchive) { archive in
            DevModeActivityView(items: [archive.url])
        }
        .confirmationDialog(
            "Delete Recorded Session?",
            isPresented: isConfirmingSessionDeletion,
            titleVisibility: .visible,
            presenting: sessionPendingDeletion
        ) { session in
            Button("Delete", role: .destructive) {
                delete(session)
            }
            Button("Cancel", role: .cancel) {}
        } message: { session in
            Text("This permanently deletes \(Self.displayName(for: session)) and all of its recorded frames.")
        }
        .confirmationDialog(
            "Delete All Recorded Sessions?",
            isPresented: $isConfirmingDeleteAll,
            titleVisibility: .visible
        ) {
            Button("Delete All", role: .destructive) {
                deleteAll()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes all \(sessions.count) recorded sessions and their frames.")
        }
    }

    private var isConfirmingSessionDeletion: Binding<Bool> {
        Binding(
            get: { sessionPendingDeletion != nil },
            set: { isPresented in
                if !isPresented {
                    sessionPendingDeletion = nil
                }
            }
        )
    }

    private func refresh() {
        sessions = ScannerDevModeStore.listSessions()
    }

    private func delete(_ session: ScannerDevModeStore.SessionInfo) {
        do {
            try ScannerDevModeStore.deleteSession(at: session.url)
            errorMessage = nil
        } catch {
            errorMessage = "Delete failed: \(error.localizedDescription)"
        }
        sessionPendingDeletion = nil
        refresh()
    }

    private func deleteAll() {
        do {
            try ScannerDevModeStore.deleteAllSessions()
            errorMessage = nil
        } catch {
            errorMessage = "Delete all failed: \(error.localizedDescription)"
        }
        refresh()
    }

    /// "scan-session-20260809-145717" → "Aug 9, 2:57 PM"; falls back to the
    /// folder name for anything that doesn't parse.
    private static func displayName(for session: ScannerDevModeStore.SessionInfo) -> String {
        let name = session.url.lastPathComponent
        guard let stamp = name.split(separator: "scan-session-").last,
              let date = parseFormatter.date(from: String(stamp))
        else { return name }
        return displayFormatter.string(from: date)
    }

    private static func details(for session: ScannerDevModeStore.SessionInfo) -> String {
        let frameLabel = session.frameCount == 1 ? "frame" : "frames"
        let size = DevModeExporter.sizeFormatter.string(fromByteCount: session.sizeBytes)
        return "\(session.frameCount) \(frameLabel) · \(size)"
    }

    private static let parseFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    private static let displayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}

enum DevModeExporter {
    static let sizeFormatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter
    }()

    static func zip(session: ScannerDevModeStore.SessionInfo) throws -> DevModeShareArchive {
        try zipDirectory(session.url, as: "TCGer-DevMode-\(session.url.lastPathComponent).zip")
    }

    /// Zips the whole ScannerDevMode root — every session — into one archive
    /// so a tester can hand over everything they have collected in one send.
    static func zipAllSessions() throws -> DevModeShareArchive {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return try zipDirectory(
            ScannerDevModeStore.rootDirectory(),
            as: "TCGer-DevMode-All-\(formatter.string(from: Date())).zip"
        )
    }

    private static func zipDirectory(_ directory: URL, as filename: String) throws -> DevModeShareArchive {
        let zip = try ScannerDebugViewModel.packageDirectoryForExport(directory)
        let named = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try? FileManager.default.removeItem(at: named)
        try FileManager.default.moveItem(at: zip, to: named)
        return DevModeShareArchive(url: named)
    }
}

struct DevModeShareArchive: Identifiable {
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
