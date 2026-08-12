import XCTest
@testable import TCGer

@MainActor
final class FeatureRepositoryInjectionTests: XCTestCase {
    func testCollectionStoreLoadsAndCreatesThroughInjectedRepository() async throws {
        let initial = makeCollection(id: "binder-1", name: "First")
        let created = makeCollection(id: "binder-2", name: "Created")
        let repository = CollectionRepositorySpy(
            collectionsResult: [initial],
            createdCollection: created
        )
        let store = CollectionListStore(repository: repository)
        let config = ServerConfiguration(baseURL: ServerConfiguration.onDeviceBaseURL)

        await store.load(config: config, token: "token", useCache: true)

        XCTAssertEqual(store.collections, [initial])
        XCTAssertTrue(store.hasLoaded)
        XCTAssertFalse(store.isLoading)
        XCTAssertEqual(repository.loadRequests.count, 1)
        XCTAssertEqual(repository.loadRequests.first?.useCache, true)

        let input = CreateCollectionInput(
            name: "Created",
            description: nil,
            colorHex: "#123456",
            defaultCondition: "Near Mint",
            containerType: "binder",
            imageUrl: nil,
            associatedTcg: "pokemon",
            associatedSetCode: nil,
            associatedSetName: nil
        )
        let result = try await store.create(config: config, token: "token", input: input)

        XCTAssertEqual(result, created)
        XCTAssertEqual(store.collections, [initial, created])
        XCTAssertEqual(repository.createInputs, [input])
    }

    func testWishlistStoreMutationsUseInjectedRepositoryAndPublishState() async throws {
        let initial = makeWishlist(id: "wishlist-1", name: "First")
        let created = makeWishlist(id: "wishlist-2", name: "Created")
        let repository = WishlistRepositorySpy(
            wishlistsResult: [initial],
            createdWishlist: created
        )
        let store = WishlistStore(refreshInterval: 60, repository: repository)
        let config = ServerConfiguration(baseURL: ServerConfiguration.onDeviceBaseURL)

        await store.load(config: config, token: "token")
        let input = CreateWishlistInput(
            name: "Created",
            description: nil,
            colorHex: "#654321",
            matchAnyPrinting: true
        )
        _ = try await store.create(config: config, token: "token", input: input)

        XCTAssertEqual(store.wishlists.map(\.id), ["wishlist-2", "wishlist-1"])
        XCTAssertEqual(repository.createInputs, [input])

        try await store.delete(config: config, token: "token", id: initial.id)

        XCTAssertEqual(store.wishlists, [created])
        XCTAssertEqual(repository.deletedIDs, [initial.id])
        XCTAssertEqual(store.revision, 3)
    }

    private func makeCollection(id: String, name: String) -> Collection {
        Collection(
            id: id,
            name: name,
            description: nil,
            cards: [],
            createdAt: "2026-08-12T00:00:00Z",
            updatedAt: "2026-08-12T00:00:00Z",
            colorHex: nil
        )
    }

    private func makeWishlist(id: String, name: String) -> Wishlist {
        Wishlist(
            id: id,
            name: name,
            description: nil,
            colorHex: nil,
            cards: [],
            totalCards: 0,
            ownedCards: 0,
            completionPercent: 0,
            createdAt: "2026-08-12T00:00:00Z",
            updatedAt: "2026-08-12T00:00:00Z"
        )
    }
}

@MainActor
private final class CollectionRepositorySpy: CollectionRepository {
    struct LoadRequest {
        let config: ServerConfiguration
        let token: String?
        let useCache: Bool
    }

    var loadRequests: [LoadRequest] = []
    var createInputs: [CreateCollectionInput] = []

    private let collectionsResult: [Collection]
    private let createdCollection: Collection

    init(collectionsResult: [Collection], createdCollection: Collection) {
        self.collectionsResult = collectionsResult
        self.createdCollection = createdCollection
    }

    func collections(
        config: ServerConfiguration,
        token: String?,
        useCache: Bool
    ) async throws -> [Collection] {
        loadRequests.append(LoadRequest(config: config, token: token, useCache: useCache))
        return collectionsResult
    }

    func createCollection(
        config: ServerConfiguration,
        token: String,
        input: CreateCollectionInput
    ) async throws -> Collection {
        createInputs.append(input)
        return createdCollection
    }
}

@MainActor
private final class WishlistRepositorySpy: WishlistRepository {
    var createInputs: [CreateWishlistInput] = []
    var deletedIDs: [String] = []

    private let wishlistsResult: [Wishlist]
    private let createdWishlist: Wishlist

    init(wishlistsResult: [Wishlist], createdWishlist: Wishlist) {
        self.wishlistsResult = wishlistsResult
        self.createdWishlist = createdWishlist
    }

    func wishlists(
        config: ServerConfiguration,
        token: String
    ) async throws -> [Wishlist] {
        wishlistsResult
    }

    func createWishlist(
        config: ServerConfiguration,
        token: String,
        input: CreateWishlistInput
    ) async throws -> Wishlist {
        createInputs.append(input)
        return createdWishlist
    }

    func deleteWishlist(
        config: ServerConfiguration,
        token: String,
        id: String
    ) async throws {
        deletedIDs.append(id)
    }
}
