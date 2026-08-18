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
        XCTAssertEqual(first.lookupKey, "pokemon:sv1-001")
        XCTAssertEqual(first.tcg, "Pokemon")
        XCTAssertEqual(first.externalId, "sv1-001")
        XCTAssertEqual(first.finishCode, "Holo")
    }

    func testGetTrackedPricesDeduplicatesEquivalentItemsBeforeRequesting() async throws {
        TrackedPricesURLProtocol.handler = { request in
            let body = try XCTUnwrap(request.httpBody)
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
        XCTAssertEqual(response.prices.first?.lookupKey, "pokemon:sv1-001")
        XCTAssertEqual(response.prices.first?.price, 3.25)
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
