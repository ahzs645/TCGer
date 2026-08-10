import XCTest
@testable import TCGer

final class SearchTextNormalizerTests: XCTestCase {
    func testPunctuationAndWhitespaceShareOneSearchKey() {
        let expected = SearchTextNormalizer.key("Mr. Mime")

        XCTAssertEqual(SearchTextNormalizer.key("mr mime"), expected)
        XCTAssertEqual(SearchTextNormalizer.key("mr.mime"), expected)
        XCTAssertEqual(SearchTextNormalizer.key("  MR - MIME  "), expected)
    }

    func testFoldsDiacriticsAndWidthVariants() {
        XCTAssertEqual(
            SearchTextNormalizer.key("Ｆｌａｂéｂé"),
            SearchTextNormalizer.key("flabebe")
        )
    }

    func testNormalizedQueryMatchesOriginalDisplayName() {
        let queryKey = SearchTextNormalizer.key("mr mime")

        XCTAssertTrue(SearchTextNormalizer.contains("Mr. Mime ex", queryKey: queryKey))
        XCTAssertFalse(SearchTextNormalizer.contains("Mime Jr.", queryKey: queryKey))
    }
}
