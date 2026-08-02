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

    private var cache: [Int: CardIndexMetadataEntry] = [:]
    nonisolated let supportedGames: Set<TCGGame>

    init(
        bundle: Bundle = .main,
        resource: String = "CardsIndexMetadata",
        fileExtension: String = "json"
    ) {
        let entries = Self.loadEntries(from: bundle, resource: resource, fileExtension: fileExtension)
        cache = entries.reduce(into: [:]) { result, entry in
            result[entry.annIndex] = entry
        }
        supportedGames = Set(entries.map(\.resolvedGame).filter { $0 != .all })
    }

    func entry(for index: Int) -> CardIndexMetadataEntry? {
        cache[index]
    }

    func details(for index: Int) -> CardDetails? {
        guard let entry = cache[index] else { return nil }
        return Self.makeDetails(from: entry)
    }

    func indices(for game: TCGGame) -> Set<Int> {
        Set(cache.values.lazy.filter { $0.resolvedGame == game }.map(\.annIndex))
    }

    func indices(for game: TCGGame, setCode: String?) -> Set<Int> {
        guard let setCode else { return indices(for: game) }
        return Set(cache.values.lazy.filter {
            $0.resolvedGame == game &&
                $0.setCode?.caseInsensitiveCompare(setCode) == .orderedSame
        }.map(\.annIndex))
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
}
