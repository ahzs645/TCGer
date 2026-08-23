import Foundation

struct WidgetCardInfo: Codable, Identifiable {
    var id: String { name + (setName ?? "") }
    let name: String
    let tcg: String
    let setName: String?
    let imageUrl: String?
}

struct WidgetWishlistInfo: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let colorHex: String
    let completionPercent: Int
    let ownedCards: Int
    let totalCards: Int
    let neededCardNames: [String]
}

struct WidgetBinderInfo: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let uniqueCards: Int
    let totalCopies: Int
    let totalValue: Double?
    let colorHex: String
}

struct SharedDataReader {
    nonisolated private static let suiteName = "group.firstform.TCGer.shared"

    nonisolated private static var defaults: UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }

    nonisolated static var totalBinders: Int {
        defaults?.integer(forKey: "widget.totalBinders") ?? 0
    }

    nonisolated static var uniqueCards: Int {
        defaults?.integer(forKey: "widget.uniqueCards") ?? 0
    }

    nonisolated static var totalCopies: Int {
        defaults?.integer(forKey: "widget.totalCopies") ?? 0
    }

    nonisolated static var totalValue: Double {
        defaults?.double(forKey: "widget.totalValue") ?? 0
    }

    nonisolated static var currencyCode: String {
        defaults?.string(forKey: "widget.currencyCode") ?? "USD"
    }

    nonisolated static var showPricing: Bool {
        defaults?.object(forKey: "widget.showPricing") as? Bool ?? true
    }

    nonisolated static var lastUpdated: Date? {
        guard let interval = defaults?.object(forKey: "widget.lastUpdated") as? Double else { return nil }
        return Date(timeIntervalSince1970: interval)
    }

    nonisolated static var recentCards: [WidgetCardInfo] {
        guard let data = defaults?.data(forKey: "widget.recentCards"),
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: String]] else {
            return []
        }

        return array.compactMap { dict in
            guard let name = dict["name"], let tcg = dict["tcg"] else { return nil }
            return WidgetCardInfo(
                name: name,
                tcg: tcg,
                setName: dict["setName"],
                imageUrl: dict["imageUrl"]
            )
        }
    }

    nonisolated static var wishlists: [WidgetWishlistInfo] {
        decode([WidgetWishlistInfo].self, forKey: "widget.wishlists") ?? []
    }

    nonisolated static var binders: [WidgetBinderInfo] {
        decode([WidgetBinderInfo].self, forKey: "widget.binders") ?? []
    }

    nonisolated static var hasData: Bool {
        defaults?.object(forKey: "widget.lastUpdated") != nil
    }

    nonisolated private static func decode<Value: Decodable>(_ type: Value.Type, forKey key: String) -> Value? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
