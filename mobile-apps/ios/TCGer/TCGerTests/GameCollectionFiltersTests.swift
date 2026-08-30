import XCTest
@testable import TCGer

final class GameCollectionFiltersTests: XCTestCase {
    func testYuGiOhDefinitionDeclaresGameSpecificFacets() throws {
        let definition = try XCTUnwrap(GameCollectionDefinitions.definition(for: .yugioh))

        XCTAssertTrue(definition.supportsConsolidatedIdentity)
        XCTAssertTrue(["attribute", "race", "level", "archetype", "atk", "def"].allSatisfy {
            definition.facets.map(\.id).contains($0)
        })
        XCTAssertTrue(["language", "edition", "owned-quantity"].allSatisfy {
            definition.facets.map(\.id).contains($0)
        })
    }

    func testYuGiOhSelectionsMatchNormalizedAttributesAndQuantity() throws {
        let definition = try XCTUnwrap(GameCollectionDefinitions.definition(for: .yugioh))
        var card = CollectionCard(
            id: "owned-dark-magician",
            cardId: "46986414",
            externalId: "46986414",
            name: "Dark Magician",
            tcg: "yugioh",
            setCode: "LOB",
            setName: "Legend of Blue Eyes White Dragon",
            rarity: "Ultra Rare",
            imageUrl: nil,
            imageUrlSmall: nil,
            quantity: 2,
            price: nil,
            condition: nil,
            language: "English",
            notes: nil,
            collectorNumber: "005",
            copies: []
        )
        card.attributes = [
            "type": .string("Normal Monster"),
            "attribute": .string("DARK"),
            "race": .string("Spellcaster"),
            "level": .number(7),
            "atk": .number(2500),
            "def": .number(2100)
        ]

        let selections: [String: CollectionFacetSelection] = [
            "card-type": .options(["Normal Monster"]),
            "race": .options(["spellcaster"]),
            "atk": .range(minimum: "2400", maximum: "2600"),
            "owned-quantity": .range(minimum: "2", maximum: "")
        ]

        XCTAssertTrue(CollectionFacetEngine.matches(card: card, definition: definition, selections: selections))
        XCTAssertFalse(CollectionFacetEngine.matches(
            card: card,
            definition: definition,
            selections: ["attribute": .options(["LIGHT"])]
        ))
    }

    func testConsolidatedIdentityGroupsExactPrintingsAndAggregatesValue() throws {
        func printing(id: String, setCode: String, quantity: Int, price: Double) -> CollectionCard {
            var card = CollectionCard(
                id: id,
                cardId: id,
                externalId: id,
                name: "Dark Magician",
                tcg: "yugioh",
                setCode: setCode,
                setName: setCode,
                rarity: nil,
                imageUrl: nil,
                imageUrlSmall: nil,
                quantity: quantity,
                price: price,
                condition: nil,
                language: nil,
                notes: nil,
                collectorNumber: nil,
                copies: []
            )
            card.baseExternalId = "46986414"
            return card
        }

        let groups = CollectionIdentityGrouping.groups(for: [
            printing(id: "lob-en005", setCode: "LOB", quantity: 2, price: 12),
            printing(id: "sdy-006", setCode: "SDY", quantity: 1, price: 4)
        ])

        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].totalQuantity, 3)
        XCTAssertEqual(groups[0].totalValue, 28)
        XCTAssertEqual(groups[0].printings.map(\.setCode), ["LOB", "SDY"])
    }
}
