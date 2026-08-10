import Foundation

enum CollectionGuideCategory: String, Codable, Sendable {
    case artStyle = "art-style"
    case artist
    case species
    case story
    case cameo
    case custom
}

struct CollectionGuideRule: Codable, Hashable, Sendable {
    enum RuleType: String, Codable, Hashable, Sendable {
        case name
        case set
        case artist
        case manual
    }

    let type: RuleType
    let tcg: String
    let query: String?
    let setCode: String?
    let setName: String?
    let includeAllPrintings: Bool
}

struct CollectionGuideItem: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let guideId: String
    let tcg: String
    let externalId: String
    let name: String
    let setCode: String?
    let setName: String?
    let collectorNumber: String?
    let rarity: String?
    let artist: String?
    let variant: String?
    let imageUrl: String?
    let imageUrlSmall: String?
    let groupKey: String?
    let groupLabel: String?
    let groupOrder: Int?
    let position: Int
    let note: String?
    let provenanceUrl: String?

    var card: Card {
        Card(
            id: externalId,
            name: name,
            tcg: tcg,
            setCode: setCode,
            setName: setName,
            rarity: rarity,
            artist: artist,
            imageUrl: imageUrl,
            imageUrlSmall: imageUrlSmall,
            price: nil,
            collectorNumber: collectorNumber,
            releasedAt: nil
        )
    }
}

struct GuideCardMembership: Codable, Hashable, Sendable {
    let guideId: String
    let slug: String
    let title: String
    let category: CollectionGuideCategory
    let tags: [String]
    let groupKey: String?
    let groupLabel: String?
    let groupOrder: Int?
    let position: Int?
}

struct GuideCardSearchResult: Identifiable, Codable, Hashable, Sendable {
    let card: Card
    let owned: Bool
    let ownedQuantity: Int
    let matchedGuides: [GuideCardMembership]

    var id: String { "\(card.tcg):\(card.id)" }
}

struct GuideCardSearchResponse: Codable, Sendable {
    let results: [GuideCardSearchResult]
    let total: Int
    let failedGuideSlugs: [String]
}

struct CollectionGuide: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let slug: String
    let title: String
    let description: String
    let tcg: String
    let category: CollectionGuideCategory
    let coverImageUrl: String?
    let curatorName: String
    let tags: [String]
    let version: Int
    let featured: Bool
    let rule: CollectionGuideRule
    let cardCountHint: Int?
    let followed: Bool
    let wishlistId: String?
}

struct FollowCollectionGuideResponse: Codable, Sendable {
    let guide: CollectionGuide
    let wishlistId: String
    let created: Bool
}
