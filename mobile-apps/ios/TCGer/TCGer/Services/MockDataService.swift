import Foundation

actor MockDataService {
    private var collections: [Collection] = []

    init() {
        // Initialize with sample data
        collections = Self.sampleCollections()
    }

    func getCollections() async throws -> [Collection] {
        // Simulate network delay
        try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        return collections
    }

    func getCollection(id: String) async throws -> Collection {
        try await Task.sleep(nanoseconds: 300_000_000)

        guard let collection = collections.first(where: { $0.id == id }) else {
            throw NSError(domain: "MockData", code: 404, userInfo: [NSLocalizedDescriptionKey: "Collection not found"])
        }
        return collection
    }

    func createCollection(name: String, description: String?) async throws -> Collection {
        try await Task.sleep(nanoseconds: 300_000_000)

        let newCollection = Collection(
            id: UUID().uuidString,
            name: name,
            description: description,
            cards: [],
            createdAt: ISO8601DateFormatter().string(from: Date()),
            updatedAt: ISO8601DateFormatter().string(from: Date()),
            colorHex: nil
        )

        collections.append(newCollection)
        return newCollection
    }

    func deleteCollection(id: String) async throws {
        try await Task.sleep(nanoseconds: 300_000_000)
        collections.removeAll { $0.id == id }
    }

    // MARK: - Sample Data
    private static func sampleCollections() -> [Collection] {
        return [
            Collection(
                id: "1",
                name: "Main Binder",
                description: "My primary collection of rare cards",
                cards: [
                    CollectionCard(
                        id: "c1",
                        cardId: "card-1",
                        name: "Dark Magician",
                        tcg: "yugioh",
                        setCode: "YGLD-EN",
                        rarity: "Ultra Rare",
                        imageUrl: nil,
                        imageUrlSmall: nil,
                        quantity: 2,
                        price: 15.99,
                        condition: "Near Mint",
                        language: "English",
                        notes: "First edition"
                    ),
                    CollectionCard(
                        id: "c2",
                        cardId: "card-2",
                        name: "Black Lotus",
                        tcg: "magic",
                        setCode: "LEA",
                        rarity: "Rare",
                        imageUrl: nil,
                        imageUrlSmall: nil,
                        quantity: 1,
                        price: 25000.00,
                        condition: "Mint",
                        language: "English",
                        notes: "Alpha edition"
                    ),
                    CollectionCard(
                        id: "c3",
                        cardId: "card-3",
                        name: "Charizard",
                        tcg: "pokemon",
                        setCode: "BS-4",
                        rarity: "Holo Rare",
                        imageUrl: nil,
                        imageUrlSmall: nil,
                        quantity: 3,
                        price: 450.00,
                        condition: "Near Mint",
                        language: "English",
                        notes: "Base Set"
                    )
                ],
                createdAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-86400 * 30)),
                updatedAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-86400))
            ),
            Collection(
                id: "2",
                name: "Yu-Gi-Oh! Collection",
                description: "Competitive Yu-Gi-Oh! deck cards",
                cards: [
                    CollectionCard(
                        id: "c4",
                        cardId: "card-4",
                        name: "Blue-Eyes White Dragon",
                        tcg: "yugioh",
                        setCode: "SDK-001",
                        rarity: "Ultra Rare",
                        imageUrl: nil,
                        imageUrlSmall: nil,
                        quantity: 3,
                        price: 89.99,
                        condition: "Near Mint",
                        language: "English",
                        notes: nil
                    ),
                    CollectionCard(
                        id: "c5",
                        cardId: "card-5",
                        name: "Pot of Greed",
                        tcg: "yugioh",
                        setCode: "LOB-119",
                        rarity: "Rare",
                        imageUrl: nil,
                        imageUrlSmall: nil,
                        quantity: 1,
                        price: 12.50,
                        condition: "Near Mint",
                        language: "English",
                        notes: "Banned card"
                    )
                ],
                createdAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-86400 * 15)),
                updatedAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3600))
            ),
            Collection(
                id: "3",
                name: "Pokémon Favorites",
                description: "My favorite Pokémon cards from childhood",
                cards: [
                    CollectionCard(
                        id: "c6",
                        cardId: "card-6",
                        name: "Pikachu",
                        tcg: "pokemon",
                        setCode: "BS-58",
                        rarity: "Common",
                        imageUrl: nil,
                        imageUrlSmall: nil,
                        quantity: 5,
                        price: 8.00,
                        condition: "Lightly Played",
                        language: "English",
                        notes: nil
                    ),
                    CollectionCard(
                        id: "c7",
                        cardId: "card-7",
                        name: "Mewtwo",
                        tcg: "pokemon",
                        setCode: "BS-10",
                        rarity: "Holo Rare",
                        imageUrl: nil,
                        imageUrlSmall: nil,
                        quantity: 2,
                        price: 65.00,
                        condition: "Near Mint",
                        language: "English",
                        notes: "Base Set"
                    )
                ],
                createdAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-86400 * 7)),
                updatedAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-7200))
            )
        ]
    }
}
