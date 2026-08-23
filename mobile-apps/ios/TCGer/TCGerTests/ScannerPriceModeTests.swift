import XCTest
@testable import TCGer

final class ScannerPriceModeTests: XCTestCase {
    func testAutomaticRemotePricingRequiresAConcreteCompatibleProvider() {
        let automaticOnly = [source(.automatic, games: [])]
        XCTAssertFalse(
            ScannerPriceModeSupport.hasRemoteProvider(
                for: .pokemon,
                selectedSource: .automatic,
                sources: automaticOnly
            )
        )

        let withPokemon = automaticOnly + [source(.tcgDexCardmarket, games: ["pokemon"])]
        XCTAssertTrue(
            ScannerPriceModeSupport.hasRemoteProvider(
                for: .pokemon,
                selectedSource: .automatic,
                sources: withPokemon
            )
        )
        XCTAssertFalse(
            ScannerPriceModeSupport.hasRemoteProvider(
                for: .magic,
                selectedSource: .automatic,
                sources: withPokemon
            )
        )
    }

    func testExplicitRemoteSourceMustBeAdvertisedForTheGame() {
        let sources = [
            source(.scryfall, games: ["magic"]),
            source(.tcgDexCardmarket, games: ["pokemon"])
        ]
        XCTAssertTrue(
            ScannerPriceModeSupport.hasRemoteProvider(
                for: .magic,
                selectedSource: .scryfall,
                sources: sources
            )
        )
        XCTAssertFalse(
            ScannerPriceModeSupport.hasRemoteProvider(
                for: .pokemon,
                selectedSource: .scryfall,
                sources: sources
            )
        )
    }

    func testOnDeviceAutomaticFallsBackToScryfallOnlyForMagic() {
        XCTAssertTrue(
            ScannerPriceModeSupport.hasOnDeviceProvider(
                for: .magic,
                selectedSource: .automatic,
                hasJustTCGKey: false,
                hasCollectrConfiguration: false,
                collectrGames: []
            )
        )
        XCTAssertFalse(
            ScannerPriceModeSupport.hasOnDeviceProvider(
                for: .pokemon,
                selectedSource: .automatic,
                hasJustTCGKey: false,
                hasCollectrConfiguration: false,
                collectrGames: []
            )
        )
        XCTAssertTrue(
            ScannerPriceModeSupport.hasOnDeviceProvider(
                for: .pokemon,
                selectedSource: .automatic,
                hasJustTCGKey: true,
                hasCollectrConfiguration: false,
                collectrGames: []
            )
        )
    }

    func testTotalsCountEveryScanAndKeepCurrenciesSeparate() {
        let totals = ScannerPriceModeSupport.totals(for: [
            ScannerPriceQuote(price: 2.50, currency: "usd"),
            ScannerPriceQuote(price: 2.50, currency: "USD"),
            ScannerPriceQuote(price: 3, currency: "eur")
        ])

        XCTAssertEqual(totals.count, 2)
        XCTAssertEqual(totals[0].currency, "EUR")
        XCTAssertEqual(totals[0].amount, 3, accuracy: 0.001)
        XCTAssertEqual(totals[1].currency, "USD")
        XCTAssertEqual(totals[1].amount, 5, accuracy: 0.001)
    }

    private func source(
        _ id: PricingSource,
        games: [String]
    ) -> APIService.PriceSourceOption {
        APIService.PriceSourceOption(
            id: id,
            label: id.displayName,
            description: "Test source",
            games: games,
            requiresServer: true
        )
    }
}
