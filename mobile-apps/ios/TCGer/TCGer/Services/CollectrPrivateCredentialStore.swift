import Foundation
import Security

struct CollectrPrivateAPIConfiguration: Codable, Equatable, Sendable {
    static let defaultBaseURL = "https://dmsbhobr66dx6.cloudfront.net"

    let baseURL: String
    let username: String
    let collectionID: String
    let locale: String
    let deviceID: String
    let sessionToken: String
    let authorization: String
    let collectrKey: String

    var nonEmptyHeaders: [String: String] {
        [
            "Locale": locale,
            "X-Device-ID": deviceID,
            "X-Session-Token": sessionToken,
            "Authorization": authorization,
            "X-COLLECTR-KEY": collectrKey
        ].filter { !$0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
}

enum CollectrPrivateCredentialStore {
    enum CredentialError: LocalizedError {
        case missingBaseURL
        case missingUsername
        case missingAuthentication
        case encodingFailed
        case decodingFailed
        case keychain(OSStatus)

        var errorDescription: String? {
            switch self {
            case .missingBaseURL: return "Enter the Collectr API base URL."
            case .missingUsername: return "Enter the Collectr account username."
            case .missingAuthentication:
                return "Enter at least one captured Collectr authentication header."
            case .encodingFailed: return "The Collectr test session could not be encoded."
            case .decodingFailed: return "The saved Collectr test session is invalid."
            case .keychain(let status):
                let detail = SecCopyErrorMessageString(status, nil) as String?
                return detail.map { "Keychain error: \($0)" } ?? "Keychain error (\(status))."
            }
        }
    }

    private static let service = "com.tcger.pricing.collectr-private-test"
    private static let account = "captured-session"

    private static var itemQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any
        ]
    }

    static func save(_ configuration: CollectrPrivateAPIConfiguration) throws {
        guard !configuration.baseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CredentialError.missingBaseURL
        }
        guard !configuration.username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CredentialError.missingUsername
        }
        guard !configuration.nonEmptyHeaders.isEmpty else {
            throw CredentialError.missingAuthentication
        }
        guard let encoded = try? JSONEncoder().encode(configuration) else {
            throw CredentialError.encodingFailed
        }

        let updateStatus = SecItemUpdate(
            itemQuery as CFDictionary,
            [kSecValueData as String: encoded] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
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

    static func load() throws -> CollectrPrivateAPIConfiguration? {
        var query = itemQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw CredentialError.keychain(status)
        }
        guard let configuration = try? JSONDecoder().decode(
            CollectrPrivateAPIConfiguration.self,
            from: data
        ) else {
            throw CredentialError.decodingFailed
        }
        return configuration
    }

    static func delete() throws {
        let status = SecItemDelete(itemQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw CredentialError.keychain(status)
        }
    }
}
