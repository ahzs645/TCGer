import XCTest
@testable import TCGer

final class PokedexProgressTests: XCTestCase {
    func testBuildsSpeciesProgressFromCatalogAndOwnership() {
        let bulbasaur = PokedexEntry(number: 1, name: "Bulbasaur")
        let charmander = PokedexEntry(number: 4, name: "Charmander")
        let catalog = [
            card(id: "bulba-1", name: "Bulbasaur", entries: [bulbasaur]),
            card(id: "bulba-2", name: "Bulbasaur", entries: [bulbasaur]),
            card(id: "char-1", name: "Charmander", entries: [charmander])
        ]
        let owned = CollectionCard(
            id: "owned", cardId: "bulba-1", externalId: "bulba-1", name: "Bulbasaur",
            tcg: "pokemon", setCode: nil, setName: nil, rarity: nil, imageUrl: nil,
            imageUrlSmall: nil, quantity: 3, price: nil, condition: nil, language: nil,
            notes: nil, collectorNumber: nil, copies: [], dexEntries: [bulbasaur]
        )
        let collection = Collection(
            id: "binder", name: "Binder", description: nil, cards: [owned],
            createdAt: "", updatedAt: "", colorHex: nil
        )

        let result = PokedexProgressBuilder.build(catalogCards: catalog, collections: [collection])

        XCTAssertEqual(result.count, 1025)
        XCTAssertEqual(Array(result.prefix(4).map(\.id)), [1, 2, 3, 4])
        XCTAssertEqual(result[0].printCount, 2)
        XCTAssertEqual(result[0].ownedCopies, 3)
        XCTAssertTrue(result[0].isOwned)
        XCTAssertFalse(result[3].isOwned)
    }

    func testBuildsLightweightCatalogSnapshotAndFallbackImageURL() {
        let charmander = PokedexEntry(number: 4, name: "Charmander")
        let catalogCard = CatalogCardEntry(
            id: "base1-4",
            name: "Charmander",
            setCode: "base1",
            collectorNumber: "4",
            rarity: "Common",
            dexEntries: [charmander],
            type: "Pokemon",
            types: ["Fire"],
            colors: nil,
            race: nil,
            level: nil,
            konamiId: nil,
            imageUrl: nil,
            imageUrlSmall: nil
        )

        let snapshot = PokedexProgressBuilder.build(
            catalogEntries: [CatalogEntry(tcg: .pokemon, card: catalogCard)],
            pokemonSetSeriesByCode: ["base1": "Base"],
            collections: []
        )

        XCTAssertEqual(snapshot.species.count, 1025)
        XCTAssertEqual(snapshot.species[3].printCount, 1)
        XCTAssertEqual(snapshot.catalogEntriesByNumber[4]?.map(\.card.id), ["base1-4"])
        XCTAssertEqual(
            snapshot.species[3].imageURL,
            "https://assets.tcgdex.net/en/Base/base1/4/low.webp"
        )
    }

    private func card(id: String, name: String, entries: [PokedexEntry]) -> Card {
        Card(
            id: id, name: name, tcg: "pokemon", setCode: nil, setName: nil,
            rarity: nil, imageUrl: nil, imageUrlSmall: nil, price: nil,
            collectorNumber: nil, releasedAt: nil, dexEntries: entries
        )
    }
}
