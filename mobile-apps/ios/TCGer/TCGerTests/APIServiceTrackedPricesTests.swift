import Foundation
import XCTest
@testable import TCGer

final class APIServiceTrackedPricesTests: XCTestCase {
    override func tearDown() {
        TrackedPricesURLProtocol.handler = nil
        super.tearDown()
    }

    func testTrackedPriceKeysNormalizeCaseAndSurroundingWhitespace() {
        let first = APIService.TrackedPriceItem(
            tcg: " Pokemon ",
            externalId: " sv1-001 ",
            finishCode: " Holo "
        )
        let second = APIService.TrackedPriceItem(
            tcg: "pokemon",
            externalId: "sv1-001",
            finishCode: "holo"
        )

        XCTAssertEqual(first.key, second.key)
        XCTAssertEqual(first.lookupKey, "pokemon:sv1-001:holo")
        XCTAssertEqual(first.tcg, "Pokemon")
        XCTAssertEqual(first.externalId, "sv1-001")
        XCTAssertEqual(first.finishCode, "Holo")
    }

    func testGetTrackedPricesDeduplicatesEquivalentItemsBeforeRequesting() async throws {
        TrackedPricesURLProtocol.handler = { request in
            let body = try Self.requestBody(request)
            let json = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: Any]
            )
            let items = try XCTUnwrap(json["items"] as? [[String: Any]])
            guard items.count == 1 else {
                return try Self.response(
                    for: request,
                    status: 422,
                    json: ["message": "Expected one canonical tracked-price item"]
                )
            }

            return try Self.response(
                for: request,
                status: 200,
                json: [
                    "prices": [[
                        "key": "pokemon:sv1-001:holo",
                        "tcg": "pokemon",
                        "externalId": "sv1-001",
                        "finishCode": "holo",
                        "price": 3.25,
                        "currency": "USD",
                        "source": "test",
                        "updatedAt": "2026-08-18T18:00:00Z",
                        "cached": false
                    ]],
                    "refreshedAt": "2026-08-18T18:00:00Z",
                    "refreshAfter": "2026-08-19T06:00:00Z"
                ]
            )
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TrackedPricesURLProtocol.self]
        let service = APIService(session: URLSession(configuration: configuration))
        let response = try await service.getTrackedPrices(
            config: ServerConfiguration(baseURL: "https://example.test"),
            token: "token",
            items: [
                APIService.TrackedPriceItem(
                    tcg: " Pokemon ",
                    externalId: " sv1-001 ",
                    finishCode: " Holo "
                ),
                APIService.TrackedPriceItem(
                    tcg: "pokemon",
                    externalId: "sv1-001",
                    finishCode: "holo"
                )
            ]
        )

        XCTAssertEqual(response.prices.count, 1)
        XCTAssertEqual(response.prices.first?.lookupKey, "pokemon:sv1-001:holo")
        XCTAssertEqual(response.prices.first?.price, 3.25)
    }

    func testGetTrackedPricesUsesPerGameSourcesForMixedCollection() async throws {
        let defaults = UserDefaults.standard
        let previousSource = defaults.string(forKey: PricingSource.storageKey)
        let previousPriorities = defaults.data(forKey: PricingSourcePreferences.storageKey)
        defaults.set(PricingSource.automatic.rawValue, forKey: PricingSource.storageKey)
        PricingSourcePreferences.save(
            [
                TCGGame.magic.rawValue: .scryfall,
                TCGGame.pokemon.rawValue: .tcgDexCardmarket
            ],
            to: defaults
        )
        defer {
            if let previousSource {
                defaults.set(previousSource, forKey: PricingSource.storageKey)
            } else {
                defaults.removeObject(forKey: PricingSource.storageKey)
            }
            if let previousPriorities {
                defaults.set(previousPriorities, forKey: PricingSourcePreferences.storageKey)
            } else {
                defaults.removeObject(forKey: PricingSourcePreferences.storageKey)
            }
        }

        TrackedPricesURLProtocol.handler = { request in
            let body = try Self.requestBody(request)
            let json = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: Any]
            )
            let source = try XCTUnwrap(json["source"] as? String)
            let items = try XCTUnwrap(json["items"] as? [[String: Any]])
            let item = try XCTUnwrap(items.first)
            let tcg = try XCTUnwrap(item["tcg"] as? String)
            XCTAssertEqual(items.count, 1)
            XCTAssertEqual(
                source,
                tcg == TCGGame.magic.rawValue
                    ? PricingSource.scryfall.rawValue
                    : PricingSource.tcgDexCardmarket.rawValue
            )

            return try Self.response(
                for: request,
                status: 200,
                json: [
                    "prices": [[
                        "key": "\(tcg):card-id:",
                        "tcg": tcg,
                        "externalId": "card-id",
                        "price": tcg == TCGGame.magic.rawValue ? 4.5 : 2.5,
                        "currency": "USD",
                        "source": source,
                        "updatedAt": "2026-08-20T18:00:00Z",
                        "cached": false
                    ]],
                    "refreshedAt": "2026-08-20T18:00:00Z",
                    "refreshAfter": "2026-08-21T06:00:00Z"
                ]
            )
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TrackedPricesURLProtocol.self]
        let service = APIService(session: URLSession(configuration: configuration))
        let response = try await service.getTrackedPrices(
            config: ServerConfiguration(baseURL: "https://example.test"),
            token: "token",
            items: [
                APIService.TrackedPriceItem(tcg: "magic", externalId: "card-id"),
                APIService.TrackedPriceItem(tcg: "pokemon", externalId: "card-id")
            ]
        )

        XCTAssertEqual(response.prices.count, 2)
        XCTAssertEqual(Set(response.prices.compactMap(\.source)), ["scryfall", "tcgdex-cardmarket"])
    }

    func testOnDeviceScryfallUsesFinishSpecificQuoteAndRequiredHeaders() async throws {
        let defaults = UserDefaults.standard
        let previousSource = defaults.string(forKey: PricingSource.storageKey)
        let previousPriorities = defaults.data(forKey: PricingSourcePreferences.storageKey)
        defaults.set(PricingSource.scryfall.rawValue, forKey: PricingSource.storageKey)
        defaults.removeObject(forKey: PricingSourcePreferences.storageKey)
        defer {
            if let previousSource {
                defaults.set(previousSource, forKey: PricingSource.storageKey)
            } else {
                defaults.removeObject(forKey: PricingSource.storageKey)
            }
            if let previousPriorities {
                defaults.set(previousPriorities, forKey: PricingSourcePreferences.storageKey)
            } else {
                defaults.removeObject(forKey: PricingSourcePreferences.storageKey)
            }
        }

        TrackedPricesURLProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), "TCGer/0.1 (iOS pricing integration)")
            XCTAssertTrue(request.value(forHTTPHeaderField: "Accept")?.contains("application/json") == true)
            XCTAssertTrue(request.url?.absoluteString.contains("api.scryfall.com/cards/finish-test-card") == true)
            return try Self.response(
                for: request,
                status: 200,
                json: [
                    "prices": [
                        "usd": "2.00",
                        "usd_foil": "5.50",
                        "usd_etched": "8.25",
                        "eur": "1.80",
                        "eur_foil": "4.90"
                    ]
                ]
            )
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TrackedPricesURLProtocol.self]
        let service = APIService(session: URLSession(configuration: configuration))
        let response = try await service.getTrackedPrices(
            config: .onDevice,
            token: "local",
            items: [APIService.TrackedPriceItem(
                tcg: "magic",
                externalId: "finish-test-card",
                finishCode: "etched"
            )],
            force: true
        )

        XCTAssertEqual(response.prices.first?.price, 8.25)
        XCTAssertEqual(response.prices.first?.currency, "USD")
        XCTAssertEqual(response.prices.first?.source, "scryfall")
    }

    private static func response(
        for request: URLRequest,
        status: Int,
        json: [String: Any]
    ) throws -> (HTTPURLResponse, Data) {
        let response = try XCTUnwrap(HTTPURLResponse(
            url: try XCTUnwrap(request.url),
            statusCode: status,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        ))
        return (response, try JSONSerialization.data(withJSONObject: json))
    }

    private static func requestBody(_ request: URLRequest) throws -> Data {
        if let body = request.httpBody { return body }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeContentData) }
            if count == 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private final class TrackedPricesURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
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
