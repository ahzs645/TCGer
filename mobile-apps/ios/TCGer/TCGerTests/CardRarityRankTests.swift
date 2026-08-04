import XCTest
@testable import TCGer

final class CardRarityRankTests: XCTestCase {
    private func assertScarcer(
        _ scarcer: String,
        than common: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertGreaterThan(
            CardRarityRank.rank(for: scarcer),
            CardRarityRank.rank(for: common),
            "\"\(scarcer)\" should outrank \"\(common)\"",
            file: file,
            line: line
        )
    }

    func testBaseTiersAreOrdered() {
        assertScarcer("Rare", than: "Uncommon")
        // "uncommon" contains "common", so a naive substring match ranks it as common.
        assertScarcer("Uncommon", than: "Common")
    }

    func testQualifiedRaresOutrankPlainRare() {
        // Each of these contains "rare", so the generic bucket must not win.
        assertScarcer("Rare Holo", than: "Rare")
        assertScarcer("Ultra Rare", than: "Rare Holo")
        assertScarcer("Secret Rare", than: "Ultra Rare")
        assertScarcer("Rare Rainbow", than: "Secret Rare")
    }

    func testCrossGameVocabularies() {
        // Yu-Gi-Oh!
        assertScarcer("Ultra Rare", than: "Super Rare")
        assertScarcer("Starlight Rare", than: "Secret Rare")
        // Magic
        assertScarcer("Mythic Rare", than: "Rare")
        // Lorcana
        assertScarcer("Enchanted", than: "Legendary")
        assertScarcer("Legendary", than: "Super Rare")
        // Pokémon
        assertScarcer("Special Illustration Rare", than: "Illustration Rare")
        assertScarcer("Double Rare", than: "Rare Holo")
    }

    func testMissingRaritySortsBelowCommon() {
        XCTAssertLessThan(CardRarityRank.rank(for: nil), CardRarityRank.rank(for: "Common"))
        XCTAssertLessThan(CardRarityRank.rank(for: "   "), CardRarityRank.rank(for: "Common"))
        XCTAssertLessThan(CardRarityRank.rank(for: "???"), CardRarityRank.rank(for: "Common"))
    }

    func testIsCaseAndWhitespaceInsensitive() {
        XCTAssertEqual(CardRarityRank.rank(for: "  ULTRA RARE "), CardRarityRank.rank(for: "ultra rare"))
    }
}
