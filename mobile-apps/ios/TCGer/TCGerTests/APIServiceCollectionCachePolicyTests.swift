import Foundation
import XCTest
@testable import TCGer

final class APIServiceCollectionCachePolicyTests: XCTestCase {
    override func tearDownWithError() throws {
        try? CacheManager.shared.remove(forKey: CacheManager.CacheKey.collections)
        MockCollectionURLProtocol.handler = nil
    }

    func testUnauthorizedResponseIsNotMaskedByCachedCollections() async throws {
        try CacheManager.shared.save([Self.cachedCollection], forKey: CacheManager.CacheKey.collections)
        MockCollectionURLProtocol.handler = { request in
            let response = try XCTUnwrap(HTTPURLResponse(
                url: request.url!,
                statusCode: 401,
                httpVersion: nil,
                headerFields: nil
            ))
            return (response, Data())
        }

        do {
            _ = try await makeService().getCollections(
                config: ServerConfiguration(baseURL: "https://example.test"),
                token: "expired"
            )
            XCTFail("Expected an unauthorized error")
        } catch APIService.APIError.unauthorized {
            // Expected: cached data must not bypass authentication failure.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testTransportFailureCanUseCachedCollections() async throws {
        try CacheManager.shared.save([Self.cachedCollection], forKey: CacheManager.CacheKey.collections)
        MockCollectionURLProtocol.handler = { _ in
            throw URLError(.notConnectedToInternet)
        }

        let collections = try await makeService().getCollections(
            config: ServerConfiguration(baseURL: "https://example.test"),
            token: "token"
        )

        XCTAssertEqual(collections, [Self.cachedCollection])
    }

    private func makeService() -> APIService {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockCollectionURLProtocol.self]
        return APIService(session: URLSession(configuration: configuration))
    }

    private static let cachedCollection = Collection(
        id: "cached-binder",
        name: "Cached Binder",
        description: nil,
        cards: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        colorHex: nil
    )
}

private final class MockCollectionURLProtocol: URLProtocol, @unchecked Sendable {
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
