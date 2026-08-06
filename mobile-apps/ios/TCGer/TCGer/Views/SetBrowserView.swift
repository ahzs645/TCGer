import SwiftUI

struct SetBrowserView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var sets: [TcgSet] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var selectedGame: TCGGame = .all
    @State private var progressFilter: SetProgressFilter = .all
    @State private var ownedCardsBySet: [String: Set<String>] = [:]
    @State private var standardOwnedCardsBySet: [String: Set<String>] = [:]
    @State private var addSetsRequest: AddSetsToWishlistRequest?
    @State private var failedProviders: [String] = []
    @State private var collectionRevision = 0

    private let apiService = APIService()

    private var enabledSets: [TcgSet] {
        let enabledGameIDs = Set(environmentStore.enabledGames.map(\.rawValue))
        return sets.filter { enabledGameIDs.contains($0.tcg.lowercased()) }
    }

    var filteredSets: [TcgSet] {
        var result = enabledSets

        if selectedGame != .all {
            result = result.filter { $0.tcg == selectedGame.rawValue }
        }

        if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let query = searchText.lowercased()
            result = result.filter {
                $0.name.lowercased().contains(query) ||
                $0.code.lowercased().contains(query)
            }
        }

        result = result.filter { set in
            let owned = ownedCount(for: set)
            let total = progressTotal(for: set)
            switch progressFilter {
            case .all:
                return true
            case .started:
                return owned > 0 && (total == 0 || owned < total)
            case .complete:
                return total > 0 && owned >= total
            case .notStarted:
                return owned == 0
            }
        }

        return result.sorted(by: setSortComparator)
    }

    var groupedSets: [(String, [TcgSet])] {
        let groups = Dictionary(grouping: filteredSets, by: { $0.tcg })
        return groups.sorted {
            gameSectionIsOrderedBefore(
                $0.key,
                $1.key,
                enabledGames: environmentStore.enabledGames
            )
        }
    }

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    var body: some View {
        Group {
            if parentProvidesNavigation {
                setBrowserContent
            } else {
                NavigationView {
                    setBrowserContent
                }
            }
        }
    }

    private var setBrowserContent: some View {
        VStack(spacing: 0) {
                if environmentStore.enabledGames.count > 1 {
                    GamePickerPills(
                        selection: $selectedGame,
                        games: environmentStore.gamePickerGames
                    )
                    .background(Color(.systemBackground))
                    Divider()
                }

                HStack(spacing: 12) {
                    Menu {
                        Picker("Progress", selection: $progressFilter) {
                            ForEach(SetProgressFilter.allCases) { filter in
                                Text(filter.title).tag(filter)
                            }
                        }

                        Divider()

                        Picker("Completion goal", selection: completionModeBinding) {
                            ForEach(SetCompletionMode.allCases) { mode in
                                Text(mode.title).tag(mode)
                            }
                        }

                        Picker("Sort", selection: $environmentStore.setBrowserSort) {
                            ForEach(SetBrowserSort.allCases) { sort in
                                Text(sort.title).tag(sort)
                            }
                        }
                    } label: {
                        Label(progressFilter.filterTitle, systemImage: "line.3.horizontal.decrease.circle")
                    }
                    .buttonStyle(.bordered)

                    Spacer()

                    Button {
                        addSetsRequest = AddSetsToWishlistRequest(initialSetIDs: [])
                    } label: {
                        Label("Add Sets", systemImage: "heart.badge.plus")
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(.horizontal)
                .padding(.vertical, 8)

                if !failedProviders.isEmpty {
                    HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        Text("Some set catalogs are unavailable: \(failedProviderNames)")
                            .font(.footnote)
                        Spacer()
                        Button("Retry") {
                            Task { await loadSets(useCache: false) }
                        }
                        .font(.footnote.weight(.semibold))
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    .background(Color.orange.opacity(0.12))
                }

                if isLoading {
                    ProgressView("Loading sets...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = errorMessage {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 50))
                            .foregroundColor(.orange)
                        Text("Failed to Load Sets")
                            .font(.headline)
                        Text(error)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                        Button("Try Again") {
                            Task { await loadSets() }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if filteredSets.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "tray")
                            .font(.system(size: 50))
                            .foregroundColor(.secondary)
                        Text("No Sets Found")
                            .font(.title3)
                            .fontWeight(.semibold)
                        Text("Try a different search, game, or progress filter.")
                            .font(.body)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(groupedSets, id: \.0) { tcg, tcgSets in
                            Section {
                                ForEach(tcgSets) { set in
                                    NavigationLink {
                                        SetDetailView(set: set)
                                            .environmentObject(environmentStore)
                                    } label: {
                                        SetRow(
                                            set: set,
                                            ownedCount: ownedCount(for: set),
                                            progressTotal: progressTotal(for: set)
                                        )
                                    }
                                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                        addToWishlistAction(for: set)
                                    }
                                    .contextMenu {
                                        addToWishlistAction(for: set)
                                    }
                                }
                            } header: {
                                GameSectionHeader(tcg: tcg)
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
        }
        .navigationTitle("Sets")
            .searchable(text: $searchText, prompt: "Search sets...")
            .task {
                await loadSets()
            }
            .onChange(of: environmentStore.enabledYugioh) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledMagic) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledPokemon) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledOnepiece) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledLorcana) { validateSelectedGame() }
            .onChange(of: environmentStore.enabledDragonball) { validateSelectedGame() }
            .refreshable {
                await loadSets(useCache: false)
            }
            .onReceive(NotificationCenter.default.publisher(for: .collectionDidChange)) { _ in
                collectionRevision += 1
            }
            .task(id: collectionRevision) {
                guard collectionRevision > 0 else { return }
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                await refreshOwnership(useCache: false)
            }
        .sheet(item: $addSetsRequest) { request in
            AddSetsToWishlistSheet(
                sets: enabledSets,
                initialSetIDs: request.initialSetIDs
            )
        }
    }

    @ViewBuilder
    private func addToWishlistAction(for set: TcgSet) -> some View {
        Button {
            addSetsRequest = AddSetsToWishlistRequest(initialSetIDs: [set.id])
        } label: {
            Label("Add to Wishlist", systemImage: "heart.badge.plus")
        }
        .tint(.pink)
    }

    private func validateSelectedGame() {
        if selectedGame != .all && !environmentStore.enabledGames.contains(selectedGame) {
            selectedGame = .all
        }
    }

    private var completionModeBinding: Binding<SetCompletionMode> {
        Binding(
            get: { environmentStore.setCompletionMode },
            set: { environmentStore.updateSetCompletionMode($0) }
        )
    }

    private var failedProviderNames: String {
        failedProviders.map {
            TCGGame(rawValue: $0)?.displayName ?? $0.capitalized
        }
        .joined(separator: ", ")
    }

    private func setSortComparator(_ left: TcgSet, _ right: TcgSet) -> Bool {
        switch environmentStore.setBrowserSort {
        case .newest:
            return (left.releaseDate ?? "") > (right.releaseDate ?? "")
        case .name:
            return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
        case .completion:
            return completion(for: left) > completion(for: right)
        case .closest:
            let leftTotal = progressTotal(for: left)
            let rightTotal = progressTotal(for: right)
            let leftRemaining = leftTotal > 0 ? max(0, leftTotal - ownedCount(for: left)) : Int.max
            let rightRemaining = rightTotal > 0 ? max(0, rightTotal - ownedCount(for: right)) : Int.max
            if leftRemaining == rightRemaining {
                return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
            }
            return leftRemaining < rightRemaining
        }
    }

    private func completion(for set: TcgSet) -> Double {
        SetProgressCalculator.progress(
            owned: ownedCount(for: set),
            total: progressTotal(for: set)
        )
    }

    @MainActor
    private func loadSets(useCache: Bool = true) async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            let catalog = try await apiService.getSetsWithStatus(
                config: environmentStore.serverConfiguration,
                token: token
            )
            sets = catalog.sets
            failedProviders = catalog.failedProviders
            await refreshOwnership(useCache: useCache)
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func refreshOwnership(useCache: Bool) async {
        guard let token = environmentStore.authToken else { return }
        let collections = (try? await apiService.getCollections(
            config: environmentStore.serverConfiguration,
            token: token,
            useCache: useCache
        )) ?? []
        let setsByKey = Dictionary(uniqueKeysWithValues: sets.map { ($0.focusID, $0) })
        var ownership: [String: Set<String>] = [:]
        var standardOwnership: [String: Set<String>] = [:]

        for collection in collections {
            for card in collection.cards {
                guard let setCode = card.setCode else { continue }
                let key = setKey(tcg: card.tcg, code: setCode)
                let cardID = card.externalId ?? card.cardId
                ownership[key, default: []].insert(cardID)

                if let set = setsByKey[key], SetProgressCalculator.includes(
                    collectorNumber: card.collectorNumber,
                    tcg: card.tcg,
                    standardLimit: set.standardCards,
                    mode: .standard
                ) {
                    standardOwnership[key, default: []].insert(cardID)
                }
            }
        }

        ownedCardsBySet = ownership
        standardOwnedCardsBySet = standardOwnership
    }

    private func setKey(tcg: String, code: String) -> String {
        "\(tcg.lowercased())::\(code.lowercased())"
    }

    private func ownedCount(for set: TcgSet) -> Int {
        let key = setKey(tcg: set.tcg, code: set.code)
        let source = environmentStore.setCompletionMode == .standard
            ? standardOwnedCardsBySet
            : ownedCardsBySet
        return source[key]?.count ?? 0
    }

    private func progressTotal(for set: TcgSet) -> Int {
        SetProgressCalculator.total(for: set, mode: environmentStore.setCompletionMode)
    }
}

private enum SetProgressFilter: String, CaseIterable, Identifiable {
    case all
    case started
    case complete
    case notStarted

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .started: return "Started"
        case .complete: return "Complete"
        case .notStarted: return "New"
        }
    }

    var filterTitle: String {
        self == .all ? "Any Progress" : title
    }
}

// MARK: - Set Row
private struct SetRow: View {
    let set: TcgSet
    let ownedCount: Int
    let progressTotal: Int

    private var gameBrandColor: Color {
        TCGGame(rawValue: set.tcg.lowercased())?.brandColor ?? .accentColor
    }

    var body: some View {
        HStack(spacing: 12) {
            SetArtworkView(set: set, showsFallback: false)
                .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 4) {
                Text(set.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    Text(set.code.uppercased())
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .foregroundColor(.accentColor)

                    if let totalCards = set.totalCards {
                        Text("\(totalCards) cards")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }

                    if let releaseDate = set.formattedReleaseDate {
                        Text(releaseDate)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }

                if progressTotal > 0 {
                    ProgressView(
                        value: Double(min(ownedCount, progressTotal)),
                        total: Double(progressTotal)
                    )
                    .tint(ownedCount >= progressTotal ? .green : gameBrandColor)
                    Text("\(ownedCount) of \(progressTotal) owned")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                } else if ownedCount > 0 {
                    Text("\(ownedCount) owned")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
}

private struct GameSectionHeader: View {
    let tcg: String

    var body: some View {
        if let game = TCGGame(rawValue: tcg) {
            HStack(spacing: 6) {
                TCGGameIcon(game: game, size: 14)
                    .foregroundStyle(game.brandColor)
                Text(game.displayName)
            }
        } else {
            HStack(spacing: 6) {
                Image(systemName: "questionmark.circle")
                    .font(.system(size: 14))
                    .foregroundStyle(.gray)
                Text(tcg.uppercased())
            }
        }
    }
}
