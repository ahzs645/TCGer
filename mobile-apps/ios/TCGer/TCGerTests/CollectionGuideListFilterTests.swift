import XCTest
@testable import TCGer

final class CollectionGuideListFilterTests: XCTestCase {
    func testAllGamesIncludesEnabledMagicPokemonAndYugiohGuides() {
        let guides = [
            guide(tcg: "pokemon", title: "Every Ditto"),
            guide(tcg: "magic", title: "Magic Showcase Frames"),
            guide(tcg: "yugioh", title: "Yu-Gi-Oh! Ghost Rares"),
            guide(tcg: "lorcana", title: "Lorcana Enchanted")
        ]

        let result = CollectionGuideListFilter.apply(
            to: guides,
            enabledGames: [.pokemon, .magic, .yugioh],
            selectedGame: .all,
            query: ""
        )

        XCTAssertEqual(result.map(\.tcg), ["pokemon", "magic", "yugioh"])
    }

    func testSelectedGameAndSearchNarrowTheGuideList() {
        let guides = [
            guide(tcg: "magic", title: "Magic Showcase Frames", tags: ["Frame Treatment"]),
            guide(tcg: "magic", title: "Magic Serialized Cards", tags: ["Serialized"]),
            guide(tcg: "yugioh", title: "Yu-Gi-Oh! Starlight Rares", tags: ["Starlight Rare"])
        ]

        let result = CollectionGuideListFilter.apply(
            to: guides,
            enabledGames: [.magic, .yugioh],
            selectedGame: .magic,
            query: "serialized"
        )

        XCTAssertEqual(result.map(\.title), ["Magic Serialized Cards"])
    }

    private func guide(tcg: String, title: String, tags: [String] = []) -> CollectionGuide {
        CollectionGuide(
            id: "\(tcg)-\(title)",
            slug: title.lowercased().replacingOccurrences(of: " ", with: "-"),
            title: title,
            description: "A collection guide for \(title).",
            tcg: tcg,
            category: .custom,
            coverImageUrl: nil,
            curatorName: "TCGer",
            tags: tags,
            version: 1,
            featured: true,
            rule: CollectionGuideRule(
                type: .tag,
                tcg: tcg,
                query: "\(tcg).test",
                setCode: nil,
                setName: nil,
                includeAllPrintings: true
            ),
            cardCountHint: 10,
            followed: false,
            wishlistId: nil
        )
    }
}
