import SwiftUI

struct SetBrowserView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var sets: [TcgSet] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var selectedGame: TCGGame = .all
    @State private var browserScope: SetBrowserScope = .browse
    @State private var progressFilter: SetProgressFilter = .all
    @State private var ownedCardsBySet: [String: Set<String>] = [:]
    @State private var standardOwnedCardsBySet: [String: Set<String>] = [:]
    @State private var showingFocusPicker = false
    @State private var didChooseInitialScope = false
    @State private var failedProviders: [String] = []
    @State private var collectionRevision = 0

    private let apiService = APIService()

    var availableGames: [TCGGame] {
        var games: [TCGGame] = [.all]
        games.append(contentsOf: environmentStore.enabledGames)
        return games
    }

    private var enabledSets: [TcgSet] {
        let enabledGameIDs = Set(environmentStore.enabledGames.map(\.rawValue))
        return sets.filter { enabledGameIDs.contains($0.tcg.lowercased()) }
    }

    var filteredSets: [TcgSet] {
        var result = enabledSets

        if browserScope == .focused {
            result = result.filter { environmentStore.isFocused(on: $0) }
        }

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

        if browserScope == .focused {
            let priority = Dictionary(
                uniqueKeysWithValues: environmentStore.focusedSetOrder.enumerated().map { ($1, $0) }
            )
            return result.sorted {
                (priority[$0.focusID] ?? .max) < (priority[$1.focusID] ?? .max)
            }
        }

        return result.sorted(by: setSortComparator)
    }

    var groupedSets: [(String, [TcgSet])] {
        if browserScope == .focused {
            return [("priority", filteredSets)]
        }
        let groups = Dictionary(grouping: filteredSets, by: { $0.tcg })
        return groups.sorted { $0.key < $1.key }
    }

    private var focusedSetCount: Int {
        enabledSets.filter { environmentStore.isFocused(on: $0) }.count
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Set view", selection: $browserScope) {
                    ForEach(SetBrowserScope.allCases) { scope in
                        Text(scope.title).tag(scope)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.top, 8)
                .padding(.bottom, 6)

                if environmentStore.enabledGames.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(availableGames) { game in
                                SetGameFilterChip(
                                    game: game,
                                    isSelected: selectedGame == game
                                ) {
                                    selectedGame = game
                                }
                            }
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 12)
                    }
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
                        showingFocusPicker = true
                    } label: {
                        Label(
                            focusedSetCount == 0 ? "Choose Sets" : "Manage \(focusedSetCount)",
                            systemImage: "scope"
                        )
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
                } else if browserScope == .focused && focusedSetCount == 0 {
                    FocusedSetsEmptyState {
                        showingFocusPicker = true
                    }
                } else if filteredSets.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: browserScope == .focused ? "scope" : "tray")
                            .font(.system(size: 50))
                            .foregroundColor(.secondary)
                        Text(browserScope == .focused ? "No Focused Sets Match" : "No Sets Found")
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
                                            progressTotal: progressTotal(for: set),
                                            isFocused: environmentStore.isFocused(on: set)
                                        )
                                    }
                                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                        focusAction(for: set)
                                    }
                                    .contextMenu {
                                        focusAction(for: set)
                                    }
                                }
                            } header: {
                                Text(
                                    tcg == "priority"
                                        ? "Priority"
                                        : (TCGGame(rawValue: tcg)?.displayName ?? tcg.uppercased())
                                )
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Sets")
            .searchable(text: $searchText, prompt: "Search sets...")
            .task {
                chooseInitialScopeIfNeeded()
                await loadSets()
            }
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
            .sheet(isPresented: $showingFocusPicker, onDismiss: {
                if !environmentStore.focusedSetIDs.isEmpty {
                    browserScope = .focused
                }
            }) {
                FocusSetPicker(
                    sets: enabledSets,
                    availableGames: availableGames,
                    initialOrder: environmentStore.focusedSetOrder,
                    onSave: environmentStore.replaceFocusedSetOrder
                )
            }
        }
    }

    @ViewBuilder
    private func focusAction(for set: TcgSet) -> some View {
        let isFocused = environmentStore.isFocused(on: set)
        Button {
            environmentStore.toggleFocus(on: set)
        } label: {
            Label(
                isFocused ? "Stop Focusing" : "Add to Focus",
                systemImage: isFocused ? "scope" : "plus.circle"
            )
        }
        .tint(isFocused ? .orange : .accentColor)
    }

    private func chooseInitialScopeIfNeeded() {
        guard !didChooseInitialScope else { return }
        browserScope = environmentStore.focusedSetIDs.isEmpty ? .browse : .focused
        didChooseInitialScope = true
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

private enum SetBrowserScope: String, CaseIterable, Identifiable {
    case focused
    case browse

    var id: String { rawValue }

    var title: String {
        switch self {
        case .focused: return "Focused"
        case .browse: return "Browse"
        }
    }
}

// MARK: - Set Row
private struct SetRow: View {
    let set: TcgSet
    let ownedCount: Int
    let progressTotal: Int
    let isFocused: Bool

    var body: some View {
        HStack(spacing: 12) {
            SetArtworkView(set: set)

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

                    if let releaseDate = set.releaseDate {
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
                    .tint(ownedCount >= progressTotal ? .green : .accentColor)
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

            if isFocused {
                Image(systemName: "scope")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.tint)
                    .accessibilityLabel("Focused set")
            }
        }
        .padding(.vertical, 4)
    }
}

private struct FocusedSetsEmptyState: View {
    let chooseAction: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Choose Your Focus Sets", systemImage: "scope")
        } description: {
            Text("Pick the sets you are actively collecting so their progress stays easy to find.")
        } actions: {
            Button("Choose Focus Sets", action: chooseAction)
                .buttonStyle(.borderedProminent)
        }
    }
}

private struct FocusSetPicker: View {
    @Environment(\.dismiss) private var dismiss

    let sets: [TcgSet]
    let availableGames: [TCGGame]
    let initialOrder: [String]
    let onSave: ([String]) -> Void

    @State private var searchText = ""
    @State private var selectedGame: TCGGame = .all
    @State private var draftOrder: [String]

    init(
        sets: [TcgSet],
        availableGames: [TCGGame],
        initialOrder: [String],
        onSave: @escaping ([String]) -> Void
    ) {
        self.sets = sets
        self.availableGames = availableGames
        self.initialOrder = initialOrder
        self.onSave = onSave
        _draftOrder = State(initialValue: initialOrder)
    }

    private var focusedSetIDs: Set<String> { Set(draftOrder) }

    private var filteredSets: [TcgSet] {
        sets.filter { set in
            let matchesGame = selectedGame == .all || set.tcg == selectedGame.rawValue
            let trimmedQuery = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            let matchesSearch = trimmedQuery.isEmpty
                || set.name.localizedCaseInsensitiveContains(trimmedQuery)
                || set.code.localizedCaseInsensitiveContains(trimmedQuery)
            return matchesGame && matchesSearch
        }
    }

    private var groupedSets: [(String, [TcgSet])] {
        Dictionary(grouping: filteredSets, by: \.tcg)
            .sorted { $0.key < $1.key }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if availableGames.count > 2 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(availableGames) { game in
                                SetGameFilterChip(
                                    game: game,
                                    isSelected: selectedGame == game
                                ) {
                                    selectedGame = game
                                }
                            }
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 10)
                    }
                    Divider()
                }

                List {
                    if searchText.isEmpty, selectedGame == .all, !draftOrder.isEmpty {
                        Section("Focused — drag to prioritize") {
                            ForEach(draftOrder, id: \.self) { focusID in
                                if let set = sets.first(where: { $0.focusID == focusID }) {
                                    HStack {
                                        Text(set.name)
                                        Spacer()
                                        Text(set.tcgDisplayName)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .onMove { source, destination in
                                draftOrder.move(fromOffsets: source, toOffset: destination)
                            }
                            .onDelete { offsets in
                                draftOrder.remove(atOffsets: offsets)
                            }
                        }
                    }

                    ForEach(groupedSets, id: \.0) { tcg, tcgSets in
                        Section(TCGGame(rawValue: tcg)?.displayName ?? tcg.uppercased()) {
                            ForEach(tcgSets) { set in
                                Button {
                                    if focusedSetIDs.contains(set.focusID) {
                                        draftOrder.removeAll { $0 == set.focusID }
                                    } else {
                                        draftOrder.append(set.focusID)
                                    }
                                } label: {
                                    HStack(spacing: 12) {
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(set.name)
                                                .foregroundStyle(.primary)
                                            Text(set.code.uppercased())
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(
                                            systemName: focusedSetIDs.contains(set.focusID)
                                                ? "checkmark.circle.fill"
                                                : "circle"
                                        )
                                        .font(.title3)
                                        .foregroundStyle(
                                            focusedSetIDs.contains(set.focusID)
                                                ? Color.accentColor
                                                : Color.secondary
                                        )
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(set.name)
                                .accessibilityValue(
                                    focusedSetIDs.contains(set.focusID) ? "Focused" : "Not focused"
                                )
                            }
                        }
                    }
                }
                .overlay {
                    if filteredSets.isEmpty {
                        ContentUnavailableView.search(text: searchText)
                    }
                }
            }
            .navigationTitle("Focus Sets")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Search sets")
            .safeAreaInset(edge: .bottom) {
                Text("\(draftOrder.count) selected")
                    .font(.footnote.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(.regularMaterial)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if !draftOrder.isEmpty {
                        Button("Clear", role: .destructive) {
                            draftOrder.removeAll()
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onSave(draftOrder)
                        dismiss()
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    EditButton()
                }
            }
        }
    }
}

// MARK: - Game Filter Chip
private struct SetGameFilterChip: View {
    let game: TCGGame
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let customIcon = game.iconName {
                    Image(customIcon)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 14, height: 14)
                        .foregroundColor(isSelected ? .white : .accentColor)
                } else {
                    Image(systemName: game.systemIconName)
                        .font(.caption)
                        .foregroundColor(isSelected ? .white : .primary)
                }
                Text(game.displayName)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(isSelected ? Color.accentColor : Color(.systemGray5))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(20)
        }
    }
}
