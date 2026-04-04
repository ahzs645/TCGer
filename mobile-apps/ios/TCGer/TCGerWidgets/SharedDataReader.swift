import Foundation

struct WidgetCardInfo: Codable, Identifiable {
    var id: String { name + (setName ?? "") }
    let name: String
    let tcg: String
    let setName: String?
    let imageUrl: String?
}

struct SharedDataReader {
    private static let suiteName = "group.firstform.TCGer.shared"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }

    static var totalBinders: Int {
        defaults?.integer(forKey: "widget.totalBinders") ?? 0
    }

    static var uniqueCards: Int {
        defaults?.integer(forKey: "widget.uniqueCards") ?? 0
    }

    static var totalCopies: Int {
        defaults?.integer(forKey: "widget.totalCopies") ?? 0
    }

    static var lastUpdated: Date? {
        guard let interval = defaults?.object(forKey: "widget.lastUpdated") as? Double else { return nil }
        return Date(timeIntervalSince1970: interval)
    }

    static var recentCards: [WidgetCardInfo] {
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

    static var hasData: Bool {
        defaults?.object(forKey: "widget.lastUpdated") != nil
    }
}
