import Foundation
import Security

/// Missing credentials are distinct from a temporarily unreadable Keychain.
protocol AuthTokenStore {
    func loadToken() throws -> String?
    func saveToken(_ token: String) throws
    func deleteToken() throws
}

struct AuthTokenStoreError: LocalizedError, Equatable {
    let operation: String
    let status: OSStatus

    var errorDescription: String? {
        let detail = SecCopyErrorMessageString(status, nil) as String? ?? "Keychain status \(status)"
        return "Could not \(operation) the saved sign-in: \(detail)"
    }
}

/// Injectable Security boundary; tests never alter the user's real Keychain.
protocol KeychainTokenClient {
    func update(query: [String: Any], attributes: [String: Any]) -> OSStatus
    func add(query: [String: Any]) -> OSStatus
    func copy(query: [String: Any]) -> (OSStatus, Data?)
    func delete(query: [String: Any]) -> OSStatus
}

struct SecurityKeychainTokenClient: KeychainTokenClient {
    func update(query: [String: Any], attributes: [String: Any]) -> OSStatus {
        SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    }

    func add(query: [String: Any]) -> OSStatus {
        SecItemAdd(query as CFDictionary, nil)
    }

    func copy(query: [String: Any]) -> (OSStatus, Data?) {
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        return (status, result as? Data)
    }

    func delete(query: [String: Any]) -> OSStatus {
        SecItemDelete(query as CFDictionary)
    }
}

final class KeychainAuthTokenStore: AuthTokenStore {
    private let client: any KeychainTokenClient
    private let service: String
    private let account: String

    init(
        client: any KeychainTokenClient = SecurityKeychainTokenClient(),
        service: String = "com.tcger.auth",
        account: String = "jwt-token"
    ) {
        self.client = client
        self.service = service
        self.account = account
    }

    private var identity: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    func saveToken(_ token: String) throws {
        guard !token.isEmpty else { throw AuthTokenStoreError(operation: "save", status: errSecParam) }
        let attributes: [String: Any] = [
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        let updateStatus = client.update(query: identity, attributes: attributes)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw AuthTokenStoreError(operation: "save", status: updateStatus)
        }

        let addStatus = client.add(query: identity.merging(attributes) { _, new in new })
        if addStatus == errSecSuccess { return }
        // Another writer can create the item between update and add. Retry the
        // update without deleting an existing usable credential.
        if addStatus == errSecDuplicateItem {
            let retryStatus = client.update(query: identity, attributes: attributes)
            guard retryStatus == errSecSuccess else {
                throw AuthTokenStoreError(operation: "save", status: retryStatus)
            }
            return
        }
        throw AuthTokenStoreError(operation: "save", status: addStatus)
    }

    func loadToken() throws -> String? {
        var query = identity
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        let (status, data) = client.copy(query: query)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw AuthTokenStoreError(operation: "read", status: status) }
        guard let data, let token = String(data: data, encoding: .utf8), !token.isEmpty else {
            throw AuthTokenStoreError(operation: "read", status: errSecDecode)
        }
        return token
    }

    func deleteToken() throws {
        let status = client.delete(query: identity)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw AuthTokenStoreError(operation: "remove", status: status)
        }
    }
}
