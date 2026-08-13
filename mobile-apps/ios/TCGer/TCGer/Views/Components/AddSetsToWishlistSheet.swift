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

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                List {
                    if fixedWishlist == nil {
                        wishlistSection
                        createWishlistSection
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
    private var wishlistSection: some View {
        Section("Wishlist") {
            if wishlistStore.isLoading && !wishlistStore.hasLoaded {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Loading wishlists…")
                        .foregroundStyle(.secondary)
                }
            } else if let loadError = wishlistStore.errorMessage,
                      wishlistStore.wishlists.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(loadError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                    Button("Try Again") {
                        Task { await reloadWishlists() }
                    }
                }
            } else if wishlistStore.wishlists.isEmpty {
                Text("Create a wishlist below to continue.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(wishlistStore.wishlists) { wishlist in
                    Button {
                        selectedWishlistID = wishlist.id
                        didFinish = false
                        operationMessage = nil
                        errorMessage = nil
                    } label: {
                        HStack(spacing: 12) {
                            Circle()
                                .fill(Color.fromHex(wishlist.colorHex))
                                .frame(width: 10, height: 10)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(wishlist.name)
                                    .foregroundStyle(.primary)
                                Text("\(wishlist.totalCards) cards")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Spacer()

                            Image(
                                systemName: selectedWishlistID == wishlist.id
                                    ? "checkmark.circle.fill"
                                    : "circle"
                            )
                            .font(.title3)
                            .foregroundStyle(
                                selectedWishlistID == wishlist.id
                                    ? Color.accentColor
                                    : Color.secondary
                            )
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var createWishlistSection: some View {
        Section("New Wishlist") {
            HStack {
                TextField("Wishlist name", text: $newWishlistName)
                    .textInputAutocapitalization(.words)

                Button(isCreatingWishlist ? "Creating…" : "Create") {
                    Task { await createWishlist() }
                }
                .disabled(
                    newWishlistName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || isCreatingWishlist
                        || isAdding
                )
            }
        }
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

    @MainActor
    private func loadInitialData() async {
        if fixedWishlist == nil {
            await loadWishlists()
        }
        if availableSets.isEmpty {
            await loadSets()
        }
    }

    @MainActor
    private func loadWishlists() async {
        guard let token = environmentStore.authToken else { return }
        await wishlistStore.load(
            config: environmentStore.serverConfiguration,
            token: token
        )
        if selectedWishlistID == nil, wishlistStore.wishlists.count == 1 {
            selectedWishlistID = wishlistStore.wishlists.first?.id
        }
    }

    @MainActor
    private func loadSets() async {
        guard let token = environmentStore.authToken else { return }
        isLoadingSets = true
        setsLoadError = nil
        defer { isLoadingSets = false }

        do {
            let catalog = try await apiService.getSetsWithStatus(
                config: environmentStore.serverConfiguration,
                token: token
            )
            let enabledGameIDs = Set(environmentStore.enabledGames.map(\.rawValue))
            availableSets = catalog.sets.filter {
                enabledGameIDs.contains($0.tcg.lowercased())
            }
        } catch {
            setsLoadError = error.localizedDescription
        }
    }

    @MainActor
    private func createWishlist() async {
        guard let token = environmentStore.authToken else { return }
        let name = newWishlistName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }

        isCreatingWishlist = true
        errorMessage = nil
        defer { isCreatingWishlist = false }

        do {
            let wishlist = try await apiService.createWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                name: name
            )
            wishlistStore.insert(wishlist)
            selectedWishlistID = wishlist.id
            newWishlistName = ""
            didFinish = false
            operationMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func addSets() async {
        guard let token = environmentStore.authToken,
              let wishlist = selectedWishlist else { return }

        let selectedSets = availableSets.filter { selectedSetIDs.contains($0.id) }
        guard !selectedSets.isEmpty else { return }

        isAdding = true
        didFinish = false
        errorMessage = nil
        var completedCount = 0
        var failedSetIDs: Set<String> = []
        var failures: [String] = []

        let service = WishlistSyncService(
            apiService: apiService,
            config: environmentStore.serverConfiguration,
            token: token,
            enabledGames: environmentStore.enabledGames
        )

        for (index, set) in selectedSets.enumerated() {
            operationMessage = "Loading \(set.name) (\(index + 1) of \(selectedSets.count))…"

            do {
                let cards = try await apiService.getSetCards(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    tcg: set.tcg,
                    setCode: set.code
                )

                try await service.addCards(cards, toWishlist: wishlist.id) { sent, total in
                    operationMessage = "\(set.name): adding \(sent) of \(total) cards…"
                }

                _ = try await apiService.addWishlistRule(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    wishlistId: wishlist.id,
                    type: .set,
                    tcg: set.tcg,
                    setCode: set.code,
                    setName: set.name,
                    includeAllPrintings: true,
                    autoSync: true
                )
                completedCount += 1
            } catch {
                failedSetIDs.insert(set.id)
                failures.append("\(set.name): \(error.localizedDescription)")
            }
        }

        await wishlistStore.load(
            config: environmentStore.serverConfiguration,
            token: token,
            force: true
        )
        environmentStore.updateWishlistWidgetData(wishlists: wishlistStore.wishlists)

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
}
