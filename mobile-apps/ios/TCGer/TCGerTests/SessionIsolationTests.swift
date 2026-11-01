import Foundation
import XCTest
@testable import TCGer

@MainActor
final class SessionIsolationTests: XCTestCase {
    func testLoginCompletionCannotInstallAnOldServersToken() throws {
        let credentials = SessionTestTokenStore()
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "SessionIsolation-\(UUID().uuidString)"))
        let environment = EnvironmentStore(storage: defaults, widgetDefaults: nil, tokenStore: credentials)
        environment.serverConfiguration = ServerConfiguration(baseURL: "https://a.test")
        environment.signOut()
        let startedOnA = environment.sessionIdentity
        environment.serverConfiguration = ServerConfiguration(baseURL: "https://b.test")
        let startedOnB = environment.sessionIdentity
        XCTAssertTrue(environment.completeAuthentication(try auth(token: "b-token", id: "b"), username: "B", for: startedOnB))
        XCTAssertFalse(environment.completeAuthentication(try auth(token: "a-token", id: "a"), username: "A", for: startedOnA))
        XCTAssertEqual(environment.authToken, "b-token")
        XCTAssertEqual(environment.currentUser?.id, "b")
        XCTAssertEqual(credentials.token, "b-token")
        XCTAssertEqual(environment.serverConfiguration.baseURL, "https://b.test")
    }

    func testSessionGenerationRejectsLogoutThenSameServerAndCredential() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "SessionABA-\(UUID().uuidString)"))
        let environment = EnvironmentStore(storage: defaults, widgetDefaults: nil, tokenStore: SessionTestTokenStore())
        environment.serverConfiguration = ServerConfiguration(baseURL: "https://a.test")
        environment.storeToken("same-token")
        let previous = environment.sessionIdentity
        environment.signOut()
        environment.storeToken("same-token")
        XCTAssertFalse(environment.matches(previous))
        XCTAssertFalse(environment.completeAuthentication(try auth(token: "late-token", id: "old"), username: "Old", for: previous))
        XCTAssertEqual(environment.authToken, "same-token")
    }

    func testLateWishlistCreateCannotPublishIntoNewAccountsStore() async throws {
        let repository = SuspendedWishlistRepository()
        let store = WishlistStore(repository: repository)
        let config = ServerConfiguration(baseURL: "https://server.test")
        await store.load(config: config, token: "A")
        let started = expectation(description: "Create reached repository")
        repository.createStarted = started
        let task = Task {
            try await store.create(config: config, token: "A", input: CreateWishlistInput(name: "A private", description: nil, colorHex: nil, matchAnyPrinting: false))
        }
        await fulfillment(of: [started], timeout: 1)
        store.reset()
        await store.load(config: config, token: "B")
        repository.createContinuation?.resume(returning: makeWishlist(id: "a-private", name: "A private"))
        do { _ = try await task.value; XCTFail("Stale mutation must be cancelled") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(store.wishlists.map(\.name), ["B"])
        XCTAssertTrue(store.matches(config: config, token: "B"))
    }

    func testLateWishlistDeleteCannotRemoveMatchingIDFromReplacementSession() async throws {
        let repository = SuspendedWishlistRepository()
        let store = WishlistStore(repository: repository)
        let config = ServerConfiguration(baseURL: "https://server.test")
        await store.load(config: config, token: "A")
        let started = expectation(description: "Delete reached repository")
        repository.deleteStarted = started
        let task = Task { try await store.delete(config: config, token: "A", id: "shared-id") }
        await fulfillment(of: [started], timeout: 1)
        store.reset()
        // The same credential/source comes back after logout. A source-only
        // comparison would miss this replacement session.
        await store.load(config: config, token: "A")
        repository.deleteContinuation?.resume()
        do { try await task.value; XCTFail("Stale delete must be cancelled") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(store.wishlists.map(\.id), ["shared-id"])
    }

    func testOldWishlistFetchCannotPublishAfterSourceReturnsToSameAccount() async {
        var continuation: CheckedContinuation<[Wishlist], Error>?
        var count = 0
        let started = expectation(description: "Fetch reached loader")
        let store = WishlistStore { _, _ in
            count += 1
            if count == 1 {
                return try await withCheckedThrowingContinuation { pending in
                    continuation = pending
                    started.fulfill()
                }
            }
            return [makeWishlist(id: "new", name: "New session")]
        }
        let config = ServerConfiguration(baseURL: "https://server.test")
        let first = Task { await store.load(config: config, token: "A") }
        await fulfillment(of: [started], timeout: 1)
        store.reset()
        await store.load(config: config, token: "A")
        continuation?.resume(returning: [makeWishlist(id: "old", name: "Old session")])
        await first.value
        XCTAssertEqual(store.wishlists.map(\.id), ["new"])
        XCTAssertFalse(store.isLoading)
    }

    func testStrongCapabilitiesDefaultToUnavailableForOlderServers() throws {
        let features = try JSONDecoder().decode(ServerFeatures.self, from: Data(#"{"finance":true,"sealed":true}"#.utf8))
        XCTAssertFalse(features.atomicSales)
        XCTAssertFalse(features.atomicIntake)
        XCTAssertFalse(features.linkedAcquisitions)
        XCTAssertFalse(features.tradeSettlement)
        XCTAssertFalse(features.emailDelivery)
        XCTAssertFalse(features.binderPageRevisionGuards)
    }

    func testLegacySyntheticCopyIDSuffixIsAPathSegmentNotAFragment() throws {
        let config = ServerConfiguration(baseURL: "https://server.test/api")
        let url = try XCTUnwrap(config.endpoint(path: "collections/binder/copies/\(APIService.pathSegment("entry#2"))"))
        XCTAssertNil(url.fragment)
        XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath, "/api/collections/binder/copies/entry%232")
        XCTAssertEqual(url.path, "/api/collections/binder/copies/entry#2")
    }

    func testMutationNoticeCannotRefreshAnotherAccountsOwnership() throws {
        let config = ServerConfiguration(baseURL: "https://server.test/api")
        let source = try XCTUnwrap(CacheManager.CacheKey.collections(config: config, token: "secret-A"))
        let notice = Notification(name: .collectionDidChange, userInfo: ["collectionSource": source])
        XCTAssertTrue(CollectionMutationNotice.matches(notice, config: config, token: "secret-A"))
        XCTAssertFalse(CollectionMutationNotice.matches(notice, config: config, token: "secret-B"))
        XCTAssertFalse(CollectionMutationNotice.matches(notice, config: ServerConfiguration(baseURL: "https://other.test/api"), token: "secret-A"))
        XCTAssertFalse(CollectionMutationNotice.matches(Notification(name: .collectionDidChange), config: config, token: "secret-A"))
        XCTAssertFalse(source.contains("secret-A"))
        let local = Notification(name: .collectionDidChange, userInfo: ["collectionSource": "collections-local-device"])
        XCTAssertTrue(CollectionMutationNotice.matches(local, config: .onDevice, token: "local"))
        XCTAssertFalse(CollectionMutationNotice.matches(local, config: config, token: "secret-A"))
    }

    func testExternalWishlistPublicationRejectsAnOldScopeAfterSameAccountReturns() async throws {
        let store = WishlistStore { _, _ in [makeWishlist(id: "current", name: "Current")] }
        let config = ServerConfiguration(baseURL: "https://server.test")
        let scope = store.mutationScope(config: config, token: "A")
        store.reset()
        await store.load(config: config, token: "A")
        XCTAssertThrowsError(try store.publish(makeWishlist(id: "old", name: "Old follow"), for: scope))
        XCTAssertEqual(store.wishlists.map(\.id), ["current"])
    }

    func testWishlistReadStartedBeforeMutationCannotEraseConfirmedNewList() async throws {
        var continuation: CheckedContinuation<[Wishlist], Error>?
        let started = expectation(description: "Read started")
        let store = WishlistStore { _, _ in
            try await withCheckedThrowingContinuation { pending in
                continuation = pending
                started.fulfill()
            }
        }
        let config = ServerConfiguration(baseURL: "https://server.test")
        let loading = Task { await store.load(config: config, token: "A") }
        await fulfillment(of: [started], timeout: 1)
        let scope = store.mutationScope(config: config, token: "A")
        try store.publish(makeWishlist(id: "confirmed", name: "Confirmed create"), for: scope)
        continuation?.resume(returning: [])
        await loading.value
        XCTAssertEqual(store.wishlists.map(\.id), ["confirmed"])
        XCTAssertFalse(store.isLoading)
    }

    private func auth(token: String, id: String) throws -> AuthResponse {
        let data = try JSONSerialization.data(withJSONObject: ["token": token, "user": ["id": id, "email": "test@example.test", "isAdmin": false]])
        return try JSONDecoder().decode(AuthResponse.self, from: data)
    }
}

@MainActor
private final class SuspendedWishlistRepository: WishlistRepository {
    var createStarted: XCTestExpectation?
    var deleteStarted: XCTestExpectation?
    var createContinuation: CheckedContinuation<Wishlist, Error>?
    var deleteContinuation: CheckedContinuation<Void, Error>?
    func wishlists(config: ServerConfiguration, token: String) async throws -> [Wishlist] {
        [makeWishlist(id: "shared-id", name: token)]
    }
    func createWishlist(config: ServerConfiguration, token: String, input: CreateWishlistInput) async throws -> Wishlist {
        try await withCheckedThrowingContinuation { continuation in
            createContinuation = continuation
            createStarted?.fulfill()
        }
    }
    func deleteWishlist(config: ServerConfiguration, token: String, id: String) async throws {
        try await withCheckedThrowingContinuation { continuation in
            deleteContinuation = continuation
            deleteStarted?.fulfill()
        }
    }
}

private final class SessionTestTokenStore: AuthTokenStore {
    var token: String?
    func loadToken() throws -> String? { token }
    func saveToken(_ token: String) throws { self.token = token }
    func deleteToken() throws { token = nil }
}

private func makeWishlist(id: String, name: String) -> Wishlist {
    Wishlist(id: id, name: name, description: nil, colorHex: nil, cards: [], totalCards: 0, ownedCards: 0, completionPercent: 0, createdAt: "2026-10-30", updatedAt: "2026-10-30")
}
