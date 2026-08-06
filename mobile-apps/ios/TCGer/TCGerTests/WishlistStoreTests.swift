import XCTest
@testable import TCGer

@MainActor
final class WishlistStoreTests: XCTestCase {
    func testRepeatedLoadUsesFreshCachedWishlistsUntilForced() async {
        var loadCount = 0
        let expected = [makeWishlist(id: "wishlist-1")]
        let store = WishlistStore(refreshInterval: 60) { _, _ in
            loadCount += 1
            return expected
        }
        let config = ServerConfiguration(baseURL: ServerConfiguration.onDeviceBaseURL)

        await store.load(config: config, token: "token")
        await store.load(config: config, token: "token")

        XCTAssertEqual(loadCount, 1)
        XCTAssertEqual(store.wishlists, expected)
        XCTAssertEqual(store.revision, 1)

        await store.load(config: config, token: "token", force: true)

        XCTAssertEqual(loadCount, 2)
        XCTAssertEqual(store.revision, 2)
    }

    func testChangingDataSourceInvalidatesCachedWishlists() async {
        var loadedBaseURLs: [String] = []
        let store = WishlistStore(refreshInterval: 60) { config, _ in
            loadedBaseURLs.append(config.baseURL)
            return [self.makeWishlist(id: config.baseURL)]
        }
        let local = ServerConfiguration(baseURL: ServerConfiguration.onDeviceBaseURL)
        let remote = ServerConfiguration(baseURL: "https://example.com")

        await store.load(config: local, token: "token")
        await store.load(config: remote, token: "token")

        XCTAssertEqual(loadedBaseURLs, [local.baseURL, remote.baseURL])
        XCTAssertEqual(store.wishlists.first?.id, remote.baseURL)
    }

    func testConcurrentLoadsShareOneRequestAndPublishOnce() async {
        var loadCount = 0
        let store = WishlistStore(refreshInterval: 60) { _, _ in
            loadCount += 1
            try await Task.sleep(nanoseconds: 20_000_000)
            return [self.makeWishlist(id: "wishlist-1")]
        }
        let config = ServerConfiguration(baseURL: ServerConfiguration.onDeviceBaseURL)

        async let first: Void = store.load(config: config, token: "token")
        async let second: Void = store.load(config: config, token: "token")
        _ = await (first, second)

        XCTAssertEqual(loadCount, 1)
        XCTAssertEqual(store.revision, 1)
    }

    private func makeWishlist(id: String) -> Wishlist {
        Wishlist(
            id: id,
            name: "Wishlist",
            description: nil,
            colorHex: nil,
            cards: [],
            totalCards: 0,
            ownedCards: 0,
            completionPercent: 0,
            createdAt: "2026-08-05T00:00:00Z",
            updatedAt: "2026-08-05T00:00:00Z"
        )
    }
}
