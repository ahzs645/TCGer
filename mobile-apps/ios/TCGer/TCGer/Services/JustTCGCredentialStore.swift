import Foundation
import Security

enum JustTCGCredentialStore {
    enum CredentialError: LocalizedError {
        case emptyKey
        case keychain(OSStatus)

        var errorDescription: String? {
            switch self {
            case .emptyKey:
                return "Enter a JustTCG API key."
            case .keychain(let status):
                let detail = SecCopyErrorMessageString(status, nil) as String?
                return detail.map { "Keychain error: \($0)" } ?? "Keychain error (\(status))."
            }
        }
    }

    private static let service = "com.tcger.pricing.justtcg"
    private static let account = "personal-api-key"

    private static var itemQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any
        ]
    }

    static func save(apiKey: String) throws {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedKey.isEmpty, let encoded = trimmedKey.data(using: .utf8) else {
            throw CredentialError.emptyKey
        }

        let updateStatus = SecItemUpdate(
            itemQuery as CFDictionary,
            [kSecValueData as String: encoded] as CFDictionary
        )

        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw CredentialError.keychain(updateStatus)
        }

        var newItem = itemQuery
        newItem[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        newItem[kSecValueData as String] = encoded
        let addStatus = SecItemAdd(newItem as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw CredentialError.keychain(addStatus)
        }
    }

    static func loadAPIKey() throws -> String? {
        var query = itemQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = item as? Data else {
            throw CredentialError.keychain(status)
        }
        return String(data: data, encoding: .utf8)
    }

    static func deleteAPIKey() throws {
        let status = SecItemDelete(itemQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw CredentialError.keychain(status)
        }
    }
}
