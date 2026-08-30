import Foundation

struct YugiohBanlistEntry: Codable, Hashable, Sendable {
    let externalId: String?
    let cardName: String
    let normalizedName: String
    let status: String
    let limit: Int
    let remarks: String?
}

struct YugiohBanlistSnapshot: Codable, Hashable, Sendable {
    let id: String
    let format: String
    let name: String
    let effectiveDate: String?
    let sourceUrl: String
    let identitySourceUrl: String?
    let syncedAt: String
    let entries: [YugiohBanlistEntry]

    func entry(for card: CollectionCard) -> YugiohBanlistEntry? {
        guard card.tcg.caseInsensitiveCompare("yugioh") == .orderedSame else { return nil }
        let ids = [card.baseExternalId, card.externalId, card.cardId].compactMap { $0 }
        return entries.first { entry in
            if let externalId = entry.externalId, ids.contains(externalId) { return true }
            return entry.normalizedName == YugiohCardNameNormalizer.normalize(card.name)
        }
    }

    func entry(for card: DeckCard) -> YugiohBanlistEntry? {
        let baseId: String
        if let value = card.cardData?["baseExternalId"], case .string(let id) = value {
            baseId = id
        } else {
            baseId = card.externalId
        }
        return entries.first { entry in
            entry.externalId == baseId || entry.normalizedName == YugiohCardNameNormalizer.normalize(card.name)
        }
    }
}

nonisolated enum YugiohCardNameNormalizer {
    static func normalize(_ value: String) -> String {
        value
            .precomposedStringWithCanonicalMapping
            .replacingOccurrences(of: "’", with: "'")
            .replacingOccurrences(of: "‘", with: "'")
            .replacingOccurrences(of: "–", with: "-")
            .replacingOccurrences(of: "—", with: "-")
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
            .uppercased()
    }
}
