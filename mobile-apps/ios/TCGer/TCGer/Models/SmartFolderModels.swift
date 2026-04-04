import Foundation

struct SmartFolder: Identifiable, Codable, Hashable {
    let id: UUID
    var name: String
    var colorHex: String
    var rules: [SmartFolderRule]
    var matchMode: MatchMode

    enum MatchMode: String, Codable, Hashable, CaseIterable {
        case all = "All Rules"
        case any = "Any Rule"
    }

    func matches(card: CollectionCard) -> Bool {
        guard !rules.isEmpty else { return true }

        switch matchMode {
        case .all: return rules.allSatisfy { $0.matches(card: card) }
        case .any: return rules.contains { $0.matches(card: card) }
        }
    }
}

struct SmartFolderRule: Identifiable, Codable, Hashable {
    let id: UUID
    var type: RuleType
    var value: String

    enum RuleType: String, Codable, CaseIterable, Hashable {
        case tcg = "TCG Game"
        case rarity = "Rarity"
        case condition = "Condition"
        case setCode = "Set Code"
        case isFoil = "Foil Only"

        var systemImage: String {
            switch self {
            case .tcg: return "square.grid.2x2"
            case .rarity: return "sparkles"
            case .condition: return "line.3.horizontal.decrease"
            case .setCode: return "square.stack.3d.up"
            case .isFoil: return "sparkle"
            }
        }
    }

    func matches(card: CollectionCard) -> Bool {
        switch type {
        case .tcg:
            return card.tcg.lowercased() == value.lowercased()
        case .rarity:
            return card.rarity?.lowercased() == value.lowercased()
        case .condition:
            return card.condition?.lowercased() == value.lowercased() ||
                   card.copies.contains { $0.condition?.lowercased() == value.lowercased() }
        case .setCode:
            return card.setCode?.lowercased() == value.lowercased()
        case .isFoil:
            return card.copies.contains { $0.isFoil == true }
        }
    }
}
