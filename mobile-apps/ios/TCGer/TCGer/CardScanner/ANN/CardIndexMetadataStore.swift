import Foundation

struct CardIndexMetadataEntry: Codable {
    let annIndex: Int
    let cardId: String
    let name: String
    let game: String
    let setCode: String?
    let setName: String?
    let rarity: String?
    let imageURL: String?
    let price: Double?
}

actor CardIndexMetadataStore {
    enum MetadataError: Error {
        case metadataUnavailable
    }

    static let shared = CardIndexMetadataStore()

    private var cache: [Int: CardIndexMetadataEntry] = [:]
    private var isLoaded = false

    func entry(for index: Int) -> CardIndexMetadataEntry? {
        cache[index]
    }

    func details(for index: Int) -> CardDetails? {
        guard let entry = cache[index] else { return nil }
        return Self.makeDetails(from: entry)
    }

    private nonisolated static func makeDetails(from entry: CardIndexMetadataEntry) -> CardDetails {
        let identity = CardIdentity(
            id: entry.cardId,
            name: entry.name,
            game: TCGGame(rawValue: entry.game) ?? .all,
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

    func loadIfNeeded(from bundle: Bundle = .main, resource: String = "CardsIndexMetadata", fileExtension: String = "json") async {
        guard !isLoaded else { return }
        guard let url = bundle.url(forResource: resource, withExtension: fileExtension) else {
            cache = [:]
            isLoaded = true
            return
        }
        do {
            let data = try Data(contentsOf: url)
            let entries = try JSONDecoder().decode([CardIndexMetadataEntry].self, from: data)
            cache = Dictionary(uniqueKeysWithValues: entries.map { ($0.annIndex, $0) })
        } catch {
            cache = [:]
        }
        isLoaded = true
    }
}
