import SwiftUI

private enum GuideSearchScope: String, CaseIterable {
    case guides = "Guides"
    case cards = "All Cards"
}

private enum GuideOwnershipFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case missing = "Missing"
    case owned = "Owned"
    var id: String { rawValue }
}

enum CollectionGuideListFilter {
    static func apply(
        to guides: [CollectionGuide],
        enabledGames: [TCGGame],
        selectedGame: TCGGame,
        query: String
    ) -> [CollectionGuide] {
        let enabledGameIDs = Set(enabledGames.map(\.rawValue))
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return guides.filter { guide in
            let guideGame = guide.tcg.lowercased()
            let matchesEnabledGame = enabledGameIDs.contains(guideGame)
            let matchesSelectedGame = selectedGame == .all || guideGame == selectedGame.rawValue
            let matchesSearch = trimmedQuery.isEmpty
                || guide.title.localizedCaseInsensitiveContains(trimmedQuery)
                || guide.description.localizedCaseInsensitiveContains(trimmedQuery)
                || guide.tags.contains { $0.localizedCaseInsensitiveContains(trimmedQuery) }
            return matchesEnabledGame && matchesSelectedGame && matchesSearch
        }
    }
}

struct CollectionGuidesView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @EnvironmentObject private var wishlistStore: WishlistStore
    @State private var guides: [CollectionGuide] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var isSearchPresented = false
    @State private var searchScope = GuideSearchScope.guides
    @State private var guideCardResults: [GuideCardSearchResult] = []
    @State private var guideCardTotal = 0
    @State private var isSearchingCards = false
    @State private var selectedGame = TCGGame.all
    @State private var selectedCategory: CollectionGuideCategory?
    @State private var globalOwnership = GuideOwnershipFilter.all

    private let apiService = APIService()

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    private var filteredGuides: [CollectionGuide] {
        CollectionGuideListFilter.apply(
            to: guides,
            enabledGames: environmentStore.enabledGames,
            selectedGame: selectedGame,
            query: searchText
        )
    }

    private var guideCardActiveFilterCount: Int {
        (selectedGame == .all ? 0 : 1)
            + (selectedCategory == nil ? 0 : 1)
            + (globalOwnership == .all ? 0 : 1)
    }

    private func progress(for guide: CollectionGuide) -> CollectionGuideProgress? {
        guard guide.followed,
              let wishlistId = guide.wishlistId,
              let wishlist = wishlistStore.wishlists.first(where: { $0.id == wishlistId }) else {
            return nil
        }
        return CollectionGuideProgress(
            ownedCards: wishlist.ownedCards,
            totalCards: wishlist.totalCards,
            completionPercent: wishlist.completionPercent
        )
    }

    var body: some View {
        Group {
            if parentProvidesNavigation {
                content
            } else {
                NavigationStack { content }
            }
        }
    }

    private var content: some View {
        Group {
            if isLoading && guides.isEmpty {
                ProgressView("Loading collection guides…")
            } else if let errorMessage, guides.isEmpty {
                ErrorView(title: "Couldn’t Load Guides", message: errorMessage) {
                    Task { await loadGuides() }
                }
            } else if searchScope == .cards {
                guideCardSearchContent
            } else if filteredGuides.isEmpty {
                VStack(spacing: 0) {
                    gamePicker
                    ContentUnavailableView {
                        Label("No Guides Found", systemImage: "books.vertical")
                    } description: {
                        Text("Try a different search or game.")
                    }
                }
            } else {
                VStack(spacing: 0) {
                    gamePicker

                    ScrollView {
                        LazyVStack(spacing: 16) {
                            ForEach(filteredGuides) { guide in
                                NavigationLink {
                                    CollectionGuideDetailView(guide: guide) { updatedGuide in
                                        guard let index = guides.firstIndex(where: { $0.id == updatedGuide.id }) else {
                                            return
                                        }
                                        guides[index] = updatedGuide
                                    }
                                } label: {
                                    CollectionGuideRow(
                                        guide: guide,
                                        progress: progress(for: guide)
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding()
                    }
                    .refreshable {
                        async let guideLoad: Void = loadGuides()
                        async let wishlistLoad: Void = loadWishlists(force: true)
                        _ = await (guideLoad, wishlistLoad)
                    }
                }
            }
        }
        .navigationTitle("Collection Guides")
        .modifier(
            CollectionGuideSearchPresenter(
                text: $searchText,
                isPresented: $isSearchPresented,
                scope: $searchScope,
                prompt: searchScope == .cards
                    ? "Search guide cards"
                    : selectedGame == .all
                        ? "Search guides"
                        : "Search \(selectedGame.shortName) guides"
            )
        )
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    isSearchPresented = true
                } label: {
                    Image(systemName: "magnifyingglass")
                }
                .accessibilityLabel("Search collection guides")
                .accessibilityIdentifier("collectionGuidesSearch")
            }
        }
        .task {
            resolveSelectedGame()
            async let guideLoad: Void = loadGuides()
            async let wishlistLoad: Void = loadWishlists()
            _ = await (guideLoad, wishlistLoad)
        }
        .onChange(of: environmentStore.enabledGames) {
            resolveSelectedGame()
        }
        .task(id: "\(searchScope.rawValue)|\(searchText)|\(selectedGame.rawValue)|\(selectedCategory?.rawValue ?? "all")|\(globalOwnership.rawValue)") {
            guard searchScope == .cards else { return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await searchGuideCards()
        }
    }

    @ViewBuilder
    private var gamePicker: some View {
        if environmentStore.shouldShowGamePicker {
            GamePickerPills(
                selection: $selectedGame,
                games: environmentStore.gamePickerGames
            )
        }
    }

    private var guideCardSearchContent: some View {
        VStack(spacing: 12) {
            HStack {
                Menu {
                    if environmentStore.shouldShowGamePicker {
                        Picker("Game", selection: $selectedGame) {
                            ForEach(environmentStore.gamePickerGames) { game in
                                GameLabel(game: game)
                                    .tag(game)
                            }
                        }
                    }
                    Picker("Theme", selection: $selectedCategory) {
                        Text("All Themes").tag(CollectionGuideCategory?.none)
                        Text("Art Style").tag(CollectionGuideCategory?.some(.artStyle))
                        Text("Artist").tag(CollectionGuideCategory?.some(.artist))
                        Text("Species").tag(CollectionGuideCategory?.some(.species))
                        Text("Story / Connected Art").tag(CollectionGuideCategory?.some(.story))
                        Text("Cameo").tag(CollectionGuideCategory?.some(.cameo))
                    }

                    Picker("Ownership", selection: $globalOwnership) {
                        ForEach(GuideOwnershipFilter.allCases) { filter in
                            Text(filter.rawValue).tag(filter)
                        }
                    }
                } label: {
                    AppFilterMenuLabel(
                        kind: .filter,
                        title: "Filters",
                        isActive: guideCardActiveFilterCount > 0,
                        activeCount: guideCardActiveFilterCount
                    )
                }
                .accessibilityLabel("Guide card filters")
                .accessibilityValue(
                    guideCardActiveFilterCount == 0
                        ? "No active filters"
                        : "\(guideCardActiveFilterCount) active"
                )

                Spacer()
            }
            .padding(.horizontal)

            if isSearchingCards && guideCardResults.isEmpty {
                ProgressView("Searching every guide…")
                    .frame(maxWidth: .infinity, minHeight: 220)
            } else if guideCardResults.isEmpty {
                ContentUnavailableView.search(text: searchText)
                    .frame(maxWidth: .infinity, minHeight: 220)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("\(guideCardTotal) matching guide cards")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 112, maximum: 170), spacing: 12)],
                            spacing: 18
                        ) {
                            ForEach(guideCardResults) { result in
                                GlobalGuideCardCell(result: result)
                            }
                        }
                    }
                    .padding()
                }
                .refreshable { await searchGuideCards() }
            }
        }
    }

    private func resolveSelectedGame() {
        selectedGame = environmentStore.resolvedGameSelection(selectedGame)
    }

    @MainActor
    private func loadGuides() async {
        guard let token = environmentStore.authToken else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            guides = try await apiService.getCollectionGuides(
                config: environmentStore.serverConfiguration,
                token: token
            )
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadWishlists(force: Bool = false) async {
        guard let token = environmentStore.authToken else { return }
        await wishlistStore.load(
            config: environmentStore.serverConfiguration,
            token: token,
            force: force
        )
    }

    @MainActor
    private func searchGuideCards() async {
        guard let token = environmentStore.authToken else { return }
        isSearchingCards = true
        defer { isSearchingCards = false }
        do {
            let response = try await apiService.searchCollectionGuideCards(
                config: environmentStore.serverConfiguration,
                token: token,
                query: searchText,
                game: selectedGame,
                category: selectedCategory,
                ownership: globalOwnership.rawValue.lowercased()
            )
            guard !Task.isCancelled else { return }
            guideCardResults = response.results
            guideCardTotal = response.total
            errorMessage = response.failedGuideSlugs.isEmpty
                ? nil
                : "Some guide sources are temporarily unavailable."
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct CollectionGuideSearchPresenter: ViewModifier {
    @Binding var text: String
    @Binding var isPresented: Bool
    @Binding var scope: GuideSearchScope
    let prompt: String

    @ViewBuilder
    func body(content: Content) -> some View {
        if isPresented {
            content
                .searchable(
                    text: $text,
                    isPresented: $isPresented,
                    prompt: prompt
                )
                .searchScopes($scope) {
                    ForEach(GuideSearchScope.allCases, id: \.self) { scope in
                        Text(scope.rawValue).tag(scope)
                    }
                }
        } else {
            content
        }
    }
}

private struct GlobalGuideCardCell: View {
    let result: GuideCardSearchResult

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CachedAsyncImage(card: result.card) { phase in
                if case let .success(image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    Rectangle().fill(.quaternary)
                }
            }
            .aspectRatio(63 / 88, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(alignment: .topTrailing) {
                if result.owned {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.white, .green)
                        .padding(5)
                }
            }
            if let guide = result.matchedGuides.first {
                Text(guide.groupLabel.map { "\(guide.title) · \($0)" } ?? guide.title)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tint)
                    .lineLimit(2)
            }
            Text(result.card.name).font(.caption.weight(.semibold)).lineLimit(1)
            Text([result.card.setCode, result.card.collectorNumber].compactMap { $0 }.joined(separator: " · "))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

private struct CollectionGuideProgress: Equatable {
    let ownedCards: Int
    let totalCards: Int
    let completionPercent: Int
}

private struct CollectionGuideRow: View {
    let guide: CollectionGuide
    let progress: CollectionGuideProgress?

    private var displayedCardCount: Int? {
        if let progress, progress.totalCards > 0 {
            return progress.totalCards
        }
        return guide.cardCountHint
    }

    var body: some View {
        HStack(spacing: 16) {
            CachedAsyncImage(url: guide.coverImageUrl.flatMap(URL.init(string:))) { phase in
                if case let .success(image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    Rectangle().fill(.quaternary)
                        .overlay { Image(systemName: "photo.on.rectangle.angled").foregroundStyle(.secondary) }
                }
            }
            .frame(width: 104, height: 146)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(guide.title).font(.headline)
                    if guide.followed {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    }
                }
                Text(guide.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                if let displayedCardCount {
                    HStack(spacing: 8) {
                        GameBadge(tcg: guide.tcg, showsName: true)
                        Label("\(displayedCardCount) cards", systemImage: "rectangle.stack")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                } else {
                    GameBadge(tcg: guide.tcg, showsName: true)
                }

                if let progress, progress.totalCards > 0 {
                    ProgressView(
                        value: Double(progress.ownedCards),
                        total: Double(progress.totalCards)
                    )
                    .tint(progress.completionPercent >= 100 ? .green : .accentColor)

                    HStack {
                        Text("\(progress.ownedCards) of \(progress.totalCards) owned")
                        Spacer()
                        Text("\(progress.completionPercent)%")
                            .fontWeight(.semibold)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct CollectionGuideDetailView: View {
    private enum OwnershipFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case missing = "Missing"
        case owned = "Owned"
        var id: String { rawValue }
    }

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @EnvironmentObject private var wishlistStore: WishlistStore
    @StateObject private var catalogStore = CatalogStore.shared
    @State private var guide: CollectionGuide
    @State private var cards: [Card] = []
    @State private var wishlist: Wishlist?
    @State private var isLoading = true
    @State private var isFollowing = false
    @State private var statusMessage: String?
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var selectedSet = "All sets"
    @State private var ownershipFilter = OwnershipFilter.all
    @State private var catalogInstallGame: TCGGame?
    @State private var catalogRequiresRepair = false
    @State private var showingUnfollowConfirmation = false

    private let apiService = APIService()
    private let onGuideChange: (CollectionGuide) -> Void
    private let columns = [GridItem(.adaptive(minimum: 112, maximum: 170), spacing: 12)]

    init(guide: CollectionGuide, onGuideChange: @escaping (CollectionGuide) -> Void = { _ in }) {
        _guide = State(initialValue: guide)
        self.onGuideChange = onGuideChange
    }

    private var setOptions: [String] {
        ["All sets"] + Set(cards.compactMap(\.setCode)).sorted()
    }

    private var ownedKeys: Set<String> {
        Set((wishlist?.cards ?? []).filter(\.owned).map { "\($0.tcg):\($0.externalId)" })
    }

    private var filteredCards: [Card] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return cards.filter { card in
            let matchesText = query.isEmpty
                || card.name.localizedCaseInsensitiveContains(query)
                || (card.setName?.localizedCaseInsensitiveContains(query) ?? false)
                || (card.collectorNumber?.localizedCaseInsensitiveContains(query) ?? false)
            let matchesSet = selectedSet == "All sets" || card.setCode == selectedSet
            let isOwned = ownedKeys.contains("\(card.tcg):\(card.id)")
            let matchesOwnership = switch ownershipFilter {
            case .all: true
            case .missing: !isOwned
            case .owned: isOwned
            }
            return matchesText && matchesSet && matchesOwnership
        }
    }

    private var activeFilterCount: Int {
        (ownershipFilter == .all ? 0 : 1)
            + (selectedSet == "All sets" ? 0 : 1)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                hero

                if let statusMessage {
                    Label(statusMessage, systemImage: "arrow.triangle.2.circlepath")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let errorMessage, !cards.isEmpty {
                    Text(errorMessage).font(.subheadline).foregroundStyle(.red)
                }

                if let catalogInstallGame {
                    catalogInstallPrompt(for: catalogInstallGame)
                } else {
                    filters
                }

                if isLoading && catalogInstallGame == nil {
                    ProgressView("Loading matching cards…")
                        .frame(maxWidth: .infinity, minHeight: 180)
                } else if let errorMessage, catalogInstallGame == nil, cards.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn’t Load Cards", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("Try Again") { Task { await load() } }
                    }
                    .frame(minHeight: 220)
                } else if catalogInstallGame == nil && filteredCards.isEmpty {
                    ContentUnavailableView(
                        "No Matching Cards",
                        systemImage: "rectangle.stack.badge.minus",
                        description: Text("Try changing the search or filters.")
                    )
                    .frame(minHeight: 220)
                } else {
                    LazyVGrid(columns: columns, spacing: 18) {
                        ForEach(filteredCards) { card in
                            guideCard(card)
                        }
                    }
                }
            }
            .padding()
        }
        .navigationTitle(guide.title)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Search this collection")
        .task { await load() }
        .alert("Unfollow \(guide.title)?", isPresented: $showingUnfollowConfirmation) {
            Button("Unfollow and Delete Wishlist", role: .destructive) {
                Task { await unfollow() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This deletes the guide’s generated wishlist and its saved wishlist cards. Cards in your collection are not affected.")
        }
    }

    private var hero: some View {
        HStack(alignment: .top, spacing: 18) {
            CachedAsyncImage(url: guide.coverImageUrl.flatMap(URL.init(string:))) { phase in
                if case let .success(image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    Rectangle().fill(.quaternary)
                }
            }
            .frame(width: 118, height: 165)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 10) {
                Text(guide.description).font(.subheadline).foregroundStyle(.secondary)
                Text("Curated by \(guide.curatorName)").font(.caption)
                Text("\(cards.isEmpty ? guide.cardCountHint ?? 0 : cards.count) cards")
                    .font(.caption.weight(.semibold))
                Button {
                    if guide.followed {
                        showingUnfollowConfirmation = true
                    } else {
                        Task { await follow() }
                    }
                } label: {
                    Label(
                        guide.followed ? "Unfollow" : "Add to Wishlist",
                        systemImage: guide.followed ? "heart.slash" : "heart.badge.plus"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(guide.followed ? .red : .accentColor)
                .disabled(isFollowing || (!guide.followed && catalogInstallGame != nil))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var filters: some View {
        HStack {
            Menu {
                Picker("Ownership", selection: $ownershipFilter) {
                    ForEach(OwnershipFilter.allCases) { filter in
                        Text(filter.rawValue).tag(filter)
                    }
                }

                Picker("Set", selection: $selectedSet) {
                    ForEach(setOptions, id: \.self) { Text($0).tag($0) }
                }
            } label: {
                AppFilterMenuLabel(
                    kind: .filter,
                    title: "Filters",
                    isActive: activeFilterCount > 0,
                    activeCount: activeFilterCount
                )
            }
            .accessibilityLabel("Guide card filters")

            Spacer()
        }
    }

    private func catalogInstallPrompt(for game: TCGGame) -> some View {
        let isUpdate = catalogStore.isUpdateAvailable(game) || catalogRequiresRepair
        return VStack(spacing: 14) {
            Image(systemName: "square.and.arrow.down")
                .font(.system(size: 42))
                .foregroundStyle(.secondary)
            Text("\(isUpdate ? "Update" : "Install") the \(game.displayName) Catalog")
                .font(.headline)
            Text(isUpdate
                 ? "This guide needs newer collection metadata. Update the catalog to load all matching cards."
                 : "This guide searches the bundled card catalog. Install it once to browse and filter every matching card offline.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button {
                Task { await installCatalog(for: game) }
            } label: {
                if catalogStore.installingGames.contains(game) {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Label("\(isUpdate ? "Update" : "Install") Catalog", systemImage: "square.and.arrow.down")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(catalogStore.installingGames.contains(game))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding()
    }

    private func guideCard(_ card: Card) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            CachedAsyncImage(card: card) { phase in
                if case let .success(image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    Rectangle().fill(.quaternary)
                }
            }
            .aspectRatio(63 / 88, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(alignment: .topTrailing) {
                if ownedKeys.contains("\(card.tcg):\(card.id)") {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.white, .green)
                        .padding(5)
                }
            }
            Text(card.name).font(.caption.weight(.semibold)).lineLimit(1)
            Text([card.setCode, card.collectorNumber].compactMap { $0 }.joined(separator: " · "))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    @MainActor
    private func load() async {
        guard let token = environmentStore.authToken else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            if let game = requiredLocalCatalogGame {
                await catalogStore.refreshManifest()
                if case .notInstalled = catalogStore.installState(for: game) {
                    catalogRequiresRepair = false
                    catalogInstallGame = game
                    cards = []
                    errorMessage = nil
                    return
                }
                if catalogStore.isUpdateAvailable(game) {
                    catalogRequiresRepair = false
                    catalogInstallGame = game
                    cards = []
                    errorMessage = nil
                    return
                }
            }
            cards = try await expandGuide(token: token)
            if let game = requiredLocalCatalogGame,
               guide.rule.type == .tag,
               !catalogStore.hasCollectionTagMetadata(for: game) {
                catalogRequiresRepair = true
                catalogInstallGame = game
                cards = []
                errorMessage = nil
                return
            }
            if let game = requiredLocalCatalogGame,
               cards.isEmpty,
               !catalogStore.isLoaded(game) {
                catalogInstallGame = game
                errorMessage = nil
                return
            }
            catalogRequiresRepair = false
            catalogInstallGame = nil
            if let wishlistId = guide.wishlistId {
                wishlist = try? await apiService.getWishlist(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    id: wishlistId
                )
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var requiredLocalCatalogGame: TCGGame? {
        guard environmentStore.serverConfiguration.isOnDevice,
              guide.rule.type != .manual,
              let game = TCGGame(rawValue: guide.rule.tcg),
              TCGGame.catalogGames.contains(game) else {
            return nil
        }
        return game
    }

    @MainActor
    private func installCatalog(for game: TCGGame) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            await catalogStore.refreshManifest()
            try await catalogStore.install(game, forceReload: catalogRequiresRepair)
            await catalogStore.loadIfNeeded(game)
            guard let token = environmentStore.authToken else { return }
            cards = try await expandGuide(token: token)
            guard !cards.isEmpty else {
                throw APIService.APIError.serverError(
                    status: 503,
                    message: "The \(game.displayName) catalog installed but could not be loaded. Make sure the game is enabled in Settings."
                )
            }
            catalogRequiresRepair = false
            catalogInstallGame = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func expandGuide(token: String) async throws -> [Card] {
        switch guide.rule.type {
        case .artist:
            return try await apiService.searchCardsByArtist(
                config: environmentStore.serverConfiguration,
                token: token,
                artist: guide.rule.query ?? "",
                game: TCGGame(rawValue: guide.rule.tcg) ?? .pokemon
            )
        case .tag:
            return try await apiService.searchCardsByCollectionTag(
                config: environmentStore.serverConfiguration,
                token: token,
                tag: guide.rule.query ?? "",
                game: TCGGame(rawValue: guide.rule.tcg) ?? .pokemon
            )
        case .name:
            return try await apiService.searchAllCards(
                config: environmentStore.serverConfiguration,
                token: token,
                query: guide.rule.query ?? "",
                game: TCGGame(rawValue: guide.rule.tcg) ?? .all,
                includeAllPrintings: guide.rule.includeAllPrintings
            )
        case .set:
            return try await apiService.getSetCards(
                config: environmentStore.serverConfiguration,
                token: token,
                tcg: guide.rule.tcg,
                setCode: guide.rule.setCode ?? ""
            )
        case .manual:
            return try await apiService.getCollectionGuideItems(
                config: environmentStore.serverConfiguration,
                token: token,
                slug: guide.slug
            ).map(\.card)
        }
    }

    @MainActor
    private func follow() async {
        guard let token = environmentStore.authToken else { return }
        isFollowing = true
        statusMessage = "Creating wishlist…"
        defer { isFollowing = false }
        do {
            let response = try await apiService.followCollectionGuide(
                config: environmentStore.serverConfiguration,
                token: token,
                slug: guide.slug
            )
            guide = response.guide
            onGuideChange(guide)
            var followedWishlist = try await apiService.getWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                id: response.wishlistId
            )
            if guide.rule.type == .manual {
                wishlist = followedWishlist
                wishlistStore.insert(followedWishlist)
                statusMessage = "Added \(followedWishlist.totalCards) curated cards to your wishlist."
                return
            }
            let syncService = WishlistSyncService(
                config: environmentStore.serverConfiguration,
                token: token,
                enabledGames: environmentStore.enabledGames
            )
            let result = await syncService.sync(wishlist: followedWishlist) { progress in
                statusMessage = progress
            }
            followedWishlist = try await apiService.getWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                id: response.wishlistId
            )
            wishlist = followedWishlist
            wishlistStore.insert(followedWishlist)
            statusMessage = result.errors.isEmpty
                ? "Added \(result.addedCards) cards to your wishlist."
                : "Added \(result.addedCards) cards; \(result.errors.count) sync issue(s)."
        } catch {
            errorMessage = error.localizedDescription
            statusMessage = nil
        }
    }

    @MainActor
    private func unfollow() async {
        guard let token = environmentStore.authToken,
              let wishlistId = guide.wishlistId else {
            errorMessage = "This guide’s wishlist could not be found. Refresh the guides and try again."
            return
        }
        isFollowing = true
        statusMessage = "Removing guide wishlist…"
        defer { isFollowing = false }
        do {
            try await apiService.deleteWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                id: wishlistId
            )
            wishlistStore.remove(id: wishlistId)
            wishlist = nil
            guide = guide.updatingFollowState(followed: false, wishlistId: nil)
            onGuideChange(guide)
            errorMessage = nil
            statusMessage = "Guide unfollowed."
        } catch {
            errorMessage = error.localizedDescription
            statusMessage = nil
        }
    }
}

#Preview("Collection guide row") {
    CollectionGuideRow(guide: CollectionGuide(
        id: "preview",
        slug: "pokemon-clay-art",
        title: "The Clay Collection",
        description: "English Pokémon cards illustrated by Yuka Morii.",
        tcg: "pokemon",
        category: .artStyle,
        coverImageUrl: nil,
        curatorName: "TCGer",
        tags: ["Clay", "Yuka Morii"],
        version: 1,
        featured: true,
        rule: CollectionGuideRule(type: .artist, tcg: "pokemon", query: "Yuka Morii", setCode: nil, setName: nil, includeAllPrintings: true),
        cardCountHint: 224,
        followed: true,
        wishlistId: "preview-wishlist"
    ), progress: CollectionGuideProgress(
        ownedCards: 73,
        totalCards: 224,
        completionPercent: 33
    ))
    .padding()
}
