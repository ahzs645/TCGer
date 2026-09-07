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

    func testCatalogMappingPreservesWorldChampionshipPrintingIdentity() {
        let worlds = PokemonWorldChampionshipPrint(
            year: 2025,
            playerName: "Yuya Okita",
            deckName: "Dragapult Dominion",
            originalCollectorNumber: "130/167",
            printedSignature: true,
            cardBack: "world-championship",
            borderStyle: nil,
            stamp: nil,
            sourceProductId: "901",
            sourceUrl: nil
        )
        let entry = CatalogEntry(
            tcg: .pokemon,
            card: CatalogCardEntry(
                id: "wcd-901",
                name: "Dragapult ex",
                setCode: "wcd2025",
                collectorNumber: "130/167",
                rarity: "Double Rare",
                type: "Pokémon",
                types: nil,
                colors: nil,
                race: nil,
                level: nil,
                konamiId: nil,
                imageUrl: nil,
                imageUrlSmall: nil,
                printingKey: "pokemon:wcd:2025:yuya-okita:901",
                printingKind: "replica",
                sanctionedPlayLegal: false,
                pokemonWorldChampionship: worlds
            )
        )

        let card = CatalogStore.shared.card(from: entry)

        XCTAssertEqual(card.printingKind, "replica")
        XCTAssertEqual(card.sanctionedPlayLegal, false)
        XCTAssertEqual(card.pokemonPrint?.worldChampionship?.playerName, "Yuya Okita")
        XCTAssertEqual(card.pokemonPrint?.finishes, ["normal"])
    }

    func testSetChoicesComeFromResultsAfterOtherFilters() {
        let matchingPokemonCard = makeCard(
            id: "pokemon-match",
            tcg: "pokemon",
            setCode: "ME05",
            rarity: "Ultra Rare"
        )
        let filteredOutPokemonCard = makeCard(
            id: "pokemon-other",
            tcg: "pokemon",
            setCode: "ME04",
            rarity: "Common"
        )
        let magicCard = makeCard(
            id: "magic-match",
            tcg: "magic",
            setCode: "FIN",
            rarity: "Ultra Rare"
        )
        let filters = CardSearchFilterState(rarity: "Ultra Rare")

        XCTAssertEqual(
            cardSearchSetIDs(
                in: [matchingPokemonCard, filteredOutPokemonCard, magicCard],
                matching: filters,
                game: .pokemon
            ),
            ["pokemon::me05"]
        )
    }

    func testCurrentSetDoesNotLimitAvailableSetChoices() {
        let selectedSet = TcgSet(
            code: "ME05",
            name: "Mega Evolution",
            tcg: "pokemon",
            releaseDate: nil,
            totalCards: nil,
            standardCards: nil,
            iconUrl: nil,
            logoUrl: nil
        )
        let filters = CardSearchFilterState(set: selectedSet)

        XCTAssertEqual(
            cardSearchSetIDs(
                in: [
                    makeCard(id: "first", tcg: "pokemon", setCode: "ME05"),
                    makeCard(id: "second", tcg: "pokemon", setCode: "SV08")
                ],
                matching: filters,
                game: .pokemon
            ),
            ["pokemon::me05", "pokemon::sv08"]
        )
    }

    private func makeCard(
        id: String = "test-card",
        tcg: String,
        setCode: String? = nil,
        rarity: String? = nil,
        collectorNumber: String? = nil,
        supertype: String? = nil,
        types: [String]? = nil,
        attributes: [String: JSONValue]? = nil
    ) -> Card {
        Card(
            id: id,
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
