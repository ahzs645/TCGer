import Foundation

struct AppNotification: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let userId: String
    let type: String
    let title: String
    let body: String
    var read: Bool
    let data: JSONValue?
    let createdAt: String

    var createdDate: Date? {
        Self.dateFormatter.date(from: createdAt)
            ?? Self.fallbackDateFormatter.date(from: createdAt)
    }

    var category: NotificationCategory {
        NotificationCategory(type: type)
    }

    private static let dateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let fallbackDateFormatter = ISO8601DateFormatter()
}

enum NotificationCategory: Hashable, Sendable {
    case trade
    case price
    case importStatus
    case news
    case general

    init(type: String) {
        let normalized = type.lowercased()
        if normalized.contains("trade") {
            self = .trade
        } else if normalized.contains("price") || normalized.contains("market") {
            self = .price
        } else if normalized.contains("import") || normalized.contains("scan") {
            self = .importStatus
        } else if normalized.contains("news") || normalized.contains("release") {
            self = .news
        } else {
            self = .general
        }
    }

    var systemImage: String {
        switch self {
        case .trade: return "arrow.left.arrow.right"
        case .price: return "chart.line.uptrend.xyaxis"
        case .importStatus: return "checkmark.circle"
        case .news: return "newspaper"
        case .general: return "bell"
        }
    }
}
