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
    let type: WishlistRule.RuleType
    let tcg: String
    let query: String?
    let setCode: String?
    let setName: String?
    let includeAllPrintings: Bool
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

