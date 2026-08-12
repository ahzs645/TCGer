import Foundation

// MARK: - Price Tracking

struct PriceMover: Identifiable, Codable, Hashable, Sendable {
    let externalId: String
    let tcg: String
    let name: String
    let priceChange: Double
    let percentChange: Double
    let currentPrice: Double

    var id: String { "\(tcg):\(externalId)" }
}

struct PriceAnalyticsMovers: Codable, Sendable {
    let gainers: [PriceMover]
    let losers: [PriceMover]
}

// MARK: - Collection Analytics

struct CollectionValuePoint: Identifiable, Codable, Hashable, Sendable {
    let date: String
    let value: Double

    var id: String { date }
}

struct CollectionValueHistory: Codable, Sendable {
    let history: [CollectionValuePoint]
    let currentValue: Double
    let changePercent: Double
    let changePeriod: String
}

struct CollectionValueBreakdown: Codable, Sendable {
    struct GameValue: Identifiable, Codable, Hashable, Sendable {
        let tcg: String
        let value: Double
        let cardCount: Int

        var id: String { tcg }
    }

    struct BinderValue: Identifiable, Codable, Hashable, Sendable {
        let binderId: String
        let binderName: String
        let value: Double
        let cardCount: Int

        var id: String { binderId }
    }

    struct TopCard: Identifiable, Codable, Hashable, Sendable {
        let externalId: String
        let tcg: String
        let name: String
        let value: Double
        let imageUrl: String?

        var id: String { "\(tcg):\(externalId)" }
    }

    let byTcg: [GameValue]
    let byBinder: [BinderValue]
    let topCards: [TopCard]
}

struct CollectionDistribution: Codable, Sendable {
    struct Entry: Identifiable, Codable, Hashable, Sendable {
        let label: String
        let count: Int
        let percentage: Double

        var id: String { label }
    }

    let dimension: String
    let entries: [Entry]
    let total: Int
}

// MARK: - Decks

struct DeckCard: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let externalId: String
    let tcg: String
    let name: String
    let quantity: Int
    let zone: String
    let isCommander: Bool
    let isSideboard: Bool
    let imageUrl: String?
    let imageUrlSmall: String?
    let setCode: String?
    let setName: String?
    let cardData: [String: JSONValue]?
}

struct Deck: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let name: String
    let description: String?
    let tcg: String
    let format: String?
    let colorHex: String?
    let isPublic: Bool
    let cards: [DeckCard]
    let cardCount: Int
    let createdAt: String
    let updatedAt: String
}

struct DeckValidation: Codable, Sendable {
    struct Violation: Codable, Hashable, Sendable {
        let externalId: String?
        let name: String?
        let zone: String?
        let message: String
    }

    let valid: Bool
    let errors: [String]
    let warnings: [String]
    let format: String?
    let points: Double?
    let violations: [Violation]?
}

struct DeckOwnership: Codable, Sendable {
    struct Owned: Codable, Hashable, Sendable {
        let externalId: String
        let quantity: Int
    }

    struct Missing: Identifiable, Codable, Hashable, Sendable {
        let externalId: String
        let name: String
        let quantity: Int
        let zone: String

        var id: String { "\(zone):\(externalId)" }
    }

    let owned: [Owned]
    let missing: [Missing]
    let missingCount: Int
}

struct DeckImportResult: Codable, Sendable {
    let deck: Deck
    let importedCount: Int
    let skippedCount: Int
    let skippedCards: [String]
}

// MARK: - Trades

struct TradeCard: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let side: String
    let externalId: String
    let tcg: String
    let name: String
    let quantity: Int
    let imageUrl: String?
    let estimatedValue: Double?
}

struct Trade: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let senderId: String
    let receiverId: String
    let status: String
    let message: String?
    let cards: [TradeCard]
    let createdAt: String
    let updatedAt: String
}

struct TradeMatch: Identifiable, Codable, Hashable, Sendable {
    struct Card: Identifiable, Codable, Hashable, Sendable {
        let externalId: String
        let tcg: String
        let name: String

        var id: String { "\(tcg):\(externalId)" }
    }

    let userId: String
    let username: String?
    let theyHave: [Card]
    let youHave: [Card]
    let matchScore: Double

    var id: String { userId }
}
