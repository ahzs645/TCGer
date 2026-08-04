import XCTest
@testable import TCGer

@MainActor
final class CardSearchFilterTests: XCTestCase {
    func testSetNumberAndPokemonFacetsMustAllMatch() {
        let set = TcgSet(
            code: "dpp",
            name: "DP Black Star Promos",
            tcg: "pokemon",
            releaseDate: nil,
            totalCards: nil,
            standardCards: nil,
            iconUrl: nil,
            logoUrl: nil
        )
        let card = makeCard(
            tcg: "pokemon",
            setCode: "DPP",
            rarity: "Promo",
            collectorNumber: "DP24",
            supertype: "Pokémon",
            types: ["Darkness"]
        )
        let filters = CardSearchFilterState(
            set: set,
            rarity: "promo",
            collectorNumber: "24",
            primaryFacet: "Pokémon",
            secondaryFacet: "Darkness"
        )

        XCTAssertTrue(filters.matches(card, game: .pokemon))

        var wrongNumber = filters
        wrongNumber.collectorNumber = "99"
        XCTAssertFalse(wrongNumber.matches(card, game: .pokemon))
    }

    func testMagicTypeAndColorFacetsUseCatalogAttributes() {
        let card = makeCard(
            tcg: "magic",
            attributes: [
                "type_line": .string("Legendary Artifact Creature — Golem"),
                "colors": .array([.string("W"), .string("U")])
            ]
        )

        XCTAssertEqual(
            Set(CardSearchFacetKind.cardType.values(for: card)),
            Set(["Artifact", "Creature"])
        )
        XCTAssertEqual(
            Set(CardSearchFacetKind.color.values(for: card)),
            Set(["White", "Blue"])
        )
    }

    func testCatalogMappingPreservesMagicFilterMetadata() {
        let entry = CatalogEntry(
            tcg: .magic,
            card: CatalogCardEntry(
                id: "card-1",
                name: "Test Card",
                setCode: "tst",
                collectorNumber: "7",
                rarity: "rare",
                type: "Creature — Wizard",
                types: nil,
                colors: ["U"],
                race: nil,
                level: nil,
                konamiId: nil,
                imageUrl: nil,
                imageUrlSmall: nil
            )
        )

        let card = CatalogStore.shared.card(from: entry)

        XCTAssertEqual(CardSearchFacetKind.cardType.values(for: card), ["Creature"])
        XCTAssertEqual(CardSearchFacetKind.color.values(for: card), ["Blue"])
    }

    private func makeCard(
        tcg: String,
        setCode: String? = nil,
        rarity: String? = nil,
        collectorNumber: String? = nil,
        supertype: String? = nil,
        types: [String]? = nil,
        attributes: [String: JSONValue]? = nil
    ) -> Card {
        Card(
            id: "test-card",
            name: "Test Card",
            tcg: tcg,
            setCode: setCode,
            setName: nil,
            rarity: rarity,
            imageUrl: nil,
            imageUrlSmall: nil,
            price: nil,
            collectorNumber: collectorNumber,
            releasedAt: nil,
            supertype: supertype,
            types: types,
            attributes: attributes
        )
    }
}
