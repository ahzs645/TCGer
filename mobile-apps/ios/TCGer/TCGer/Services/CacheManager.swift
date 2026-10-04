import Foundation
import CryptoKit

final class CacheManager {
    static let shared = CacheManager()

    private let fileManager = FileManager.default
    private let cacheDirectory: URL

    init(directory: URL? = nil) {
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        cacheDirectory = directory ?? documentsPath.appendingPathComponent("TCGerCache", isDirectory: true)

        // Creation is retried by each throwing operation so an initialization
        // failure is surfaced to the caller instead of being silently lost.
    }

    // MARK: - Cache Operations

    func save<T: Encodable>(_ data: T, forKey key: String) throws {
        try ensureCacheDirectory()
        let fileURL = cacheDirectory.appendingPathComponent("\(key).json")
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let jsonData = try encoder.encode(data)
        try jsonData.write(to: fileURL, options: [.atomic])

        // Update last cache time
        UserDefaults.standard.set(Date(), forKey: "lastCacheUpdate_\(key)")
    }

    func load<T: Decodable>(_ type: T.Type, forKey key: String) throws -> T? {
        let fileURL = cacheDirectory.appendingPathComponent("\(key).json")

        guard fileManager.fileExists(atPath: fileURL.path) else {
            return nil
        }

        let data = try Data(contentsOf: fileURL)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(T.self, from: data)
    }

    func remove(forKey key: String) throws {
        let fileURL = cacheDirectory.appendingPathComponent("\(key).json")
        if fileManager.fileExists(atPath: fileURL.path) {
            try fileManager.removeItem(at: fileURL)
        }
        UserDefaults.standard.removeObject(forKey: "lastCacheUpdate_\(key)")
    }

    func clearAll() throws {
        try ensureCacheDirectory()
        let contents = try fileManager.contentsOfDirectory(at: cacheDirectory, includingPropertiesForKeys: nil)
        for fileURL in contents {
            try fileManager.removeItem(at: fileURL)
        }

        ImageCache.shared.clearAll()

        // Clear all cache timestamps
        let keys = UserDefaults.standard.dictionaryRepresentation().keys
        for key in keys where key.hasPrefix("lastCacheUpdate_") {
            UserDefaults.standard.removeObject(forKey: key)
        }

        UserDefaults.standard.set(Date(), forKey: "lastCacheClear")
    }

    func getCacheSize() -> Int64 {
        guard let enumerator = fileManager.enumerator(
            at: cacheDirectory,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else {
            return 0
        }

        var totalSize: Int64 = 0

        for case let fileURL as URL in enumerator {
            guard
                let resourceValues = try? fileURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
                resourceValues.isRegularFile == true,
                let fileSize = resourceValues.fileSize
            else {
                continue
            }
            totalSize += Int64(fileSize)
        }

        return totalSize
    }

    func getLastCacheUpdate(forKey key: String) -> Date? {
        return UserDefaults.standard.object(forKey: "lastCacheUpdate_\(key)") as? Date
    }

    func getLastSyncDate() -> Date? {
        return UserDefaults.standard.object(forKey: "lastSuccessfulSync") as? Date
    }

    func updateLastSyncDate() {
        UserDefaults.standard.set(Date(), forKey: "lastSuccessfulSync")
    }

    private func ensureCacheDirectory() throws {
        try fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    }
}

// MARK: - Cache Keys
extension CacheManager {
    enum CacheKey {
        /// Legacy key is never read. A credential change intentionally requires
        /// a fresh fetch; opaque tokens do not expose a trustworthy stable user ID.
        static let collections = "collections"

        static func collections(config: ServerConfiguration, token: String?) -> String? {
            guard !config.isOnDevice, let token, !token.isEmpty,
                  var url = URLComponents(string: config.baseURL) else { return nil }
            url.scheme = url.scheme?.lowercased()
            url.host = url.host?.lowercased()
            if (url.scheme == "https" && url.port == 443) || (url.scheme == "http" && url.port == 80) { url.port = nil }
            url.path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if !url.path.isEmpty { url.path = "/" + url.path }
            guard let server = url.string else { return nil }
            let data = Data((server + "\u{0}" + token).utf8)
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            return "collections-v2-" + digest
        }
        static let searchResults = "searchResults"
        static let userPreferences = "userPreferences"
        static let appSettings = "appSettings"
        static let magicCardHashes = "magic_card_hashes"

        static func collection(id: String) -> String {
            return "collection_\(id)"
        }

        static func card(id: String) -> String {
            return "card_\(id)"
        }
    }
}

// MARK: - Helper for formatted sizes
extension CacheManager {
    func getFormattedCacheSize() -> String {
        let size = getCacheSize()

        if size < 1024 {
            return "\(size) B"
        } else if size < 1024 * 1024 {
            return String(format: "%.2f KB", Double(size) / 1024)
        } else if size < 1024 * 1024 * 1024 {
            return String(format: "%.2f MB", Double(size) / (1024 * 1024))
        } else {
            return String(format: "%.2f GB", Double(size) / (1024 * 1024 * 1024))
        }
    }
}
