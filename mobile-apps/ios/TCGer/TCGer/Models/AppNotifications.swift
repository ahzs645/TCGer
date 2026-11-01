import Foundation

extension Notification.Name {
    static let collectionDidChange = Notification.Name("TCGer.collectionDidChange")
}

/// Mutations carry only a non-secret source digest. Every ownership/cache
/// consumer rejects notices from another server or authenticated account.
enum CollectionMutationNotice {
    private static let sourceKey = "collectionSource"

    private static func source(config: ServerConfiguration, token: String?) -> String? {
        if config.isOnDevice { return "collections-local-device" }
        return CacheManager.CacheKey.collections(config: config, token: token)
    }

    static func post(config: ServerConfiguration, token: String?, object: Any? = nil) {
        guard let source = source(config: config, token: token) else { return }
        NotificationCenter.default.post(name: .collectionDidChange, object: object, userInfo: [sourceKey: source])
    }

    static func matches(_ notification: Notification, config: ServerConfiguration, token: String?) -> Bool {
        guard let source = notification.userInfo?[sourceKey] as? String,
              let current = source(config: config, token: token) else { return false }
        return source == current
    }
}
