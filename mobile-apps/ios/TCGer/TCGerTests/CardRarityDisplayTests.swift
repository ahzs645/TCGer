import XCTest
@testable import TCGer

final class CardRarityDisplayTests: XCTestCase {
    func testFormatsLowercaseMagicRarities() {
        XCTAssertEqual(CardRarityDisplay.name(for: "common"), "Common")
        XCTAssertEqual(CardRarityDisplay.name(for: "mythic"), "Mythic")
    }

    func testNormalizesInconsistentMultiwordCatalogLabels() {
        XCTAssertEqual(
            CardRarityDisplay.name(for: "Special illustration rare"),
            "Special Illustration Rare"
        )
        XCTAssertEqual(CardRarityDisplay.name(for: "Super_rare"), "Super Rare")
    }

    func testPreservesCatalogAcronymsAndMixedCaseTerms() {
        XCTAssertEqual(CardRarityDisplay.name(for: "ACE SPEC Rare"), "ACE SPEC Rare")
        XCTAssertEqual(CardRarityDisplay.name(for: "Rare Holo LV.X"), "Rare Holo LV.X")
    }

    func testTrimsAndCollapsesWhitespace() {
        XCTAssertEqual(CardRarityDisplay.name(for: "  ultra   rare\n"), "Ultra Rare")
    }
}
