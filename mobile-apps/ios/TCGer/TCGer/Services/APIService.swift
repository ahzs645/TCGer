import Foundation

final class APIService {
    enum APIError: Error, LocalizedError {
        case invalidURL
        case unauthorized
        case serverError(status: Int, message: String? = nil)
        case decodingError
        case networkError(Error)

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "The server address appears to be invalid."
            case .unauthorized:
                return "The server rejected your credentials."
            case .serverError(let status, let message):
                if let message, !message.isEmpty {
                    return "Server error (\(status)): \(message)"
                }
                return "Server responded with status code \(status)."
            case .decodingError:
                return "Unexpected response from the server."
            case .networkError(let error):
                return "Network error: \(error.localizedDescription)"
            }
        }
    }

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func makeRequest(
        config: ServerConfiguration,
        path: String,
        queryItems: [URLQueryItem] = [],
        method: String = "GET",
        token: String? = nil,
        body: Encodable? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = config.endpoint(path: path, queryItems: queryItems) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            let encoder = JSONEncoder()
            request.httpBody = try encoder.encode(AnyEncodable(erasing: body))
        }

        return try await execute(request)
    }

    func execute(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.serverError(status: -1, message: nil)
            }
            return (data, httpResponse)
        } catch {
            throw APIError.networkError(error)
        }
    }

    func parseServerMessage(from data: Data) -> String? {
        guard !data.isEmpty else { return nil }

        if let json = try? JSONSerialization.jsonObject(with: data, options: []),
           let dict = json as? [String: Any] {
            if let message = dict["message"] as? String, !message.isEmpty {
                return message
            }
            if let error = dict["error"] as? String, !error.isEmpty {
                return error
            }
        }

        let fallback = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return fallback?.isEmpty == false ? fallback : nil
    }
}

private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(erasing value: Encodable) {
        self.encodeClosure = { encoder in
            try value.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}

@MainActor
final class LocalStore {
    static let shared = LocalStore()

    private let persistenceRepository: LocalStorePersistenceRepository
    private(set) var persistenceFailure: LocalStorePersistenceFailure?
    /// The exact domain snapshot represented by the most recent successful
    /// repository write (or load). Failed writes restore this snapshot so the
    /// process never continues from state that would disappear on relaunch.
    private var lastDurableState: PersistedState?

    private enum Constants {
        static let userId = "local-user"
        static let token = "local-device-token"
        static let unsortedBinderId = "__library__"
        /// Prefix for every record created by the optional sample collection.
        static let samplePrefix = "sample-"
        /// Sample ids written by builds that seeded phone-only mode automatically.
        static let legacySampleIds: Set<String> = [
            "demo-binder-1", "demo-binder-2",
            "demo-cc-1", "demo-cc-2", "demo-cc-3", "demo-cc-4",
            "demo-wishlist-1", "demo-wishlist-2",
            "demo-wc-1", "demo-wc-2", "demo-wc-3", "demo-wc-4",
            "demo-si-1", "demo-si-2", "demo-si-3",
            "demo-txn-1", "demo-txn-2", "demo-txn-3", "demo-txn-4", "demo-txn-5"
        ]
    }

    private var user: User
    private var preferences: APIService.UserPreferences
    private var appSettings: AppSettings
    private var tags: [CollectionCardTag]
    private var collections: [Collection]
    private var binderPages: [SavedBinderPage]
    private var searchCatalog: [Card]
    private var printGroups: [String: [Card]]
    private var nextBinderId: Int
    private var nextCollectionCardId: Int
    private var nextCopyId: Int
    private var nextTagId: Int
    private var wishlists: [Wishlist]
    private var sealedProducts: [SealedProduct]
    private var sealedInventory: [SealedInventoryItem]
    private var onlineCodes: [OnlineCode]
    private var transactions: [Transaction]
    private var nextWishlistId: Int
    private var nextWishlistRuleId: Int
    private var nextTransactionId: Int
    private var nextOnlineCodeId: Int

    /// True once the user has explicitly asked for the sample collection.
    /// Phone-only mode is a real, empty collection until they do.
    private(set) var sampleDataLoaded: Bool

    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    init(persistenceRepository: LocalStorePersistenceRepository? = nil) {
        self.persistenceRepository = persistenceRepository ?? FileLocalStorePersistenceRepository()
        self.persistenceFailure = nil
        self.lastDurableState = nil
        self.preferences = APIService.UserPreferences(
            showCardNumbers: true,
            showPricing: true,
            enabledYugioh: true,
            enabledMagic: true,
            enabledPokemon: true,
            enabledOnepiece: false,
            enabledLorcana: false,
            enabledDragonball: false,
            defaultGame: nil,
            focusedSetOrder: [],
            setCompletionMode: SetCompletionMode.standard.rawValue
        )
        self.user = User(
            id: Constants.userId,
            email: "",
            name: "This Phone",
            username: "This Phone",
            isAdmin: false,
            showCardNumbers: true,
            showPricing: true,
            enabledYugioh: true,
            enabledMagic: true,
            enabledPokemon: true,
            enabledOnepiece: false,
            enabledLorcana: false,
            enabledDragonball: false,
            defaultGame: nil
        )
        self.appSettings = AppSettings(
            id: 0,
            publicDashboard: true,
            publicCollections: true,
            requireAuth: false,
            appName: "TCGer",
            updatedAt: LocalStore.isoFormatter.string(from: Date())
        )
        self.tags = LocalStore.starterTags
        self.collections = []
        self.binderPages = []
        self.searchCatalog = []
        self.printGroups = [:]
        self.nextBinderId = 1
        self.nextCollectionCardId = 100
        self.nextCopyId = 1000
        self.nextTagId = 4
        self.nextWishlistId = 1
        self.nextWishlistRuleId = 1
        self.nextTransactionId = 1
        self.nextOnlineCodeId = 1
        self.wishlists = []
        self.sealedProducts = []
        self.sealedInventory = []
        self.onlineCodes = []
        self.transactions = []
        self.sampleDataLoaded = false
        seedBaseline()
        lastDurableState = persistedState()
        loadPersistedState()
    }

    // MARK: - Persistence
    //
    // Phone-only mode keeps everything the user creates on-device. A fresh
    // install starts with an empty library — sample content is opt-in via
    // `loadSampleData()` — and every change is snapshotted to disk so nothing
    // is lost when the app is relaunched.

    private struct PersistedState: Codable {
        var collections: [Collection]
        var binderPages: [SavedBinderPage]?
        var tags: [CollectionCardTag]
        var wishlists: [Wishlist]
        var sealedInventory: [SealedInventoryItem]
        /// Absent in stores written before online-code tracking shipped.
        var onlineCodes: [OnlineCode]?
        var transactions: [Transaction]
        var nextBinderId: Int
        var nextCollectionCardId: Int
        var nextCopyId: Int
        var nextTagId: Int
        var nextWishlistId: Int
        /// Absent in stores written before smart wishlists shipped.
        var nextWishlistRuleId: Int?
        var nextTransactionId: Int
        var nextOnlineCodeId: Int?
        var user: User?
        var preferences: APIService.UserPreferences?
        var appSettings: AppSettings?
        /// Absent in stores written before sample data became opt-in; those
        /// stores were seeded automatically, so they are treated as loaded.
        var sampleDataLoaded: Bool?
    }

    private func loadPersistedState() {
        do {
            guard let data = try persistenceRepository.load() else { return }
            let state = try JSONDecoder().decode(PersistedState.self, from: data)
            applyPersistedState(state)
            lastDurableState = persistedState()
            persistenceFailure = nil
        } catch {
            recordPersistenceFailure(error, operation: .load)
        }
    }

    private func applyPersistedState(_ state: PersistedState) {
        collections = state.collections
        binderPages = state.binderPages ?? []
        tags = state.tags
        wishlists = state.wishlists
        sealedInventory = state.sealedInventory
        onlineCodes = state.onlineCodes ?? []
        transactions = state.transactions
        nextBinderId = state.nextBinderId
        nextCollectionCardId = state.nextCollectionCardId
        nextCopyId = state.nextCopyId
        nextTagId = state.nextTagId
        nextWishlistId = state.nextWishlistId
        nextWishlistRuleId = state.nextWishlistRuleId ?? 1
        nextTransactionId = state.nextTransactionId
        nextOnlineCodeId = state.nextOnlineCodeId ?? 1
        sampleDataLoaded = state.sampleDataLoaded ?? true
        if let preferences = state.preferences { self.preferences = preferences }

        // The identity and app name persisted by older builds described a demo
        // account ("Demo User" / "TCGer Demo"); phone-only mode has no account,
        // so the neutral local defaults always win.
        if let user = state.user, !LocalStore.isLegacyDemoUser(user) {
            self.user = user
        }
        if let appSettings = state.appSettings, appSettings.appName != "TCGer Demo" {
            self.appSettings = appSettings
        }

        if !collections.contains(where: { $0.id == Constants.unsortedBinderId }) {
            collections.append(LocalStore.makeUnsortedLibrary())
        }

        if sampleDataLoaded {
            seedSampleCatalog()
            seedSampleBinderPages()
            seedSampleOnlineCodes()
        }
    }

    private func persistedState() -> PersistedState {
        PersistedState(
            collections: collections,
            binderPages: binderPages,
            tags: tags,
            wishlists: wishlists,
            sealedInventory: sealedInventory,
            onlineCodes: onlineCodes,
            transactions: transactions,
            nextBinderId: nextBinderId,
            nextCollectionCardId: nextCollectionCardId,
            nextCopyId: nextCopyId,
            nextTagId: nextTagId,
            nextWishlistId: nextWishlistId,
            nextWishlistRuleId: nextWishlistRuleId,
            nextTransactionId: nextTransactionId,
            nextOnlineCodeId: nextOnlineCodeId,
            user: user,
            preferences: preferences,
            appSettings: appSettings,
            sampleDataLoaded: sampleDataLoaded
        )
    }

    private func encodedPersistedState(_ state: PersistedState) throws -> Data {
        try JSONEncoder().encode(state)
    }

    @discardableResult
    private func persist() -> Bool {
        let candidate = persistedState()
        do {
            try persistenceRepository.save(try encodedPersistedState(candidate))
            lastDurableState = candidate
            persistenceFailure = nil
            return true
        } catch {
            if let lastDurableState {
                applyPersistedState(lastDurableState)
            }
            recordPersistenceFailure(error, operation: .save)
            return false
        }
    }

    /// Call immediately after a nonthrowing LocalStore mutation when its
    /// public caller already has a throwing contract (all APIService writes
    /// do). This prevents the API layer from returning an object that was
    /// rolled back after a failed disk write.
    func requireLatestMutationPersisted() throws {
        guard let failure = persistenceFailure, failure.operation == .save else { return }
        throw LocalStorePersistenceError.saveFailed(failure.message)
    }

    private func persistOrThrow() throws {
        guard persist() else {
            try requireLatestMutationPersisted()
            throw LocalStorePersistenceError.saveFailed("Unknown local persistence failure.")
        }
    }

    private func recordPersistenceFailure(
        _ error: Error,
        operation: LocalStorePersistenceFailure.Operation
    ) {
        let failure = LocalStorePersistenceFailure(
            operation: operation,
            message: (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        )
        persistenceFailure = failure
        NotificationCenter.default.post(
            name: .localStorePersistenceFailed,
            object: self,
            userInfo: ["failure": failure]
        )
    }

    /// Snapshots are newest-first and can be presented by Settings without
    /// exposing repository internals.
    func availableLocalBackups() throws -> [URL] {
        try persistenceRepository.availableBackups()
    }

    /// Creates an explicit recovery point without changing the active library.
    @discardableResult
    func createLocalBackup() throws -> URL {
        try persistenceRepository.createBackup(try encodedPersistedState(persistedState()))
    }

    func removeLocalBackup(at url: URL) throws {
        try persistenceRepository.removeBackup(at: url)
    }

    /// Validates the selected snapshot before atomically making it current.
    /// The pre-restore current state is rotated into the backup set by `save`.
    func restoreLocalBackup(from url: URL) throws {
        do {
            let data = try persistenceRepository.loadBackup(at: url)
            let state = try JSONDecoder().decode(PersistedState.self, from: data)
            try persistenceRepository.save(data)
            applyPersistedState(state)
            lastDurableState = persistedState()
            persistenceFailure = nil
        } catch {
            recordPersistenceFailure(error, operation: .restore)
            throw error
        }
    }

    private static func isLegacyDemoUser(_ user: User) -> Bool {
        user.id == "demo-user-001" || user.email == "demo@tcger.app"
    }

    /// Erase the active phone data while retaining the bounded recovery chain.
    func resetLocalData() {
        collections = []
        binderPages = []
        wishlists = []
        sealedInventory = []
        onlineCodes = []
        transactions = []
        tags = LocalStore.starterTags
        searchCatalog = []
        printGroups = [:]
        nextBinderId = 1
        nextCollectionCardId = 100
        nextCopyId = 1000
        nextTagId = 4
        nextWishlistId = 1
        nextWishlistRuleId = 1
        nextTransactionId = 1
        nextOnlineCodeId = 1
        sampleDataLoaded = false
        seedBaseline()
        persist()
    }

    func authenticate(username: String? = nil, email: String? = nil) -> AuthResponse {
        let resolvedEmail = email?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedUsername = username?.trimmingCharacters(in: .whitespacesAndNewlines)

        user = User(
            id: user.id,
            email: (resolvedEmail?.isEmpty == false) ? resolvedEmail! : user.email,
            name: resolvedUsername ?? user.name,
            username: (resolvedUsername?.isEmpty == false) ? resolvedUsername : user.username,
            isAdmin: false,
            showCardNumbers: preferences.showCardNumbers,
            showPricing: preferences.showPricing,
            enabledYugioh: preferences.enabledYugioh,
            enabledMagic: preferences.enabledMagic,
            enabledPokemon: preferences.enabledPokemon,
            enabledOnepiece: preferences.enabledOnepiece,
            enabledLorcana: preferences.enabledLorcana,
            enabledDragonball: preferences.enabledDragonball,
            defaultGame: preferences.defaultGame
        )
        persist()
        return AuthResponse(user: user, token: Constants.token)
    }

    func checkSetupRequired() -> SetupCheckResponse {
        SetupCheckResponse(setupRequired: false)
    }

    func getSettings() -> AppSettings {
        appSettings
    }

    func updateSettings(
        publicDashboard: Bool?,
        publicCollections: Bool?,
        requireAuth: Bool?,
        appName: String?
    ) -> AppSettings {
        appSettings = AppSettings(
            id: appSettings.id,
            publicDashboard: publicDashboard ?? appSettings.publicDashboard,
            publicCollections: publicCollections ?? appSettings.publicCollections,
            requireAuth: requireAuth ?? appSettings.requireAuth,
            appName: appName ?? appSettings.appName,
            updatedAt: LocalStore.isoFormatter.string(from: Date())
        )
        persist()
        return appSettings
    }

    func getUserPreferences() -> APIService.UserPreferences {
        preferences
    }

    func updateUserPreferences(
        showCardNumbers: Bool?,
        showPricing: Bool?,
        enabledYugioh: Bool?,
        enabledMagic: Bool?,
        enabledPokemon: Bool?,
        enabledOnepiece: Bool?,
        enabledLorcana: Bool?,
        enabledDragonball: Bool?,
        defaultGame: String??,
        focusedSetOrder: [String]?,
        setCompletionMode: String?
    ) -> APIService.UserPreferences {
        preferences = APIService.UserPreferences(
            showCardNumbers: showCardNumbers ?? preferences.showCardNumbers,
            showPricing: showPricing ?? preferences.showPricing,
            enabledYugioh: enabledYugioh ?? preferences.enabledYugioh,
            enabledMagic: enabledMagic ?? preferences.enabledMagic,
            enabledPokemon: enabledPokemon ?? preferences.enabledPokemon,
            enabledOnepiece: enabledOnepiece ?? preferences.enabledOnepiece,
            enabledLorcana: enabledLorcana ?? preferences.enabledLorcana,
            enabledDragonball: enabledDragonball ?? preferences.enabledDragonball,
            defaultGame: defaultGame ?? preferences.defaultGame,
            focusedSetOrder: focusedSetOrder ?? preferences.focusedSetOrder,
            setCompletionMode: setCompletionMode ?? preferences.setCompletionMode
        )
        user = User(
            id: user.id,
            email: user.email,
            name: user.name,
            username: user.username,
            isAdmin: user.isAdmin,
            showCardNumbers: preferences.showCardNumbers,
            showPricing: preferences.showPricing,
            enabledYugioh: preferences.enabledYugioh,
            enabledMagic: preferences.enabledMagic,
            enabledPokemon: preferences.enabledPokemon,
            enabledOnepiece: preferences.enabledOnepiece,
            enabledLorcana: preferences.enabledLorcana,
            enabledDragonball: preferences.enabledDragonball,
            defaultGame: preferences.defaultGame
        )
        persist()
        return preferences
    }

    func getUserProfile() -> APIService.UserProfile {
        APIService.UserProfile(
            id: user.id,
            email: user.email,
            username: user.username,
            isAdmin: user.isAdmin,
            showCardNumbers: preferences.showCardNumbers,
            showPricing: preferences.showPricing,
            createdAt: LocalStore.isoFormatter.string(from: Date())
        )
    }

    func updateUserProfile(username: String?, email: String?) -> APIService.UpdatedProfile {
        let trimmedEmail = email?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedUsername = username?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedEmail = (trimmedEmail?.isEmpty == false) ? (trimmedEmail ?? user.email) : user.email
        let resolvedUsername = (trimmedUsername?.isEmpty == false) ? trimmedUsername : user.username

        user = User(
            id: user.id,
            email: resolvedEmail,
            name: resolvedUsername ?? user.name,
            username: resolvedUsername,
            isAdmin: user.isAdmin,
            showCardNumbers: preferences.showCardNumbers,
            showPricing: preferences.showPricing,
            enabledYugioh: preferences.enabledYugioh,
            enabledMagic: preferences.enabledMagic,
            enabledPokemon: preferences.enabledPokemon,
            enabledOnepiece: preferences.enabledOnepiece,
            enabledLorcana: preferences.enabledLorcana,
            enabledDragonball: preferences.enabledDragonball,
            defaultGame: preferences.defaultGame
        )

        persist()
        return APIService.UpdatedProfile(
            id: user.id,
            email: user.email,
            username: user.username,
            isAdmin: user.isAdmin,
            showCardNumbers: preferences.showCardNumbers,
            showPricing: preferences.showPricing
        )
    }

    func changePassword(currentPassword _: String, newPassword _: String) {
        // No-op: phone-only mode has no account to hold a password.
    }

    func searchCards(query: String, game: TCGGame) -> CardSearchResponse {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return CardSearchResponse(cards: [], total: 0)
        }

        let store = CatalogStore.shared
        let entries = store.search(query: trimmed, tcg: game, limit: 200)
        return searchCards(query: trimmed, game: game, catalogEntries: entries)
    }

    func searchCardsAsync(query: String, game: TCGGame) async -> CardSearchResponse {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return CardSearchResponse(cards: [], total: 0)
        }
        let entries = await CatalogStore.shared.searchAsync(
            query: trimmed,
            tcg: game,
            limit: 200
        )
        return searchCards(query: trimmed, game: game, catalogEntries: entries)
    }

    private func searchCards(
        query: String,
        game: TCGGame,
        catalogEntries: [CatalogEntry]
    ) -> CardSearchResponse {
        let store = CatalogStore.shared
        var base = catalogEntries.map(store.card(from:))
        base.append(contentsOf: searchCatalog.filter { card in
            guard gameMatches(card.tcg, requested: game),
                  !store.isLoaded(TCGGame(rawValue: card.tcg) ?? .all) else {
                return false
            }
            return cardMatchesSearch(card, query: query)
        })

        let owned = ownedCatalogCards().filter { card in
            gameMatches(card.tcg, requested: game) && cardMatchesSearch(card, query: query)
        }
        let results = Array(catalogCards(base: base, owned: owned).prefix(200))

        return CardSearchResponse(cards: results, total: results.count)
    }

    private func ownedCatalogCards() -> [Card] {
        var result: [Card] = []
        var seenIds: Set<String> = []
        for collection in collections {
            for cc in collection.cards {
                let id = cc.externalId ?? cc.cardId
                guard !seenIds.contains(id) else { continue }
                seenIds.insert(id)
                result.append(
                    Card(
                        id: id,
                        name: cc.name,
                        tcg: cc.tcg,
                        setCode: cc.setCode,
                        setName: cc.setName,
                        rarity: cc.rarity,
                        imageUrl: cc.imageUrl,
                        imageUrlSmall: cc.imageUrlSmall,
                        price: cc.price,
                        collectorNumber: cc.collectorNumber,
                        releasedAt: nil
                    )
                )
            }
        }
        return result
    }

    func getSets(tcg: String?) -> [TcgSet] {
        let store = CatalogStore.shared
        let requestedGames: [TCGGame]
        if let tcg, let game = TCGGame(rawValue: tcg) {
            requestedGames = [game]
        } else {
            requestedGames = TCGGame.allCases.filter { game in
                game != .all && store.isEnabled(game)
            }
        }

        var setsByID: [String: TcgSet] = [:]
        for game in requestedGames {
            if store.isLoaded(game) {
                for set in store.sets(tcg: game) {
                    let mapped = store.tcgSet(from: set, tcg: game)
                    setsByID[mapped.id] = mapped
                }
            } else if TCGGame.catalogGames.contains(game) {
                addCardSets(
                    from: searchCatalog.filter { $0.tcg == game.rawValue },
                    to: &setsByID,
                    preserveExisting: true
                )
            }
        }

        addCardSets(
            from: ownedCatalogCards().filter { card in
                requestedGames.contains { $0.rawValue == card.tcg }
            },
            to: &setsByID,
            preserveExisting: true
        )
        return setsByID.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func getSetCards(tcg: String, setCode: String) -> [Card] {
        guard let game = TCGGame(rawValue: tcg), CatalogStore.shared.isEnabled(game) else {
            return []
        }
        let store = CatalogStore.shared
        let base: [Card]
        if store.isLoaded(game) {
            base = store.cards(inSet: setCode, tcg: game).map(store.card(from:))
        } else if TCGGame.catalogGames.contains(game) {
            base = searchCatalog.filter { $0.tcg == tcg && $0.setCode == setCode }
        } else {
            base = []
        }
        let owned = ownedCatalogCards().filter { $0.tcg == tcg && $0.setCode == setCode }
        return catalogCards(base: base, owned: owned)
    }

    private func gameMatches(_ cardTCG: String, requested game: TCGGame) -> Bool {
        guard let cardGame = TCGGame(rawValue: cardTCG),
              CatalogStore.shared.isEnabled(cardGame) else {
            return false
        }
        return game == .all || cardGame == game
    }

    private func cardMatchesSearch(_ card: Card, query: String) -> Bool {
        let queryKey = SearchTextNormalizer.key(query)
        return SearchTextNormalizer.contains(card.name, queryKey: queryKey)
            || SearchTextNormalizer.contains(card.setName, queryKey: queryKey)
            || SearchTextNormalizer.contains(card.setCode, queryKey: queryKey)
            || SearchTextNormalizer.contains(card.collectorNumber, queryKey: queryKey)
    }

    /// Merge a catalog slice with local collection cards. Catalog order is the
    /// base, while an owned card with the same external id replaces that row.
    private func catalogCards(base: [Card], owned: [Card]) -> [Card] {
        var result = base
        var indexByID = Dictionary(
            base.enumerated().map { ($1.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        for card in owned {
            if let index = indexByID[card.id] {
                result[index] = card
            } else {
                indexByID[card.id] = result.count
                result.append(card)
            }
        }
        return result
    }

    private func addCardSets(
        from cards: [Card],
        to setsByID: inout [String: TcgSet],
        preserveExisting: Bool
    ) {
        let grouped = Dictionary(grouping: cards) { card in
            "\(card.tcg)-\(card.setCode ?? "")"
        }
        for cards in grouped.values {
            guard let first = cards.first,
                  let code = first.setCode,
                  !code.isEmpty else {
                continue
            }
            let set = TcgSet(
                code: code,
                name: first.setName ?? code,
                tcg: first.tcg,
                releaseDate: nil,
                totalCards: cards.count,
                standardCards: nil,
                iconUrl: first.setSymbolUrl,
                logoUrl: first.setLogoUrl
            )
            if !preserveExisting || setsByID[set.id] == nil {
                setsByID[set.id] = set
            }
        }
    }

    func exportCollections(format: String) -> Data {
        if format.lowercased() == "csv" {
            return exportCollectionsCSV()
        }
        return (try? JSONEncoder().encode(collections)) ?? Data("[]".utf8)
    }

    private func exportCollectionsCSV() -> Data {
        func escape(_ value: String?) -> String {
            let raw = value ?? ""
            guard raw.contains(",") || raw.contains("\"") || raw.contains("\n") else {
                return raw
            }
            return "\"" + raw.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }

        func money(_ value: Double?) -> String {
            value.map { String(format: "%.2f", $0) } ?? ""
        }

        // Phone-only mode has no server backup, so the export doubles as one:
        // emit the server's import-template columns, one row per group of
        // identical copies, so the file can be imported back here (or into a
        // server) without losing per-copy detail.
        var rows = [
            [
                "tcg", "external_id", "card_name", "collector_number", "set_code", "set_name",
                "rarity", "binder_name", "quantity", "condition", "language", "notes",
                "price", "acquisition_price", "is_foil", "finish_code", "is_signed",
                "is_altered", "tags"
            ].joined(separator: ",")
        ]

        for collection in collections {
            let binderName = collection.isUnsortedBinder ? "" : collection.name
            for card in collection.cards {
                let copies = card.copies
                guard !copies.isEmpty else {
                    rows.append(
                        [
                            card.tcg,
                            card.externalId ?? card.cardId,
                            card.name,
                            card.collectorNumber ?? "",
                            card.setCode ?? "",
                            card.setName ?? "",
                            card.rarity ?? "",
                            binderName,
                            String(card.quantity),
                            card.condition ?? "",
                            card.language ?? "",
                            card.notes ?? "",
                            money(card.price),
                            "", "false", "", "false", "false", ""
                        ].map(escape).joined(separator: ",")
                    )
                    continue
                }

                let grouped = Dictionary(grouping: copies) { copy in
                    [
                        copy.condition ?? "",
                        copy.language ?? "",
                        copy.finishCode ?? "",
                        copy.notes ?? "",
                        money(copy.acquisitionPrice),
                        (copy.isSigned ?? false) ? "1" : "0",
                        (copy.isAltered ?? false) ? "1" : "0",
                        copy.tags.map(\.label).sorted().joined(separator: ";")
                    ].joined(separator: "|")
                }

                for group in grouped.values.sorted(by: { ($0.first?.id ?? "") < ($1.first?.id ?? "") }) {
                    guard let sample = group.first else { continue }
                    rows.append(
                        [
                            card.tcg,
                            card.externalId ?? card.cardId,
                            card.name,
                            card.collectorNumber ?? "",
                            card.setCode ?? "",
                            card.setName ?? "",
                            card.rarity ?? "",
                            binderName,
                            String(group.count),
                            sample.condition ?? card.condition ?? "",
                            sample.language ?? card.language ?? "",
                            sample.notes ?? card.notes ?? "",
                            money(sample.price ?? card.price),
                            money(sample.acquisitionPrice),
                            (sample.isFoil ?? false) ? "true" : "false",
                            sample.finishCode ?? "",
                            (sample.isSigned ?? false) ? "true" : "false",
                            (sample.isAltered ?? false) ? "true" : "false",
                            sample.tags.map(\.label).joined(separator: ";")
                        ].map(escape).joined(separator: ",")
                    )
                }
            }
        }

        return Data(rows.joined(separator: "\n").utf8)
    }

    // MARK: - CSV Import
    //
    // With a server the backend parses and resolves the upload; phone-only mode
    // runs the same two-step (preview, then commit) locally so importing works
    // with no network at all.

    func previewImport(
        csv: String,
        options: APIService.CollectionImportOptions
    ) -> APIService.CollectionImportPreview {
        let parsed = CollectionCSVImporter.parse(csv: csv)
        return APIService.CollectionImportPreview(
            valid: parsed.valid,
            rows: parsed.rows.map(\.row),
            issues: parsed.issues,
            sourceRows: parsed.sourceRows,
            totalCopies: parsed.totalCopies
        )
    }

    func commitImport(
        csv: String,
        options: APIService.CollectionImportOptions
    ) -> APIService.CollectionImportResult {
        let parsed = CollectionCSVImporter.parse(csv: csv)
        let previewRows = parsed.rows.map(\.row)

        guard parsed.valid else {
            return APIService.CollectionImportResult(
                valid: false,
                rows: previewRows,
                issues: parsed.issues,
                sourceRows: parsed.sourceRows,
                totalCopies: parsed.totalCopies,
                importedRows: 0,
                importedCopies: 0,
                createdBinders: []
            )
        }

        var issues = parsed.issues
        var createdBinders: [String] = []
        var importedRows = 0
        var importedCopies = 0
        let stateBeforeImport = persistedState()

        for item in parsed.rows {
            let binderId = resolveImportBinder(
                named: item.binderName,
                options: options,
                createdBinders: &createdBinders
            )
            let (tagIds, newTags) = resolveImportTags(item.tags)

            do {
                try addCardToBinderInMemory(
                    binderId: binderId,
                    cardId: item.card.id,
                    quantity: item.row.quantity,
                    condition: item.row.condition,
                    language: item.row.language,
                    notes: item.row.notes,
                    price: item.row.price,
                    acquisitionPrice: item.row.acquisitionPrice,
                    variant: CardCopyVariant(
                        finishCode: item.finishCode,
                        finishLabel: nil,
                        edition: nil,
                        stamp: nil,
                        isSealedPromo: false,
                        isOversized: false,
                        isPeelOff: false
                    ),
                    isSigned: item.row.isSigned,
                    isAltered: item.row.isAltered,
                    tagIds: tagIds,
                    newTags: newTags,
                    card: item.card
                )
                importedRows += 1
                importedCopies += item.row.quantity
            } catch {
                // An import is a single transaction. Restore every collection,
                // tag, id counter, and copy changed by earlier rows before
                // reporting the row that caused the transaction to abort.
                applyPersistedState(stateBeforeImport)
                issues.append(
                    APIService.CollectionImportIssue(
                        row: item.row.row,
                        field: nil,
                        message: "Could not import \(item.row.cardName): \(error.localizedDescription)"
                    )
                )
                return APIService.CollectionImportResult(
                    valid: false,
                    rows: previewRows,
                    issues: issues,
                    sourceRows: parsed.sourceRows,
                    totalCopies: parsed.totalCopies,
                    importedRows: 0,
                    importedCopies: 0,
                    createdBinders: []
                )
            }
        }

        // All imported rows, newly-created binders, and newly-created tags are
        // persisted together. `persist` restores the last durable snapshot if
        // this one repository write fails.
        guard persist() else {
            issues.append(
                APIService.CollectionImportIssue(
                    row: 0,
                    field: nil,
                    message: persistenceFailure?.message ?? "The import could not be saved."
                )
            )
            return APIService.CollectionImportResult(
                valid: false,
                rows: previewRows,
                issues: issues,
                sourceRows: parsed.sourceRows,
                totalCopies: parsed.totalCopies,
                importedRows: 0,
                importedCopies: 0,
                createdBinders: []
            )
        }

        return APIService.CollectionImportResult(
            valid: issues.isEmpty,
            rows: previewRows,
            issues: issues,
            sourceRows: parsed.sourceRows,
            totalCopies: parsed.totalCopies,
            importedRows: importedRows,
            importedCopies: importedCopies,
            createdBinders: createdBinders
        )
    }

    /// A named binder wins when it already exists (or may be created); anything
    /// else lands in the chosen default binder, falling back to the library.
    private func resolveImportBinder(
        named name: String?,
        options: APIService.CollectionImportOptions,
        createdBinders: inout [String]
    ) -> String {
        if let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty {
            if let existing = collections.first(where: {
                $0.name.caseInsensitiveCompare(trimmed) == .orderedSame
            }) {
                return existing.id
            }
            if options.createMissingBinders {
                let created = createCollectionInMemory(name: trimmed, description: nil, colorHex: nil)
                createdBinders.append(created.name)
                return created.id
            }
        }

        if let defaultBinderId = options.defaultBinderId,
           collections.contains(where: { $0.id == defaultBinderId }) {
            return defaultBinderId
        }

        return Constants.unsortedBinderId
    }

    private func resolveImportTags(
        _ labels: [String]
    ) -> ([String]?, [APIService.TagPayload]?) {
        guard !labels.isEmpty else { return (nil, nil) }

        var ids: [String] = []
        var created: [APIService.TagPayload] = []
        for label in labels {
            if let existing = tags.first(where: { $0.label.caseInsensitiveCompare(label) == .orderedSame }) {
                ids.append(existing.id)
            } else {
                created.append(APIService.TagPayload(label: label, colorHex: nil))
            }
        }

        return (ids.isEmpty ? nil : ids, created.isEmpty ? nil : created)
    }

    func getCardPrints(tcg: String, cardId: String) -> [Card] {
        if let grouped = printGroups[cardId] {
            return grouped
        }

        if let game = TCGGame(rawValue: tcg),
           let entry = CatalogStore.shared.entry(id: cardId) {
            let exactName = SearchTextNormalizer.key(entry.card.name)
            return CatalogStore.shared
                .search(query: entry.card.name, tcg: game, limit: 500)
                .filter { SearchTextNormalizer.key($0.card.name) == exactName }
                .map(CatalogStore.shared.card(from:))
        }

        if let card = searchCatalog.first(where: { $0.id == cardId || $0.tcg == tcg && $0.id == cardId }) {
            return [card]
        }

        return []
    }

    func getCollections() -> [Collection] {
        collections
    }

    func getCollection(id: String) throws -> Collection {
        guard let collection = collections.first(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "Collection not found")
        }
        return collection
    }

    func createCollection(
        name: String,
        description: String?,
        colorHex: String?,
        defaultCondition: String? = nil,
        containerType: String? = nil,
        imageUrl: String? = nil,
        associatedTcg: String? = nil,
        associatedSetCode: String? = nil,
        associatedSetName: String? = nil
    ) -> Collection {
        let collection = createCollectionInMemory(
            name: name,
            description: description,
            colorHex: colorHex,
            defaultCondition: defaultCondition,
            containerType: containerType,
            imageUrl: imageUrl,
            associatedTcg: associatedTcg,
            associatedSetCode: associatedSetCode,
            associatedSetName: associatedSetName
        )
        persist()
        return collection
    }

    private func createCollectionInMemory(
        name: String,
        description: String?,
        colorHex: String?,
        defaultCondition: String? = nil,
        containerType: String? = nil,
        imageUrl: String? = nil,
        associatedTcg: String? = nil,
        associatedSetCode: String? = nil,
        associatedSetName: String? = nil
    ) -> Collection {
        let now = LocalStore.isoFormatter.string(from: Date())
        let collection = Collection(
            id: "local-binder-\(nextBinderId)",
            name: name,
            description: description,
            cards: [],
            createdAt: now,
            updatedAt: now,
            colorHex: colorHex ?? "4a90e2",
            defaultCondition: defaultCondition,
            containerType: containerType,
            imageUrl: imageUrl,
            associatedTcg: associatedTcg,
            associatedSetCode: associatedSetCode,
            associatedSetName: associatedSetName
        )
        nextBinderId += 1
        collections.append(collection)
        return collection
    }

    func updateCollection(
        id: String,
        name: String?,
        description: String?,
        colorHex: String?,
        defaultCondition: String? = nil,
        containerType: String? = nil,
        imageUrl: String? = nil,
        associatedTcg: String? = nil,
        associatedSetCode: String? = nil,
        associatedSetName: String? = nil
    ) throws -> Collection {
        guard id != Constants.unsortedBinderId else {
            throw APIService.APIError.serverError(status: 400, message: "The Unsorted Library cannot be edited")
        }
        guard let index = collections.firstIndex(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "Collection not found")
        }
        let existing = collections[index]
        // Matches the server contract: nil leaves the default condition
        // unchanged, an empty string clears it.
        let resolvedDefaultCondition: String?
        if let defaultCondition {
            resolvedDefaultCondition = defaultCondition.isEmpty ? nil : defaultCondition
        } else {
            resolvedDefaultCondition = existing.defaultCondition
        }
        let updated = Collection(
            id: existing.id,
            name: name ?? existing.name,
            description: description ?? existing.description,
            cards: existing.cards,
            createdAt: existing.createdAt,
            updatedAt: LocalStore.isoFormatter.string(from: Date()),
            colorHex: colorHex ?? existing.colorHex,
            defaultCondition: resolvedDefaultCondition,
            containerType: containerType,
            imageUrl: imageUrl,
            associatedTcg: associatedTcg,
            associatedSetCode: associatedSetCode,
            associatedSetName: associatedSetName
        )
        collections[index] = updated
        try persistOrThrow()
        return updated
    }

    func deleteCollection(id: String) throws {
        guard id != Constants.unsortedBinderId else {
            throw APIService.APIError.serverError(status: 400, message: "Cannot delete library binder")
        }
        guard let index = collections.firstIndex(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "Collection not found")
        }
        let removedImageURLs = binderPages
            .filter { $0.binderId == id }
            .compactMap(\.imageUrl)
        collections.remove(at: index)
        binderPages.removeAll { $0.binderId == id }
        try persistOrThrow()
        removedImageURLs.forEach(removeLocalBinderPageImage(at:))
    }

    func getBinderPages(binderId: String) -> [SavedBinderPage] {
        binderPages
            .filter { $0.binderId == binderId }
            .sorted { $0.pageNumber < $1.pageNumber }
    }

    func upsertBinderPage(
        binderId: String,
        pageNumber: Int,
        capturedAt: Date,
        placements: [BinderPagePlacement]
    ) -> SavedBinderPage {
        let timestamp = LocalStore.isoFormatter.string(from: Date())
        let captured = LocalStore.isoFormatter.string(from: capturedAt)
        let existingIndex = binderPages.firstIndex {
            $0.binderId == binderId && $0.pageNumber == pageNumber
        }
        let existing = existingIndex.map { binderPages[$0] }
        let page = SavedBinderPage(
            id: existing?.id ?? "local-page-\(UUID().uuidString)",
            binderId: binderId,
            pageNumber: pageNumber,
            revision: (existing?.revision ?? 0) + 1,
            capturedAt: captured,
            imageUrl: existing?.imageUrl,
            placements: placements,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp
        )
        if let existingIndex {
            binderPages[existingIndex] = page
        } else {
            binderPages.append(page)
        }
        persist()
        return page
    }

    func replaceBinderPageImage(
        binderId: String,
        pageNumber: Int,
        imageData: Data
    ) throws -> SavedBinderPage {
        guard let index = binderPages.firstIndex(where: {
            $0.binderId == binderId && $0.pageNumber == pageNumber
        }) else {
            throw APIService.APIError.serverError(status: 404, message: "Binder page not found")
        }
        guard let directory = Self.binderPageImageDirectory else {
            throw APIService.APIError.serverError(status: 500, message: "Image storage unavailable")
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("\(UUID().uuidString).jpg")
        try imageData.write(to: url, options: [.atomic])
        let existing = binderPages[index]
        let page = SavedBinderPage(
            id: existing.id,
            binderId: existing.binderId,
            pageNumber: existing.pageNumber,
            revision: existing.revision,
            capturedAt: existing.capturedAt,
            imageUrl: url.absoluteString,
            placements: existing.placements,
            createdAt: existing.createdAt,
            updatedAt: LocalStore.isoFormatter.string(from: Date())
        )
        binderPages[index] = page
        do {
            try persistOrThrow()
            removeLocalBinderPageImage(at: existing.imageUrl)
        } catch {
            removeLocalBinderPageImage(at: url.absoluteString)
            throw error
        }
        return page
    }

    func removeBinderPageImage(binderId: String, pageNumber: Int) {
        guard let index = binderPages.firstIndex(where: {
            $0.binderId == binderId && $0.pageNumber == pageNumber
        }) else { return }
        let existing = binderPages[index]
        binderPages[index] = SavedBinderPage(
            id: existing.id,
            binderId: existing.binderId,
            pageNumber: existing.pageNumber,
            revision: existing.revision,
            capturedAt: existing.capturedAt,
            imageUrl: nil,
            placements: existing.placements,
            createdAt: existing.createdAt,
            updatedAt: LocalStore.isoFormatter.string(from: Date())
        )
        if persist() {
            removeLocalBinderPageImage(at: existing.imageUrl)
        }
    }

    private static var binderPageImageDirectory: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("BinderPageImages", isDirectory: true)
    }

    private func removeLocalBinderPageImage(at value: String?) {
        guard let value, let url = URL(string: value), url.isFileURL else { return }
        try? FileManager.default.removeItem(at: url)
    }

    func getTags() -> [CollectionCardTag] {
        tags
    }

    func createTag(label: String, colorHex: String?) -> CollectionCardTag {
        let newTag = createTagInMemory(label: label, colorHex: colorHex)
        persist()
        return newTag
    }

    private func createTagInMemory(label: String, colorHex: String?) -> CollectionCardTag {
        let newTag = CollectionCardTag(
            id: "local-tag-\(nextTagId)",
            label: label,
            colorHex: colorHex ?? "cccccc"
        )
        nextTagId += 1
        tags.append(newTag)
        return newTag
    }

    func addCardToBinder(
        binderId: String,
        cardId: String,
        quantity: Int,
        condition: String?,
        language: String?,
        notes: String?,
        price: Double?,
        acquisitionPrice: Double?,
        variant: CardCopyVariant = .empty,
        isSigned: Bool?,
        isAltered: Bool?,
        gradingCompany: String? = nil,
        gradingScore: String? = nil,
        certNumber: String? = nil,
        storageLocation: String? = nil,
        tagIds: [String]?,
        newTags: [APIService.TagPayload]?,
        card: Card?
    ) throws {
        try addCardToBinderInMemory(
            binderId: binderId,
            cardId: cardId,
            quantity: quantity,
            condition: condition,
            language: language,
            notes: notes,
            price: price,
            acquisitionPrice: acquisitionPrice,
            variant: variant,
            isSigned: isSigned,
            isAltered: isAltered,
            gradingCompany: gradingCompany,
            gradingScore: gradingScore,
            certNumber: certNumber,
            storageLocation: storageLocation,
            tagIds: tagIds,
            newTags: newTags,
            card: card
        )
        try persistOrThrow()
    }

    private func addCardToBinderInMemory(
        binderId: String,
        cardId: String,
        quantity: Int,
        condition: String?,
        language: String?,
        notes: String?,
        price: Double?,
        acquisitionPrice: Double?,
        variant: CardCopyVariant = .empty,
        isSigned: Bool?,
        isAltered: Bool?,
        gradingCompany: String? = nil,
        gradingScore: String? = nil,
        certNumber: String? = nil,
        storageLocation: String? = nil,
        tagIds: [String]?,
        newTags: [APIService.TagPayload]?,
        card: Card?
    ) throws {
        let resolvedBinderId = binderId == Constants.unsortedBinderId ? Constants.unsortedBinderId : binderId
        guard let binderIndex = collections.firstIndex(where: { $0.id == resolvedBinderId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Binder not found")
        }

        let preparedNewTags = (newTags ?? []).map { payload in
            createTagInMemory(label: payload.label, colorHex: payload.colorHex)
        }
        let selectedTags = tags.filter { tagIds?.contains($0.id) == true } + preparedNewTags
        let resolvedCard = card ?? searchCatalog.first(where: { $0.id == cardId }) ?? placeholderCard(id: cardId)
        let qty = max(1, quantity)

        let binder = collections[binderIndex]
        // Mirrors the server: an omitted condition falls back to the binder's
        // default before landing as unspecified.
        let condition = condition ?? binder.defaultCondition
        var binderCards = binder.cards
        if let existingIndex = binderCards.firstIndex(where: { $0.cardId == resolvedCard.id }) {
            var existing = binderCards[existingIndex]
            let newCopies = makeCopies(
                quantity: qty,
                condition: condition ?? existing.condition,
                language: language ?? existing.language,
                notes: notes ?? existing.notes,
                price: price ?? existing.price,
                acquisitionPrice: acquisitionPrice,
                variant: variant,
                isSigned: isSigned,
                isAltered: isAltered,
                tags: selectedTags,
                gradingCompany: gradingCompany,
                gradingScore: gradingScore,
                certNumber: certNumber,
                storageLocation: storageLocation
            )
            let allCopies = existing.copies + newCopies
            existing = CollectionCard(
                id: existing.id,
                cardId: existing.cardId,
                externalId: existing.externalId,
                name: existing.name,
                tcg: existing.tcg,
                setCode: existing.setCode,
                setName: existing.setName,
                rarity: existing.rarity,
                imageUrl: existing.imageUrl,
                imageUrlSmall: existing.imageUrlSmall,
                quantity: allCopies.count,
                price: price ?? existing.price,
                condition: condition ?? existing.condition,
                language: language ?? existing.language,
                notes: notes ?? existing.notes,
                collectorNumber: existing.collectorNumber,
                copies: allCopies
            )
            binderCards[existingIndex] = existing
        } else {
            let newCard = CollectionCard(
                id: "local-cc-\(nextCollectionCardId)",
                cardId: resolvedCard.id,
                externalId: resolvedCard.id,
                name: resolvedCard.name,
                tcg: resolvedCard.tcg,
                setCode: resolvedCard.setCode,
                setName: resolvedCard.setName,
                rarity: resolvedCard.rarity,
                imageUrl: resolvedCard.imageUrl,
                imageUrlSmall: resolvedCard.imageUrlSmall,
                quantity: qty,
                price: price ?? resolvedCard.price,
                condition: condition,
                language: language,
                notes: notes,
                collectorNumber: resolvedCard.collectorNumber,
                copies: makeCopies(
                    quantity: qty,
                    condition: condition,
                    language: language,
                    notes: notes,
                    price: price ?? resolvedCard.price,
                    acquisitionPrice: acquisitionPrice,
                    variant: variant,
                    isSigned: isSigned,
                    isAltered: isAltered,
                    tags: selectedTags,
                    gradingCompany: gradingCompany,
                    gradingScore: gradingScore,
                    certNumber: certNumber,
                    storageLocation: storageLocation
                )
            )
            nextCollectionCardId += 1
            binderCards.append(newCard)
        }

        collections[binderIndex] = stampUpdatedAt(binder, cards: binderCards)
    }

    func updateCardInBinder(
        binderId: String,
        collectionCardOrCopyId: String,
        quantity: Int?,
        condition: String?,
        language: String?,
        notes: String?,
        acquisitionPrice: Double?,
        acquiredAt: String?,
        variant: CardCopyVariant?,
        isSigned: Bool?,
        isAltered: Bool?,
        gradingCompany: String?,
        gradingScore: String?,
        certNumber: String?,
        storageLocation: String?,
        includeOwnedCopyDetails: Bool,
        includeAcquisitionDetails: Bool,
        tagIds: [String]?,
        newTags: [APIService.TagPayload]?,
        newPrint: Card?,
        targetBinderId: String?
    ) throws -> CollectionCard {
        guard let sourceBinderIndex = collections.firstIndex(where: { $0.id == binderId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Binder not found")
        }

        let sourceBinder = collections[sourceBinderIndex]
        var sourceCards = sourceBinder.cards
        guard let sourceCardIndex = sourceCards.firstIndex(where: {
            $0.id == collectionCardOrCopyId || $0.copies.contains(where: { $0.id == collectionCardOrCopyId })
        }) else {
            throw APIService.APIError.serverError(status: 404, message: "Card not found")
        }

        var sourceCard = sourceCards[sourceCardIndex]
        let targetCopyId = sourceCard.copies.contains(where: { $0.id == collectionCardOrCopyId }) ? collectionCardOrCopyId : nil

        if let destinationId = targetBinderId, destinationId != binderId {
            guard let destinationIndex = collections.firstIndex(where: { $0.id == destinationId }) else {
                throw APIService.APIError.serverError(status: 404, message: "Destination binder not found")
            }

            let destinationBinder = collections[destinationIndex]
            var destinationCards = destinationBinder.cards
            let movingCopies: [CollectionCardCopy]

            if let targetCopyId {
                movingCopies = sourceCard.copies.filter { $0.id == targetCopyId }
                sourceCard = replaceCard(sourceCard, copies: sourceCard.copies.filter { $0.id != targetCopyId })
            } else {
                movingCopies = sourceCard.copies
                sourceCard = replaceCard(sourceCard, copies: [])
            }

            sourceCards[sourceCardIndex] = sourceCard
            sourceCards.removeAll { $0.quantity <= 0 }

            if let destinationCardIndex = destinationCards.firstIndex(where: { $0.cardId == sourceCard.cardId }) {
                let existing = destinationCards[destinationCardIndex]
                let mergedCopies = existing.copies + movingCopies
                destinationCards[destinationCardIndex] = replaceCard(existing, copies: mergedCopies)
            } else {
                let movedCard = CollectionCard(
                    id: "local-cc-\(nextCollectionCardId)",
                    cardId: sourceCard.cardId,
                    externalId: sourceCard.externalId,
                    name: sourceCard.name,
                    tcg: sourceCard.tcg,
                    setCode: sourceCard.setCode,
                    setName: sourceCard.setName,
                    rarity: sourceCard.rarity,
                    imageUrl: sourceCard.imageUrl,
                    imageUrlSmall: sourceCard.imageUrlSmall,
                    quantity: movingCopies.count,
                    price: sourceCard.price,
                    condition: sourceCard.condition,
                    language: sourceCard.language,
                    notes: sourceCard.notes,
                    collectorNumber: sourceCard.collectorNumber,
                    copies: movingCopies
                )
                nextCollectionCardId += 1
                destinationCards.append(movedCard)
            }

            collections[sourceBinderIndex] = stampUpdatedAt(sourceBinder, cards: sourceCards)
            collections[destinationIndex] = stampUpdatedAt(destinationBinder, cards: destinationCards)

            guard let updatedDestination = destinationCards.first(where: { $0.cardId == sourceCard.cardId }) else {
                throw APIService.APIError.serverError(status: 500, message: "Failed to move card")
            }
            try persistOrThrow()
            return updatedDestination
        }

        let createdTags = (newTags ?? []).map { payload in
            createTag(label: payload.label, colorHex: payload.colorHex)
        }
        let selectedTags = tags.filter { tagIds?.contains($0.id) == true } + createdTags

        var updatedCopies = sourceCard.copies
        if let qty = quantity {
            let normalized = max(1, qty)
            if normalized > updatedCopies.count {
                let template = updatedCopies.last ?? makeCopies(
                    quantity: 1,
                    condition: sourceCard.condition,
                    language: sourceCard.language,
                    notes: sourceCard.notes,
                    price: sourceCard.price,
                    acquisitionPrice: nil,
                    tags: selectedTags
                ).first!
                let needed = normalized - updatedCopies.count
                for _ in 0..<needed {
                    updatedCopies.append(
                        CollectionCardCopy(
                            id: "local-copy-\(nextCopyId)",
                            condition: template.condition,
                            language: template.language,
                            notes: template.notes,
                            price: template.price,
                            acquisitionPrice: template.acquisitionPrice,
                            serialNumber: template.serialNumber,
                            acquiredAt: template.acquiredAt,
                            isFoil: template.isFoil,
                            finishCode: template.finishCode,
                            finishLabel: template.finishLabel,
                            edition: template.edition,
                            stamp: template.stamp,
                            isSealedPromo: template.isSealedPromo,
                            isOversized: template.isOversized,
                            isPeelOff: template.isPeelOff,
                            isSigned: template.isSigned,
                            isAltered: template.isAltered,
                            imageUrls: template.imageUrls,
                            gradingCompany: template.gradingCompany,
                            gradingScore: template.gradingScore,
                            certNumber: template.certNumber,
                            storageLocation: template.storageLocation,
                            tags: template.tags
                        )
                    )
                    nextCopyId += 1
                }
            } else if normalized < updatedCopies.count {
                updatedCopies = Array(updatedCopies.prefix(normalized))
            }
        }

        if condition != nil ||
            language != nil ||
            notes != nil ||
            includeAcquisitionDetails ||
            variant != nil ||
            isSigned != nil ||
            isAltered != nil ||
            includeOwnedCopyDetails ||
            !selectedTags.isEmpty {
            updatedCopies = updatedCopies.map { copy in
                guard targetCopyId == nil || copy.id == targetCopyId else {
                    return copy
                }
                return CollectionCardCopy(
                    id: copy.id,
                    condition: condition ?? copy.condition,
                    language: language ?? copy.language,
                    notes: notes ?? copy.notes,
                    price: copy.price,
                    acquisitionPrice: includeAcquisitionDetails ? acquisitionPrice : copy.acquisitionPrice,
                    serialNumber: copy.serialNumber,
                    acquiredAt: includeAcquisitionDetails ? acquiredAt : copy.acquiredAt,
                    isFoil: variant?.isFoil ?? copy.isFoil,
                    finishCode: variant == nil ? copy.finishCode : variant?.finishCode,
                    finishLabel: variant == nil ? copy.finishLabel : variant?.finishLabel,
                    edition: variant == nil ? copy.edition : variant?.edition,
                    stamp: variant == nil ? copy.stamp : variant?.stamp,
                    isSealedPromo: variant?.isSealedPromo ?? copy.isSealedPromo,
                    isOversized: variant?.isOversized ?? copy.isOversized,
                    isPeelOff: variant?.isPeelOff ?? copy.isPeelOff,
                    isSigned: isSigned ?? copy.isSigned,
                    isAltered: isAltered ?? copy.isAltered,
                    imageUrls: copy.imageUrls,
                    gradingCompany: includeOwnedCopyDetails ? gradingCompany : copy.gradingCompany,
                    gradingScore: includeOwnedCopyDetails ? gradingScore : copy.gradingScore,
                    certNumber: includeOwnedCopyDetails ? certNumber : copy.certNumber,
                    storageLocation: includeOwnedCopyDetails ? storageLocation : copy.storageLocation,
                    tags: selectedTags.isEmpty ? copy.tags : selectedTags
                )
            }
        }

        var updatedCard = replaceCard(sourceCard, copies: updatedCopies)
        if let newPrint {
            updatedCard = CollectionCard(
                id: updatedCard.id,
                cardId: newPrint.id,
                externalId: newPrint.id,
                name: newPrint.name,
                tcg: newPrint.tcg,
                setCode: newPrint.setCode,
                setName: newPrint.setName,
                rarity: newPrint.rarity,
                imageUrl: newPrint.imageUrl,
                imageUrlSmall: newPrint.imageUrlSmall,
                quantity: updatedCard.quantity,
                price: newPrint.price ?? updatedCard.price,
                condition: updatedCard.condition,
                language: updatedCard.language,
                notes: updatedCard.notes,
                collectorNumber: newPrint.collectorNumber,
                copies: updatedCard.copies
            )
        }

        sourceCards[sourceCardIndex] = updatedCard
        collections[sourceBinderIndex] = stampUpdatedAt(sourceBinder, cards: sourceCards)
        try persistOrThrow()
        return updatedCard
    }

    func deleteCardFromBinder(binderId: String, collectionCardOrCopyId: String) throws {
        guard let binderIndex = collections.firstIndex(where: { $0.id == binderId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Binder not found")
        }

        let binder = collections[binderIndex]
        var binderCards = binder.cards
        guard let cardIndex = binderCards.firstIndex(where: {
            $0.id == collectionCardOrCopyId || $0.copies.contains(where: { $0.id == collectionCardOrCopyId })
        }) else {
            throw APIService.APIError.serverError(status: 404, message: "Card not found")
        }

        var card = binderCards[cardIndex]
        if card.id != collectionCardOrCopyId {
            card = replaceCard(card, copies: card.copies.filter { $0.id != collectionCardOrCopyId })
            if card.quantity > 0 {
                binderCards[cardIndex] = card
            } else {
                binderCards.remove(at: cardIndex)
            }
        } else {
            binderCards.remove(at: cardIndex)
        }

        collections[binderIndex] = stampUpdatedAt(binder, cards: binderCards)
        try persistOrThrow()
    }

    private static func cardBack(for tcg: String) -> String? {
        switch tcg {
        case "pokemon": return "PokemonCardBack"
        case "magic": return "MagicCardBack"
        case "yugioh": return "YugiohCardBack"
        case "onepiece": return "OnePieceCardBack"
        case "lorcana": return "LorcanaCardBack"
        case "dragonball": return "DragonBallCardBack"
        default: return nil
        }
    }

    // MARK: - Baseline Content
    //
    // Present in every phone-only install: the library binder that holds loose
    // cards, a few starter tags, and the bundled sealed product catalog. None
    // of this is sample content.

    private static let starterTags: [CollectionCardTag] = [
        CollectionCardTag(id: "local-tag-1", label: "For Trade", colorHex: "4caf50"),
        CollectionCardTag(id: "local-tag-2", label: "PC", colorHex: "2196f3"),
        CollectionCardTag(id: "local-tag-3", label: "Needs Grading", colorHex: "ff9800")
    ]

    private static func makeUnsortedLibrary() -> Collection {
        let now = LocalStore.isoFormatter.string(from: Date())
        return Collection(
            id: Constants.unsortedBinderId,
            name: "Unsorted Library",
            description: "Cards not yet assigned to a binder",
            cards: [],
            createdAt: now,
            updatedAt: now,
            colorHex: "9e9e9e"
        )
    }

    private func seedBaseline() {
        collections = [LocalStore.makeUnsortedLibrary()]
        sealedProducts = LocalStore.bundledSealedProducts()
    }

    // MARK: - Sample Content
    //
    // Optional starter content for trying the app out. It only exists once the
    // user asks for it, and removing it leaves everything they added alone.

    var isSampleDataLoaded: Bool { sampleDataLoaded }

    func loadSampleData() {
        guard !sampleDataLoaded else { return }
        seedSampleCatalog()
        seedSampleCollections()
        seedSampleBinderPages()
        seedSampleWishlistsAndFinance()
        seedSampleOnlineCodes()
        sampleDataLoaded = true
        persist()
    }

    /// Take the sample content back out, leaving anything the user added in
    /// place — including their own cards inside a sample binder.
    func removeSampleData() {
        for page in binderPages where LocalStore.isSampleId(page.id) || LocalStore.isSampleId(page.binderId) {
            removeLocalBinderPageImage(at: page.imageUrl)
        }
        binderPages.removeAll {
            LocalStore.isSampleId($0.id) || LocalStore.isSampleId($0.binderId)
        }

        collections = collections.compactMap { collection -> Collection? in
            let remaining = collection.cards.filter { !LocalStore.isSampleId($0.id) }
            if remaining.isEmpty, LocalStore.isSampleId(collection.id) {
                return nil
            }
            guard remaining.count != collection.cards.count else { return collection }
            return stampUpdatedAt(collection, cards: remaining)
        }

        wishlists.removeAll { LocalStore.isSampleId($0.id) }
        wishlists = wishlists.map { wishlist -> Wishlist in
            let remaining = wishlist.cards.filter { !LocalStore.isSampleId($0.id) }
            guard remaining.count != wishlist.cards.count else { return wishlist }
            return Wishlist(
                id: wishlist.id,
                name: wishlist.name,
                description: wishlist.description,
                colorHex: wishlist.colorHex,
                cards: remaining,
                totalCards: remaining.count,
                ownedCards: remaining.filter { $0.owned }.count,
                completionPercent: remaining.isEmpty ? 0 : Int((Double(remaining.filter { $0.owned }.count) / Double(remaining.count)) * 100),
                createdAt: wishlist.createdAt,
                updatedAt: LocalStore.isoFormatter.string(from: Date()),
                rules: wishlist.rules,
                matchAnyPrinting: wishlist.matchAnyPrinting
            )
        }

        sealedInventory.removeAll { LocalStore.isSampleId($0.id) }
        onlineCodes.removeAll { LocalStore.isSampleId($0.id) }
        transactions.removeAll { LocalStore.isSampleId($0.id) }
        searchCatalog = []
        printGroups = [:]
        sampleDataLoaded = false
        persist()
    }

    /// Sample records carry a reserved id prefix. The explicit legacy list
    /// covers stores written by builds that seeded phone-only mode on launch.
    private static func isSampleId(_ id: String) -> Bool {
        id.hasPrefix(Constants.samplePrefix) || Constants.legacySampleIds.contains(id)
    }

    /// Starter tags that still exist, matched by label so a sample card never
    /// references a tag the user has since deleted.
    private func existingTags(labeled labels: [String]) -> [CollectionCardTag] {
        tags.filter { labels.contains($0.label) }
    }

    /// The seven cards the sample content is built from. They are rebuilt on
    /// every launch (they are catalog data, not user data) so sample cards keep
    /// showing up in search and print pickers after a relaunch.
    private struct SampleCards {
        let pikaBase: Card
        let pikaSurging: Card
        let charizard: Card
        let boltM10: Card
        let bolt2xm: Card
        let blackLotus: Card
        let blueEyes: Card

        var all: [Card] {
            [pikaBase, pikaSurging, charizard, boltM10, bolt2xm, blackLotus, blueEyes]
        }

        var printGroups: [String: [Card]] {
            [
                pikaBase.id: [pikaBase, pikaSurging],
                pikaSurging.id: [pikaBase, pikaSurging],
                boltM10.id: [boltM10, bolt2xm],
                bolt2xm.id: [boltM10, bolt2xm]
            ]
        }
    }

    private static func makeSampleCards() -> SampleCards {
        let pikaBase = Card(
            id: "sample-pokemon-pikachu-base",
            name: "Pikachu",
            tcg: "pokemon",
            setCode: "CEL",
            setName: "Celebrations",
            rarity: "Rare",
            imageUrl: LocalStore.cardBack(for: "pokemon"),
            imageUrlSmall: LocalStore.cardBack(for: "pokemon"),
            price: 6.75,
            collectorNumber: "005",
            releasedAt: nil,
            supertype: "Pokémon",
            subtypes: ["Basic"],
            types: ["Lightning"],
            attributes: ["tcgplayer_id": .string("250303")]
        )
        let pikaSurging = Card(
            id: "sample-pokemon-pikachu-surging",
            name: "Pikachu ex",
            tcg: "pokemon",
            setCode: "SV08",
            setName: "Surging Sparks",
            rarity: "Special Illustration Rare",
            imageUrl: LocalStore.cardBack(for: "pokemon"),
            imageUrlSmall: LocalStore.cardBack(for: "pokemon"),
            price: 19.25,
            collectorNumber: "238",
            releasedAt: nil,
            supertype: "Pokémon",
            subtypes: ["Basic"],
            types: ["Lightning"],
            attributes: ["tcgplayer_id": .string("590027")]
        )
        let charizard = Card(
            id: "sample-pokemon-charizard",
            name: "Charizard ex",
            tcg: "pokemon",
            setCode: "PAF",
            setName: "Paldean Fates",
            rarity: "Ultra Rare",
            imageUrl: LocalStore.cardBack(for: "pokemon"),
            imageUrlSmall: LocalStore.cardBack(for: "pokemon"),
            price: 33.40,
            collectorNumber: "54",
            releasedAt: nil,
            supertype: "Pokémon",
            subtypes: ["Stage 2", "ex"],
            types: ["Fire"],
            attributes: ["tcgplayer_id": .string("534416")]
        )
        let boltM10 = Card(
            id: "sample-magic-lightning-bolt-m10",
            name: "Lightning Bolt",
            tcg: "magic",
            setCode: "M10",
            setName: "Magic 2010",
            rarity: "Common",
            imageUrl: LocalStore.cardBack(for: "magic"),
            imageUrlSmall: LocalStore.cardBack(for: "magic"),
            price: 2.10,
            collectorNumber: "146",
            releasedAt: nil,
            attributes: [
                "scryfall_id": .string("435589bb-27c6-4a6d-9d63-394d5092b9d8"),
                "tcgplayer_id": .string("32656")
            ]
        )
        let bolt2xm = Card(
            id: "sample-magic-lightning-bolt-2xm",
            name: "Lightning Bolt",
            tcg: "magic",
            setCode: "2X2",
            setName: "Double Masters 2022",
            rarity: "Uncommon",
            imageUrl: LocalStore.cardBack(for: "magic"),
            imageUrlSmall: LocalStore.cardBack(for: "magic"),
            price: 3.75,
            collectorNumber: "117",
            releasedAt: nil,
            attributes: [
                "scryfall_id": .string("f29ba16f-c8fb-42fe-aabf-87089cb214a7"),
                "tcgplayer_id": .string("276484")
            ]
        )
        let blackLotus = Card(
            id: "sample-magic-black-lotus",
            name: "Black Lotus",
            tcg: "magic",
            setCode: "LEA",
            setName: "Limited Edition Alpha",
            rarity: "Rare",
            imageUrl: LocalStore.cardBack(for: "magic"),
            imageUrlSmall: LocalStore.cardBack(for: "magic"),
            price: 25000,
            collectorNumber: "233",
            releasedAt: nil,
            attributes: [
                "scryfall_id": .string("b0faa7f2-b547-42c4-a810-839da50dadfe"),
                "tcgplayer_id": .string("1042")
            ]
        )
        let blueEyes = Card(
            id: "sample-ygo-blue-eyes",
            name: "Blue-Eyes White Dragon",
            tcg: "yugioh",
            setCode: "SDK",
            setName: "Starter Deck: Kaiba",
            rarity: "Ultra Rare",
            imageUrl: LocalStore.cardBack(for: "yugioh"),
            imageUrlSmall: LocalStore.cardBack(for: "yugioh"),
            price: 18.50,
            collectorNumber: nil,
            releasedAt: nil,
            attributes: ["tcgplayer_id": .string("22796")]
        )

        return SampleCards(
            pikaBase: pikaBase,
            pikaSurging: pikaSurging,
            charizard: charizard,
            boltM10: boltM10,
            bolt2xm: bolt2xm,
            blackLotus: blackLotus,
            blueEyes: blueEyes
        )
    }

    static func makeSampleBinderPage(timestamp: String) -> SavedBinderPage {
        let cards = makeSampleCards()
        let pocketCards = [
            cards.charizard,
            cards.pikaBase,
            cards.pikaSurging,
            cards.boltM10,
            cards.blackLotus,
            cards.bolt2xm,
            cards.blueEyes,
            cards.charizard,
            cards.pikaBase
        ]

        let placements = pocketCards.enumerated().map { slotIndex, card in
            let column = slotIndex % 3
            let row = slotIndex / 3
            let left = 0.045 + (Double(column) * 0.311)
            let right = left + 0.288
            let top = 0.973 - (Double(row) * 0.320)
            let bottom = top - 0.306

            return BinderPagePlacement(
                slotIndex: slotIndex,
                cardId: card.id,
                name: card.name,
                tcg: card.tcg,
                setCode: card.setCode,
                confidence: 0.99,
                status: "matched",
                quad: BinderPageQuad(
                    topLeft: BinderPagePoint(x: left, y: top),
                    topRight: BinderPagePoint(x: right, y: top),
                    bottomRight: BinderPagePoint(x: right, y: bottom),
                    bottomLeft: BinderPagePoint(x: left, y: bottom)
                )
            )
        }

        return SavedBinderPage(
            id: "sample-binder-page-1",
            binderId: "sample-binder-1",
            pageNumber: 1,
            revision: 1,
            capturedAt: timestamp,
            imageUrl: nil,
            placements: placements,
            createdAt: timestamp,
            updatedAt: timestamp
        )
    }

    private func seedSampleBinderPages() {
        guard !binderPages.contains(where: {
            $0.binderId == "sample-binder-1" && $0.pageNumber == 1
        }) else { return }

        let timestamp = LocalStore.isoFormatter.string(from: Date())
        binderPages.append(LocalStore.makeSampleBinderPage(timestamp: timestamp))
    }

    /// Make the sample cards searchable without touching stored collections.
    private func seedSampleCatalog() {
        let cards = LocalStore.makeSampleCards()
        searchCatalog = cards.all
        printGroups = cards.printGroups
    }

    private func seedSampleCollections() {
        let cards = LocalStore.makeSampleCards()
        let charizard = cards.charizard
        let boltM10 = cards.boltM10
        let blueEyes = cards.blueEyes
        let pikaBase = cards.pikaBase
        let now = LocalStore.isoFormatter.string(from: Date())

        func sampleCollectionCard(
            id: String,
            card: Card,
            quantity: Int,
            condition: String = CardCondition.nearMint.rawValue,
            notes: String? = nil,
            acquisitionPrice: Double? = nil,
            variant: CardCopyVariant = .empty,
            gradingCompany: String? = nil,
            gradingScore: String? = nil,
            certNumber: String? = nil,
            storageLocation: String? = nil,
            tagLabels: [String] = []
        ) -> CollectionCard {
            var collectionCard = CollectionCard(
                id: id,
                cardId: card.id,
                externalId: card.id,
                name: card.name,
                tcg: card.tcg,
                setCode: card.setCode,
                setName: card.setName,
                rarity: card.rarity,
                imageUrl: LocalStore.cardBack(for: card.tcg),
                imageUrlSmall: LocalStore.cardBack(for: card.tcg),
                quantity: quantity,
                price: card.price,
                condition: condition,
                language: "English",
                notes: notes,
                collectorNumber: card.collectorNumber,
                copies: makeCopies(
                    quantity: quantity,
                    condition: condition,
                    language: "English",
                    notes: notes,
                    price: card.price,
                    acquisitionPrice: acquisitionPrice,
                    variant: variant,
                    tags: existingTags(labeled: tagLabels),
                    gradingCompany: gradingCompany,
                    gradingScore: gradingScore,
                    certNumber: certNumber,
                    storageLocation: storageLocation
                )
            )
            collectionCard.attributes = card.attributes
            return collectionCard
        }

        let starterCards: [CollectionCard] = [
            sampleCollectionCard(
                id: "sample-cc-1",
                card: charizard,
                quantity: 2,
                notes: "Pulled from pack",
                acquisitionPrice: 8.99,
                gradingCompany: "PSA",
                gradingScore: "10",
                certNumber: "TCGER-DEMO-0001",
                storageLocation: "Display case · Shelf A",
                tagLabels: ["PC"]
            ),
            sampleCollectionCard(
                id: "sample-cc-2",
                card: boltM10,
                quantity: 1,
                condition: "Excellent",
                acquisitionPrice: 1.25,
                variant: CardCopyVariant(
                    finishCode: "foil",
                    finishLabel: "Foil",
                    edition: nil,
                    stamp: nil,
                    isSealedPromo: false,
                    isOversized: false,
                    isPeelOff: false
                ),
                storageLocation: "Trade binder · Page 2",
                tagLabels: ["For Trade"]
            ),
            sampleCollectionCard(id: "sample-cc-5", card: pikaBase, quantity: 2),
            sampleCollectionCard(id: "sample-cc-6", card: cards.pikaSurging, quantity: 1),
            sampleCollectionCard(id: "sample-cc-7", card: cards.blackLotus, quantity: 1),
            sampleCollectionCard(id: "sample-cc-8", card: cards.bolt2xm, quantity: 1),
            sampleCollectionCard(id: "sample-cc-9", card: blueEyes, quantity: 1)
        ]

        collections.append(contentsOf: [
            Collection(
                id: "sample-binder-1",
                name: "Favorites Binder",
                description: "Showcase cards and personal favorites",
                cards: starterCards,
                createdAt: now,
                updatedAt: now,
                colorHex: "7c4dff",
                defaultCondition: CardCondition.nearMint.rawValue,
                containerType: "9-pocket zip binder",
                imageUrl: LocalStore.cardBack(for: "pokemon"),
                associatedTcg: "pokemon",
                associatedSetCode: "PAF",
                associatedSetName: "Paldean Fates"
            ),
            Collection(
                id: "sample-binder-2",
                name: "Trade Binder",
                description: "Cards available for trade",
                cards: [
                    CollectionCard(
                        id: "sample-cc-3",
                        cardId: blueEyes.id,
                        externalId: blueEyes.id,
                        name: blueEyes.name,
                        tcg: blueEyes.tcg,
                        setCode: blueEyes.setCode,
                        setName: blueEyes.setName,
                        rarity: blueEyes.rarity,
                        imageUrl: LocalStore.cardBack(for: blueEyes.tcg),
                        imageUrlSmall: LocalStore.cardBack(for: blueEyes.tcg),
                        quantity: 1,
                        price: blueEyes.price,
                        condition: "Good",
                        language: "English",
                        notes: "Light edge wear",
                        collectorNumber: nil,
                        copies: makeCopies(
                            quantity: 1,
                            condition: "Good",
                            language: "English",
                            notes: "Light edge wear",
                            price: blueEyes.price,
                            acquisitionPrice: 4.50,
                            tags: existingTags(labeled: ["For Trade", "Needs Grading"])
                        )
                    )
                ],
                createdAt: now,
                updatedAt: now,
                colorHex: "26a69a",
                defaultCondition: "Excellent",
                containerType: "Trade binder",
                imageUrl: LocalStore.cardBack(for: "yugioh"),
                associatedTcg: "yugioh"
            )
        ])

        let libraryCard = CollectionCard(
            id: "sample-cc-4",
            cardId: pikaBase.id,
            externalId: pikaBase.id,
            name: pikaBase.name,
            tcg: pikaBase.tcg,
            setCode: pikaBase.setCode,
            setName: pikaBase.setName,
            rarity: pikaBase.rarity,
            imageUrl: LocalStore.cardBack(for: pikaBase.tcg),
            imageUrlSmall: LocalStore.cardBack(for: pikaBase.tcg),
            quantity: 2,
            price: pikaBase.price,
            condition: CardCondition.nearMint.rawValue,
            language: "English",
            notes: nil,
            collectorNumber: pikaBase.collectorNumber,
            copies: makeCopies(
                quantity: 2,
                condition: CardCondition.nearMint.rawValue,
                language: "English",
                notes: nil,
                price: pikaBase.price,
                acquisitionPrice: 1.75,
                tags: []
            )
        )

        if let libraryIndex = collections.firstIndex(where: { $0.id == Constants.unsortedBinderId }) {
            let library = collections[libraryIndex]
            collections[libraryIndex] = stampUpdatedAt(library, cards: library.cards + [libraryCard])
        } else {
            collections.append(
                stampUpdatedAt(LocalStore.makeUnsortedLibrary(), cards: [libraryCard])
            )
        }
    }

    private func makeCopies(
        quantity: Int,
        condition: String?,
        language: String?,
        notes: String?,
        price: Double?,
        acquisitionPrice: Double?,
        variant: CardCopyVariant = .empty,
        isSigned: Bool? = nil,
        isAltered: Bool? = nil,
        tags: [CollectionCardTag],
        gradingCompany: String? = nil,
        gradingScore: String? = nil,
        certNumber: String? = nil,
        storageLocation: String? = nil
    ) -> [CollectionCardCopy] {
        let now = LocalStore.isoFormatter.string(from: Date())
        let count = max(1, quantity)
        var copies: [CollectionCardCopy] = []
        copies.reserveCapacity(count)
        for _ in 0..<count {
            copies.append(
                CollectionCardCopy(
                    id: "local-copy-\(nextCopyId)",
                    condition: condition,
                    language: language,
                    notes: notes,
                    price: price,
                    acquisitionPrice: acquisitionPrice,
                    serialNumber: nil,
                    acquiredAt: now,
                    isFoil: variant.isFoil,
                    finishCode: variant.finishCode,
                    finishLabel: variant.finishLabel,
                    edition: variant.edition,
                    stamp: variant.stamp,
                    isSealedPromo: variant.isSealedPromo,
                    isOversized: variant.isOversized,
                    isPeelOff: variant.isPeelOff,
                    isSigned: isSigned,
                    isAltered: isAltered,
                    imageUrls: nil,
                    gradingCompany: gradingCompany,
                    gradingScore: gradingScore,
                    certNumber: certNumber,
                    storageLocation: storageLocation,
                    tags: tags
                )
            )
            nextCopyId += 1
        }
        return copies
    }

    private func stampUpdatedAt(_ collection: Collection, cards: [CollectionCard]? = nil) -> Collection {
        Collection(
            id: collection.id,
            name: collection.name,
            description: collection.description,
            cards: cards ?? collection.cards,
            createdAt: collection.createdAt,
            updatedAt: LocalStore.isoFormatter.string(from: Date()),
            colorHex: collection.colorHex,
            defaultCondition: collection.defaultCondition,
            containerType: collection.containerType,
            imageUrl: collection.imageUrl,
            associatedTcg: collection.associatedTcg,
            associatedSetCode: collection.associatedSetCode,
            associatedSetName: collection.associatedSetName
        )
    }

    private func replaceCard(_ card: CollectionCard, copies: [CollectionCardCopy]) -> CollectionCard {
        CollectionCard(
            id: card.id,
            cardId: card.cardId,
            externalId: card.externalId,
            name: card.name,
            tcg: card.tcg,
            setCode: card.setCode,
            setName: card.setName,
            rarity: card.rarity,
            artist: card.artist,
            imageUrl: card.imageUrl,
            imageUrlSmall: card.imageUrlSmall,
            quantity: copies.count,
            price: card.price,
            condition: copies.first?.condition ?? card.condition,
            language: copies.first?.language ?? card.language,
            notes: copies.first?.notes ?? card.notes,
            collectorNumber: card.collectorNumber,
            copies: copies
        )
    }

    /// Stand-in for a card that is added by id while its catalog is not
    /// installed, so the copy still shows up in the binder.
    private func placeholderCard(id: String) -> Card {
        Card(
            id: id,
            name: "Unknown Card",
            tcg: "pokemon",
            setCode: nil,
            setName: nil,
            rarity: nil,
            imageUrl: LocalStore.cardBack(for: "pokemon"),
            imageUrlSmall: LocalStore.cardBack(for: "pokemon"),
            price: nil,
            collectorNumber: nil,
            releasedAt: nil
        )
    }

    // MARK: - Bundled Sealed Product Catalog

    /// Phone-only mode has no product API, so a small bundled catalog backs the
    /// sealed inventory picker. These are real products, not sample content.
    private static func bundledSealedProducts() -> [SealedProduct] {
        [
            SealedProduct(id: "sealed-product-1", tcg: "pokemon", name: "Surging Sparks Booster Box", productType: "box", setCode: "SV", cardsPerPack: 10, packsPerBox: 36, releaseDate: "2024-11-08", imageUrl: LocalStore.cardBack(for: "pokemon"), msrp: 143.64, upc: "820650855221"),
            SealedProduct(id: "sealed-product-2", tcg: "pokemon", name: "Paldean Fates Elite Trainer Box", productType: "etb", setCode: "PAF", cardsPerPack: 10, packsPerBox: 9, releaseDate: "2024-01-26", imageUrl: LocalStore.cardBack(for: "pokemon"), msrp: 49.99, upc: "820650853159"),
            SealedProduct(id: "sealed-product-3", tcg: "magic", name: "Modern Horizons 3 Draft Booster Box", productType: "box", setCode: "MH3", cardsPerPack: 15, packsPerBox: 36, releaseDate: "2024-06-14", imageUrl: LocalStore.cardBack(for: "magic"), msrp: 287.64, upc: nil),
            SealedProduct(id: "sealed-product-4", tcg: "yugioh", name: "Age of Overlord Booster Box", productType: "box", setCode: "AGOV", cardsPerPack: 9, packsPerBox: 24, releaseDate: "2023-10-19", imageUrl: LocalStore.cardBack(for: "yugioh"), msrp: 79.99, upc: nil),
            SealedProduct(id: "sealed-product-5", tcg: "pokemon", name: "Prismatic Evolutions Booster Pack", productType: "booster", setCode: "PRE", cardsPerPack: 10, packsPerBox: nil, releaseDate: "2025-01-17", imageUrl: LocalStore.cardBack(for: "pokemon"), msrp: 5.99, upc: nil)
        ]
    }

    private func seedSampleWishlistsAndFinance() {
        let now = LocalStore.isoFormatter.string(from: Date())

        wishlists.append(contentsOf: [
            Wishlist(
                id: "sample-wishlist-1",
                name: "Want List",
                description: "Cards I'm looking for",
                colorHex: "e91e63",
                cards: [
                    WishlistCard(id: "sample-wc-1", externalId: "sample-pokemon-charizard", tcg: "pokemon", name: "Charizard ex", setCode: "PAF", setName: "Paldean Fates", rarity: "Ultra Rare", imageUrl: LocalStore.cardBack(for: "pokemon"), imageUrlSmall: LocalStore.cardBack(for: "pokemon"), setSymbolUrl: nil, setLogoUrl: nil, collectorNumber: "54", notes: nil, owned: true, ownedQuantity: 1, createdAt: now),
                    WishlistCard(id: "sample-wc-2", externalId: "sample-magic-black-lotus", tcg: "magic", name: "Black Lotus", setCode: "LEA", setName: "Limited Edition Alpha", rarity: "Rare", imageUrl: LocalStore.cardBack(for: "magic"), imageUrlSmall: LocalStore.cardBack(for: "magic"), setSymbolUrl: nil, setLogoUrl: nil, collectorNumber: "233", notes: "The dream card", owned: false, ownedQuantity: 0, createdAt: now),
                    WishlistCard(id: "sample-wc-3", externalId: "sample-ygo-blue-eyes", tcg: "yugioh", name: "Blue-Eyes White Dragon", setCode: "SDK", setName: "Starter Deck: Kaiba", rarity: "Ultra Rare", imageUrl: LocalStore.cardBack(for: "yugioh"), imageUrlSmall: LocalStore.cardBack(for: "yugioh"), setSymbolUrl: nil, setLogoUrl: nil, collectorNumber: nil, notes: nil, owned: true, ownedQuantity: 1, createdAt: now)
                ],
                totalCards: 3,
                ownedCards: 2,
                completionPercent: 67,
                createdAt: now,
                updatedAt: now
            ),
            Wishlist(
                id: "sample-wishlist-2",
                name: "Grails",
                description: "High-value chase cards",
                colorHex: "ffd700",
                cards: [
                    WishlistCard(id: "sample-wc-4", externalId: "sample-magic-black-lotus", tcg: "magic", name: "Black Lotus", setCode: "LEA", setName: "Limited Edition Alpha", rarity: "Rare", imageUrl: LocalStore.cardBack(for: "magic"), imageUrlSmall: LocalStore.cardBack(for: "magic"), setSymbolUrl: nil, setLogoUrl: nil, collectorNumber: "233", notes: nil, owned: false, ownedQuantity: 0, createdAt: now)
                ],
                totalCards: 1,
                ownedCards: 0,
                completionPercent: 0,
                createdAt: now,
                updatedAt: now
            )
        ])

        let boosterBox = sealedProducts.first { $0.name == "Surging Sparks Booster Box" }
        let eliteTrainerBox = sealedProducts.first { $0.name == "Paldean Fates Elite Trainer Box" }
        let boosterPack = sealedProducts.first { $0.name == "Prismatic Evolutions Booster Pack" }

        var sampleInventory: [SealedInventoryItem] = []
        if let boosterBox {
            sampleInventory.append(SealedInventoryItem(id: "sample-si-1", product: boosterBox, quantity: 2, purchasePrice: 130.00, purchaseDate: "2024-11-15", notes: "From LGS pre-order", createdAt: now))
        }
        if let eliteTrainerBox {
            sampleInventory.append(SealedInventoryItem(id: "sample-si-2", product: eliteTrainerBox, quantity: 1, purchasePrice: 49.99, purchaseDate: "2024-02-01", notes: nil, createdAt: now))
        }
        if let boosterPack {
            sampleInventory.append(SealedInventoryItem(id: "sample-si-3", product: boosterPack, quantity: 5, purchasePrice: 4.99, purchaseDate: "2025-01-20", notes: "Target restock", createdAt: now))
        }
        sealedInventory.append(contentsOf: sampleInventory)

        transactions.append(contentsOf: [
            Transaction(id: "sample-txn-1", type: "purchase", cardName: "Charizard ex", tcg: "pokemon", quantity: 1, amount: 8.99, currency: "USD", platform: "Local", notes: "Pulled from pack", date: now),
            Transaction(id: "sample-txn-2", type: "purchase", cardName: "Lightning Bolt", tcg: "magic", quantity: 3, amount: 3.75, currency: "USD", platform: "TCGPlayer", notes: nil, date: now),
            Transaction(id: "sample-txn-3", type: "sale", cardName: "Pikachu VMAX", tcg: "pokemon", quantity: 1, amount: 15.00, currency: "USD", platform: "eBay", notes: "Sold in lot", date: now),
            Transaction(id: "sample-txn-4", type: "purchase", cardName: "Blue-Eyes White Dragon", tcg: "yugioh", quantity: 1, amount: 4.50, currency: "USD", platform: "CardMarket", notes: nil, date: now),
            Transaction(id: "sample-txn-5", type: "sale", cardName: "Mewtwo GX", tcg: "pokemon", quantity: 2, amount: 22.50, currency: "USD", platform: "TCGPlayer", notes: nil, date: now)
        ])
    }

    /// A representative vault spanning every supported game, capture source,
    /// and status. Values are intentionally synthetic so sample content can
    /// never be mistaken for a redeemable code.
    private func seedSampleOnlineCodes() {
        func timestamp(daysAgo: Int) -> String {
            let date = Calendar(identifier: .gregorian).date(
                byAdding: .day,
                value: -daysAgo,
                to: Date()
            ) ?? Date()
            return LocalStore.isoFormatter.string(from: date)
        }

        func sampleCode(
            id: String,
            tcg: TCGGame,
            code: String,
            status: OnlineCodeStatus,
            source: OnlineCodeSource,
            productName: String,
            notes: String? = nil,
            daysAgo: Int
        ) -> OnlineCode {
            let capturedAt = timestamp(daysAgo: daysAgo)
            let redeemedAt = status == .redeemed
                ? timestamp(daysAgo: max(0, daysAgo - 1))
                : nil
            return OnlineCode(
                id: id,
                tcg: tcg.rawValue,
                code: code,
                status: status,
                source: source,
                productName: productName,
                notes: notes,
                capturedAt: capturedAt,
                redeemedAt: redeemedAt,
                createdAt: capturedAt,
                updatedAt: redeemedAt ?? capturedAt
            )
        }

        let samples = [
            sampleCode(
                id: "sample-online-code-1",
                tcg: .pokemon,
                code: "DEMO-PKMN-7K4Q-2J9X",
                status: .unused,
                source: .camera,
                productName: "Destined Rivals Booster Pack",
                notes: "Scanned from the code card",
                daysAgo: 1
            ),
            sampleCode(
                id: "sample-online-code-2",
                tcg: .pokemon,
                code: "DEMO-PKMN-ETB-8R2M",
                status: .redeemed,
                source: .manual,
                productName: "Paldean Fates Elite Trainer Box",
                notes: "Redeemed on Pokémon TCG Live",
                daysAgo: 8
            ),
            sampleCode(
                id: "sample-online-code-3",
                tcg: .magic,
                code: "DEMO-MTGA-PRERELEASE-25",
                status: .unused,
                source: .camera,
                productName: "Prerelease Pack",
                notes: "Arena reward code",
                daysAgo: 3
            ),
            sampleCode(
                id: "sample-online-code-4",
                tcg: .magic,
                code: "DEMO-MTGA-STARTER-24",
                status: .traded,
                source: .import,
                productName: "Starter Kit",
                notes: "Traded with a friend",
                daysAgo: 18
            ),
            sampleCode(
                id: "sample-online-code-5",
                tcg: .yugioh,
                code: "DEMO-YGO-NEURON-4M8K",
                status: .redeemed,
                source: .manual,
                productName: "Yu-Gi-Oh! Promotional Insert",
                daysAgo: 12
            ),
            sampleCode(
                id: "sample-online-code-6",
                tcg: .yugioh,
                code: "DEMO-YGO-LEGACY-9P3D",
                status: .invalid,
                source: .camera,
                productName: "Legacy of Destruction Booster Box",
                notes: "Damaged print; kept for reference",
                daysAgo: 24
            ),
            sampleCode(
                id: "sample-online-code-7",
                tcg: .onepiece,
                code: "DEMO-OPTCG-6H2W-5N8C",
                status: .unused,
                source: .manual,
                productName: "One Piece Card Game Promotion",
                daysAgo: 5
            ),
            sampleCode(
                id: "sample-online-code-8",
                tcg: .lorcana,
                code: "DEMO-LORCANA-3F7B-1Q6T",
                status: .traded,
                source: .import,
                productName: "Organized Play Reward",
                daysAgo: 15
            ),
            sampleCode(
                id: "sample-online-code-9",
                tcg: .dragonball,
                code: "DEMO-DBSCG-2V9L-7A4R",
                status: .unused,
                source: .camera,
                productName: "Fusion World Starter Deck",
                daysAgo: 6
            )
        ]

        let existing = Set(onlineCodes.map(\.id))
        onlineCodes.append(contentsOf: samples.filter { !existing.contains($0.id) })
    }

    // MARK: - Wishlist Accessors

    func getWishlists() -> [Wishlist] {
        let maps = ownershipMaps()
        return wishlists.map { applyingOwnership($0, maps: maps) }
    }

    func getWishlist(id: String) throws -> Wishlist {
        guard let wl = wishlists.first(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "Wishlist not found")
        }
        return applyingOwnership(wl, maps: ownershipMaps())
    }

    /// Live ownership from the local binders, keyed by exact printing
    /// ("tcg:externalId") and by base card ("tcg:baseExternalId", falling back
    /// to externalId). Mirrors the server, which cross-references wishlists
    /// against the collection on every read instead of storing ownership.
    private func ownershipMaps() -> (exact: [String: Int], base: [String: Int]) {
        var exact: [String: Int] = [:]
        var base: [String: Int] = [:]
        for collection in collections {
            for card in collection.cards {
                let externalId = card.externalId ?? card.cardId
                exact["\(card.tcg):\(externalId)", default: 0] += card.quantity
                base["\(card.tcg):\(card.baseExternalId ?? externalId)", default: 0] += card.quantity
            }
        }
        return (exact, base)
    }

    private func ownedQuantity(
        for card: WishlistCard,
        matchAnyPrinting: Bool,
        maps: (exact: [String: Int], base: [String: Int])
    ) -> Int {
        if matchAnyPrinting {
            return maps.base["\(card.tcg):\(card.baseExternalId ?? card.externalId)"] ?? 0
        }
        return maps.exact["\(card.tcg):\(card.externalId)"] ?? 0
    }

    /// Rewrites a wishlist's cards and totals with live ownership; the stored
    /// flags only reflect what was true when each card was added.
    private func applyingOwnership(
        _ wishlist: Wishlist,
        maps: (exact: [String: Int], base: [String: Int])
    ) -> Wishlist {
        let cards = wishlist.cards.map { card -> WishlistCard in
            var updated = card
            let quantity = ownedQuantity(
                for: card,
                matchAnyPrinting: wishlist.matchesAnyPrinting,
                maps: maps
            )
            updated.owned = quantity > 0
            updated.ownedQuantity = quantity
            return updated
        }
        let ownedCount = cards.filter(\.owned).count
        return Wishlist(
            id: wishlist.id,
            name: wishlist.name,
            description: wishlist.description,
            colorHex: wishlist.colorHex,
            cards: cards,
            totalCards: cards.count,
            ownedCards: ownedCount,
            completionPercent: cards.isEmpty ? 0 : Int((Double(ownedCount) / Double(cards.count)) * 100),
            createdAt: wishlist.createdAt,
            updatedAt: wishlist.updatedAt,
            rules: wishlist.rules,
            matchAnyPrinting: wishlist.matchAnyPrinting
        )
    }

    func createWishlist(
        name: String,
        description: String?,
        colorHex: String?,
        matchAnyPrinting: Bool? = nil
    ) -> Wishlist {
        let now = LocalStore.isoFormatter.string(from: Date())
        let wl = Wishlist(id: "local-wishlist-\(nextWishlistId)", name: name, description: description, colorHex: colorHex, cards: [], totalCards: 0, ownedCards: 0, completionPercent: 0, createdAt: now, updatedAt: now, matchAnyPrinting: matchAnyPrinting ?? false)
        nextWishlistId += 1
        wishlists.insert(wl, at: 0)
        persist()
        return wl
    }

    func updateWishlist(
        id: String,
        name: String?,
        description: String?,
        colorHex: String?,
        matchAnyPrinting: Bool? = nil
    ) throws -> Wishlist {
        guard let idx = wishlists.firstIndex(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "Wishlist not found")
        }
        let wl = wishlists[idx]
        let updated = Wishlist(
            id: wl.id,
            name: name ?? wl.name,
            description: description ?? wl.description,
            colorHex: colorHex ?? wl.colorHex,
            cards: wl.cards,
            totalCards: wl.totalCards,
            ownedCards: wl.ownedCards,
            completionPercent: wl.completionPercent,
            createdAt: wl.createdAt,
            updatedAt: LocalStore.isoFormatter.string(from: Date()),
            rules: wl.rules,
            matchAnyPrinting: matchAnyPrinting ?? wl.matchAnyPrinting
        )
        wishlists[idx] = updated
        try persistOrThrow()
        return applyingOwnership(updated, maps: ownershipMaps())
    }

    func deleteWishlist(id: String) {
        wishlists.removeAll { $0.id == id }
        persist()
    }

    func addCardToWishlist(wishlistId: String, card: Card) throws -> WishlistCard {
        guard let idx = wishlists.firstIndex(where: { $0.id == wishlistId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Wishlist not found")
        }
        let now = LocalStore.isoFormatter.string(from: Date())
        let wl = wishlists[idx]
        let maps = ownershipMaps()

        if var existing = wl.cards.first(where: { $0.externalId == card.id && $0.tcg == card.tcg }) {
            let quantity = ownedQuantity(for: existing, matchAnyPrinting: wl.matchesAnyPrinting, maps: maps)
            existing.owned = quantity > 0
            existing.ownedQuantity = quantity
            return existing
        }

        var wc = LocalStore.makeWishlistCard(from: card, at: now)
        var cards = wl.cards
        cards.append(wc)
        wishlists[idx] = LocalStore.rebuildWishlist(wl, cards: cards, rules: wl.rules, updatedAt: now)
        try persistOrThrow()
        let quantity = ownedQuantity(for: wc, matchAnyPrinting: wl.matchesAnyPrinting, maps: maps)
        wc.owned = quantity > 0
        wc.ownedQuantity = quantity
        return wc
    }

    /// Batch equivalent of `addCardToWishlist`, used when a rule expands into
    /// many cards at once. Cards already on the list are skipped.
    func addCardsToWishlist(wishlistId: String, cards newCards: [Card]) throws -> Wishlist {
        guard let idx = wishlists.firstIndex(where: { $0.id == wishlistId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Wishlist not found")
        }
        let now = LocalStore.isoFormatter.string(from: Date())
        let wl = wishlists[idx]
        var cards = wl.cards
        var seen = Set(cards.map { "\($0.tcg):\($0.externalId)" })

        for card in newCards {
            let key = "\(card.tcg):\(card.id)"
            if seen.contains(key) { continue }
            seen.insert(key)
            cards.append(LocalStore.makeWishlistCard(from: card, at: now))
        }

        let updated = LocalStore.rebuildWishlist(wl, cards: cards, rules: wl.rules, updatedAt: now)
        wishlists[idx] = updated
        try persistOrThrow()
        return applyingOwnership(updated, maps: ownershipMaps())
    }

    func removeCardFromWishlist(wishlistId: String, cardId: String) {
        guard let idx = wishlists.firstIndex(where: { $0.id == wishlistId }) else { return }
        let wl = wishlists[idx]
        let cards = wl.cards.filter { $0.id != cardId }
        let now = LocalStore.isoFormatter.string(from: Date())
        wishlists[idx] = LocalStore.rebuildWishlist(wl, cards: cards, rules: wl.rules, updatedAt: now)
        persist()
    }

    // MARK: - Wishlist Rule Accessors

    func addWishlistRule(
        wishlistId: String,
        type: WishlistRule.RuleType,
        tcg: String?,
        query: String?,
        setCode: String?,
        setName: String?,
        includeAllPrintings: Bool,
        autoSync: Bool
    ) throws -> WishlistRule {
        guard let idx = wishlists.firstIndex(where: { $0.id == wishlistId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Wishlist not found")
        }
        let now = LocalStore.isoFormatter.string(from: Date())
        let wl = wishlists[idx]
        var rules = wl.expansionRules

        // Re-adding the same rule refreshes it rather than duplicating it.
        let existingIndex = rules.firstIndex {
            $0.type == type && $0.tcg == tcg && $0.query == query && $0.setCode == setCode
        }

        let rule = WishlistRule(
            id: existingIndex.map { rules[$0].id } ?? "local-wr-\(nextWishlistRuleId)",
            type: type,
            tcg: tcg,
            query: query,
            setCode: setCode,
            setName: setName ?? existingIndex.flatMap { rules[$0].setName },
            includeAllPrintings: includeAllPrintings,
            autoSync: autoSync,
            lastSyncedAt: existingIndex.flatMap { rules[$0].lastSyncedAt },
            lastMatchCount: existingIndex.flatMap { rules[$0].lastMatchCount },
            createdAt: existingIndex.map { rules[$0].createdAt } ?? now,
            updatedAt: now
        )

        if let existingIndex {
            rules[existingIndex] = rule
        } else {
            rules.append(rule)
            nextWishlistRuleId += 1
        }

        wishlists[idx] = LocalStore.rebuildWishlist(wl, cards: wl.cards, rules: rules, updatedAt: now)
        try persistOrThrow()
        return rule
    }

    func updateWishlistRule(
        wishlistId: String,
        ruleId: String,
        autoSync: Bool?,
        includeAllPrintings: Bool?,
        lastSyncedAt: String?,
        lastMatchCount: Int?
    ) throws -> WishlistRule {
        guard let idx = wishlists.firstIndex(where: { $0.id == wishlistId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Wishlist not found")
        }
        let wl = wishlists[idx]
        var rules = wl.expansionRules
        guard let ruleIndex = rules.firstIndex(where: { $0.id == ruleId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Wishlist rule not found")
        }

        let now = LocalStore.isoFormatter.string(from: Date())
        let current = rules[ruleIndex]
        let updated = WishlistRule(
            id: current.id,
            type: current.type,
            tcg: current.tcg,
            query: current.query,
            setCode: current.setCode,
            setName: current.setName,
            includeAllPrintings: includeAllPrintings ?? current.includeAllPrintings,
            autoSync: autoSync ?? current.autoSync,
            lastSyncedAt: lastSyncedAt ?? current.lastSyncedAt,
            lastMatchCount: lastMatchCount ?? current.lastMatchCount,
            createdAt: current.createdAt,
            updatedAt: now
        )
        rules[ruleIndex] = updated

        wishlists[idx] = LocalStore.rebuildWishlist(wl, cards: wl.cards, rules: rules, updatedAt: now)
        try persistOrThrow()
        return updated
    }

    func removeWishlistRule(wishlistId: String, ruleId: String) {
        guard let idx = wishlists.firstIndex(where: { $0.id == wishlistId }) else { return }
        let wl = wishlists[idx]
        let rules = wl.expansionRules.filter { $0.id != ruleId }
        let now = LocalStore.isoFormatter.string(from: Date())
        wishlists[idx] = LocalStore.rebuildWishlist(wl, cards: wl.cards, rules: rules, updatedAt: now)
        persist()
    }

    private static func makeWishlistCard(from card: Card, at timestamp: String) -> WishlistCard {
        WishlistCard(
            id: "local-wc-\(UUID().uuidString.prefix(8))",
            externalId: card.id,
            tcg: card.tcg,
            name: card.name,
            setCode: card.setCode,
            setName: card.setName,
            rarity: card.rarity,
            imageUrl: card.imageUrl,
            imageUrlSmall: card.imageUrlSmall,
            setSymbolUrl: card.setSymbolUrl,
            setLogoUrl: card.setLogoUrl,
            collectorNumber: card.collectorNumber,
            notes: nil,
            owned: false,
            ownedQuantity: 0,
            createdAt: timestamp
        )
    }

    /// Rebuilds a wishlist with new cards/rules, recomputing the totals.
    private static func rebuildWishlist(
        _ wishlist: Wishlist,
        cards: [WishlistCard],
        rules: [WishlistRule]?,
        updatedAt: String
    ) -> Wishlist {
        let ownedCards = cards.filter(\.owned).count
        return Wishlist(
            id: wishlist.id,
            name: wishlist.name,
            description: wishlist.description,
            colorHex: wishlist.colorHex,
            cards: cards,
            totalCards: cards.count,
            ownedCards: ownedCards,
            completionPercent: cards.isEmpty ? 0 : Int((Double(ownedCards) / Double(cards.count)) * 100),
            createdAt: wishlist.createdAt,
            updatedAt: updatedAt,
            rules: rules,
            matchAnyPrinting: wishlist.matchAnyPrinting
        )
    }

    // MARK: - Online Code Accessors

    func getOnlineCodes(tcg: String? = nil) -> [OnlineCode] {
        repairOnlineCodeDuplicatesIfNeeded()
        return onlineCodes
            .filter { tcg == nil || $0.tcg == tcg }
            .sorted { $0.capturedAt > $1.capturedAt }
    }

    func createOnlineCodes(
        tcg: String,
        codes: [String],
        source: OnlineCodeSource,
        productName: String?,
        notes: String?
    ) throws -> OnlineCodeBatchResult {
        guard !codes.isEmpty, codes.count <= 250 else {
            throw APIService.APIError.serverError(
                status: 400,
                message: "A batch must contain 1 to 250 codes."
            )
        }

        let now = LocalStore.isoFormatter.string(from: Date())
        let cleanedProduct = nonemptyOnlineCodeText(productName)
        let cleanedNotes = nonemptyOnlineCodeText(notes)
        var created: [OnlineCode] = []
        var duplicates = 0
        var seen = Set(
            onlineCodes
                .filter { $0.tcg == tcg }
                .map { normalizeOnlineCode($0.code) }
        )

        for rawCode in codes {
            let code = OnlineCodeParser.canonicalCode(rawCode)
            let normalized = normalizeOnlineCode(code)
            guard normalized.count >= 4, code.count <= 512 else {
                throw APIService.APIError.serverError(
                    status: 400,
                    message: "Each code must contain 4 to 512 characters."
                )
            }
            guard seen.insert(normalized).inserted else {
                duplicates += 1
                continue
            }

            let item = OnlineCode(
                id: "local-online-code-\(nextOnlineCodeId)",
                tcg: tcg,
                code: code,
                status: .unused,
                source: source,
                productName: cleanedProduct,
                notes: cleanedNotes,
                capturedAt: now,
                redeemedAt: nil,
                createdAt: now,
                updatedAt: now
            )
            nextOnlineCodeId += 1
            onlineCodes.insert(item, at: 0)
            created.append(item)
        }

        try persistOrThrow()
        return OnlineCodeBatchResult(
            created: created.count,
            duplicates: duplicates,
            items: created
        )
    }

    func updateOnlineCode(
        id: String,
        status: OnlineCodeStatus,
        productName: String?,
        notes: String?,
        updateDetails: Bool
    ) throws -> OnlineCode {
        guard let index = onlineCodes.firstIndex(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "Online code not found.")
        }
        let current = onlineCodes[index]
        let now = LocalStore.isoFormatter.string(from: Date())
        let updated = OnlineCode(
            id: current.id,
            tcg: current.tcg,
            code: current.code,
            status: status,
            source: current.source,
            productName: updateDetails
                ? nonemptyOnlineCodeText(productName)
                : current.productName,
            notes: updateDetails ? nonemptyOnlineCodeText(notes) : current.notes,
            capturedAt: current.capturedAt,
            redeemedAt: status == .redeemed ? current.redeemedAt ?? now : nil,
            createdAt: current.createdAt,
            updatedAt: now
        )
        onlineCodes[index] = updated
        try persistOrThrow()
        return updated
    }

    func deleteOnlineCode(id: String) throws {
        guard onlineCodes.contains(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "Online code not found.")
        }
        onlineCodes.removeAll { $0.id == id }
        try persistOrThrow()
    }

    private func normalizeOnlineCode(_ value: String) -> String {
        OnlineCodeParser.normalize(value)
    }

    private func repairOnlineCodeDuplicatesIfNeeded() {
        var seen = Set<String>()
        var repaired: [OnlineCode] = []
        var changed = false

        for item in onlineCodes.sorted(by: {
            onlineCodeStatusPriority($0.status) > onlineCodeStatusPriority($1.status)
        }) {
            let canonical = OnlineCodeParser.canonicalCode(item.code)
            let key = "\(item.tcg):\(normalizeOnlineCode(canonical))"
            guard seen.insert(key).inserted else {
                changed = true
                continue
            }
            if canonical != item.code {
                changed = true
                repaired.append(OnlineCode(
                    id: item.id,
                    tcg: item.tcg,
                    code: canonical,
                    status: item.status,
                    source: item.source,
                    productName: item.productName,
                    notes: item.notes,
                    capturedAt: item.capturedAt,
                    redeemedAt: item.redeemedAt,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt
                ))
            } else {
                repaired.append(item)
            }
        }

        guard changed else { return }
        onlineCodes = repaired
        try? persistOrThrow()
    }

    private func onlineCodeStatusPriority(_ status: OnlineCodeStatus) -> Int {
        switch status {
        case .redeemed: 4
        case .traded: 3
        case .invalid: 2
        case .unused: 1
        }
    }

    private func nonemptyOnlineCodeText(_ value: String?) -> String? {
        let cleaned = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned?.isEmpty == false ? cleaned : nil
    }

    // MARK: - Sealed Accessors

    func getSealedProducts() -> [SealedProduct] {
        var productsByName = Dictionary(
            sealedProducts.map {
                ("\($0.tcg)|\($0.name.lowercased())", $0)
            },
            uniquingKeysWith: { _, latest in latest }
        )
        for product in CatalogStore.shared.sealedProducts() {
            productsByName["\(product.tcg)|\(product.name.lowercased())"] = product
        }
        return productsByName.values.sorted {
            ($0.releaseDate ?? "", $0.name) > ($1.releaseDate ?? "", $1.name)
        }
    }
    func getSealedInventory() -> [SealedInventoryItem] { sealedInventory }

    func addSealedInventory(productId: String, quantity: Int, purchasePrice: Double?) -> SealedInventoryItem? {
        guard let product = getSealedProducts().first(where: { $0.id == productId }) else { return nil }
        let now = LocalStore.isoFormatter.string(from: Date())
        let item = SealedInventoryItem(id: "local-si-\(Int.random(in: 100...9999))", product: product, quantity: quantity, purchasePrice: purchasePrice, purchaseDate: now, notes: nil, createdAt: now)
        sealedInventory.insert(item, at: 0)
        persist()
        return item
    }

    func updateSealedInventory(
        itemId: String,
        quantity: Int?,
        purchasePrice: Double?,
        purchaseDate: String?,
        notes: String?,
        clearPurchasePrice: Bool = false,
        clearPurchaseDate: Bool = false,
        clearNotes: Bool = false
    ) throws -> SealedInventoryItem {
        guard let idx = sealedInventory.firstIndex(where: { $0.id == itemId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Inventory item not found")
        }
        let item = sealedInventory[idx]
        let updated = SealedInventoryItem(
            id: item.id,
            product: item.product,
            quantity: quantity ?? item.quantity,
            purchasePrice: clearPurchasePrice ? nil : purchasePrice ?? item.purchasePrice,
            purchaseDate: clearPurchaseDate ? nil : purchaseDate ?? item.purchaseDate,
            notes: clearNotes ? nil : notes ?? item.notes,
            createdAt: item.createdAt
        )
        sealedInventory[idx] = updated
        try persistOrThrow()
        return updated
    }

    func deleteSealedInventory(itemId: String) {
        sealedInventory.removeAll { $0.id == itemId }
        persist()
    }

    // MARK: - Finance Accessors

    func getTransactions(collectionEntryId: String? = nil) -> [Transaction] {
        guard let collectionEntryId else { return transactions }
        return transactions.filter { $0.collectionEntryId == collectionEntryId }
    }

    func getFinanceSummary() -> FinanceSummary {
        let spent = transactions.filter { $0.type == "purchase" }.reduce(0.0) { $0 + $1.amount }
        let earned = transactions.filter { $0.type == "sale" }.reduce(0.0) { $0 + $1.amount }
        return FinanceSummary(totalSpent: spent, totalEarned: earned, profitLoss: earned - spent, transactionCount: transactions.count)
    }

    func createTransaction(
        type: String,
        collectionEntryId: String?,
        cardId: String?,
        externalId: String?,
        cardName: String?,
        tcg: String?,
        quantity: Int,
        amount: Double,
        currency: String,
        platform: String?,
        sourceUrl: String?,
        costBasis: Double?,
        fees: Double?,
        shippingCost: Double?,
        acquiredAt: String?,
        notes: String?,
        date: String?
    ) -> Transaction {
        let now = LocalStore.isoFormatter.string(from: Date())
        let netProceeds = type == "sale" ? amount - (fees ?? 0) - (shippingCost ?? 0) : nil
        let txn = Transaction(
            id: "local-txn-\(nextTransactionId)", type: type,
            collectionEntryId: collectionEntryId, cardId: cardId, externalId: externalId,
            cardName: cardName, tcg: tcg, quantity: quantity, amount: amount,
            currency: currency.uppercased(), platform: platform, sourceUrl: sourceUrl,
            costBasis: costBasis, fees: fees, shippingCost: shippingCost, acquiredAt: acquiredAt,
            netProceeds: netProceeds,
            realizedProfit: costBasis.map { (netProceeds ?? amount) - $0 },
            notes: notes, date: date ?? now
        )
        nextTransactionId += 1
        transactions.insert(txn, at: 0)
        persist()
        return txn
    }

    func updateTransaction(
        id: String,
        collectionEntryId: String?,
        cardId: String?,
        externalId: String?,
        cardName: String?,
        tcg: String?,
        quantity: Int,
        amount: Double,
        currency: String,
        platform: String?,
        sourceUrl: String?,
        notes: String?,
        date: String
    ) throws -> Transaction {
        guard let index = transactions.firstIndex(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "Transaction not found")
        }
        let existing = transactions[index]
        let updated = Transaction(
            id: existing.id,
            type: existing.type,
            collectionEntryId: collectionEntryId,
            cardId: cardId,
            externalId: externalId,
            cardName: cardName,
            tcg: tcg,
            quantity: quantity,
            amount: amount,
            currency: currency.uppercased(),
            platform: platform,
            sourceUrl: sourceUrl,
            costBasis: existing.costBasis,
            fees: existing.fees,
            shippingCost: existing.shippingCost,
            acquiredAt: existing.acquiredAt,
            netProceeds: existing.type == "sale"
                ? amount - (existing.fees ?? 0) - (existing.shippingCost ?? 0)
                : nil,
            realizedProfit: existing.realizedProfit,
            holdingDays: existing.holdingDays,
            notes: notes,
            date: date
        )
        transactions[index] = updated
        try persistOrThrow()
        return updated
    }

    func getRealizedPerformance() -> RealizedPerformance {
        let sales = transactions.filter { $0.type == "sale" }
        let revenue = sales.reduce(0.0) { $0 + $1.amount }
        let fees = sales.reduce(0.0) { $0 + ($1.fees ?? 0) }
        let shipping = sales.reduce(0.0) { $0 + ($1.shippingCost ?? 0) }
        let costed = sales.filter { $0.costBasis != nil }
        let costBasis = costed.reduce(0.0) { $0 + ($1.costBasis ?? 0) }
        let realized = costed.reduce(0.0) { $0 + ($1.realizedProfit ?? 0) }
        let inventoryCards = collections.flatMap(\.cards).flatMap(\.copies)
        return RealizedPerformance(
            byCurrency: [RealizedPerformanceCurrency(
                currency: "USD", revenue: revenue, costBasis: costBasis, fees: fees,
                shippingCost: shipping, netProceeds: revenue - fees - shipping,
                realizedProfit: realized, saleCount: sales.count,
                costedSaleCount: costed.count, averageHoldingDays: nil
            )],
            inventoryCost: inventoryCards.reduce(0.0) { $0 + ($1.acquisitionPrice ?? 0) },
            inventoryMarketValue: collections.flatMap(\.cards).reduce(0.0) { $0 + ($1.price ?? 0) * Double($1.quantity) },
            inventoryCurrency: "USD",
            truncated: false
        )
    }

    func deleteTransaction(id: String) {
        transactions.removeAll { $0.id == id }
        persist()
    }
}
