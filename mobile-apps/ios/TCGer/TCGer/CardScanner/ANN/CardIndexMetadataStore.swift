import Foundation

struct CardIndexMetadataEntry: Codable {
    let annIndex: Int
    let cardId: String
    let name: String
    let game: String?
    let setCode: String?
    let setName: String?
    let rarity: String?
    let imageURL: String?
    let price: Double?

    nonisolated var resolvedGame: TCGGame {
        guard let game else { return .pokemon }
        switch game.lowercased() {
        case "pokemon": return .pokemon
        case "magic", "mtg": return .magic
        case "yugioh", "yu-gi-oh", "yu_gi_oh": return .yugioh
        default: return .all
        }
    }
}

actor CardIndexMetadataStore {
    enum MetadataError: Error {
        case metadataUnavailable
    }

    static let shared = CardIndexMetadataStore()

    private let bundle: Bundle?
    private let resource: String
    private let fileExtension: String
    private var cache: [Int: CardIndexMetadataEntry] = [:]
    private var indicesByGameAndName: [TCGGame: [String: Set<Int>]] = [:]
    private var isLoaded = false
    nonisolated let supportedGames: Set<TCGGame>

    init(
        bundle: Bundle = .main,
        resource: String = "CardsIndexMetadata",
        fileExtension: String = "json"
    ) {
        self.bundle = bundle
        self.resource = resource
        self.fileExtension = fileExtension
        supportedGames = Self.detectSupportedGames(
            in: bundle,
            resource: resource,
            fileExtension: fileExtension
        )
    }

    /// In-memory initializer for unit tests and imported replay manifests.
    init(entries: [CardIndexMetadataEntry]) {
        bundle = nil
        resource = ""
        fileExtension = ""
        cache = entries.reduce(into: [:]) { result, entry in
            result[entry.annIndex] = entry
        }
        indicesByGameAndName = Self.makeNameIndex(entries)
        isLoaded = true
        supportedGames = Set(entries.map(\.resolvedGame).filter { $0 != .all })
    }

    func entry(for index: Int) -> CardIndexMetadataEntry? {
        loadIfNeeded()
        return cache[index]
    }

    func details(for index: Int) -> CardDetails? {
        loadIfNeeded()
        guard let entry = cache[index] else { return nil }
        return Self.makeDetails(from: entry)
    }

    func indices(for game: TCGGame) -> Set<Int> {
        loadIfNeeded()
        return Set(cache.values.lazy.filter { $0.resolvedGame == game }.map(\.annIndex))
    }

    func indices(for game: TCGGame, setCode: String?) -> Set<Int> {
        loadIfNeeded()
        guard let setCode else { return indices(for: game) }
        return Set(cache.values.lazy.filter {
            $0.resolvedGame == game &&
                $0.setCode?.caseInsensitiveCompare(setCode) == .orderedSame
        }.map(\.annIndex))
    }

    func entries(for game: TCGGame, setCode: String) -> [CardIndexMetadataEntry] {
        loadIfNeeded()
        return cache.values
            .filter {
                $0.resolvedGame == game &&
                    $0.setCode?.caseInsensitiveCompare(setCode) == .orderedSame
            }
            .sorted { $0.annIndex < $1.annIndex }
    }

    /// Returns the exact catalog name and printing rows confirmed by OCR.
    /// Matching is deliberately normalization-only (case, accents and
    /// punctuation); it does not use edit distance, so noisy text cannot pull
    /// the embedding search toward an unrelated card.
    func exactNameMatch(
        for candidates: [CardTitleOCR.Candidate],
        game: TCGGame,
        setCode: String?
    ) -> (name: String, indices: Set<Int>)? {
        loadIfNeeded()
        let names = indicesByGameAndName[game] ?? [:]
        let matches = candidates.compactMap { candidate -> (String, Set<Int>, Int, Double)? in
            guard candidate.confidence >= 0.25 else { return nil }
            let key = CardTitleOCR.normalizedName(candidate.text)
            guard key.count >= 4, var indices = names[key], !indices.isEmpty else { return nil }
            if let setCode {
                indices = indices.filter { cache[$0]?.setCode?.caseInsensitiveCompare(setCode) == .orderedSame }
            }
            guard !indices.isEmpty,
                  let canonicalName = indices.compactMap({ cache[$0]?.name }).first
            else { return nil }
            return (canonicalName, indices, key.count, candidate.confidence)
        }
        .sorted {
            if $0.2 != $1.2 { return $0.2 > $1.2 }
            return $0.3 > $1.3
        }
        return matches.first.map { ($0.0, $0.1) }
    }

    private func loadIfNeeded() {
        guard !isLoaded else { return }
        isLoaded = true
        guard let bundle else { return }

        let entries = Self.loadEntries(
            from: bundle,
            resource: resource,
            fileExtension: fileExtension
        )
        cache = entries.reduce(into: [:]) { result, entry in
            result[entry.annIndex] = entry
        }
        indicesByGameAndName = Self.makeNameIndex(entries)
    }

    private nonisolated static func makeNameIndex(
        _ entries: [CardIndexMetadataEntry]
    ) -> [TCGGame: [String: Set<Int>]] {
        entries.reduce(into: [:]) { result, entry in
            let game = entry.resolvedGame
            guard game != .all else { return }
            let key = CardTitleOCR.normalizedName(entry.name)
            guard !key.isEmpty else { return }
            result[game, default: [:]][key, default: []].insert(entry.annIndex)
        }
    }

    private nonisolated static func makeDetails(from entry: CardIndexMetadataEntry) -> CardDetails {
        let identity = CardIdentity(
            id: entry.cardId,
            name: entry.name,
            game: entry.resolvedGame,
            setCode: entry.setCode,
            setName: entry.setName
        )
        let url = entry.imageURL.flatMap(URL.init(string:))
        return CardDetails(
            identity: identity,
            rarity: entry.rarity,
            imageURL: url,
            price: entry.price,
            sourceCard: nil
        )
    }

    private nonisolated static func loadEntries(
        from bundle: Bundle,
        resource: String,
        fileExtension: String
    ) -> [CardIndexMetadataEntry] {
        guard let url = bundle.url(forResource: resource, withExtension: fileExtension) else {
            return []
        }
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode([CardIndexMetadataEntry].self, from: data)
        } catch {
            return []
        }
    }

    /// Determines mode support without decoding and indexing the full metadata
    /// catalog. The generated scanner metadata is compact JSON, so searching
    /// its memory-mapped bytes for the game field touches only a tiny fraction
    /// of the work performed by JSONDecoder and dictionary construction.
    private nonisolated static func detectSupportedGames(
        in bundle: Bundle,
        resource: String,
        fileExtension: String
    ) -> Set<TCGGame> {
        guard let url = bundle.url(forResource: resource, withExtension: fileExtension),
              let data = try? Data(contentsOf: url, options: .mappedIfSafe)
        else {
            return []
        }

        let tokens: [(TCGGame, [Data])] = [
            (.pokemon, [Data(#""game":"pokemon""#.utf8), Data(#""game": "pokemon""#.utf8)]),
            (.magic, [Data(#""game":"magic""#.utf8), Data(#""game": "magic""#.utf8)]),
            (.yugioh, [
                Data(#""game":"yugioh""#.utf8),
                Data(#""game": "yugioh""#.utf8),
                Data(#""game":"yu-gi-oh""#.utf8),
                Data(#""game": "yu-gi-oh""#.utf8),
            ]),
        ]
        return Set(tokens.compactMap { game, patterns in
            patterns.contains { data.range(of: $0) != nil } ? game : nil
        })
    }
}
