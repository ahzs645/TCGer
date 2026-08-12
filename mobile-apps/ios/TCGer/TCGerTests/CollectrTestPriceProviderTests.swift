import Foundation
import XCTest
@testable import TCGer

private final class CollectrURLProtocolStub: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.requestHandler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

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

    func testMappingStoreSavesReplacesAndRemovesProductIDs() throws {
        let suiteName = "CollectrTestPriceProviderTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = CollectrProductMappingStore(defaults: defaults)

        try store.save(
            tcg: "pokemon",
            externalID: "sv04-214",
            collectrProductID: "101"
        )
        try store.save(
            tcg: " POKEMON ",
            externalID: "SV04-214",
            collectrProductID: "202"
        )

        let saved = try XCTUnwrap(store.mappings.first)
        XCTAssertEqual(store.mappings.count, 1)
        XCTAssertEqual(saved.tcg, "pokemon")
        XCTAssertEqual(saved.externalID, "SV04-214")
        XCTAssertEqual(saved.collectrProductID, "202")

        try store.remove(id: saved.id)
        XCTAssertTrue(store.mappings.isEmpty)
    }

    func testBuildsAuthorizedProductDetailRequest() throws {
        let request = try CollectrPrivatePriceClient().makeRequest(
            productID: "654213",
            configuration: sampleConfiguration
        )

        let components = try XCTUnwrap(URLComponents(url: request.url!, resolvingAgainstBaseURL: false))
        let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value) })
        XCTAssertEqual(components.scheme, "https")
        XCTAssertEqual(components.host, "dmsbhobr66dx6.cloudfront.net")
        XCTAssertEqual(components.path, "/catalog/products/654213")
        XCTAssertEqual(query["username"]!, "private-test-user")
        XCTAssertEqual(query["collectionId"]!, "collection-7")
        XCTAssertEqual(query["details"]!, "true")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Locale"), "en-CA")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Device-ID"), "device-id")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Session-Token"), "session-token")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-COLLECTR-KEY"), "captured-key")
    }

    func testMappedLivePriceIsAppliedToCardResult() async throws {
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [CollectrURLProtocolStub.self]
        let session = URLSession(configuration: sessionConfiguration)
        var capturedRequest: URLRequest?
        CollectrURLProtocolStub.requestHandler = { request in
            capturedRequest = request
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, Data(#"{"data":{"market_price":"31.50","currency":"cad"}}"#.utf8))
        }
        defer {
            CollectrURLProtocolStub.requestHandler = nil
            session.invalidateAndCancel()
        }

        let mapping = CollectrProductMapping(
            tcg: "pokemon",
            externalID: "SV04-214",
            collectrProductID: "654213"
        )
        let provider = CollectrTestPriceProvider(
            configuration: sampleConfiguration,
            mappings: [mapping],
            session: session
        )
        let cards = [
            Card(
                id: "sv04-214",
                name: "Mapped Card",
                tcg: "pokemon",
                setCode: "SV04",
                setName: "Example Set",
                rarity: "Rare",
                imageUrl: nil,
                imageUrlSmall: nil,
                price: 1,
                collectorNumber: "214",
                releasedAt: nil
            ),
            Card(
                id: "unmapped",
                name: "Unmapped Card",
                tcg: "pokemon",
                setCode: "SV04",
                setName: "Example Set",
                rarity: "Common",
                imageUrl: nil,
                imageUrlSmall: nil,
                price: 2,
                collectorNumber: "1",
                releasedAt: nil
            )
        ]

        let priced = await APIService().applyingCollectrPricing(
            to: cards,
            provider: provider,
            mappings: [mapping]
        )

        XCTAssertEqual(priced[0].price, 31.5)
        XCTAssertEqual(priced[1].price, 2)
        XCTAssertEqual(capturedRequest?.url?.path, "/catalog/products/654213")
        XCTAssertEqual(capturedRequest?.value(forHTTPHeaderField: "X-Session-Token"), "session-token")
    }

    func testLiveProviderRefusesUnmappedCardWithoutMakingRequest() async throws {
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [CollectrURLProtocolStub.self]
        let session = URLSession(configuration: sessionConfiguration)
        var didRequest = false
        CollectrURLProtocolStub.requestHandler = { request in
            didRequest = true
            throw URLError(.badURL)
        }
        defer {
            CollectrURLProtocolStub.requestHandler = nil
            session.invalidateAndCancel()
        }

        let provider = CollectrTestPriceProvider(
            configuration: sampleConfiguration,
            mappings: [],
            session: session
        )

        do {
            _ = try await provider.fetchPrice(tcg: "pokemon", externalID: "unmapped")
            XCTFail("Expected an unmapped-card error")
        } catch let error as CollectrTestPriceProvider.ProviderError {
            XCTAssertEqual(error.localizedDescription, "No Collectr product ID is mapped to this card.")
        }
        XCTAssertFalse(didRequest)
    }

    private var sampleConfiguration: CollectrPrivateAPIConfiguration {
        CollectrPrivateAPIConfiguration(
            baseURL: CollectrPrivateAPIConfiguration.defaultBaseURL,
            username: "private-test-user",
            collectionID: "collection-7",
            locale: "en-CA",
            deviceID: "device-id",
            sessionToken: "session-token",
            authorization: "Bearer token",
            collectrKey: "captured-key"
        )
    }
}
