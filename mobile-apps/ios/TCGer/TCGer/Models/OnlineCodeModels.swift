import Foundation

enum OnlineCodeStatus: String, CaseIterable, Codable, Identifiable, Sendable {
    case unused
    case redeemed
    case invalid
    case traded

    var id: String { rawValue }

    var title: String {
        switch self {
        case .unused: "Unused"
        case .redeemed: "Used"
        case .invalid: "Invalid"
        case .traded: "Shared"
        }
    }

    var systemImage: String {
        switch self {
        case .unused: "checkmark.seal"
        case .redeemed: "checkmark.circle.fill"
        case .invalid: "xmark.octagon.fill"
        case .traded: "square.and.arrow.up.circle.fill"
        }
    }
}

enum OnlineCodeSource: String, Codable, Sendable {
    case camera
    case manual
    case `import`
}

struct OnlineCode: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let tcg: String
    let code: String
    let status: OnlineCodeStatus
    let source: OnlineCodeSource
    let productName: String?
    let notes: String?
    let capturedAt: String
    let redeemedAt: String?
    let createdAt: String
    let updatedAt: String

    var game: TCGGame? { TCGGame(rawValue: tcg) }
}

struct OnlineCodeBatchResult: Codable, Sendable {
    let created: Int
    let duplicates: Int
    let items: [OnlineCode]
}
