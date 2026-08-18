import SwiftUI
import UIKit

struct OnlineCodesView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var codes: [OnlineCode] = []
    @State private var gameFilter = TCGGame.all
    @State private var statusFilter = OnlineCodeStatusFilter.all
    @State private var searchText = ""
    @State private var isLoading = true
    @State private var presentedSheet: OnlineCodeSheet?
    @State private var errorMessage: String?
    @State private var resultMessage: String?

    private let apiService = APIService()

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    private var availableGames: [TCGGame] {
        TCGGame.codeVaultGames
    }

    private var defaultAddGame: TCGGame {
        if gameFilter != .all { return gameFilter }
        return environmentStore.enabledGames.first ?? .pokemon
    }

    private var gameFilteredCodes: [OnlineCode] {
        guard gameFilter != .all else { return codes }
        return codes.filter { $0.game == gameFilter }
    }

    private var filteredCodes: [OnlineCode] {
        gameFilteredCodes.filter { code in
            let matchesStatus = statusFilter.matches(code.status)
            let needle = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard matchesStatus, !needle.isEmpty else { return matchesStatus }
            return [
                code.code,
                code.productName,
                code.notes,
                code.game?.displayName
            ]
            .compactMap { $0 }
            .contains { $0.localizedCaseInsensitiveContains(needle) }
        }
    }

    private var displayedGames: [TCGGame] {
        availableGames.filter { game in
            (gameFilter == .all || gameFilter == game)
                && filteredCodes.contains { $0.game == game }
        }
    }

    var body: some View {
        Group {
            if parentProvidesNavigation { content } else { NavigationStack { content } }
        }
    }

    private var content: some View {
        Group {
            if isLoading && codes.isEmpty {
                ProgressView("Loading code vault…")
            } else if let errorMessage, codes.isEmpty {
                ErrorView(title: "Couldn’t Load Codes", message: errorMessage) {
                    Task { await load() }
                }
            } else {
                List {
                    summarySection
                    filterSection

                    if let resultMessage {
                        Section {
                            Label(resultMessage, systemImage: "checkmark.circle.fill")
                                .font(.subheadline)
                                .foregroundStyle(.green)
                        }
                    }

                    if filteredCodes.isEmpty {
                        ContentUnavailableView(
                            "No Matching Codes",
                            systemImage: "key.viewfinder",
                            description: Text(
                                "Scan a printed or QR redemption card, or add codes manually."
                            )
                        )
                        .listRowBackground(Color.clear)
                    } else {
                        ForEach(displayedGames) { game in
                            Section(game.displayName) {
                                ForEach(filteredCodes.filter { $0.game == game }) { code in
                                    OnlineCodeRow(
                                        code: code,
                                        onCopy: { copy(code) },
                                        onEdit: { presentedSheet = .edit(code) },
                                        onStatus: { status in
                                            Task { await updateStatus(code, status: status) }
                                        }
                                    )
                                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                        Button(role: .destructive) {
                                            Task { await delete(code) }
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .searchable(text: $searchText, prompt: "Search codes, games, products, or notes")
            }
        }
        .navigationTitle("Code Vault")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if !filteredCodes.isEmpty {
                    ShareLink(
                        item: exportText,
                        subject: Text("TCG redemption codes"),
                        message: Text("Redemption codes exported from TCGer")
                    ) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Export codes")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        presentedSheet = .scanner(defaultAddGame)
                    } label: {
                        Label("Scan Printed or QR Codes", systemImage: "viewfinder")
                    }
                    Button {
                        presentedSheet = .manual(defaultAddGame)
                    } label: {
                        Label("Add Codes Manually", systemImage: "keyboard")
                    }
                } label: {
                    Label("Add Codes", systemImage: "plus")
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(item: $presentedSheet) { sheet in
            switch sheet {
            case .manual(let defaultGame):
                ManualOnlineCodeSheet(
                    games: availableGames,
                    defaultGame: defaultGame
                ) { game, input, productName, notes in
                    try await save(
                        input,
                        game: game,
                        source: .manual,
                        productName: productName,
                        notes: notes
                    )
                }
            case .scanner(let defaultGame):
                OnlineCodeScannerSheet(
                    games: availableGames,
                    defaultGame: defaultGame
                ) { game, scanned in
                    try await save(
                        scanned,
                        game: game,
                        source: .camera,
                        productName: nil,
                        notes: nil
                    )
                }
            case .edit(let code):
                OnlineCodeEditorSheet(code: code) { status, productName, notes in
                    try await updateDetails(
                        code,
                        status: status,
                        productName: productName,
                        notes: notes
                    )
                }
            }
        }
        .alert(
            "Code Vault",
            isPresented: Binding(
                get: { errorMessage != nil && !codes.isEmpty },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var filterSection: some View {
        Section {
            Picker("Game", selection: $gameFilter) {
                Text("All Games").tag(TCGGame.all)
                ForEach(availableGames) { game in
                    Text(game.displayName).tag(game)
                }
            }

            Picker("Status", selection: $statusFilter) {
                ForEach(OnlineCodeStatusFilter.allCases) { filter in
                    Text(filter.title).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
    }

    private var summarySection: some View {
        Section {
            HStack(spacing: 0) {
                ForEach(OnlineCodeStatus.allCases) { status in
                    StatBlock(
                        title: status.title,
                        value: "\(gameFilteredCodes.count { $0.status == status })",
                        color: status.color
                    )
                    .frame(maxWidth: .infinity)
                    if status != OnlineCodeStatus.allCases.last {
                        Divider().frame(height: 42)
                    }
                }
            }
            .padding(.vertical, AppSpacing.small)
        } header: {
            Text(gameFilter == .all ? "All games" : gameFilter.displayName)
        } footer: {
            Text("Codes remain private to this phone or your signed-in TCGer account.")
        }
    }

    private var exportText: String {
        displayedGames.flatMap { game in
            let gameCodes = filteredCodes.filter { $0.game == game }
            return ["# \(game.displayName)"] + gameCodes.map(\.code) + [""]
        }
        .joined(separator: "\n")
    }

    @MainActor
    private func load() async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            errorMessage = "Sign in is required to view the code vault."
            return
        }
        isLoading = codes.isEmpty
        do {
            let loaded = try await apiService.getOnlineCodes(
                config: environmentStore.serverConfiguration,
                token: token
            )
            guard !Task.isCancelled else { return }
            codes = loaded
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    private func save(
        _ values: [String],
        game: TCGGame,
        source: OnlineCodeSource,
        productName: String?,
        notes: String?
    ) async throws {
        guard let token = environmentStore.authToken else {
            throw APIService.APIError.unauthorized
        }
        let result = try await apiService.createOnlineCodes(
            config: environmentStore.serverConfiguration,
            token: token,
            tcg: game.rawValue,
            codes: values,
            source: source,
            productName: productName,
            notes: notes
        )
        await load()
        resultMessage = "\(result.created) saved" +
            (result.duplicates > 0 ? " · \(result.duplicates) duplicate skipped" : "")
        HapticManager.notification(.success)
    }

    @MainActor
    private func updateStatus(_ code: OnlineCode, status: OnlineCodeStatus) async {
        guard let token = environmentStore.authToken else { return }
        do {
            let updated = try await apiService.updateOnlineCodeStatus(
                config: environmentStore.serverConfiguration,
                token: token,
                id: code.id,
                status: status
            )
            replace(updated)
            HapticManager.impact(.light)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func updateDetails(
        _ code: OnlineCode,
        status: OnlineCodeStatus,
        productName: String?,
        notes: String?
    ) async throws {
        guard let token = environmentStore.authToken else {
            throw APIService.APIError.unauthorized
        }
        let updated = try await apiService.updateOnlineCodeDetails(
            config: environmentStore.serverConfiguration,
            token: token,
            id: code.id,
            status: status,
            productName: productName,
            notes: notes
        )
        replace(updated)
    }

    @MainActor
    private func delete(_ code: OnlineCode) async {
        guard let token = environmentStore.authToken else { return }
        do {
            try await apiService.deleteOnlineCode(
                config: environmentStore.serverConfiguration,
                token: token,
                id: code.id
            )
            codes.removeAll { $0.id == code.id }
            HapticManager.notification(.success)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func replace(_ code: OnlineCode) {
        if let index = codes.firstIndex(where: { $0.id == code.id }) {
            codes[index] = code
        }
    }

    private func copy(_ code: OnlineCode) {
        UIPasteboard.general.string = code.code
        HapticManager.impact(.light)
    }
}

private enum OnlineCodeSheet: Identifiable {
    case manual(TCGGame)
    case scanner(TCGGame)
    case edit(OnlineCode)

    var id: String {
        switch self {
        case .manual: "manual"
        case .scanner: "scanner"
        case .edit(let code): "edit-\(code.id)"
        }
    }
}

private enum OnlineCodeStatusFilter: String, CaseIterable, Identifiable {
    case all
    case unused
    case redeemed
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .unused: "Unused"
        case .redeemed: "Used"
        case .other: "Other"
        }
    }

    func matches(_ status: OnlineCodeStatus) -> Bool {
        switch self {
        case .all: true
        case .unused: status == .unused
        case .redeemed: status == .redeemed
        case .other: status == .invalid || status == .traded
        }
    }
}

private extension OnlineCodeStatus {
    var color: Color {
        switch self {
        case .unused: .green
        case .redeemed: .blue
        case .invalid: .red
        case .traded: .orange
        }
    }
}

private extension TCGGame {
    static var codeVaultGames: [TCGGame] {
        allCases.filter { $0 != .all }
    }
}

private struct OnlineCodeRow: View {
    let code: OnlineCode
    let onCopy: () -> Void
    let onEdit: () -> Void
    let onStatus: (OnlineCodeStatus) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: AppSpacing.small) {
            HStack(alignment: .firstTextBaseline) {
                Text(code.code)
                    .font(.subheadline.monospaced().weight(.semibold))
                    .textSelection(.enabled)
                Spacer(minLength: AppSpacing.small)
                StatusPill(
                    title: code.status.title,
                    systemImage: code.status.systemImage,
                    color: code.status.color
                )
            }
            HStack(spacing: AppSpacing.small) {
                Label(
                    code.game?.shortName ?? code.tcg.capitalized,
                    systemImage: code.game?.systemIconName ?? "gamecontroller"
                )
                if let productName = code.productName {
                    Text("·")
                    Text(productName)
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            HStack {
                Text(code.source.rawValue.capitalized)
                Text("·")
                Text(code.capturedAt.onlineCodeDateLabel)
                Spacer()
                Menu {
                    ForEach(OnlineCodeStatus.allCases) { status in
                        Button {
                            onStatus(status)
                        } label: {
                            Label(status.title, systemImage: status.systemImage)
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                Button(action: onCopy) {
                    Image(systemName: "doc.on.doc")
                }
                Button(action: onEdit) {
                    Image(systemName: "pencil")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if let notes = code.notes {
                Text(notes).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.vertical, AppSpacing.compact)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private extension String {
    var onlineCodeDateLabel: String {
        guard let date = ISO8601DateFormatter().date(from: self) else { return self }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
