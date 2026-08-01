import Combine
import CryptoKit
import Foundation

nonisolated protocol CatalogSource: Sendable {
    func data(for filename: String) async throws -> Data
    func remove(_ filename: String) async
}

nonisolated struct BundledCatalogSource: CatalogSource, @unchecked Sendable {
    private let bundle: Bundle

    init(bundle: Bundle = .main) {
        self.bundle = bundle
    }

    func data(for filename: String) async throws -> Data {
        guard let url = resourceURL(for: filename) else {
            throw CatalogStore.StoreError.resourceUnavailable(filename)
        }
        return try Data(contentsOf: url, options: .mappedIfSafe)
    }

    func remove(_ filename: String) async {}

    private func resourceURL(for filename: String) -> URL? {
        let fileManager = FileManager.default
        if let resourceURL = bundle.resourceURL {
            let catalogURL = resourceURL
                .appendingPathComponent("Catalogs", isDirectory: true)
                .appendingPathComponent(filename, isDirectory: false)
            if fileManager.fileExists(atPath: catalogURL.path) {
                return catalogURL
            }
        }

        // Xcode may flatten synchronized resources depending on project settings.
        return bundle.url(forResource: filename, withExtension: nil)
    }
}

actor RemoteCatalogSource: CatalogSource {
    private let baseURL: URL
    private let cacheDirectory: URL
    private let fallback: any CatalogSource
    private let session: URLSession

    init(
        baseURL: URL,
        fallback: any CatalogSource = BundledCatalogSource(),
        session: URLSession = .shared,
        fileManager: FileManager = .default
    ) {
        self.baseURL = baseURL
        self.fallback = fallback
        self.session = session
        let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? fileManager.temporaryDirectory
        cacheDirectory = applicationSupport
            .appendingPathComponent("TCGer", isDirectory: true)
            .appendingPathComponent("Catalogs", isDirectory: true)
    }

    func data(for filename: String) async throws -> Data {
        guard Self.isSafe(filename) else {
            throw CatalogStore.StoreError.resourceUnavailable(filename)
        }

        let cachedURL = cacheDirectory.appendingPathComponent(filename, isDirectory: false)
        if filename != "manifest.json",
           let cached = try? Data(contentsOf: cachedURL, options: .mappedIfSafe) {
            return cached
        }

        do {
            let remoteURL = baseURL.appendingPathComponent(filename, isDirectory: false)
            var request = URLRequest(url: remoteURL)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 60
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode) else {
                throw CatalogStore.StoreError.resourceUnavailable(filename)
            }
            try FileManager.default.createDirectory(
                at: cacheDirectory,
                withIntermediateDirectories: true
            )
            try data.write(to: cachedURL, options: .atomic)
            return data
        } catch {
            if let cached = try? Data(contentsOf: cachedURL, options: .mappedIfSafe) {
                return cached
            }
            return try await fallback.data(for: filename)
        }
    }

    func remove(_ filename: String) async {
        guard Self.isSafe(filename), filename != "manifest.json" else { return }
        try? FileManager.default.removeItem(
            at: cacheDirectory.appendingPathComponent(filename, isDirectory: false)
        )
    }

    private static func isSafe(_ filename: String) -> Bool {
        !filename.isEmpty &&
            filename != "." &&
            filename != ".." &&
            !filename.contains("/") &&
            !filename.contains("\\")
    }
}

nonisolated enum CatalogAssetConfiguration {
    static func catalogSource(bundle: Bundle = .main) -> any CatalogSource {
        let bundled = BundledCatalogSource(bundle: bundle)
        guard let baseURL = httpsURL(for: "TCGerCatalogBaseURL", bundle: bundle) else {
            return bundled
        }
        return RemoteCatalogSource(baseURL: baseURL, fallback: bundled)
    }

    private static func httpsURL(for key: String, bundle: Bundle) -> URL? {
        guard let value = bundle.object(forInfoDictionaryKey: key) as? String,
              !value.isEmpty,
              !value.contains("$("),
              let url = URL(string: value),
              url.scheme == "https",
              url.host != nil else {
            return nil
        }
        return url
    }
}

nonisolated struct CatalogManifest: Decodable, Sendable {
    let formatVersion: Int
    let generatedAt: String
    let games: [String: CatalogManifestGame]
}

nonisolated struct CatalogManifestGame: Decodable, Sendable {
    let version: Int
    let cardCount: Int
    let setCount: Int
    let bytes: Int
    let sha256: String
    let file: String
}

nonisolated struct CatalogSetEntry: Decodable, Hashable, Sendable {
    let code: String
    let name: String
    let serie: String?
    let releasedAt: String?
    let count: Int
}

/// The in-memory pack row intentionally contains only fields needed by offline
/// search, set browsing, Card mapping, and image URL derivation.
nonisolated struct CatalogCardEntry: Decodable, Hashable, Sendable {
    let id: String
    let name: String
    let setCode: String?
    let collectorNumber: String?
    let rarity: String?
    let type: String?
    let types: [String]?
    let konamiId: Int?
}

nonisolated struct CatalogEntry: Hashable, Sendable {
    let tcg: TCGGame
    let card: CatalogCardEntry
}

nonisolated enum CatalogInstallState: Equatable {
    case notInstalled
    case installed(version: Int)
}

@MainActor
final class CatalogStore: ObservableObject {
    static let shared = CatalogStore()

    enum StoreError: LocalizedError {
        case resourceUnavailable(String)
        case unsupportedFormat(Int)
        case invalidPack(expected: TCGGame)
        case checksumMismatch(expected: TCGGame)

        var errorDescription: String? {
            switch self {
            case .resourceUnavailable:
                return "This catalog is not available in this build."
            case .unsupportedFormat(let version):
                return "Catalog format version \(version) is not supported."
            case .invalidPack(let game):
                return "The \(game.rawValue) catalog is invalid."
            case .checksumMismatch(let game):
                return "The downloaded \(game.rawValue) catalog failed its integrity check."
            }
        }
    }

    @Published private(set) var manifest: CatalogManifest?
    @Published private(set) var installingGames: Set<TCGGame> = []
    @Published private(set) var installProgress: [TCGGame: Double] = [:]

    nonisolated private struct CatalogPack: Decodable, Sendable {
        let formatVersion: Int
        let tcg: String
        let version: Int
        let updatedAt: String
        let sets: [CatalogSetEntry]
        let cards: [CatalogCardEntry]
    }

    nonisolated private struct SetSearchMetadata: Sendable {
        let name: String
        let code: String

        func contains(_ query: String) -> Bool {
            name.contains(query) || code.contains(query)
        }
    }

    nonisolated private struct LoadedCatalogPack: Sendable {
        let pack: CatalogPack
        let setSearchMetadata: [String: SetSearchMetadata]

        init(pack: CatalogPack) {
            self.pack = pack
            setSearchMetadata = Dictionary(
                pack.sets.map { set in
                    (
                        set.code,
                        SetSearchMetadata(
                            name: Self.normalize(set.name),
                            code: Self.normalize(set.code)
                        )
                    )
                },
                uniquingKeysWith: { first, _ in first }
            )
        }

        var version: Int { pack.version }
        var sets: [CatalogSetEntry] { pack.sets }
        var cards: [CatalogCardEntry] { pack.cards }

        private static func normalize(_ value: String) -> String {
            value.folding(
                options: [.caseInsensitive, .diacriticInsensitive],
                locale: nil
            )
        }
    }

    private let source: any CatalogSource
    private let defaults: UserDefaults
    private var loadedPacks: [TCGGame: LoadedCatalogPack] = [:]
    private var enabledGames: Set<TCGGame> = []

    init(
        source: any CatalogSource = CatalogAssetConfiguration.catalogSource(),
        defaults: UserDefaults = .standard
    ) {
        self.source = source
        self.defaults = defaults
        manifest = nil

        Task { [weak self] in
            await self?.refreshManifest()
        }
    }

    func refreshManifest() async {
        do {
            let source = self.source
            let data = try await source.data(for: "manifest.json")
            let decoded = try await Task.detached(priority: .utility) {
                try JSONDecoder().decode(CatalogManifest.self, from: data)
            }.value
            guard decoded.formatVersion == 1 else {
                throw StoreError.unsupportedFormat(decoded.formatVersion)
            }
            manifest = decoded
            for game in TCGGame.catalogGames where enabledGames.contains(game) && isInstalled(game) {
                await loadIfNeeded(game)
            }
        } catch {
            // The source already tries its disk cache and bundled resources.
            // With no manifest at all, local mode keeps its small seed catalog.
        }
    }

    func metadata(for game: TCGGame) -> CatalogManifestGame? {
        guard game != .all else { return nil }
        return manifest?.games[game.rawValue]
    }

    func installState(for game: TCGGame) -> CatalogInstallState {
        guard let version = defaults.object(forKey: installKey(for: game)) as? Int else {
            return .notInstalled
        }
        return .installed(version: version)
    }

    func isAvailable(_ game: TCGGame) -> Bool {
        metadata(for: game) != nil
    }

    func isUpdateAvailable(_ game: TCGGame) -> Bool {
        guard let metadata = metadata(for: game),
              case .installed(let installedVersion) = installState(for: game) else {
            return false
        }
        return installedVersion < metadata.version
    }

    func isLoaded(_ game: TCGGame) -> Bool {
        loadedPacks[game] != nil
    }

    func isEnabled(_ game: TCGGame) -> Bool {
        game == .all || enabledGames.contains(game)
    }

    func configure(enabledGames: [TCGGame]) async {
        let games = Set(enabledGames.filter { $0 != .all })
        self.enabledGames = games

        for loadedGame in Array(loadedPacks.keys) where !games.contains(loadedGame) {
            loadedPacks.removeValue(forKey: loadedGame)
        }

        for game in TCGGame.catalogGames where games.contains(game) && isInstalled(game) {
            await loadIfNeeded(game)
        }
    }

    func setEnabled(_ enabled: Bool, for game: TCGGame) {
        guard game != .all else { return }
        if enabled {
            enabledGames.insert(game)
            guard TCGGame.catalogGames.contains(game), isInstalled(game) else { return }
            Task(priority: .utility) {
                await loadIfNeeded(game)
            }
        } else {
            enabledGames.remove(game)
            loadedPacks.removeValue(forKey: game)
        }
    }

    func install(_ game: TCGGame) async throws {
        guard game != .all,
              let metadata = metadata(for: game) else {
            throw StoreError.resourceUnavailable(metadata(for: game)?.file ?? game.rawValue)
        }

        if installingGames.contains(game) {
            while installingGames.contains(game) {
                try? await Task.sleep(for: .milliseconds(25))
            }
        }
        if loadedPacks[game]?.version != metadata.version {
            try await load(game, metadata: metadata)
        }
        defaults.set(metadata.version, forKey: installKey(for: game))

        if !enabledGames.contains(game) {
            loadedPacks.removeValue(forKey: game)
        }
        objectWillChange.send()
    }

    func remove(_ game: TCGGame) {
        let file = metadata(for: game)?.file
        defaults.removeObject(forKey: installKey(for: game))
        loadedPacks.removeValue(forKey: game)
        installProgress.removeValue(forKey: game)
        if let file {
            let source = self.source
            Task(priority: .utility) {
                await source.remove(file)
            }
        }
        objectWillChange.send()
    }

    func loadIfNeeded(_ game: TCGGame) async {
        guard TCGGame.catalogGames.contains(game),
              enabledGames.contains(game),
              loadedPacks[game] == nil,
              isInstalled(game),
              let metadata = metadata(for: game),
              metadata.version == installedVersion(for: game) else {
            return
        }

        if installingGames.contains(game) {
            while installingGames.contains(game) {
                try? await Task.sleep(for: .milliseconds(25))
            }
            return
        }

        do {
            try await load(game, metadata: metadata)
        } catch {
            // A missing or invalid generated resource degrades to the seed catalog.
            loadedPacks.removeValue(forKey: game)
        }
    }

    func search(query: String, tcg: TCGGame, limit: Int) -> [CatalogEntry] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty, limit > 0 else { return [] }
        let normalizedNeedle = needle.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: nil
        )

        let packs = searchablePacks(for: tcg)
        var results: [CatalogEntry] = []
        results.reserveCapacity(min(limit, 200))

        // Ordered passes rank name prefixes, then name substrings, then set metadata.
        for (game, pack) in packs {
            for card in pack.cards where name(card.name, hasPrefix: needle) {
                results.append(CatalogEntry(tcg: game, card: card))
                if results.count == limit { return results }
            }
        }

        for (game, pack) in packs {
            for card in pack.cards {
                guard !name(card.name, hasPrefix: needle),
                      card.name.range(
                        of: needle,
                        options: [.caseInsensitive, .diacriticInsensitive]
                      ) != nil else {
                    continue
                }
                results.append(CatalogEntry(tcg: game, card: card))
                if results.count == limit { return results }
            }
        }

        for (game, pack) in packs {
            for card in pack.cards {
                guard card.name.range(
                    of: needle,
                    options: [.caseInsensitive, .diacriticInsensitive]
                ) == nil,
                      let setCode = card.setCode,
                      pack.setSearchMetadata[setCode]?.contains(normalizedNeedle) == true else {
                    continue
                }
                results.append(CatalogEntry(tcg: game, card: card))
                if results.count == limit { return results }
            }
        }

        return results
    }

    func sets(tcg: TCGGame) -> [CatalogSetEntry] {
        guard tcg != .all, enabledGames.contains(tcg) else { return [] }
        return loadedPacks[tcg]?.sets ?? []
    }

    func cards(inSet setCode: String, tcg: TCGGame) -> [CatalogEntry] {
        guard tcg != .all,
              enabledGames.contains(tcg),
              let pack = loadedPacks[tcg] else {
            return []
        }
        return pack.cards.compactMap { card in
            card.setCode == setCode ? CatalogEntry(tcg: tcg, card: card) : nil
        }
    }

    func entry(id: String) -> CatalogEntry? {
        for game in TCGGame.catalogGames {
            guard enabledGames.contains(game), let pack = loadedPacks[game],
                  let card = pack.cards.first(where: { $0.id == id }) else {
                continue
            }
            return CatalogEntry(tcg: game, card: card)
        }
        return nil
    }

    func imageURL(for entry: CatalogEntry, thumbnail: Bool) -> URL? {
        switch entry.tcg {
        case .pokemon:
            guard let setCode = entry.card.setCode,
                  let collectorNumber = entry.card.collectorNumber,
                  let serie = loadedPacks[.pokemon]?.sets.first(where: { $0.code == setCode })?.serie else {
                return nil
            }
            let size = thumbnail ? "low" : "high"
            return URL(string: "https://assets.tcgdex.net/en/\(path(serie))/\(path(setCode))/\(path(collectorNumber))/\(size).webp")
        case .magic:
            let id = entry.card.id
            guard id.count >= 2 else { return nil }
            let first = id[id.startIndex]
            let second = id[id.index(after: id.startIndex)]
            let size = thumbnail ? "small" : "normal"
            return URL(string: "https://cards.scryfall.io/\(size)/front/\(first)/\(second)/\(path(id)).jpg")
        case .yugioh:
            guard let konamiId = entry.card.konamiId else { return nil }
            let directory = thumbnail ? "cards_small" : "cards"
            return URL(string: "https://images.ygoprodeck.com/images/\(directory)/\(konamiId).jpg")
        case .onepiece, .lorcana, .dragonball, .all:
            return nil
        }
    }

    func set(for entry: CatalogEntry) -> CatalogSetEntry? {
        guard let setCode = entry.card.setCode else { return nil }
        return loadedPacks[entry.tcg]?.sets.first(where: { $0.code == setCode })
    }

    private func isInstalled(_ game: TCGGame) -> Bool {
        installedVersion(for: game) != nil
    }

    private func installedVersion(for game: TCGGame) -> Int? {
        defaults.object(forKey: installKey(for: game)) as? Int
    }

    private func installKey(for game: TCGGame) -> String {
        "tcger.catalog.installedVersion.\(game.rawValue)"
    }

    private func searchablePacks(for tcg: TCGGame) -> [(TCGGame, LoadedCatalogPack)] {
        if tcg == .all {
            return TCGGame.catalogGames.compactMap { game in
                guard enabledGames.contains(game), let pack = loadedPacks[game] else { return nil }
                return (game, pack)
            }
        }
        guard enabledGames.contains(tcg), let pack = loadedPacks[tcg] else { return [] }
        return [(tcg, pack)]
    }

    private func load(_ game: TCGGame, metadata: CatalogManifestGame) async throws {
        guard !installingGames.contains(game) else { return }
        installingGames.insert(game)
        installProgress[game] = 0.05
        defer {
            installingGames.remove(game)
            installProgress.removeValue(forKey: game)
        }

        let source = self.source
        let file = metadata.file
        let data = try await source.data(for: file)
        installProgress[game] = 0.3

        let digest = await Task.detached(priority: .utility) {
            SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        }.value
        guard digest == metadata.sha256 else {
            throw StoreError.checksumMismatch(expected: game)
        }

        let pack = try await Task.detached(priority: .utility) {
            try JSONDecoder().decode(CatalogPack.self, from: data)
        }.value
        installProgress[game] = 0.9

        guard pack.formatVersion == 1 else {
            throw StoreError.unsupportedFormat(pack.formatVersion)
        }
        guard pack.tcg == game.rawValue,
              pack.version == metadata.version else {
            throw StoreError.invalidPack(expected: game)
        }

        loadedPacks[game] = LoadedCatalogPack(pack: pack)
        installProgress[game] = 1
    }

    private func name(_ name: String, hasPrefix query: String) -> Bool {
        name.range(
            of: query,
            options: [.anchored, .caseInsensitive, .diacriticInsensitive]
        ) != nil
    }

    private func path(_ component: String) -> String {
        component.addingPercentEncoding(
            withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        ) ?? component
    }
}

extension TCGGame {
    static let catalogGames: [TCGGame] = [.yugioh, .magic, .pokemon]

    var cardBackAssetName: String? {
        switch self {
        case .yugioh: return "YugiohCardBack"
        case .magic: return "MagicCardBack"
        case .pokemon: return "PokemonCardBack"
        case .onepiece, .lorcana, .dragonball, .all: return nil
        }
    }
}
