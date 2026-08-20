import Foundation
import XCTest
@testable import TCGer

final class JustTCGPricingTests: XCTestCase {
    override func tearDown() {
        JustTCGURLProtocol.handler = nil
        super.tearDown()
    }

    func testBatchUsesOnePostForMultipleGamesAndSelectsConditionLanguageAndFinish() async throws {
        var requestCount = 0
        JustTCGURLProtocol.handler = { request in
            requestCount += 1
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.absoluteString, "https://api.justtcg.com/v1/cards")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-key"), "test-key")
            let body = try Self.requestBody(request)
            let lookups = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [[String: String]])
            XCTAssertEqual(lookups.count, 2)
            XCTAssertEqual(Set(lookups.compactMap { $0.keys.first }), ["scryfallId", "tcgplayerId"])

            return try Self.response(
                for: request,
                json: [
                    "data": [
                        [
                            "id": "magic-card",
                            "uuid": "11111111-1111-5111-8111-111111111111",
                            "name": "Magic Card",
                            "game": "Magic: The Gathering",
                            "set": "test-magic",
                            "scryfallId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                            "variants": [
                                ["condition": "Near Mint", "printing": "Normal", "language": "English", "price": 2.0],
                                ["condition": "Lightly Played", "printing": "Foil", "language": "Japanese", "price": 5.5]
                            ]
                        ],
                        [
                            "id": "pokemon-card",
                            "uuid": "22222222-2222-5222-8222-222222222222",
                            "name": "Pokemon Card",
                            "game": "Pokemon",
                            "set": "test-pokemon",
                            "tcgplayerId": "219042",
                            "variants": [
                                ["condition": "Near Mint", "printing": "Normal", "language": "Japanese", "price": 9.0],
                                ["condition": "Near Mint", "printing": "Normal", "language": "English", "price": 7.25]
                            ]
                        ]
                    ]
                ]
            )
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [JustTCGURLProtocol.self]
        let service = APIService(session: URLSession(configuration: configuration))
        let magic = APIService.TrackedPriceItem(
            tcg: "magic",
            externalId: "magic-local",
            finishCode: "foil",
            condition: "Lightly Played",
            language: "Japanese",
            identifiers: JustTCGIdentifiers(scryfallId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        )
        let pokemon = APIService.TrackedPriceItem(
            tcg: "pokemon",
            externalId: "pokemon-local",
            condition: "Near Mint",
            language: "English",
            identifiers: JustTCGIdentifiers(tcgplayerId: "219042")
        )

        let quotes = try await service.fetchOnDeviceJustTCGPrices(
            [magic, pokemon],
            apiKey: "test-key"
        )

        XCTAssertEqual(requestCount, 1)
        XCTAssertEqual(quotes[magic.key]?.price, 5.5)
        XCTAssertEqual(quotes[pokemon.key]?.price, 7.25)
        XCTAssertEqual(quotes.values.map(\.source), ["justtcg", "justtcg"])
    }

    func testIdentifierMappingsPersistCanonicalUUIDAndTCGplayerID() {
        let suiteName = "JustTCGPricingTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        JustTCGIdentifierMappingStore.save(
            JustTCGIdentifiers(
                cardId: "11111111-1111-5111-8111-111111111111",
                tcgplayerId: "219042"
            ),
            tcg: "pokemon",
            externalId: "sv1-001",
            to: defaults
        )

        let saved = JustTCGIdentifierMappingStore.identifiers(
            tcg: "POKEMON",
            externalId: "SV1-001",
            in: defaults
        )
        XCTAssertEqual(saved?.cardId, "11111111-1111-5111-8111-111111111111")
        XCTAssertEqual(saved?.tcgplayerId, "219042")
    }

    func testMatchCardPreferencesNormalizeCollectionConditions() {
        XCTAssertEqual(
            JustTCGPricingPreferences.resolvedCondition(preference: "", cardValue: "Good"),
            "Moderately Played"
        )
        XCTAssertEqual(
            JustTCGPricingPreferences.resolvedLanguage(preference: "", cardValue: nil),
            "English"
        )
        XCTAssertEqual(
            JustTCGPricingPreferences.resolvedLanguage(preference: "Japanese", cardValue: "English"),
            "Japanese"
        )
    }

    private static func response(
        for request: URLRequest,
        json: [String: Any]
    ) throws -> (HTTPURLResponse, Data) {
        let response = try XCTUnwrap(HTTPURLResponse(
            url: try XCTUnwrap(request.url),
            statusCode: 200,
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

private final class JustTCGURLProtocol: URLProtocol, @unchecked Sendable {
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
