import SwiftUI

struct AddSetsToWishlistRequest: Identifiable {
    let id = UUID()
    let initialSetIDs: Set<String>
}

/// Selects one or more expansions and adds each one to a wishlist as both
/// cards and an auto-syncing set rule.
struct AddSetsToWishlistSheet: View {
    private let fixedWishlist: Wishlist?
    private let onComplete: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @EnvironmentObject private var wishlistStore: WishlistStore

    @State private var selectedSetIDs: Set<String>
    @State private var selectedWishlistID: String?
    @State private var availableSets: [TcgSet]
    @State private var selectedGame: TCGGame = .all
    @State private var searchText = ""
    @State private var newWishlistName = ""
    @State private var isCreatingWishlist = false
    @State private var isAdding = false
    @State private var didFinish = false
    @State private var operationMessage: String?
    @State private var errorMessage: String?
    @State private var isLoadingSets = false
    @State private var setsLoadError: String?

    private let apiService = APIService()

    init(
        sets: [TcgSet] = [],
        initialSetIDs: Set<String> = [],
        wishlist: Wishlist? = nil,
        onComplete: (() -> Void)? = nil
    ) {
        fixedWishlist = wishlist
        self.onComplete = onComplete
        _selectedSetIDs = State(initialValue: initialSetIDs)
        _selectedWishlistID = State(initialValue: wishlist?.id)
        _availableSets = State(initialValue: sets)
    }

    private var filteredSets: [TcgSet] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return availableSets.filter { set in
            let matchesGame = selectedGame == .all || set.tcg == selectedGame.rawValue
            let matchesSearch = query.isEmpty
                || set.name.localizedCaseInsensitiveContains(query)
                || set.code.localizedCaseInsensitiveContains(query)
            return matchesGame && matchesSearch
        }
    }

    private var groupedSets: [(String, [TcgSet])] {
        Dictionary(grouping: filteredSets, by: \.tcg)
            .sorted {
                gameSectionIsOrderedBefore(
                    $0.key,
                    $1.key,
                    enabledGames: environmentStore.enabledGames
                )
            }
            .map { tcg, sets in
                (
                    tcg,
                    sets.sorted {
                        $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                    }
                )
            }
    }

    private var selectedWishlist: Wishlist? {
        fixedWishlist ?? wishlistStore.wishlists.first { $0.id == selectedWishlistID }
    }

    private var canAdd: Bool {
        selectedWishlist != nil && !selectedSetIDs.isEmpty && !isAdding
    }

    private var trimmedNewWishlistName: String {
        newWishlistName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                List {
                    if fixedWishlist == nil {
                        WishlistSelectionSection(
                            title: "Wishlist",
                            wishlists: wishlistStore.wishlists,
                            selectedWishlistID: selectedWishlistID,
                            showsSelectionIndicators: true,
                            isLoading: wishlistStore.isLoading && !wishlistStore.hasLoaded,
                            loadingMessage: "Loading wishlists…",
                            loadError: wishlistStore.errorMessage,
                            emptyMessage: "Create a wishlist below to continue.",
                            isInteractionDisabled: false,
                            showsActivityIndicator: false,
                            onRetry: startReloadWishlists,
                            onSelect: selectWishlist
                        )
                        CreateWishlistSection(
                            title: "New Wishlist",
                            placeholder: "Wishlist name",
                            name: $newWishlistName,
                            textInputAutocapitalization: .words,
                            buttonTitle: isCreatingWishlist ? "Creating…" : "Create",
                            isCreateDisabled: trimmedNewWishlistName.isEmpty
                                || isCreatingWishlist
                                || isAdding,
                            onCreate: startCreateWishlist
                        )
                    }
                    setSections

                    if let errorMessage {
                        Section("Couldn’t Add Some Sets") {
                            Text(errorMessage)
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
            .navigationTitle("Add Sets to Wishlist")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search sets"
            )
            .safeAreaBar(edge: .top, spacing: 0) {
                if environmentStore.shouldShowGamePicker {
                    GamePickerPills(
                        selection: $selectedGame,
                        games: environmentStore.gamePickerGames
                    )
                }
            }
            .scrollEdgeEffectStyle(.soft, for: .all)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isAdding)
                }

                ToolbarItem(placement: .primaryAction) {
                    if !selectedSetIDs.isEmpty && !isAdding && !didFinish {
                        Button("Clear") {
                            selectedSetIDs.removeAll()
                        }
                    }
                }
            }
            .safeAreaBar(edge: .bottom) {
                actionBar
            }
            .task {
                selectedGame = environmentStore.resolvedGameSelection(selectedGame)
                await loadInitialData()
            }
        }
        .interactiveDismissDisabled(isAdding)
        .presentationDetents([.large])
    }

    @ViewBuilder
    private var setSections: some View {
        if isLoadingSets && availableSets.isEmpty {
            Section("Sets") {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Loading sets…")
                        .foregroundStyle(.secondary)
                }
            }
        } else if let setsLoadError, availableSets.isEmpty {
            Section("Sets") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(setsLoadError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                    Button("Try Again") {
                        Task { await loadSets() }
                    }
                }
            }
        } else if filteredSets.isEmpty {
            Section("Sets") {
                Text("No sets match your search.")
                    .foregroundStyle(.secondary)
            }
        } else {
            ForEach(groupedSets, id: \.0) { tcg, tcgSets in
                Section {
                    ForEach(tcgSets) { set in
                        Button {
                            toggle(set)
                        } label: {
                            HStack(spacing: 12) {
                                SetArtworkView(set: set, showsFallback: false)
                                    .frame(width: 32, height: 32)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(set.name)
                                        .foregroundStyle(.primary)
                                    Text(set.code.uppercased())
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                Spacer()

                                Image(
                                    systemName: selectedSetIDs.contains(set.id)
                                        ? "checkmark.circle.fill"
                                        : "circle"
                                )
                                .font(.title3)
                                .foregroundStyle(
                                    selectedSetIDs.contains(set.id)
                                        ? Color.accentColor
                                        : Color.secondary
                                )
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(isAdding || didFinish)
                        .accessibilityLabel(set.name)
                        .accessibilityValue(
                            selectedSetIDs.contains(set.id) ? "Selected" : "Not selected"
                        )
                    }
                } header: {
                    if environmentStore.shouldShowGamePicker {
                        if let game = TCGGame(rawValue: tcg) {
                            GameLabel(game: game, text: game.displayName)
                        } else {
                            Text(tcg.uppercased())
                        }
                    }
                }
            }
        }
    }

    private var actionBar: some View {
        VStack(spacing: 8) {
            if let operationMessage {
                Text(operationMessage)
                    .font(.footnote)
                    .foregroundStyle(didFinish ? Color.green : Color.secondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                if didFinish {
                    dismiss()
                } else {
                    Task { await addSets() }
                }
            } label: {
                HStack(spacing: 8) {
                    if isAdding {
                        ProgressView()
                    }
                    Text(actionTitle)
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!didFinish && !canAdd)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    private var actionTitle: String {
        if didFinish { return "Done" }
        if isAdding { return "Adding sets…" }
        let noun = selectedSetIDs.count == 1 ? "Set" : "Sets"
        return "Add \(selectedSetIDs.count) \(noun)"
    }

    private func toggle(_ set: TcgSet) {
        didFinish = false
        errorMessage = nil
        if selectedSetIDs.contains(set.id) {
            selectedSetIDs.remove(set.id)
        } else {
            selectedSetIDs.insert(set.id)
        }
    }

    private func selectWishlist(_ wishlist: Wishlist) {
        selectedWishlistID = wishlist.id
        didFinish = false
        operationMessage = nil
        errorMessage = nil
    }

    private func startCreateWishlist() {
        Task { await createWishlist() }
    }

    @MainActor
    private func loadInitialData() async {
        let session = environmentStore.sessionIdentity
        if fixedWishlist == nil {
            await loadWishlists()
        }
        guard environmentStore.matches(session), !Task.isCancelled else { return }
        if availableSets.isEmpty {
            await loadSets()
        }
    }

    @MainActor
    private func loadWishlists() async {
        let session = environmentStore.sessionIdentity
        guard let token = environmentStore.authToken else { return }
        await wishlistStore.load(
            config: session.configuration,
            token: token
        )
        guard environmentStore.matches(session), !Task.isCancelled else { return }
        if selectedWishlistID == nil, wishlistStore.wishlists.count == 1 {
            selectedWishlistID = wishlistStore.wishlists.first?.id
        }
    }

    @MainActor
    private func loadSets() async {
        let session = environmentStore.sessionIdentity
        guard let token = environmentStore.authToken else { return }
        isLoadingSets = true
        setsLoadError = nil
        defer { if environmentStore.matches(session) { isLoadingSets = false } }

        do {
            let catalog = try await apiService.getSetsWithStatus(
                config: session.configuration,
                token: token
            )
            guard environmentStore.matches(session), !Task.isCancelled else { return }
            let enabledGameIDs = Set(environmentStore.enabledGames.map(\.rawValue))
            availableSets = catalog.sets.filter {
                enabledGameIDs.contains($0.tcg.lowercased())
            }
        } catch {
            guard environmentStore.matches(session), !Task.isCancelled else { return }
            setsLoadError = error.localizedDescription
        }
    }

    @MainActor
    private func createWishlist() async {
        guard !isCreatingWishlist, let token = environmentStore.authToken else { return }
        let session = environmentStore.sessionIdentity
        let name = newWishlistName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }

        isCreatingWishlist = true
        errorMessage = nil
        defer { if environmentStore.matches(session) { isCreatingWishlist = false } }

        do {
            let wishlist = try await wishlistStore.create(
                config: session.configuration,
                token: token,
                input: CreateWishlistInput(name: name, description: nil, colorHex: nil, matchAnyPrinting: false)
            )
            guard environmentStore.matches(session), !Task.isCancelled else { return }
            selectedWishlistID = wishlist.id
            newWishlistName = ""
            didFinish = false
            operationMessage = nil
        } catch {
            guard environmentStore.matches(session), !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func addSets() async {
        guard !isAdding, let token = environmentStore.authToken,
              let wishlist = selectedWishlist else { return }
        let session = environmentStore.sessionIdentity

        let selectedSets = availableSets.filter { selectedSetIDs.contains($0.id) }
        guard !selectedSets.isEmpty else { return }

        isAdding = true
        defer { if environmentStore.matches(session) { isAdding = false } }
        didFinish = false
        errorMessage = nil
        var completedCount = 0
        var failedSetIDs: Set<String> = []
        var failures: [String] = []

        let service = WishlistSyncService(
            apiService: apiService,
            config: session.configuration,
            token: token,
            enabledGames: environmentStore.enabledGames,
            isCurrent: { environmentStore.matches(session) }
        )

        for (index, set) in selectedSets.enumerated() {
            guard environmentStore.matches(session), !Task.isCancelled else { return }
            operationMessage = "Loading \(set.name) (\(index + 1) of \(selectedSets.count))…"

            do {
                let cards = try await apiService.getSetCards(
                    config: session.configuration,
                    token: token,
                    tcg: set.tcg,
                    setCode: set.code
                )
                guard environmentStore.matches(session), !Task.isCancelled else { return }

                try await service.addCards(cards, toWishlist: wishlist.id) { sent, total in
                    guard environmentStore.matches(session) else { return }
                    operationMessage = "\(set.name): adding \(sent) of \(total) cards…"
                }
                guard environmentStore.matches(session), !Task.isCancelled else { return }

                _ = try await apiService.addWishlistRule(
                    config: session.configuration,
                    token: token,
                    wishlistId: wishlist.id,
                    type: .set,
                    tcg: set.tcg,
                    setCode: set.code,
                    setName: set.name,
                    includeAllPrintings: true,
                    autoSync: true
                )
                guard environmentStore.matches(session), !Task.isCancelled else { return }
                completedCount += 1
            } catch {
                guard environmentStore.matches(session), !Task.isCancelled else { return }
                failedSetIDs.insert(set.id)
                failures.append("\(set.name): \(error.localizedDescription)")
            }
        }

        await wishlistStore.load(
            config: session.configuration,
            token: token,
            force: true
        )
        guard environmentStore.matches(session), !Task.isCancelled else { return }
        if wishlistStore.matches(config: session.configuration, token: token) {
            environmentStore.updateWishlistWidgetData(wishlists: wishlistStore.wishlists, sessionID: session.generation)
        }

        isAdding = false
        if failures.isEmpty {
            let noun = completedCount == 1 ? "set" : "sets"
            operationMessage = "Added \(completedCount) \(noun) to \(wishlist.name)."
            didFinish = true
            onComplete?()
            HapticManager.notification(.success)
        } else {
            selectedSetIDs = failedSetIDs
            operationMessage = "Added \(completedCount) of \(selectedSets.count) sets."
            errorMessage = failures.joined(separator: "\n")
            if completedCount > 0 {
                onComplete?()
            }
            HapticManager.notification(.error)
        }
    }

    @MainActor
    private func reloadWishlists() async {
        guard let token = environmentStore.authToken else { return }
        await wishlistStore.load(
            config: environmentStore.serverConfiguration,
            token: token,
            force: true
        )
    }
    private func startReloadWishlists() {
        Task { await reloadWishlists() }
    }
}
