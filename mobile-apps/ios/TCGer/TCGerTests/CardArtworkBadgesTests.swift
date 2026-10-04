import XCTest
@testable import TCGer

final class CardArtworkBadgesTests: XCTestCase {
    override func tearDown() {
        CurrencyDisplayState.shared.configure(currencyCode: "USD", rate: nil)
        super.tearDown()
    }

    func testMissingAndInvalidQuotesDoNotBecomeZeroPrices() {
        for price in [nil, -1, Double.nan, .infinity, -.infinity] as [Double?] {
            let value = CardPriceBadgeValue(price: price)
            XCTAssertEqual(value.text, "—")
            XCTAssertEqual(value.accessibilityLabel, "Price unavailable")
        }
    }

    func testZeroIsAValidUnitQuote() {
        CurrencyDisplayState.shared.configure(currencyCode: "USD", rate: nil)
        let value = CardPriceBadgeValue(price: 0)
        XCTAssertEqual(value.text, 0.0.priceText)
        XCTAssertNotEqual(value.text, "—")
        XCTAssertEqual(value.accessibilityLabel, "\(0.0.priceText) per card")
    }

    func testBadgeUsesUnitPriceAndCurrencyPreference() throws {
        let rate = CachedExchangeRate(
            exchangeRate: ExchangeRate(date: "2026-10-04", base: "USD", quote: "CAD", rate: Decimal(string: "1.4")!),
            fetchedAt: Date(),
            providerName: "Fixture"
        )
        CurrencyDisplayState.shared.configure(currencyCode: "CAD", rate: rate)
        let value = CardPriceBadgeValue(price: 0.22)
        XCTAssertEqual(value.text, Decimal(string: "0.308")!.formatted(.currency(code: "CAD")))
        XCTAssertEqual(value.accessibilityLabel, "\(value.text) per card")
    }
}
