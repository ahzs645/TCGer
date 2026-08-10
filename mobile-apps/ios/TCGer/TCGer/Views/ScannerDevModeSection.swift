import SwiftUI

/// Settings/debug controls for dev-mode recording: a persistent toggle, an
/// Export All button, and a submenu listing the recorded sessions with
/// per-session share and delete. Sessions live in Documents/ScannerDevMode
/// and use the device-recording schema, so they also appear in Browse
/// Reference Sets and can be replayed directly.
struct ScannerDevModeSection: View {
    enum Presentation: Equatable {
        case compact
        case settingsRows
    }

    @AppStorage(ScannerDevModeStore.enabledDefaultsKey) private var devModeEnabled = false
    @State private var sessions: [ScannerDevModeStore.SessionInfo] = []
    @State private var shareArchive: DevModeShareArchive?
    @State private var errorMessage: String?

    var presentation: Presentation = .compact

    @ViewBuilder
    var body: some View {
        switch presentation {
        case .compact:
            compactContent
        case .settingsRows:
            settingsRows
        }
    }

    private var compactContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            recordingToggle

            recordingDescription

            if let errorMessage {
                errorLabel(errorMessage)
            }

            sessionsLink

            exportButton
                .buttonStyle(.bordered)
        }
        .onAppear(perform: refresh)
    }

    @ViewBuilder
    private var settingsRows: some View {
        recordingToggle
            .onAppear(perform: refresh)

        recordingDescription

        if let errorMessage {
            errorLabel(errorMessage)
        }

        sessionsLink

        exportButton
    }

    private var recordingToggle: some View {
        Toggle(isOn: $devModeEnabled) {
            Label("Dev Mode Recording", systemImage: "record.circle")
        }
        .onChange(of: devModeEnabled) { refresh() }
    }

    private var recordingDescription: some View {
        Text("Saves every scan with its crop attempts and decision evidence as reusable training data.")
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    private func errorLabel(_ message: String) -> some View {
        Text(message)
            .font(.caption)
            .foregroundStyle(.red)
    }

    @ViewBuilder
    private var sessionsLink: some View {
        if presentation == .compact {
            NavigationLink {
                ScannerDevModeSessionsView()
            } label: {
                sessionsLinkLabel
            }
            .buttonStyle(.plain)
        } else {
            NavigationLink {
                ScannerDevModeSessionsView()
            } label: {
                sessionsLinkLabel
            }
        }
    }

    private var sessionsLinkLabel: some View {
        HStack {
            Label("Recorded Sessions", systemImage: "film.stack")
            Spacer()
            Text(sessionSummary)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
    }

    private var exportButton: some View {
        Button {
            do {
                shareArchive = try DevModeExporter.zipAllSessions()
                errorMessage = nil
            } catch {
                errorMessage = "Export failed: \(error.localizedDescription)"
            }
        } label: {
            if presentation == .compact {
                Label("Export All Sessions", systemImage: "square.and.arrow.up.on.square")
                    .frame(maxWidth: .infinity)
            } else {
                Label("Export All Sessions", systemImage: "square.and.arrow.up.on.square")
            }
        }
        .disabled(sessions.isEmpty)
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
    @State private var selectedSessionIDs: Set<String> = []
    @State private var isSelecting = false
    @State private var deletionRequest: DeletionRequest?

    var body: some View {
        List(selection: $selectedSessionIDs) {
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
                    if !isSelecting {
                        HStack(spacing: 4) {
                            Button {
                                share(session)
                            } label: {
                                Image(systemName: "square.and.arrow.up")
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Share \(Self.displayName(for: session))")

                            Button(role: .destructive) {
                                deletionRequest = .session(session)
                            } label: {
                                Image(systemName: "trash")
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Delete \(Self.displayName(for: session))")
                        }
                    }
                }
                .tag(session.id)
                .swipeActions {
                    Button(role: .destructive) {
                        deletionRequest = .session(session)
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
        .environment(\.editMode, .constant(isSelecting ? .active : .inactive))
        .navigationTitle("Recorded Sessions")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(isSelecting ? "Done" : "Select") {
                    if isSelecting {
                        endSelection()
                    } else {
                        isSelecting = true
                    }
                }
                .disabled(sessions.isEmpty && !isSelecting)
            }

            if isSelecting {
                ToolbarItemGroup(placement: .bottomBar) {
                    Button(allSessionsAreSelected ? "Deselect All" : "Select All") {
                        toggleSelectAll()
                    }

                    Spacer()

                    Button(role: .destructive) {
                        deletionRequest = .sessions(selectedSessionIDs)
                    } label: {
                        Label(deleteSelectionTitle, systemImage: "trash")
                    }
                    .disabled(selectedSessionIDs.isEmpty)
                }
            }
        }
        .onAppear(perform: refresh)
        .sheet(item: $shareArchive) { archive in
            DevModeActivityView(items: [archive.url])
        }
        .alert(
            deletionRequest?.title ?? "Delete Recorded Session?",
            isPresented: isConfirmingDeletion
        ) {
            Button("Cancel", role: .cancel) {
                deletionRequest = nil
            }
            Button(deletionRequest?.actionTitle ?? "Delete", role: .destructive) {
                confirmDeletion()
            }
        } message: {
            Text(deletionRequest?.message ?? "")
        }
    }

    private var isConfirmingDeletion: Binding<Bool> {
        Binding(
            get: { deletionRequest != nil },
            set: { isPresented in
                if !isPresented {
                    deletionRequest = nil
                }
            }
        )
    }

    private var allSessionsAreSelected: Bool {
        !sessions.isEmpty && selectedSessionIDs.count == sessions.count
    }

    private var deleteSelectionTitle: String {
        selectedSessionIDs.isEmpty ? "Delete" : "Delete (\(selectedSessionIDs.count))"
    }

    private func refresh() {
        sessions = ScannerDevModeStore.listSessions()
        selectedSessionIDs.formIntersection(sessions.map(\.id))
    }

    private func share(_ session: ScannerDevModeStore.SessionInfo) {
        do {
            shareArchive = try DevModeExporter.zip(session: session)
            errorMessage = nil
        } catch {
            errorMessage = "Share failed: \(error.localizedDescription)"
        }
    }

    private func toggleSelectAll() {
        if allSessionsAreSelected {
            selectedSessionIDs.removeAll()
        } else {
            selectedSessionIDs = Set(sessions.map(\.id))
        }
    }

    private func endSelection() {
        isSelecting = false
        selectedSessionIDs.removeAll()
    }

    private func confirmDeletion() {
        guard let deletionRequest else { return }

        switch deletionRequest {
        case .session(let session):
            delete(session)
        case .sessions(let ids):
            deleteSessions(withIDs: ids)
        }
    }

    private func delete(_ session: ScannerDevModeStore.SessionInfo) {
        do {
            try ScannerDevModeStore.deleteSession(at: session.url)
            errorMessage = nil
        } catch {
            errorMessage = "Delete failed: \(error.localizedDescription)"
        }
        deletionRequest = nil
        refresh()
    }

    private func deleteSessions(withIDs ids: Set<String>) {
        let targets = sessions.filter { ids.contains($0.id) }
        var failedIDs: Set<String> = []

        for session in targets {
            do {
                try ScannerDevModeStore.deleteSession(at: session.url)
            } catch {
                failedIDs.insert(session.id)
            }
        }

        deletionRequest = nil
        if failedIDs.isEmpty {
            errorMessage = nil
            endSelection()
        } else {
            selectedSessionIDs = failedIDs
            let noun = failedIDs.count == 1 ? "session" : "sessions"
            errorMessage = "Couldn’t delete \(failedIDs.count) selected \(noun)."
        }
        refresh()
    }

    private enum DeletionRequest {
        case session(ScannerDevModeStore.SessionInfo)
        case sessions(Set<String>)

        var title: String {
            switch self {
            case .session:
                return "Delete Recorded Session?"
            case .sessions(let ids):
                return ids.count == 1 ? "Delete 1 Recorded Session?" : "Delete \(ids.count) Recorded Sessions?"
            }
        }

        var actionTitle: String {
            switch self {
            case .session:
                return "Delete"
            case .sessions(let ids):
                return ids.count == 1 ? "Delete Session" : "Delete \(ids.count) Sessions"
            }
        }

        var message: String {
            switch self {
            case .session(let session):
                return "This permanently deletes \(ScannerDevModeSessionsView.displayName(for: session)) and all of its recorded frames."
            case .sessions(let ids):
                let noun = ids.count == 1 ? "session" : "sessions"
                return "This permanently deletes the \(ids.count) selected \(noun) and all of their recorded frames."
            }
        }
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
