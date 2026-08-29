import Foundation

struct PackOpeningPullSession: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let packLabel: String
    let openedAt: String
    let packs: [[PackOpeningPull]]
    let packClasses: [PackOpeningPackClass]?
    let recap: PackOpeningRecap?

    var pulls: [PackOpeningPull] { packs.flatMap { $0 } }
    var resultArtworkURLs: [URL] {
        var seen = Set<URL>()
        return pulls.flatMap { pull in
            [pull.imageUrlSmall, pull.imageUrl]
                .filter { !$0.isEmpty }
                .compactMap(URL.init(string:))
        }.filter { seen.insert($0).inserted }
    }
    var setCode: String? {
        let codes = Set(pulls.map(\.setCode))
        return codes.count == 1 ? codes.first : nil
    }
    var tcg: String? {
        let games = Set(pulls.map(\.tcg))
        return games.count == 1 ? games.first : nil
    }
}

struct PackOpeningPackClass: Codable, Hashable, Sendable {
    let id: String
    let label: String
    let probability: Double
    let description: String

    var isEvent: Bool { id != "standard" }
    var rank: Int {
        switch id {
        case "rare-pack": 2
        case "hit-heavy": 1
        default: 0
        }
    }
}

struct PackOpeningAchievement: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let title: String
    let description: String
}

struct PackOpeningProgressSnapshot: Codable, Hashable, Sendable {
    let totalPacks: Int
    let setPacks: Int
    let uniqueCards: Int
    let possibleCards: Int
    let completionPercentage: Double
    let standardPacks: Int
    let hitHeavyPacks: Int
    let rarePacks: Int
}

struct PackOpeningRecap: Codable, Hashable, Sendable {
    let newCards: Int
    let progress: PackOpeningProgressSnapshot
    let unlockedAchievements: [PackOpeningAchievement]
}

struct PackOpeningPull: Identifiable, Codable, Hashable, Sendable {
    let cardId: String
    let name: String
    let rarity: String
    let tier: String
    let collectorNumber: String
    let tcg: String
    let setCode: String
    let setName: String
    let imageUrl: String
    let imageUrlSmall: String

    var id: String { cardId }

    var card: Card {
        Card(
            id: cardId,
            name: name,
            tcg: tcg,
            setCode: setCode,
            setName: setName,
            rarity: rarity,
            imageUrl: imageUrl,
            imageUrlSmall: imageUrlSmall,
            price: nil,
            collectorNumber: collectorNumber,
            releasedAt: nil
        )
    }
}
