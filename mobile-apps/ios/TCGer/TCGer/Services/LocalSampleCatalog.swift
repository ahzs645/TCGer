import Foundation

/// Immutable sample catalog data; this service never writes local domain state.
@MainActor
enum LocalSampleCatalog {
    struct Cards {
        let pikaBase: Card
        let pikaSurging: Card
        let charizard: Card
        let boltM10: Card
        let bolt2xm: Card
        let blackLotus: Card
        let blueEyes: Card

        var all: [Card] {
            [pikaBase, pikaSurging, charizard, boltM10, bolt2xm, blackLotus, blueEyes]
        }

        var printGroups: [String: [Card]] {
            [
                pikaBase.id: [pikaBase, pikaSurging],
                pikaSurging.id: [pikaBase, pikaSurging],
                boltM10.id: [boltM10, bolt2xm],
                bolt2xm.id: [boltM10, bolt2xm]
            ]
        }
    }

    static func makeCards() -> Cards {
        let pikaBase = Card(
            id: "sample-pokemon-pikachu-base",
            name: "Pikachu",
            tcg: "pokemon",
            setCode: "CEL",
            setName: "Celebrations",
            rarity: "Rare",
            imageUrl: LocalStore.cardBack(for: "pokemon"),
            imageUrlSmall: LocalStore.cardBack(for: "pokemon"),
            price: 6.75,
            collectorNumber: "005",
            releasedAt: nil,
            supertype: "Pokémon",
            subtypes: ["Basic"],
            types: ["Lightning"],
            attributes: ["tcgplayer_id": .string("250303")]
        )
        let pikaSurging = Card(
            id: "sample-pokemon-pikachu-surging",
            name: "Pikachu ex",
            tcg: "pokemon",
            setCode: "SV08",
            setName: "Surging Sparks",
            rarity: "Special Illustration Rare",
            imageUrl: LocalStore.cardBack(for: "pokemon"),
            imageUrlSmall: LocalStore.cardBack(for: "pokemon"),
            price: 19.25,
            collectorNumber: "238",
            releasedAt: nil,
            supertype: "Pokémon",
            subtypes: ["Basic"],
            types: ["Lightning"],
            attributes: ["tcgplayer_id": .string("590027")]
        )
        let charizard = Card(
            id: "sample-pokemon-charizard",
            name: "Charizard ex",
            tcg: "pokemon",
            setCode: "PAF",
            setName: "Paldean Fates",
            rarity: "Ultra Rare",
            imageUrl: LocalStore.cardBack(for: "pokemon"),
            imageUrlSmall: LocalStore.cardBack(for: "pokemon"),
            price: 33.40,
            collectorNumber: "54",
            releasedAt: nil,
            supertype: "Pokémon",
            subtypes: ["Stage 2", "ex"],
            types: ["Fire"],
            attributes: ["tcgplayer_id": .string("534416")]
        )
        let boltM10 = Card(
            id: "sample-magic-lightning-bolt-m10",
            name: "Lightning Bolt",
            tcg: "magic",
            setCode: "M10",
            setName: "Magic 2010",
            rarity: "Common",
            imageUrl: LocalStore.cardBack(for: "magic"),
            imageUrlSmall: LocalStore.cardBack(for: "magic"),
            price: 2.10,
            collectorNumber: "146",
            releasedAt: nil,
            attributes: [
                "scryfall_id": .string("435589bb-27c6-4a6d-9d63-394d5092b9d8"),
                "tcgplayer_id": .string("32656")
            ]
        )
        let bolt2xm = Card(
            id: "sample-magic-lightning-bolt-2xm",
            name: "Lightning Bolt",
            tcg: "magic",
            setCode: "2X2",
            setName: "Double Masters 2022",
            rarity: "Uncommon",
            imageUrl: LocalStore.cardBack(for: "magic"),
            imageUrlSmall: LocalStore.cardBack(for: "magic"),
            price: 3.75,
            collectorNumber: "117",
            releasedAt: nil,
            attributes: [
                "scryfall_id": .string("f29ba16f-c8fb-42fe-aabf-87089cb214a7"),
                "tcgplayer_id": .string("276484")
            ]
        )
        let blackLotus = Card(
            id: "sample-magic-black-lotus",
            name: "Black Lotus",
            tcg: "magic",
            setCode: "LEA",
            setName: "Limited Edition Alpha",
            rarity: "Rare",
            imageUrl: LocalStore.cardBack(for: "magic"),
            imageUrlSmall: LocalStore.cardBack(for: "magic"),
            price: 25000,
            collectorNumber: "233",
            releasedAt: nil,
            attributes: [
                "scryfall_id": .string("b0faa7f2-b547-42c4-a810-839da50dadfe"),
                "tcgplayer_id": .string("1042")
            ]
        )
        let blueEyes = Card(
            id: "sample-ygo-blue-eyes",
            name: "Blue-Eyes White Dragon",
            tcg: "yugioh",
            setCode: "SDK",
            setName: "Starter Deck: Kaiba",
            rarity: "Ultra Rare",
            imageUrl: LocalStore.cardBack(for: "yugioh"),
            imageUrlSmall: LocalStore.cardBack(for: "yugioh"),
            price: 18.50,
            collectorNumber: nil,
            releasedAt: nil,
            attributes: ["tcgplayer_id": .string("22796")]
        )

        return Cards(
            pikaBase: pikaBase,
            pikaSurging: pikaSurging,
            charizard: charizard,
            boltM10: boltM10,
            bolt2xm: bolt2xm,
            blackLotus: blackLotus,
            blueEyes: blueEyes
        )
    }

    static func makeSampleBinderPage(timestamp: String) -> SavedBinderPage {
        let cards = makeCards()
        let pocketCards = [
            cards.charizard,
            cards.pikaBase,
            cards.pikaSurging,
            cards.boltM10,
            cards.blackLotus,
            cards.bolt2xm,
            cards.blueEyes,
            cards.charizard,
            cards.pikaBase
        ]

        let placements = pocketCards.enumerated().map { slotIndex, card in
            let column = slotIndex % 3
            let row = slotIndex / 3
            let left = 0.045 + (Double(column) * 0.311)
            let right = left + 0.288
            let top = 0.973 - (Double(row) * 0.320)
            let bottom = top - 0.306

            return BinderPagePlacement(
                slotIndex: slotIndex,
                cardId: card.id,
                name: card.name,
                tcg: card.tcg,
                setCode: card.setCode,
                confidence: 0.99,
                status: "matched",
                quad: BinderPageQuad(
                    topLeft: BinderPagePoint(x: left, y: top),
                    topRight: BinderPagePoint(x: right, y: top),
                    bottomRight: BinderPagePoint(x: right, y: bottom),
                    bottomLeft: BinderPagePoint(x: left, y: bottom)
                )
            )
        }

        return SavedBinderPage(
            id: "sample-binder-page-1",
            binderId: "sample-binder-1",
            pageNumber: 1,
            revision: 1,
            capturedAt: timestamp,
            imageUrl: nil,
            placements: placements,
            createdAt: timestamp,
            updatedAt: timestamp
        )
    }

}
