import Foundation
import CryptoKit

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

        let copies: [CollectionCardCopy?] = card.copies.isEmpty ? [nil] : card.copies.map { $0 }
        return copies.contains { copy in
            switch matchMode {
            case .all: return rules.allSatisfy { $0.matches(card: card, copy: copy) }
            case .any: return rules.contains { $0.matches(card: card, copy: copy) }
            }
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
        case tag = "Tag"

        var systemImage: String {
            switch self {
            case .tcg: return "square.grid.2x2"
            case .rarity: return "sparkles"
            case .condition: return "line.3.horizontal.decrease"
            case .setCode: return "square.stack.3d.up"
            case .isFoil: return "sparkle"
            case .tag: return "tag"
            }
        }
    }

    func matches(card: CollectionCard, copy: CollectionCardCopy? = nil) -> Bool {
        switch type {
        case .tcg:
            return card.tcg.lowercased() == value.lowercased()
        case .rarity:
            return card.rarity?.lowercased() == value.lowercased()
        case .condition:
            return (copy == nil ? card.condition : copy?.condition)?.lowercased() == value.lowercased()
        case .setCode:
            return card.setCode?.lowercased() == value.lowercased()
        case .isFoil:
            return (copy?.isFoil == true) == (value.lowercased() != "false")
        case .tag:
            return copy?.tags.contains { $0.label.caseInsensitiveCompare(value) == .orderedSame } ?? false
        }
    }
}

private func portableFolderUUID(_ value: String) -> UUID {
    if let uuid = UUID(uuidString: value) { return uuid }
    let bytes = Array(SHA256.hash(data: Data(value.utf8)).prefix(16))
    return UUID(uuid: (bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]))
}
extension SmartFolder {
    private enum Keys: String, CodingKey { case id, name, colorHex, rules, matchMode }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        id = portableFolderUUID(try c.decode(String.self, forKey: .id)); name = try c.decode(String.self, forKey: .name)
        colorHex = try c.decode(String.self, forKey: .colorHex); rules = try c.decode([SmartFolderRule].self, forKey: .rules)
        let mode = try c.decode(String.self, forKey: .matchMode)
        guard ["all", "any", "All Rules", "Any Rule"].contains(mode) else { throw DecodingError.dataCorruptedError(forKey: .matchMode, in: c, debugDescription: "Unknown folder mode") }
        matchMode = mode == "all" || mode == "All Rules" ? .all : .any
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(id.uuidString, forKey: .id); try c.encode(name, forKey: .name); try c.encode(colorHex, forKey: .colorHex)
        try c.encode(rules, forKey: .rules); try c.encode(matchMode == .all ? "all" : "any", forKey: .matchMode)
    }
}
extension SmartFolderRule {
    private enum Keys: String, CodingKey { case id, type, value }
    private static let codes: [RuleType: String] = [.tcg:"tcg", .rarity:"rarity", .condition:"condition", .setCode:"setCode", .isFoil:"isFoil", .tag:"tag"]
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        id = portableFolderUUID(try c.decode(String.self, forKey: .id)); value = try c.decode(String.self, forKey: .value)
        let name = try c.decode(String.self, forKey: .type)
        guard let resolved = Self.codes.first(where: { $0.value == name })?.key ?? RuleType(rawValue: name) else { throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unknown folder rule") }
        type = resolved
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(id.uuidString, forKey: .id); try c.encode(Self.codes[type]!, forKey: .type); try c.encode(value, forKey: .value)
    }
}
