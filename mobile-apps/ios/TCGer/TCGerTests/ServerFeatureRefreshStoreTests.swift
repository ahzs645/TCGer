import XCTest
@testable import TCGer

@MainActor
final class ServerFeatureRefreshStoreTests: XCTestCase {
    func testFailedHealthRequestCanRetryTheSameServer() async {
        var attempts = 0
        let expected = ServerFeatures(decks: false, onlineCodes: true)
        let store = ServerFeatureRefreshStore { _ in
            attempts += 1
            if attempts == 1 { throw URLError(.cannotConnectToHost) }
            return expected
        }
        let configuration = ServerConfiguration(baseURL: "https://health.test")
        let first = await store.refresh(config: configuration)
        XCTAssertNil(first)
        XCTAssertNotNil(store.errorMessage)
        let second = await store.refresh(config: configuration)
        XCTAssertEqual(second, expected)
        XCTAssertEqual(attempts, 2)
        XCTAssertNil(store.errorMessage)
    }

    func testSuccessIsCachedAndForcedRecoveryFetchesChanges() async {
        var attempts = 0
        let store = ServerFeatureRefreshStore { _ in
            attempts += 1
            return ServerFeatures(decks: attempts == 1)
        }
        let configuration = ServerConfiguration(baseURL: "https://health.test")
        let first = await store.refresh(config: configuration)
        let cached = await store.refresh(config: configuration)
        XCTAssertEqual(cached, first)
        XCTAssertEqual(attempts, 1)
        let recovered = await store.refresh(config: configuration, force: true)
        XCTAssertEqual(recovered?.decks, false)
        XCTAssertEqual(attempts, 2)
    }

    func testFailedForcedRefreshRetainsLastKnownRestrictions() async {
        var attempts = 0
        let restricted = ServerFeatures(decks: false, trades: false)
        let store = ServerFeatureRefreshStore { _ in
            attempts += 1
            if attempts > 1 { throw URLError(.networkConnectionLost) }
            return restricted
        }
        let configuration = ServerConfiguration(baseURL: "https://health.test")
        _ = await store.refresh(config: configuration)
        let failure = await store.refresh(config: configuration, force: true)
        XCTAssertNil(failure)
        let retained = await store.refresh(config: configuration)
        XCTAssertEqual(retained, restricted)
        XCTAssertNotNil(store.errorMessage)
    }

    func testSourceChangeRejectsLateResultEvenWhenTransportIgnoresCancellation() async {
        let pending = PendingHealthResponses()
        let store = ServerFeatureRefreshStore { configuration in
            try await pending.load(configuration)
        }
        let first = ServerConfiguration(baseURL: "https://first.test")
        let second = ServerConfiguration(baseURL: "https://second.test")
        let firstTask = Task { await store.refresh(config: first) }
        await pending.waitForCall(first.baseURL)
        let secondTask = Task { await store.refresh(config: second) }
        await pending.waitForCall(second.baseURL)
        pending.finish(second.baseURL, with: ServerFeatures(trades: false))
        let current = await secondTask.value
        XCTAssertEqual(current?.trades, false)
        pending.finish(first.baseURL, with: .allEnabled)
        let stale = await firstTask.value
        XCTAssertNil(stale)
        let retained = await store.refresh(config: second)
        XCTAssertEqual(retained?.trades, false)
    }

    func testConcurrentRequestsAreCoalescedAndResetInvalidatesPendingResult() async {
        let pending = PendingHealthResponses()
        let store = ServerFeatureRefreshStore { configuration in
            try await pending.load(configuration)
        }
        let configuration = ServerConfiguration(baseURL: "https://health.test")
        let firstTask = Task { await store.refresh(config: configuration) }
        await pending.waitForCall(configuration.baseURL)
        var duplicateTask: Task<ServerFeatures?, Never>!
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            duplicateTask = Task {
                started.resume()
                return await store.refresh(config: configuration, force: true)
            }
        }
        store.reset()
        pending.finish(configuration.baseURL, with: .allEnabled)
        let first = await firstTask.value
        let duplicate = await duplicateTask.value
        XCTAssertNil(first)
        XCTAssertNil(duplicate)
        XCTAssertEqual(pending.calls.count, 1)
        XCTAssertNil(store.errorMessage)
    }
}

@MainActor
private final class PendingHealthResponses {
    private var continuations: [String: CheckedContinuation<ServerFeatures, Error>] = [:]
    private var waiters: [String: CheckedContinuation<Void, Never>] = [:]
    private(set) var calls: [String] = []

    func load(_ configuration: ServerConfiguration) async throws -> ServerFeatures {
        try await withCheckedThrowingContinuation { continuation in
            continuations[configuration.baseURL] = continuation
            calls.append(configuration.baseURL)
            waiters.removeValue(forKey: configuration.baseURL)?.resume()
        }
    }

    func waitForCall(_ url: String) async {
        if calls.contains(url) { return }
        await withCheckedContinuation { waiters[url] = $0 }
    }

    func finish(_ url: String, with features: ServerFeatures) {
        continuations.removeValue(forKey: url)?.resume(returning: features)
    }
}
