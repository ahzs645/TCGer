import Foundation

// MARK: - Card Models
struct Card: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let tcg: String // "yugioh", "magic", "pokemon"
    let setCode: String?
    let setName: String?
    let rarity: String?
    let imageUrl: String?
    let imageUrlSmall: String?
    let price: Double?

    var displayName: String {
        if let setCode = setCode {
            return "\(name) (\(setCode))"
        }
        return name
    }

    var tcgDisplayName: String {
        switch tcg.lowercased() {
        case "yugioh": return "Yu-Gi-Oh!"
        case "magic": return "Magic: The Gathering"
        case "pokemon": return "Pokémon"
        default: return tcg.capitalized
        }
    }
}

// MARK: - Search Response
struct CardSearchResponse: Codable {
    let cards: [Card]
    let total: Int
}

// MARK: - Collection Models
struct Collection: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let description: String?
    let cards: [CollectionCard]
    let createdAt: String
    let updatedAt: String
    let colorHex: String?

    var uniqueCards: Int {
        cards.count
    }

    var totalCopies: Int {
        cards.reduce(0) { $0 + $1.quantity }
    }

    var totalValue: Double {
        cards.reduce(0) { $0 + ($1.price ?? 0) * Double($1.quantity) }
    }

    var uniqueGames: Set<String> {
        Set(cards.map { $0.tcg })
    }

    var color: Color {
        if let hex = colorHex {
            return Color(hex: hex)
        }
        return .blue // Default color
    }
}

struct CollectionCard: Identifiable, Codable, Hashable {
    let id: String
    let cardId: String
    let name: String
    let tcg: String
    let setCode: String?
    let rarity: String?
    let imageUrl: String?
    let imageUrlSmall: String?
    let quantity: Int
    let price: Double?
    let condition: String?
    let language: String?
    let notes: String?
}

// MARK: - App Settings
struct AppSettings: Codable {
    let id: Int
    let publicDashboard: Bool
    let publicCollections: Bool
    let requireAuth: Bool
    let appName: String
    let updatedAt: String
}

// MARK: - User
struct User: Codable {
    let id: String
    let email: String
    let username: String?
    let isAdmin: Bool
}

struct AuthResponse: Codable {
    let user: User
    let token: String
}

// MARK: - Dashboard Stats
struct DashboardStats: Codable {
    let totalCards: Int
    let totalCollections: Int
    let totalValue: Double
    let recentCards: [Card]
    let topSets: [SetStats]
}

struct SetStats: Codable, Identifiable {
    let id = UUID()
    let setName: String
    let cardCount: Int
    let tcg: String

    private enum CodingKeys: String, CodingKey {
        case setName, cardCount, tcg
    }
}

// MARK: - Game Filter
enum TCGGame: String, CaseIterable, Identifiable {
    case all = "all"
    case yugioh = "yugioh"
    case magic = "magic"
    case pokemon = "pokemon"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .all: return "All Games"
        case .yugioh: return "Yu-Gi-Oh!"
        case .magic: return "Magic: The Gathering"
        case .pokemon: return "Pokémon"
        }
    }

    var iconName: String {
        switch self {
        case .all: return "square.grid.2x2"
        case .yugioh: return "suit.club.fill"
        case .magic: return "sparkles"
        case .pokemon: return "bolt.fill"
        }
    }
}
