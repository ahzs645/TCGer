import XCTest
@testable import TCGer

final class ScannerIndexTests: XCTestCase {
    func testMetadataEntryDecodingAndGameNormalization() throws {
        let data = Data(#"{"annIndex":7,"cardId":"abc","name":"Card","game":"yu-gi-oh","setCode":"LOB","setName":"Legend of Blue Eyes","rarity":"Rare","imageURL":"https://example.com/card.jpg","price":1.25}"#.utf8)
        let entry = try JSONDecoder().decode(CardIndexMetadataEntry.self, from: data)

        XCTAssertEqual(entry.annIndex, 7)
        XCTAssertEqual(entry.resolvedGame, .yugioh)
    }

    func testMetadataStoreFiltersByGameAndSetAndBuildsDetails() async {
        let store = CardIndexMetadataStore(entries: [
            metadata(index: 0, id: "p1", game: "pokemon", setCode: "sv01"),
            metadata(index: 1, id: "p2", game: "pokemon", setCode: "sv02"),
            metadata(index: 2, id: "m1", game: "magic", setCode: "lea")
        ])

        let pokemonIndices = await store.indices(for: .pokemon)
        let scopedIndices = await store.indices(for: .pokemon, setCode: "SV02")
        let magicDetails = await store.details(for: 2)

        XCTAssertEqual(pokemonIndices, [0, 1])
        XCTAssertEqual(scopedIndices, [1])
        XCTAssertEqual(magicDetails?.identity.game, .magic)
        XCTAssertEqual(magicDetails?.identity.id, "m1")
    }

    func testPhysicalCardIndicesExcludePocketRowsIncludingLegacyMetadata() async {
        let store = CardIndexMetadataStore(entries: [
            metadata(index: 0, id: "me05-003", game: "pokemon", setCode: "me05"),
            metadata(
                index: 1,
                id: "B2-004",
                game: "pokemon",
                setCode: "B2",
                imageURL: "https://assets.tcgdex.net/en/tcgp/B2/004/high.webp"
            ),
            metadata(
                index: 2,
                id: "A2-105",
                game: "pokemon",
                setCode: "A2",
                format: "pocket"
            ),
        ])

        let allPokemon = await store.indices(for: .pokemon)
        let physicalPokemon = await store.physicalCardIndices(for: .pokemon, setCode: nil)

        XCTAssertEqual(allPokemon, [0, 1, 2])
        XCTAssertEqual(physicalPokemon, [0])
    }

    func testAutomaticPhysicalCardIndicesSpanInstalledGameShards() async {
        let store = CardIndexMetadataStore(entries: [
            metadata(index: 0, id: "p1", game: "pokemon", setCode: "sv01"),
            metadata(index: 1, id: "m1", game: "magic", setCode: "lea"),
            metadata(index: 2, id: "y1", game: "yugioh", setCode: "lob"),
            metadata(
                index: 3,
                id: "pocket-1",
                game: "pokemon",
                setCode: "A1",
                format: "pocket"
            ),
        ])

        let automatic = await store.physicalCardIndices(for: .all, setCode: nil)

        XCTAssertEqual(automatic, [0, 1, 2])
    }

    func testANNRanksByCosineDistanceAndHonorsAllowedIndices() async throws {
        let store = AnnoyIndexStore(vectors: [
            [1, 0],
            [0.8, 0.2],
            [0, 1]
        ])

        let all = try await store.nearestNeighbors(
            for: [1, 0],
            limit: 3,
            allowedIndices: [0, 1, 2]
        )
        XCTAssertEqual(all.map(\.index), [0, 1, 2])
        XCTAssertEqual(all[0].distance, 0, accuracy: 0.000_001)

        let filtered = try await store.nearestNeighbors(
            for: [1, 0],
            limit: 3,
            allowedIndices: [1, 2]
        )
        XCTAssertEqual(filtered.map(\.index), [1, 2])
    }

    private func metadata(
        index: Int,
        id: String,
        game: String,
        setCode: String,
        imageURL: String? = nil,
        format: String? = nil
    ) -> CardIndexMetadataEntry {
        CardIndexMetadataEntry(
            annIndex: index,
            cardId: id,
            name: id,
            game: game,
            format: format,
            setCode: setCode,
            setName: nil,
            rarity: nil,
            imageURL: imageURL,
            price: nil
        )
    }
}
