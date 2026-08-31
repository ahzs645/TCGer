import Combine
import CryptoKit
import Foundation
import OSLog

nonisolated protocol CatalogSource: Sendable {
    func data(for filename: String) async throws -> Data
    func refreshData(for filename: String) async throws -> Data
    func remove(_ filename: String) async
}

nonisolated extension CatalogSource {
    func refreshData(for filename: String) async throws -> Data {
        try await data(for: filename)
    }
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
        if let cached = try? Data(contentsOf: cachedURL, options: .mappedIfSafe) {
            return filename == "manifest.json"
                ? await preferredManifestData(remote: cached)
                : cached
        }

        if let bundled = try? await fallback.data(for: filename) {
            return bundled
        }

        return try await refreshData(for: filename)
    }

    func refreshData(for filename: String) async throws -> Data {
        guard Self.isSafe(filename) else {
            throw CatalogStore.StoreError.resourceUnavailable(filename)
        }

        let cachedURL = cacheDirectory.appendingPathComponent(filename, isDirectory: false)

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
            return filename == "manifest.json"
                ? await preferredManifestData(remote: data)
                : data
        } catch {
            if let cached = try? Data(contentsOf: cachedURL, options: .mappedIfSafe) {
                return filename == "manifest.json"
                    ? await preferredManifestData(remote: cached)
                    : cached
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

    private func preferredManifestData(remote: Data) async -> Data {
        guard let bundled = try? await fallback.data(for: "manifest.json") else {
            return remote
        }
        return Self.mergeManifest(remote: remote, bundled: bundled)
    }

    nonisolated static func mergeManifest(remote: Data, bundled: Data) -> Data {
        let decoder = JSONDecoder()
        guard let bundledManifest = try? decoder.decode(CatalogManifest.self, from: bundled) else {
            return remote
        }
        guard let remoteManifest = try? decoder.decode(CatalogManifest.self, from: remote),
              remoteManifest.formatVersion == bundledManifest.formatVersion else {
            return bundled
        }

        var games = remoteManifest.games
        for (game, bundledEntry) in bundledManifest.games {
            let remoteSealed = games[game]?.sealedProducts
            if games[game].map({ $0.version < bundledEntry.version }) ?? true {
                games[game] = bundledEntry
            }
            if games[game]?.packageFile == nil,
               games[game]?.sha256 == bundledEntry.sha256 {
                games[game]?.packageFile = bundledEntry.packageFile
            }
            let preferredSealed = [remoteSealed, bundledEntry.sealedProducts]
                .compactMap { $0 }
                .max { $0.version < $1.version }
            if let preferredSealed {
                games[game]?.sealedProducts = preferredSealed
            }
        }
        let merged = CatalogManifest(
            formatVersion: remoteManifest.formatVersion,
            generatedAt: max(remoteManifest.generatedAt, bundledManifest.generatedAt),
            games: games
        )
        return (try? JSONEncoder().encode(merged)) ?? remote
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

nonisolated struct CatalogManifest: Codable, Sendable {
    let formatVersion: Int
    let generatedAt: String
    let games: [String: CatalogManifestGame]
}

nonisolated struct CatalogManifestGame: Codable, Sendable {
    let version: Int
    let cardCount: Int
    let setCount: Int
    let bytes: Int
    var compressedBytes: Int? = nil
    let sha256: String
    let file: String
    var packageFile: String? = nil
    var sealedProducts: SealedCatalogManifestEntry? = nil
}

struct OfficialGamePackage: Identifiable {
    let game: TCGGame
    let manifest: GamePackageManifest

    var id: String { manifest.installedId }
}

nonisolated struct SealedCatalogManifestEntry: Codable, Sendable {
    let version: Int
    let productCount: Int
    let bytes: Int
    var compressedBytes: Int? = nil
    let sha256: String
    let file: String
}

nonisolated struct CatalogSetEntry: Decodable, Hashable, Sendable {
    let code: String
    let name: String
    let serie: String?
    let releasedAt: String?
    let count: Int
    let standardCount: Int?
    let iconUrl: String?
    let iconFallbackUrl: String?
    let logoUrl: String?
    var setType: String? = nil
    var releaseYear: Int? = nil
    var boosters: [PokemonBooster]? = nil
}

/// The in-memory pack row intentionally contains only fields needed by offline
/// search, set browsing, Card mapping, and image URL derivation.
nonisolated struct CatalogCardEntry: Decodable, Hashable, Sendable {
    let id: String
    let name: String
    let setCode: String?
    let collectorNumber: String?
    let rarity: String?
    var dexEntries: [PokedexEntry]? = nil
    var artist: String? = nil
    var archetype: String? = nil
    var classifications: [String]? = nil
    var subtypes: [String]? = nil
    var variants: [String]? = nil
    var source: String? = nil
    var character: String? = nil
    var era: String? = nil
    var specialTrait: String? = nil
    var treatments: [String]? = nil
    var collectionTags: [String]? = nil
    let type: String?
    let types: [String]?
    let colors: [String]?
    let race: String?
    let level: Int?
    let konamiId: Int?
    let imageUrl: String?
    let imageUrlSmall: String?
    var printingKey: String? = nil
    var printingKind: String? = nil
    var sanctionedPlayLegal: Bool? = nil
    var originalPrintingKey: String? = nil
    var pokemonWorldChampionship: PokemonWorldChampionshipPrint? = nil
    var pokemonPocket: PokemonPocketMetadata? = nil
}

nonisolated struct CatalogEntry: Hashable, Sendable {
    let tcg: TCGGame
    let card: CatalogCardEntry
}

nonisolated enum CatalogInstallState: Equatable {
    case notInstalled
    case installed(version: Int)
}

nonisolated enum CatalogInstallPhase: Equatable {
    case downloading
    case verifying
    case decoding
    case preparingSearch

    var description: String {
        switch self {
        case .downloading: return "Downloading"
        case .verifying: return "Verifying download"
        case .decoding: return "Reading cards"
        case .preparingSearch: return "Preparing search"
        }
    }
}

@MainActor
final class CatalogStore: ObservableObject {
    static let shared = CatalogStore()
    private static let logger = Logger(subsystem: "firstform.TCGer", category: "CatalogStore")

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
    @Published private(set) var officialPackages: [OfficialGamePackage] = []
    @Published private(set) var installingGames: Set<TCGGame> = []
    @Published private(set) var installProgress: [TCGGame: Double] = [:]
    @Published private(set) var installPhases: [TCGGame: CatalogInstallPhase] = [:]
    @Published private(set) var installingSealedGames: Set<TCGGame> = []
    @Published private(set) var sealedInstallProgress: [TCGGame: Double] = [:]
    @Published private(set) var installedVersions: [TCGGame: Int] = [:]
    @Published private(set) var sealedInstalledVersions: [TCGGame: Int] = [:]

    nonisolated private struct CatalogPack: Decodable, Sendable {
        let formatVersion: Int
        let tcg: String
        let version: Int
        let updatedAt: String
        let sets: [CatalogSetEntry]
        let cards: [CatalogCardEntry]
    }

    nonisolated private struct SealedCatalogPack: Decodable, Sendable {
        let formatVersion: Int
        let tcg: String
        let version: Int
        let updatedAt: String
        let products: [SealedProduct]
    }

    nonisolated private struct SetSearchMetadata: Sendable {
        let name: String
        let code: String
        let officialCardCount: Int?

        func contains(_ query: String) -> Bool {
            name.contains(query) || code.contains(query)
        }
    }

    nonisolated private struct CardSearchMetadata: Sendable {
        let name: String
        let boundaryName: String
        let nameWords: [String]
        let searchableFields: [String]
        let collectorNumber: String?
        let displayCollectorNumber: String?
        let worldChampionshipYear: String?

        func hasWholeWordNamePrefix(_ query: String) -> Bool {
            boundaryName == query || boundaryName.hasPrefix("\(query) ")
        }

        func matchesAll(_ queryTerms: [String]) -> Bool {
            queryTerms.allSatisfy { term in
                if term.allSatisfy(\.isNumber) {
                    // A bare number is a collector-number query, not a loose
                    // substring of a name, set, or denominator.
                    return collectorNumber == term
                        || displayCollectorNumber == term
                        || worldChampionshipYear == term
                }
                return searchableFields.contains { $0.contains(term) }
            }
        }

        func nameIsSingleEditAway(from query: String) -> Bool {
            nameWords.contains { SearchTextNormalizer.isSingleEditAway($0, query) }
        }

        func namePrefixIsSingleEditAway(from query: String) -> Bool {
            nameWords.first.map { SearchTextNormalizer.isSingleEditAway($0, query) } == true
        }
    }

    nonisolated private struct LoadedCatalogPack: Sendable {
        let pack: CatalogPack
        let setsByCode: [String: CatalogSetEntry]
        let setSearchMetadata: [String: SetSearchMetadata]
        let cardSearchMetadata: [CardSearchMetadata]
        let nameTrigramPostings: [String: [Int]]
        let setTrigramPostings: [String: [Int]]
        let numericPostings: [String: [Int]]

        init(pack: CatalogPack) {
            self.pack = pack
            setsByCode = Dictionary(
                pack.sets.map { ($0.code, $0) },
                uniquingKeysWith: { first, _ in first }
            )
            let setMetadata = Dictionary(
                pack.sets.map { set in
                    let searchableName = set.serie?.lowercased() == "tcgp"
                        ? "\(set.name) pokemon pocket tcg pocket tcgp"
                        : set.name
                    return (
                        set.code,
                        SetSearchMetadata(
                            name: Self.normalize(searchableName),
                            code: Self.normalize(set.code),
                            officialCardCount: set.standardCount ?? (set.count > 0 ? set.count : nil)
                        )
                    )
                },
                uniquingKeysWith: { first, _ in first }
            )
            setSearchMetadata = setMetadata
            var metadata: [CardSearchMetadata] = []
            metadata.reserveCapacity(pack.cards.count)
            var namePostings: [String: [Int]] = [:]
            var setPostings: [String: [Int]] = [:]
            var numberPostings: [String: [Int]] = [:]

            for (index, card) in pack.cards.enumerated() {
                let set = card.setCode.flatMap { setMetadata[$0] }
                let collectorNumber = card.collectorNumber.map(Self.normalize)
                let displayCollectorNumber = CatalogStore.displayCollectorNumber(
                    card.collectorNumber,
                    tcg: TCGGame(rawValue: pack.tcg) ?? .all,
                    officialCardCount: set?.officialCardCount
                ).map(Self.normalize)
                let worlds = card.pokemonWorldChampionship
                var searchableFields = [Self.normalize(card.name)]
                if let setName = set?.name { searchableFields.append(setName) }
                if let setCode = set?.code { searchableFields.append(setCode) }
                if let collectorNumber { searchableFields.append(collectorNumber) }
                if let displayCollectorNumber { searchableFields.append(displayCollectorNumber) }
                if let printingKind = card.printingKind {
                    searchableFields.append(Self.normalize(printingKind))
                }
                if let artist = card.artist {
                    searchableFields.append(Self.normalize(artist))
                }
                if let archetype = card.archetype { searchableFields.append(Self.normalize(archetype)) }
                searchableFields.append(contentsOf: (card.classifications ?? []).map(Self.normalize))
                searchableFields.append(contentsOf: (card.subtypes ?? []).map(Self.normalize))
                searchableFields.append(contentsOf: (card.variants ?? []).map(Self.normalize))
                if let source = card.source { searchableFields.append(Self.normalize(source)) }
                if let character = card.character { searchableFields.append(Self.normalize(character)) }
                if let era = card.era { searchableFields.append(Self.normalize(era)) }
                if let specialTrait = card.specialTrait { searchableFields.append(Self.normalize(specialTrait)) }
                searchableFields.append(contentsOf: (card.treatments ?? []).map(Self.normalize))
                searchableFields.append(contentsOf: (card.collectionTags ?? []).map(Self.normalize))
                if let pocket = card.pokemonPocket {
                    searchableFields.append(contentsOf: ["pokemon pocket", "tcg pocket", "tcgp"])
                    if let effect = pocket.effect { searchableFields.append(Self.normalize(effect)) }
                    if let description = pocket.cardDescription {
                        searchableFields.append(Self.normalize(description))
                    }
                    searchableFields.append(contentsOf: (pocket.abilities ?? []).flatMap {
                        [Self.normalize($0.name), Self.normalize($0.effect)]
                    })
                    searchableFields.append(contentsOf: (pocket.attacks ?? []).flatMap {
                        [Self.normalize($0.name), $0.effect.map(Self.normalize)].compactMap { $0 }
                    })
                    searchableFields.append(contentsOf: (pocket.boosters ?? []).map {
                        Self.normalize($0.name)
                    })
                }
                if let worlds {
                    searchableFields.append(String(worlds.year))
                    searchableFields.append(Self.normalize(worlds.playerName))
                    if let deckName = worlds.deckName {
                        searchableFields.append(Self.normalize(deckName))
                    }
                    if let stamp = worlds.stamp {
                        searchableFields.append(Self.normalize(stamp))
                    }
                    searchableFields.append(contentsOf: [
                        "world", "worlds", "world championship", "wcd", "replica", "memorabilia"
                    ])
                }
                searchableFields.append(contentsOf: CatalogSearchAliases.normalizedAliases(forCardID: card.id))

                let cardMetadata = CardSearchMetadata(
                    name: Self.normalize(card.name),
                    boundaryName: SearchTextNormalizer.boundaryKey(card.name),
                    nameWords: SearchTextNormalizer.wordKeys(card.name),
                    searchableFields: searchableFields,
                    collectorNumber: collectorNumber,
                    displayCollectorNumber: displayCollectorNumber,
                    worldChampionshipYear: worlds.map { String($0.year) }
                )
                metadata.append(cardMetadata)

                Self.add(index, for: Self.trigrams(cardMetadata.name), to: &namePostings)
                // `SetSearchMetadata` is already normalized, and normalizing
                // again here makes that invariant explicit at the index edge.
                let searchableSetValues = [set?.name, set?.code]
                    .compactMap { $0 }
                    .map(Self.normalize)
                Self.add(
                    index,
                    for: Set(searchableSetValues.flatMap(Self.trigrams)),
                    to: &setPostings
                )
                let numericValues = [
                    cardMetadata.collectorNumber,
                    cardMetadata.displayCollectorNumber,
                    cardMetadata.worldChampionshipYear,
                ].compactMap { $0 }
                Self.add(index, for: Set(numericValues), to: &numberPostings)
            }
            cardSearchMetadata = metadata
            nameTrigramPostings = namePostings
            setTrigramPostings = setPostings
            numericPostings = numberPostings
        }

        var version: Int { pack.version }
        var sets: [CatalogSetEntry] { pack.sets }
        var cards: [CatalogCardEntry] { pack.cards }

        private static func normalize(_ value: String) -> String {
            SearchTextNormalizer.key(value)
        }

        private static func trigrams(_ value: String) -> Set<String> {
            let characters = Array(value)
            guard characters.count >= 3 else { return [] }
            return Set((0...(characters.count - 3)).map {
                String(characters[$0...($0 + 2)])
            })
        }

        private static func add<S: Sequence>(
            _ index: Int,
            for keys: S,
            to postings: inout [String: [Int]]
        ) where S.Element == String {
            for key in keys {
                postings[key, default: []].append(index)
            }
        }
    }

    nonisolated private struct SearchableCatalogPack: Sendable {
        let game: TCGGame
        let pack: LoadedCatalogPack
    }

    private let source: any CatalogSource
    private let defaults: UserDefaults
    private var loadedPacks: [TCGGame: LoadedCatalogPack] = [:]
    private var loadedSealedPacks: [TCGGame: SealedCatalogPack] = [:]
    private var enabledGames: Set<TCGGame> = []
    private var sealedProductsEnabled = true

    init(
        source: any CatalogSource = CatalogAssetConfiguration.catalogSource(),
        defaults: UserDefaults = .standard
    ) {
        self.source = source
        self.defaults = defaults
        installedVersions = Self.loadInstalledVersions(from: defaults, sealed: false)
        sealedInstalledVersions = Self.loadInstalledVersions(from: defaults, sealed: true)
        manifest = nil

        Task { [weak self] in
            await self?.loadManifest()
        }
    }

    func refreshManifest() async {
        await loadManifest(refreshing: true)
    }

    private func loadManifest(refreshing: Bool = false) async {
        do {
            let source = self.source
            let data: Data
            if refreshing {
                data = try await source.refreshData(for: "manifest.json")
            } else {
                data = try await source.data(for: "manifest.json")
            }
            let decoded = try await Task.detached(priority: .utility) {
                try JSONDecoder().decode(CatalogManifest.self, from: data)
            }.value
            guard decoded.formatVersion == 1 else {
                throw StoreError.unsupportedFormat(decoded.formatVersion)
            }
            manifest = decoded
            officialPackages = await loadOfficialGamePackages(from: decoded)
            for game in TCGGame.catalogGames where enabledGames.contains(game) && isInstalled(game) {
                await loadIfNeeded(game)
            }
            if sealedProductsEnabled {
                for game in TCGGame.catalogGames where enabledGames.contains(game) && isSealedInstalled(game) {
                    await loadSealedIfNeeded(game)
                }
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

    func officialGamePackages() async -> [OfficialGamePackage] {
        if manifest == nil { await loadManifest() }
        guard let manifest else { return [] }
        if officialPackages.isEmpty, !manifest.games.isEmpty {
            officialPackages = await loadOfficialGamePackages(from: manifest)
        }
        return officialPackages
    }

    private func loadOfficialGamePackages(from manifest: CatalogManifest) async -> [OfficialGamePackage] {
        var packages: [OfficialGamePackage] = []
        for (gameID, entry) in manifest.games {
            guard let game = TCGGame(rawValue: gameID),
                  game != .all,
                  let packageFile = entry.packageFile,
                  let data = try? await source.data(for: packageFile),
                  let package = try? JSONDecoder().decode(GamePackageManifest.self, from: data),
                  package.publisher.id == "tcger",
                  package.game.id == gameID,
                  package.catalog.cardCount == entry.cardCount,
                  package.catalog.asset.sha256.caseInsensitiveCompare(entry.sha256) == .orderedSame else {
                continue
            }
            packages.append(OfficialGamePackage(game: game, manifest: package))
        }
        return packages.sorted {
            $0.manifest.game.name.localizedCaseInsensitiveCompare($1.manifest.game.name) == .orderedAscending
        }
    }

    func sealedMetadata(for game: TCGGame) -> SealedCatalogManifestEntry? {
        metadata(for: game)?.sealedProducts
    }

    func installState(for game: TCGGame) -> CatalogInstallState {
        guard let version = installedVersions[game] else {
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

    func sealedInstallState(for game: TCGGame) -> CatalogInstallState {
        guard let version = sealedInstalledVersions[game] else {
            return .notInstalled
        }
        return .installed(version: version)
    }

    func isSealedAvailable(_ game: TCGGame) -> Bool {
        sealedMetadata(for: game) != nil
    }

    func isSealedUpdateAvailable(_ game: TCGGame) -> Bool {
        guard let metadata = sealedMetadata(for: game),
              case .installed(let version) = sealedInstallState(for: game) else {
            return false
        }
        return version < metadata.version
    }

    func isLoaded(_ game: TCGGame) -> Bool {
        loadedPacks[game] != nil
    }

    func installStatus(for game: TCGGame) -> String? {
        installPhases[game]?.description
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
        for loadedGame in Array(loadedSealedPacks.keys) where !games.contains(loadedGame) {
            loadedSealedPacks.removeValue(forKey: loadedGame)
        }

        for game in TCGGame.catalogGames where games.contains(game) && isInstalled(game) {
            await loadIfNeeded(game)
        }
        if sealedProductsEnabled {
            for game in TCGGame.catalogGames where games.contains(game) && isSealedInstalled(game) {
                await loadSealedIfNeeded(game)
            }
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
            loadedSealedPacks.removeValue(forKey: game)
        }
    }

    func setSealedProductsEnabled(_ enabled: Bool) {
        sealedProductsEnabled = enabled
        if enabled {
            for game in TCGGame.catalogGames where enabledGames.contains(game) && isSealedInstalled(game) {
                Task(priority: .utility) { await loadSealedIfNeeded(game) }
            }
        } else {
            for game in TCGGame.catalogGames {
                removeSealed(game)
            }
        }
    }

    func install(_ game: TCGGame, forceReload: Bool = false) async throws {
        guard game != .all,
              let metadata = metadata(for: game) else {
            throw StoreError.resourceUnavailable(metadata(for: game)?.file ?? game.rawValue)
        }

        if installingGames.contains(game) {
            while installingGames.contains(game) {
                try? await Task.sleep(for: .milliseconds(25))
            }
        }
        if forceReload {
            loadedPacks.removeValue(forKey: game)
            await source.remove(metadata.file)
        }
        if loadedPacks[game]?.version != metadata.version {
            try await load(game, metadata: metadata)
        }
        defaults.removeObject(forKey: deletionKey(for: game))
        defaults.set(metadata.version, forKey: installKey(for: game))

        if !enabledGames.contains(game) {
            loadedPacks.removeValue(forKey: game)
        }
        installedVersions[game] = metadata.version
    }

    func remove(_ game: TCGGame) {
        let file = metadata(for: game)?.file
        defaults.set(true, forKey: deletionKey(for: game))
        defaults.removeObject(forKey: installKey(for: game))
        loadedPacks.removeValue(forKey: game)
        installProgress.removeValue(forKey: game)
        if let file {
            let source = self.source
            Task(priority: .utility) {
                await source.remove(file)
            }
        }
        installedVersions.removeValue(forKey: game)
    }

    func installSealed(_ game: TCGGame, forceReload: Bool = false) async throws {
        guard game != .all, let metadata = sealedMetadata(for: game) else {
            throw StoreError.resourceUnavailable(game.rawValue)
        }
        if installingSealedGames.contains(game) {
            while installingSealedGames.contains(game) {
                try? await Task.sleep(for: .milliseconds(25))
            }
        }
        if forceReload {
            loadedSealedPacks.removeValue(forKey: game)
            await source.remove(metadata.file)
        }
        if loadedSealedPacks[game]?.version != metadata.version {
            try await loadSealed(game, metadata: metadata)
        }
        defaults.set(metadata.version, forKey: sealedInstallKey(for: game))
        if !enabledGames.contains(game) || !sealedProductsEnabled {
            loadedSealedPacks.removeValue(forKey: game)
        }
        sealedInstalledVersions[game] = metadata.version
    }

    func removeSealed(_ game: TCGGame) {
        let file = sealedMetadata(for: game)?.file
        defaults.removeObject(forKey: sealedInstallKey(for: game))
        loadedSealedPacks.removeValue(forKey: game)
        sealedInstallProgress.removeValue(forKey: game)
        if let file {
            let source = self.source
            Task(priority: .utility) { await source.remove(file) }
        }
        sealedInstalledVersions.removeValue(forKey: game)
    }

    func sealedProducts(tcg: TCGGame? = nil) -> [SealedProduct] {
        guard sealedProductsEnabled else { return [] }
        let games = tcg.map { [$0] } ?? TCGGame.catalogGames
        return games.flatMap { game -> [SealedProduct] in
            guard enabledGames.contains(game) else { return [] }
            return loadedSealedPacks[game]?.products ?? []
        }
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
            Self.logger.error(
                "Failed to load the \(game.rawValue, privacy: .public) catalog: \(error.localizedDescription, privacy: .public)"
            )
            loadedPacks.removeValue(forKey: game)
        }
    }

    func loadSealedIfNeeded(_ game: TCGGame) async {
        guard sealedProductsEnabled,
              TCGGame.catalogGames.contains(game),
              enabledGames.contains(game),
              loadedSealedPacks[game] == nil,
              isSealedInstalled(game),
              let metadata = sealedMetadata(for: game),
              metadata.version == sealedInstalledVersion(for: game) else {
            return
        }
        do {
            try await loadSealed(game, metadata: metadata)
        } catch {
            Self.logger.error(
                "Failed to load the \(game.rawValue, privacy: .public) sealed catalog: \(error.localizedDescription, privacy: .public)"
            )
            loadedSealedPacks.removeValue(forKey: game)
        }
    }

    func search(query: String, tcg: TCGGame, limit: Int) -> [CatalogEntry] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty, limit > 0 else { return [] }
        let normalizedNeedle = SearchTextNormalizer.key(needle)
        guard !normalizedNeedle.isEmpty else { return [] }
        let boundaryNeedle = SearchTextNormalizer.boundaryKey(needle)
        let queryTerms = SearchTextNormalizer.termKeys(needle)

        let packs = searchablePacks(for: tcg)
        var results: [CatalogEntry] = []
        results.reserveCapacity(min(limit, 200))

        // Prefer prefixes that respect printed word boundaries. A compact
        // punctuation-insensitive prefix remains a lower-ranked fallback, so
        // `Dark Raichu` is still found for `Darkrai` without preceding Darkrai.
        for (game, pack) in packs {
            for (card, metadata) in zip(pack.cards, pack.cardSearchMetadata)
                where metadata.hasWholeWordNamePrefix(boundaryNeedle) {
                results.append(CatalogEntry(tcg: game, card: card))
                if results.count == limit { return results }
            }
        }

        for (game, pack) in packs {
            for (card, metadata) in zip(pack.cards, pack.cardSearchMetadata) {
                guard !metadata.hasWholeWordNamePrefix(boundaryNeedle),
                      metadata.boundaryName.hasPrefix(boundaryNeedle) else {
                    continue
                }
                results.append(CatalogEntry(tcg: game, card: card))
                if results.count == limit { return results }
            }
        }

        for (game, pack) in packs {
            for (card, metadata) in zip(pack.cards, pack.cardSearchMetadata) {
                guard !metadata.boundaryName.hasPrefix(boundaryNeedle),
                      metadata.name.hasPrefix(normalizedNeedle) else {
                    continue
                }
                results.append(CatalogEntry(tcg: game, card: card))
                if results.count == limit { return results }
            }
        }

        for (game, pack) in packs {
            for (card, metadata) in zip(pack.cards, pack.cardSearchMetadata) {
                guard !metadata.name.hasPrefix(normalizedNeedle),
                      metadata.name.contains(normalizedNeedle) else {
                    continue
                }
                results.append(CatalogEntry(tcg: game, card: card))
                if results.count == limit { return results }
            }
        }

        for (game, pack) in packs {
            for (card, metadata) in zip(pack.cards, pack.cardSearchMetadata) {
                guard !metadata.name.contains(normalizedNeedle),
                      let setCode = card.setCode,
                      pack.setSearchMetadata[setCode]?.contains(normalizedNeedle) == true else {
                    continue
                }
                results.append(CatalogEntry(tcg: game, card: card))
                if results.count == limit { return results }
            }
        }

        // Multi-term queries may span the card name, set, and collector number.
        // Existing ordered passes stay first so established name-prefix ranking
        // is unchanged for ordinary queries such as `Lucario`.
        let existingIDs = Set(results.map(\.card.id))
        for (game, pack) in packs {
            for (card, metadata) in zip(pack.cards, pack.cardSearchMetadata) {
                guard !existingIDs.contains(card.id), metadata.matchesAll(queryTerms) else {
                    continue
                }
                results.append(CatalogEntry(tcg: game, card: card))
                if results.count == limit { return results }
            }
        }

        // Typo tolerance is deliberately an empty-result fallback. It handles
        // one long misspelled card-name word (`Lucaio` -> `Lucario`) without
        // adding near-neighbor noise to otherwise successful searches.
        if results.isEmpty,
           queryTerms.count == 1,
           let queryTerm = queryTerms.first,
           queryTerm.count >= 5,
           queryTerm.allSatisfy(\.isLetter) {
            for (game, pack) in packs {
                for (card, metadata) in zip(pack.cards, pack.cardSearchMetadata)
                    where metadata.namePrefixIsSingleEditAway(from: queryTerm) {
                    results.append(CatalogEntry(tcg: game, card: card))
                    if results.count == limit { return results }
                }
            }
            let prefixIDs = Set(results.map(\.card.id))
            for (game, pack) in packs {
                for (card, metadata) in zip(pack.cards, pack.cardSearchMetadata)
                    where !prefixIDs.contains(card.id)
                        && metadata.nameIsSingleEditAway(from: queryTerm) {
                    results.append(CatalogEntry(tcg: game, card: card))
                    if results.count == limit { return results }
                }
            }
        }

        return results
    }

    /// Snapshot the immutable loaded packs on the main actor, then use the
    /// precomputed trigram postings and perform all matching/ranking work on a
    /// utility task. The synchronous variant above remains available for
    /// import-only code paths and as a behavior reference.
    func searchAsync(query: String, tcg: TCGGame, limit: Int) async -> [CatalogEntry] {
        let snapshots = searchablePacks(for: tcg).map {
            SearchableCatalogPack(game: $0.0, pack: $0.1)
        }
        return await Task.detached(priority: .userInitiated) {
            Self.indexedSearch(query: query, packs: snapshots, limit: limit)
        }.value
    }

    nonisolated private static func indexedSearch(
        query: String,
        packs: [SearchableCatalogPack],
        limit: Int
    ) -> [CatalogEntry] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty, limit > 0 else { return [] }
        let normalizedNeedle = SearchTextNormalizer.key(needle)
        guard !normalizedNeedle.isEmpty else { return [] }
        let boundaryNeedle = SearchTextNormalizer.boundaryKey(needle)
        let queryTerms = SearchTextNormalizer.termKeys(needle)
        var results: [CatalogEntry] = []
        results.reserveCapacity(min(limit, 200))

        for snapshot in packs {
            let pack = snapshot.pack
            for index in candidateIndices(
                for: normalizedNeedle,
                postings: pack.nameTrigramPostings,
                count: pack.cards.count
            ) where pack.cardSearchMetadata[index].hasWholeWordNamePrefix(boundaryNeedle) {
                results.append(CatalogEntry(tcg: snapshot.game, card: pack.cards[index]))
                if results.count == limit { return results }
            }
        }

        for snapshot in packs {
            let pack = snapshot.pack
            for index in candidateIndices(
                for: normalizedNeedle,
                postings: pack.nameTrigramPostings,
                count: pack.cards.count
            ) {
                let metadata = pack.cardSearchMetadata[index]
                guard !metadata.hasWholeWordNamePrefix(boundaryNeedle),
                      metadata.boundaryName.hasPrefix(boundaryNeedle) else { continue }
                results.append(CatalogEntry(tcg: snapshot.game, card: pack.cards[index]))
                if results.count == limit { return results }
            }
        }

        for snapshot in packs {
            let pack = snapshot.pack
            for index in candidateIndices(
                for: normalizedNeedle,
                postings: pack.nameTrigramPostings,
                count: pack.cards.count
            ) {
                let metadata = pack.cardSearchMetadata[index]
                guard !metadata.boundaryName.hasPrefix(boundaryNeedle),
                      metadata.name.hasPrefix(normalizedNeedle) else { continue }
                results.append(CatalogEntry(tcg: snapshot.game, card: pack.cards[index]))
                if results.count == limit { return results }
            }
        }

        for snapshot in packs {
            let pack = snapshot.pack
            for index in candidateIndices(
                for: normalizedNeedle,
                postings: pack.nameTrigramPostings,
                count: pack.cards.count
            ) {
                let metadata = pack.cardSearchMetadata[index]
                guard !metadata.name.hasPrefix(normalizedNeedle),
                      metadata.name.contains(normalizedNeedle) else { continue }
                results.append(CatalogEntry(tcg: snapshot.game, card: pack.cards[index]))
                if results.count == limit { return results }
            }
        }

        for snapshot in packs {
            let pack = snapshot.pack
            for index in candidateIndices(
                for: normalizedNeedle,
                postings: pack.setTrigramPostings,
                count: pack.cards.count
            ) {
                let card = pack.cards[index]
                let metadata = pack.cardSearchMetadata[index]
                guard !metadata.name.contains(normalizedNeedle),
                      let setCode = card.setCode,
                      pack.setSearchMetadata[setCode]?.contains(normalizedNeedle) == true else {
                    continue
                }
                results.append(CatalogEntry(tcg: snapshot.game, card: card))
                if results.count == limit { return results }
            }
        }

        let existingIDs = Set(results.map(\.card.id))
        for snapshot in packs {
            let pack = snapshot.pack
            for index in multiTermCandidateIndices(queryTerms, pack: pack) {
                let card = pack.cards[index]
                guard !existingIDs.contains(card.id),
                      pack.cardSearchMetadata[index].matchesAll(queryTerms) else { continue }
                results.append(CatalogEntry(tcg: snapshot.game, card: card))
                if results.count == limit { return results }
            }
        }

        // Edit-distance fallback remains linear, but only runs when all exact
        // indexed passes return nothing for one sufficiently long word.
        if results.isEmpty,
           queryTerms.count == 1,
           let queryTerm = queryTerms.first,
           queryTerm.count >= 5,
           queryTerm.allSatisfy(\.isLetter) {
            for snapshot in packs {
                let pack = snapshot.pack
                for (card, metadata) in zip(pack.cards, pack.cardSearchMetadata)
                    where metadata.namePrefixIsSingleEditAway(from: queryTerm) {
                    results.append(CatalogEntry(tcg: snapshot.game, card: card))
                    if results.count == limit { return results }
                }
            }
            let prefixIDs = Set(results.map(\.card.id))
            for snapshot in packs {
                let pack = snapshot.pack
                for (card, metadata) in zip(pack.cards, pack.cardSearchMetadata)
                    where !prefixIDs.contains(card.id)
                        && metadata.nameIsSingleEditAway(from: queryTerm) {
                    results.append(CatalogEntry(tcg: snapshot.game, card: card))
                    if results.count == limit { return results }
                }
            }
        }

        return results
    }

    nonisolated private static func candidateIndices(
        for value: String,
        postings: [String: [Int]],
        count: Int
    ) -> [Int] {
        let grams = trigrams(value)
        guard !grams.isEmpty else { return Array(0..<count) }
        let lists = grams.compactMap { postings[$0] }
        guard lists.count == grams.count,
              var candidates = lists.min(by: { $0.count < $1.count }) else { return [] }
        for list in lists {
            let allowed = Set(list)
            candidates.removeAll { !allowed.contains($0) }
            if candidates.isEmpty { break }
        }
        return candidates.sorted()
    }

    nonisolated private static func multiTermCandidateIndices(
        _ terms: [String],
        pack: LoadedCatalogPack
    ) -> [Int] {
        // Extended searchable fields include artist, variants, treatments, and
        // collection tags. Magic alone currently has more than 450,000 tags;
        // expanding every one into trigram posting lists made installation
        // disproportionately slow and memory-hungry. Numeric terms still give
        // us a safe, compact narrowing index. Other terms are verified by
        // `matchesAll` in the detached search task, preserving search results
        // without making installation build a second catalog-sized structure.
        var candidates: [Int]?
        for term in terms where term.allSatisfy(\.isNumber) {
            let next = pack.numericPostings[term] ?? []
            if let current = candidates {
                let allowed = Set(next)
                candidates = current.filter(allowed.contains)
            } else {
                candidates = next
            }
            if candidates?.isEmpty == true { return [] }
        }
        return candidates ?? Array(0..<pack.cards.count)
    }

    nonisolated private static func trigrams(_ value: String) -> Set<String> {
        let characters = Array(value)
        guard characters.count >= 3 else { return [] }
        return Set((0...(characters.count - 3)).map {
            String(characters[$0...($0 + 2)])
        })
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

    /// Pokémon printings carrying normalized Pokédex metadata. This keeps the
    /// completion screen on the same downloaded catalog used by search.
    func pokedexCards() -> [CatalogEntry] {
        guard enabledGames.contains(.pokemon), let pack = loadedPacks[.pokemon] else {
            return []
        }
        return pack.cards.compactMap { card in
            let isPokemon: Bool
            switch card.type {
            case "Pokemon", "Pokémon":
                isPokemon = true
            case let type?:
                isPokemon = SearchTextNormalizer.key(type) == "pokemon"
            case nil:
                isPokemon = false
            }
            guard isPokemon else { return nil }
            return CatalogEntry(tcg: .pokemon, card: card)
        }
    }

    func cards(byArtist artist: String, tcg: TCGGame) -> [CatalogEntry] {
        guard tcg != .all,
              enabledGames.contains(tcg),
              let pack = loadedPacks[tcg] else {
            return []
        }
        let normalizedArtist = SearchTextNormalizer.key(artist)
        return pack.cards.compactMap { card in
            guard card.artist.map(SearchTextNormalizer.key) == normalizedArtist else {
                return nil
            }
            return CatalogEntry(tcg: tcg, card: card)
        }
    }

    func cards(tagged tag: String, tcg: TCGGame) -> [CatalogEntry] {
        guard tcg != .all,
              enabledGames.contains(tcg),
              let pack = loadedPacks[tcg] else {
            return []
        }
        let normalizedTag = SearchTextNormalizer.key(tag)
        return pack.cards.compactMap { card in
            guard card.collectionTags?.contains(where: {
                SearchTextNormalizer.key($0) == normalizedTag
            }) == true else { return nil }
            return CatalogEntry(tcg: tcg, card: card)
        }
    }

    func hasCollectionTagMetadata(for game: TCGGame) -> Bool {
        guard game != .all,
              enabledGames.contains(game),
              let pack = loadedPacks[game] else {
            return false
        }
        return pack.cards.contains { $0.collectionTags?.isEmpty == false }
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
        let storedURL = thumbnail
            ? entry.card.imageUrlSmall ?? entry.card.imageUrl
            : entry.card.imageUrl ?? entry.card.imageUrlSmall
        if let storedURL, let url = URL(string: storedURL) {
            return url
        }

        switch entry.tcg {
        case .pokemon:
            guard let setCode = entry.card.setCode,
                  let collectorNumber = entry.card.collectorNumber,
                  let serie = loadedPacks[.pokemon]?.setsByCode[setCode]?.serie else {
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
        return loadedPacks[entry.tcg]?.setsByCode[setCode]
    }

    /// A display/search form such as `3/11`, derived without changing the
    /// catalog's canonical collector number used for image and identity keys.
    func displayCollectorNumber(for entry: CatalogEntry) -> String? {
        let set = set(for: entry)
        return Self.displayCollectorNumber(
            entry.card.collectorNumber,
            tcg: entry.tcg,
            officialCardCount: set?.standardCount ?? set?.count
        )
    }

    nonisolated static func displayCollectorNumber(
        _ raw: String?,
        tcg: TCGGame,
        officialCardCount: Int?
    ) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard tcg == .pokemon,
              !trimmed.contains("/"),
              trimmed.allSatisfy(\.isNumber),
              let officialCardCount,
              officialCardCount > 0 else {
            return trimmed
        }
        return "\(trimmed)/\(officialCardCount)"
    }

    func isInstalled(_ game: TCGGame) -> Bool {
        installedVersion(for: game) != nil
    }

    private func isSealedInstalled(_ game: TCGGame) -> Bool {
        sealedInstalledVersion(for: game) != nil
    }

    private func installedVersion(for game: TCGGame) -> Int? {
        installedVersions[game]
    }

    private func installKey(for game: TCGGame) -> String {
        "tcger.catalog.installedVersion.\(game.rawValue)"
    }

    private func deletionKey(for game: TCGGame) -> String {
        "tcger.catalog.deleted.\(game.rawValue)"
    }

    private func sealedInstalledVersion(for game: TCGGame) -> Int? {
        sealedInstalledVersions[game]
    }

    private func sealedInstallKey(for game: TCGGame) -> String {
        "tcger.catalog.sealed.installedVersion.\(game.rawValue)"
    }

    private static func loadInstalledVersions(
        from defaults: UserDefaults,
        sealed: Bool
    ) -> [TCGGame: Int] {
        Dictionary(uniqueKeysWithValues: TCGGame.catalogGames.compactMap { game in
            if !sealed, defaults.bool(forKey: "tcger.catalog.deleted.\(game.rawValue)") {
                return nil
            }
            let component = sealed ? "sealed.installedVersion" : "installedVersion"
            let key = "tcger.catalog.\(component).\(game.rawValue)"
            guard let version = defaults.object(forKey: key) as? Int else { return nil }
            return (game, version)
        })
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
        installPhases[game] = .downloading
        installProgress[game] = 0.1
        defer {
            installingGames.remove(game)
            installPhases.removeValue(forKey: game)
            installProgress.removeValue(forKey: game)
        }

        let source = self.source
        let file = metadata.file
        var data = try await source.data(for: file)
        installPhases[game] = .verifying
        installProgress[game] = 0.55

        var digest = await Self.digest(for: data)
        if digest != metadata.sha256 {
            // Immutable filenames make this unusual, but a truncated or legacy
            // cache entry should heal itself instead of permanently blocking an update.
            await source.remove(file)
            data = try await source.data(for: file)
            digest = await Self.digest(for: data)
            guard digest == metadata.sha256 else {
                throw StoreError.checksumMismatch(expected: game)
            }
        }

        installPhases[game] = .decoding
        installProgress[game] = 0.7
        let pack = try await Task.detached(priority: .utility) {
            try JSONDecoder().decode(CatalogPack.self, from: data)
        }.value
        installProgress[game] = 0.85

        guard pack.formatVersion == 1 else {
            throw StoreError.unsupportedFormat(pack.formatVersion)
        }
        guard pack.tcg == game.rawValue,
              pack.version == metadata.version else {
            throw StoreError.invalidPack(expected: game)
        }

        // Normalization and posting-list construction touch every catalog row;
        // keep that work off the main actor just like JSON decoding.
        installPhases[game] = .preparingSearch
        let loadedPack = await Task.detached(priority: .utility) {
            LoadedCatalogPack(pack: pack)
        }.value
        loadedPacks[game] = loadedPack
        installProgress[game] = 1
    }

    private func loadSealed(
        _ game: TCGGame,
        metadata: SealedCatalogManifestEntry
    ) async throws {
        guard !installingSealedGames.contains(game) else { return }
        installingSealedGames.insert(game)
        sealedInstallProgress[game] = 0.05
        defer {
            installingSealedGames.remove(game)
            sealedInstallProgress.removeValue(forKey: game)
        }

        let file = metadata.file
        var data = try await source.data(for: file)
        sealedInstallProgress[game] = 0.3
        var digest = await Self.digest(for: data)
        if digest != metadata.sha256 {
            await source.remove(file)
            data = try await source.data(for: file)
            digest = await Self.digest(for: data)
            guard digest == metadata.sha256 else {
                throw StoreError.checksumMismatch(expected: game)
            }
        }
        let pack = try await Task.detached(priority: .utility) {
            try JSONDecoder().decode(SealedCatalogPack.self, from: data)
        }.value
        sealedInstallProgress[game] = 0.9
        guard pack.formatVersion == 1 else {
            throw StoreError.unsupportedFormat(pack.formatVersion)
        }
        guard pack.tcg == game.rawValue, pack.version == metadata.version else {
            throw StoreError.invalidPack(expected: game)
        }
        loadedSealedPacks[game] = pack
        sealedInstallProgress[game] = 1
    }

    nonisolated private static func digest(for data: Data) async -> String {
        await Task.detached(priority: .utility) {
            SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        }.value
    }

    private func path(_ component: String) -> String {
        component.addingPercentEncoding(
            withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        ) ?? component
    }
}

extension TCGGame {
    static let catalogGames: [TCGGame] = [
        .yugioh,
        .magic,
        .pokemon,
        .onepiece,
        .lorcana,
        .dragonball
    ]

    var cardBackAssetName: String? {
        switch self {
        case .yugioh: return "YugiohCardBack"
        case .magic: return "MagicCardBack"
        case .pokemon: return "PokemonCardBack"
        case .onepiece: return "OnePieceCardBack"
        case .lorcana: return "LorcanaCardBack"
        case .dragonball: return "DragonBallCardBack"
        case .all: return nil
        }
    }
}
