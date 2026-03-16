import Foundation

// MARK: - Card Models
struct Card: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let name: String
    let tcg: String // "yugioh", "magic", "pokemon"
    let setCode: String?
    let setName: String?
    let rarity: String?
    let imageUrl: String?
    let imageUrlSmall: String?
    let price: Double?
    let collectorNumber: String?
    let releasedAt: Date?
    let supertype: String? // "Pokémon", "Trainer", "Energy" (Pokemon TCG)
    let subtypes: [String]? // ["Basic"], ["Supporter"], ["VMAX"], etc. (Pokemon TCG)
    let types: [String]? // ["Lightning"], ["Dragon"], etc. (Pokemon TCG)

    // Custom initializer with default values for Pokemon-specific fields
    init(
        id: String,
        name: String,
        tcg: String,
        setCode: String?,
        setName: String?,
        rarity: String?,
        imageUrl: String?,
        imageUrlSmall: String?,
        price: Double?,
        collectorNumber: String?,
        releasedAt: Date?,
        supertype: String? = nil,
        subtypes: [String]? = nil,
        types: [String]? = nil
    ) {
        self.id = id
        self.name = name
        self.tcg = tcg
        self.setCode = setCode
        self.setName = setName
        self.rarity = rarity
        self.imageUrl = imageUrl
        self.imageUrlSmall = imageUrlSmall
        self.price = price
        self.collectorNumber = collectorNumber
        self.releasedAt = releasedAt
        self.supertype = supertype
        self.subtypes = subtypes
        self.types = types
    }

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
        case "onepiece": return "One Piece"
        case "lorcana": return "Disney Lorcana"
        case "dragonball": return "Dragon Ball Super"
        default: return tcg.capitalized
        }
    }

    var supportsPrintSelection: Bool {
        switch tcg.lowercased() {
        case "magic", "pokemon": return true
        default: return false
        }
    }
}

// MARK: - Search Response
struct CardSearchResponse: Codable, Sendable {
    let cards: [Card]
    let total: Int
}

// MARK: - Collection Models
struct Collection: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let name: String
    let description: String?
    let cards: [CollectionCard]
    let createdAt: String
    let updatedAt: String
    let colorHex: String?

    static let unsortedBinderId = "__library__"

    var isUnsortedBinder: Bool {
        id == Collection.unsortedBinderId
    }

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
}

struct CollectionCard: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let cardId: String
    let externalId: String?
    let name: String
    let tcg: String
    let setCode: String?
    let setName: String?
    let rarity: String?
    let imageUrl: String?
    let imageUrlSmall: String?
    let quantity: Int
    let price: Double?
    let condition: String?
    let language: String?
    let notes: String?
    let collectorNumber: String?
    let copies: [CollectionCardCopy]

    var supportsPrintSelection: Bool {
        switch tcg.lowercased() {
        case "magic", "pokemon": return true
        default: return false
        }
    }
}

struct CollectionCardCopy: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let condition: String?
    let language: String?
    let notes: String?
    let price: Double?
    let acquisitionPrice: Double?
    let serialNumber: String?
    let acquiredAt: String?
    let isFoil: Bool?
    let isSigned: Bool?
    let isAltered: Bool?
    let imageUrls: [String]?
    let tags: [CollectionCardTag]
}

struct CollectionCardTag: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let label: String
    let colorHex: String
}

// MARK: - App Settings
struct AppSettings: Codable, Sendable {
    let id: Int
    let publicDashboard: Bool
    let publicCollections: Bool
    let requireAuth: Bool
    let appName: String
    let updatedAt: String
}

// MARK: - User
struct User: Codable, Sendable {
    let id: String
    let email: String
    let username: String?
    let isAdmin: Bool
    let showCardNumbers: Bool?
    let showPricing: Bool?
    let enabledYugioh: Bool?
    let enabledMagic: Bool?
    let enabledPokemon: Bool?
    let enabledOnepiece: Bool?
    let enabledLorcana: Bool?
    let enabledDragonball: Bool?
    let defaultGame: String?
}

struct AuthResponse: Codable, Sendable {
    let user: User
    let token: String
}

struct SetupCheckResponse: Codable, Sendable {
    let setupRequired: Bool
}

// MARK: - Dashboard Stats
struct DashboardStats: Codable, Sendable {
    let totalCards: Int
    let totalCollections: Int
    let totalValue: Double
    let recentCards: [Card]
    let topSets: [SetStats]
}

struct SetStats: Codable, Identifiable, Sendable {
    let id = UUID()
    let setName: String
    let cardCount: Int
    let tcg: String

    private enum CodingKeys: String, CodingKey {
        case setName, cardCount, tcg
    }
}

// MARK: - TCG Set
struct TcgSet: Identifiable, Codable, Hashable, Sendable {
    let code: String
    let name: String
    let tcg: String
    let releaseDate: String?
    let totalCards: Int?
    let iconUrl: String?
    let logoUrl: String?

    var id: String { "\(tcg)-\(code)" }

    var tcgDisplayName: String {
        switch tcg.lowercased() {
        case "yugioh": return "Yu-Gi-Oh!"
        case "magic": return "Magic: The Gathering"
        case "pokemon": return "Pokémon"
        case "onepiece": return "One Piece"
        case "lorcana": return "Disney Lorcana"
        case "dragonball": return "Dragon Ball Super"
        default: return tcg.capitalized
        }
    }
}

// MARK: - Game Filter
enum TCGGame: String, CaseIterable, Identifiable {
    case all = "all"
    case yugioh = "yugioh"
    case magic = "magic"
    case pokemon = "pokemon"
    case onepiece = "onepiece"
    case lorcana = "lorcana"
    case dragonball = "dragonball"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .all: return "All Games"
        case .yugioh: return "Yu-Gi-Oh!"
        case .magic: return "Magic: The Gathering"
        case .pokemon: return "Pokémon"
        case .onepiece: return "One Piece"
        case .lorcana: return "Disney Lorcana"
        case .dragonball: return "Dragon Ball Super"
        }
    }

    var iconName: String? {
        switch self {
        case .all: return nil
        case .yugioh: return "YugiohIcon"
        case .magic: return "MTGIcon"
        case .pokemon: return "PokemonIcon"
        case .onepiece: return "OnePieceIcon"
        case .lorcana: return "LorcanaIcon"
        case .dragonball: return "DragonBallIcon"
        }
    }

    var systemIconName: String {
        switch self {
        case .all: return "square.grid.2x2"
        case .yugioh: return "suit.club.fill"
        case .magic: return "sparkles"
        case .pokemon: return "bolt.fill"
        case .onepiece: return "sail.boat.fill"
        case .lorcana: return "wand.and.stars"
        case .dragonball: return "flame.fill"
        }
    }
}
