import XCTest
@testable import TCGer

#if DEBUG
final class CollectrTestPriceProviderTests: XCTestCase {
    func testReadsRecoveredMarketPriceAndCurrency() async throws {
        let provider = CollectrTestPriceProvider { _, _ in
            return Data(
                #"{"id":"collectr-product-1","market_price":"42.75","currency":"cad","external_ids":[{"external_id":"sv04-214","product_sub_type":"Normal","grade_id":"ungraded"}]}"#.utf8
            )
        }

        let quote = try await provider.fetchPrice(tcg: "pokemon", externalID: "sv04-214")

        XCTAssertEqual(
            quote,
            CardPriceQuote(source: "collectr-test", price: 42.75, currency: "CAD")
        )
    }

    func testAcceptsCapturedResponseWrappers() async throws {
        let fixtures = [
            #"{"data":{"market_price":8.5}}"#,
            #"{"product":{"market_price":"8.50"}}"#,
            #"{"data":{"product_details":{"market_price":"8.50"}}}"#,
            #"{"productDetails":{"market_price":8.5}}"#
        ]

        for fixture in fixtures {
            let provider = CollectrTestPriceProvider { _, _ in Data(fixture.utf8) }
            let quote = try await provider.fetchPrice(tcg: "magic", externalID: "card-id")
            XCTAssertEqual(
                quote,
                CardPriceQuote(source: "collectr-test", price: 8.5, currency: "USD")
            )
        }
    }

    func testRejectsMissingZeroAndMalformedPrices() async throws {
        let fixtures = [
            #"{}"#,
            #"{"market_price":null}"#,
            #"{"market_price":0}"#,
            #"{"market_price":"not-a-price"}"#
        ]

        for fixture in fixtures {
            let provider = CollectrTestPriceProvider { _, _ in Data(fixture.utf8) }
            let quote = try await provider.fetchPrice(tcg: "lorcana", externalID: "1:42")
            XCTAssertNil(quote)
        }
    }

    func testKeepsRootMarketPriceWhenResponseAlsoContainsMetadata() async throws {
        let provider = CollectrTestPriceProvider { _, _ in
            Data(#"{"market_price":"9.25","data":{"status":"ok"}}"#.utf8)
        }

        let quote = try await provider.fetchPrice(tcg: "pokemon", externalID: "card-id")

        XCTAssertEqual(quote?.price, 9.25)
    }
}
#endif
