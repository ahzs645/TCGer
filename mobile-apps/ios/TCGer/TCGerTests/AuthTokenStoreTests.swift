import Foundation
import Security
import XCTest
@testable import TCGer

@MainActor
final class AuthTokenStoreTests: XCTestCase {
    func testUpdatePreservesExistingCredentialWithoutDeleteOrAdd() throws {
        let client = FakeKeychainTokenClient(token: "old")
        try KeychainAuthTokenStore(client: client).saveToken("new")
        XCTAssertEqual(client.calls, ["update"])
        XCTAssertEqual(client.token, "new")
    }

    func testFailedUpdatePreservesPriorCredentialAndDoesNotFallBackToAdd() {
        let client = FakeKeychainTokenClient(token: "usable")
        client.updateStatuses = [errSecInteractionNotAllowed]
        XCTAssertThrowsError(try KeychainAuthTokenStore(client: client).saveToken("replacement"))
        XCTAssertEqual(client.calls, ["update"])
        XCTAssertEqual(client.token, "usable")
    }

    func testMissingItemIsAddedAndAddFailureIsReported() throws {
        let client = FakeKeychainTokenClient()
        let store = KeychainAuthTokenStore(client: client)
        try store.saveToken("new")
        XCTAssertEqual(client.calls, ["update", "add"])
        XCTAssertEqual(try store.loadToken(), "new")

        let failing = FakeKeychainTokenClient()
        failing.addStatus = errSecNotAvailable
        XCTAssertThrowsError(try KeychainAuthTokenStore(client: failing).saveToken("new"))
        XCTAssertNil(failing.token)
        XCTAssertEqual(failing.calls, ["update", "add"])
    }

    func testConcurrentAddRetriesUpdateWithoutDeletingTheWinningCredential() throws {
        let client = FakeKeychainTokenClient(token: "concurrent")
        client.updateStatuses = [errSecItemNotFound, errSecSuccess]
        client.addStatus = errSecDuplicateItem
        try KeychainAuthTokenStore(client: client).saveToken("new")
        XCTAssertEqual(client.calls, ["update", "add", "update"])
        XCTAssertEqual(client.token, "new")
    }

    func testReadDistinguishesMissingUnreadableAndInvalidData() throws {
        let client = FakeKeychainTokenClient()
        let store = KeychainAuthTokenStore(client: client)
        XCTAssertNil(try store.loadToken())
        client.copyStatus = errSecInteractionNotAllowed
        XCTAssertThrowsError(try store.loadToken())
        client.copyStatus = errSecSuccess
        client.data = Data([0xFF])
        XCTAssertThrowsError(try store.loadToken())
        client.data = Data("restored".utf8)
        XCTAssertEqual(try store.loadToken(), "restored")
    }

    func testDeleteReportsFailureAndMissingItemIsAlreadyDeleted() throws {
        let client = FakeKeychainTokenClient(token: "usable")
        let store = KeychainAuthTokenStore(client: client)
        client.deleteStatus = errSecNotAvailable
        XCTAssertThrowsError(try store.deleteToken())
        XCTAssertEqual(client.token, "usable")
        client.deleteStatus = errSecSuccess
        try store.deleteToken()
        XCTAssertNil(client.token)
        client.deleteStatus = errSecItemNotFound
        XCTAssertNoThrow(try store.deleteToken())
    }

    func testEmptyTokenCannotReplaceUsableCredential() {
        let client = FakeKeychainTokenClient(token: "usable")
        XCTAssertThrowsError(try KeychainAuthTokenStore(client: client).saveToken(""))
        XCTAssertEqual(client.token, "usable")
        XCTAssertTrue(client.calls.isEmpty)
    }
}

@MainActor
final class EnvironmentTokenPersistenceTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUpWithError() throws {
        suiteName = "EnvironmentTokenPersistence-" + UUID().uuidString
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.set(try JSONEncoder().encode(ServerConfiguration(baseURL: "https://token-tests.invalid")), forKey: "tcg.manager.server")
        defaults.set(true, forKey: "tcg.manager.authenticated")
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
    }

    private func environment(_ store: FakeAuthTokenStore) -> EnvironmentStore {
        EnvironmentStore(storage: defaults, widgetDefaults: nil, tokenStore: store)
    }

    func testFailedMigrationRetainsLegacyCopyAndRetriesNextLaunch() {
        defaults.set("legacy", forKey: "tcg.manager.auth.token")
        let store = FakeAuthTokenStore()
        store.saveError = AuthTokenStoreError(operation: "save", status: errSecNotAvailable)
        let first = environment(store)
        XCTAssertEqual(first.authToken, "legacy")
        XCTAssertTrue(first.isAuthenticated)
        XCTAssertNotNil(first.tokenPersistenceWarning)
        XCTAssertEqual(defaults.string(forKey: "tcg.manager.auth.token"), "legacy")
        XCTAssertNil(store.token)

        store.saveError = nil
        let second = environment(store)
        XCTAssertEqual(second.authToken, "legacy")
        XCTAssertEqual(store.token, "legacy")
        XCTAssertNil(defaults.object(forKey: "tcg.manager.auth.token"))
        XCTAssertNil(second.tokenPersistenceWarning)
    }

    func testReadFailureUsesLegacyFallbackWithoutOverwritingUnreadableCredential() {
        defaults.set("legacy", forKey: "tcg.manager.auth.token")
        let store = FakeAuthTokenStore(token: "keychain")
        store.loadError = AuthTokenStoreError(operation: "read", status: errSecInteractionNotAllowed)
        let first = environment(store)
        XCTAssertEqual(first.authToken, "legacy")
        XCTAssertEqual(store.saveCalls, 0)
        XCTAssertEqual(store.token, "keychain")
        XCTAssertEqual(defaults.string(forKey: "tcg.manager.auth.token"), "legacy")
        XCTAssertNotNil(first.tokenPersistenceWarning)

        store.loadError = nil
        let second = environment(store)
        XCTAssertEqual(second.authToken, "keychain")
        XCTAssertNil(defaults.object(forKey: "tcg.manager.auth.token"))
        XCTAssertNil(second.tokenPersistenceWarning)
    }

    func testReadFailureWithoutFallbackRetainsCredentialForLaterLaunch() {
        let store = FakeAuthTokenStore(token: "usable")
        store.loadError = AuthTokenStoreError(operation: "read", status: errSecNotAvailable)
        let first = environment(store)
        XCTAssertNil(first.authToken)
        XCTAssertFalse(first.isAuthenticated)
        XCTAssertNotNil(first.tokenPersistenceWarning)
        XCTAssertEqual(store.token, "usable")
        XCTAssertEqual(store.deleteCalls, 0)
        store.loadError = nil
        XCTAssertEqual(environment(store).authToken, "usable")
    }

    func testFailedSaveKeepsSuccessfulInMemorySessionAndPriorStoredCredential() {
        let store = FakeAuthTokenStore(token: "prior")
        let current = environment(store)
        store.saveError = AuthTokenStoreError(operation: "save", status: errSecNotAvailable)
        XCTAssertFalse(current.storeToken("new-login"))
        XCTAssertEqual(current.authToken, "new-login")
        XCTAssertTrue(current.isAuthenticated)
        XCTAssertEqual(store.token, "prior")
        XCTAssertNotNil(current.tokenPersistenceWarning)
        store.saveError = nil
        XCTAssertTrue(current.storeToken("new-login"))
        XCTAssertEqual(store.token, "new-login")
        XCTAssertNil(current.tokenPersistenceWarning)
    }

    func testFailedDeletionCannotRestoreSignedOutCredentialOnRelaunch() {
        let store = FakeAuthTokenStore(token: "prior")
        let current = environment(store)
        store.deleteError = AuthTokenStoreError(operation: "remove", status: errSecNotAvailable)
        current.signOut()
        XCTAssertFalse(current.isAuthenticated)
        XCTAssertNil(current.authToken)
        XCTAssertEqual(store.token, "prior")
        XCTAssertTrue(defaults.bool(forKey: "tcg.manager.auth.tokenDiscarded"))
        XCTAssertNotNil(current.tokenPersistenceWarning)
        let readsBeforeRelaunch = store.loadCalls
        let relaunched = environment(store)
        XCTAssertNil(relaunched.authToken)
        XCTAssertFalse(relaunched.isAuthenticated)
        XCTAssertEqual(store.loadCalls, readsBeforeRelaunch)

        XCTAssertTrue(relaunched.storeToken("next-login"))
        relaunched.isAuthenticated = true
        XCTAssertFalse(defaults.bool(forKey: "tcg.manager.auth.tokenDiscarded"))
        XCTAssertEqual(environment(store).authToken, "next-login")
    }

    func testLocalSessionDoesNotRequireKeychainOrOverwriteServerCredential() throws {
        defaults.set(try JSONEncoder().encode(ServerConfiguration.onDevice), forKey: "tcg.manager.server")
        let store = FakeAuthTokenStore(token: "saved-server-token")
        store.loadError = AuthTokenStoreError(operation: "read", status: errSecNotAvailable)
        let local = environment(store)
        XCTAssertEqual(local.authToken, "local-device-token")
        XCTAssertTrue(local.isAuthenticated)
        XCTAssertEqual(store.token, "saved-server-token")
        XCTAssertEqual(store.loadCalls, 0)
        XCTAssertEqual(store.saveCalls, 0)
        XCTAssertNil(local.tokenPersistenceWarning)
    }
}

private final class FakeAuthTokenStore: AuthTokenStore {
    var token: String?
    var loadError: Error?
    var saveError: Error?
    var deleteError: Error?
    var loadCalls = 0
    var saveCalls = 0
    var deleteCalls = 0

    init(token: String? = nil) { self.token = token }
    func loadToken() throws -> String? {
        loadCalls += 1
        if let loadError { throw loadError }
        return token
    }
    func saveToken(_ token: String) throws {
        saveCalls += 1
        if let saveError { throw saveError }
        self.token = token
    }
    func deleteToken() throws {
        deleteCalls += 1
        if let deleteError { throw deleteError }
        token = nil
    }
}

private final class FakeKeychainTokenClient: KeychainTokenClient {
    var data: Data?
    var updateStatuses: [OSStatus] = []
    var addStatus: OSStatus = errSecSuccess
    var copyStatus: OSStatus?
    var deleteStatus: OSStatus = errSecSuccess
    var calls: [String] = []
    var token: String? { data.flatMap { String(data: $0, encoding: .utf8) } }
    init(token: String? = nil) { data = token.map { Data($0.utf8) } }
    func update(query: [String: Any], attributes: [String: Any]) -> OSStatus {
        calls.append("update")
        let status = updateStatuses.isEmpty ? (data == nil ? errSecItemNotFound : errSecSuccess) : updateStatuses.removeFirst()
        if status == errSecSuccess { data = attributes[kSecValueData as String] as? Data }
        return status
    }
    func add(query: [String: Any]) -> OSStatus {
        calls.append("add")
        if addStatus == errSecSuccess { data = query[kSecValueData as String] as? Data }
        return addStatus
    }
    func copy(query: [String: Any]) -> (OSStatus, Data?) {
        calls.append("copy")
        return (copyStatus ?? (data == nil ? errSecItemNotFound : errSecSuccess), data)
    }
    func delete(query: [String: Any]) -> OSStatus {
        calls.append("delete")
        if deleteStatus == errSecSuccess { data = nil }
        return deleteStatus
    }
}
