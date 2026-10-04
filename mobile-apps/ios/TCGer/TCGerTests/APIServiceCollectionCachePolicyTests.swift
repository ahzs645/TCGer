import Foundation
import XCTest
@testable import TCGer

final class APIServiceCollectionCachePolicyTests: XCTestCase {
    private var root: URL!
    private var cache: CacheManager!
    private let config = ServerConfiguration(baseURL: "https://example.test")
    private func key(_ token: String) -> String { CacheManager.CacheKey.collections(config: config, token: token)! }

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        cache = CacheManager(directory: root)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
        MockCollectionURLProtocol.handler = nil
    }

    func testUnauthorizedResponseIsNotMaskedByCachedCollections() async throws {
        try cache.save([Self.cachedCollection], forKey: key("expired"))
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
        try cache.save([Self.cachedCollection], forKey: key("token"))
        MockCollectionURLProtocol.handler = { _ in
            throw URLError(.notConnectedToInternet)
        }

        let collections = try await makeService().getCollections(
            config: ServerConfiguration(baseURL: "https://example.test"),
            token: "token"
        )

        XCTAssertEqual(collections, [Self.cachedCollection])
    }

    func testExplicitCacheCannotCrossCredentialOrServerBoundaries() async throws {
        try cache.save([Self.cachedCollection], forKey: key("account-a"))
        MockCollectionURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        let same = try await makeService().getCollections(config: config, token: "account-a", useCache: true)
        XCTAssertEqual(same, [Self.cachedCollection])
        for (server, token) in [(config, "account-b"), (ServerConfiguration(baseURL: "https://other.test"), "account-a")] {
            do {
                _ = try await makeService().getCollections(config: server, token: token, useCache: true)
                XCTFail("Another identity must not receive cached account A")
            } catch { }
        }
    }

    func testLegacyCacheIsDiscardedAndAnonymousCannotReadPrivateData() async throws {
        try cache.save([Self.cachedCollection], forKey: CacheManager.CacheKey.collections)
        MockCollectionURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        do {
            _ = try await makeService().getCollections(config: config, token: nil, useCache: true)
            XCTFail("Legacy unscoped data must not be returned")
        } catch { }
        XCTAssertNil(try cache.load([Collection].self, forKey: CacheManager.CacheKey.collections))
    }

    func testCacheKeyNormalizesServerAndDoesNotExposeCredentials() {
        let a = CacheManager.CacheKey.collections(config: ServerConfiguration(baseURL: "https://EXAMPLE.test:443/api/"), token: "secret-token")
        let b = CacheManager.CacheKey.collections(config: ServerConfiguration(baseURL: "https://example.test/api"), token: "secret-token")
        XCTAssertEqual(a, b)
        XCTAssertFalse(a!.contains("secret-token"))
        XCTAssertNotEqual(a, CacheManager.CacheKey.collections(config: config, token: "secret-token"))
    }

    func testSuccessfulDeleteInvalidatesOnlyItsSessionCache() async throws {
        try cache.save([Self.cachedCollection], forKey: key("account-a"))
        try cache.save([Self.cachedCollection], forKey: key("account-b"))
        MockCollectionURLProtocol.handler = { request in
            (try XCTUnwrap(HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)), Data())
        }
        try await makeService().deleteCollection(config: config, token: "account-a", id: Self.cachedCollection.id)
        XCTAssertNil(try cache.load([Collection].self, forKey: key("account-a")))
        XCTAssertEqual(try cache.load([Collection].self, forKey: key("account-b")), [Self.cachedCollection])
    }

    private func makeService() -> APIService {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockCollectionURLProtocol.self]
        return APIService(session: URLSession(configuration: configuration), collectionCache: cache)
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
