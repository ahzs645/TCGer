import Foundation

enum CollectionFacetProperty: Hashable, Sendable {
    case attribute(String)
    case copyLanguage
    case copyEdition
    case copyFinish
    case quantity
}

enum CollectionFacetKind: Hashable, Sendable {
    case options(staticValues: [String] = [])
    case text
    case numberRange(minimum: Double, maximum: Double, step: Double)
}

struct CollectionFacetDefinition: Identifiable, Hashable, Sendable {
    let id: String
    let label: String
    let property: CollectionFacetProperty
    let kind: CollectionFacetKind
}

struct GameCollectionDefinition: Hashable, Sendable {
    let game: TCGGame
    let supportsConsolidatedIdentity: Bool
    let facets: [CollectionFacetDefinition]
}

enum CollectionIdentityViewMode: String, CaseIterable, Identifiable, Sendable {
    case collector
    case consolidated

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

struct CollectionIdentityGroup: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let tcg: String
    let totalQuantity: Int
    let totalValue: Double?
    let printings: [CollectionCard]
}

nonisolated enum CollectionIdentityGrouping {
    static func groups(for cards: [CollectionCard]) -> [CollectionIdentityGroup] {
        Dictionary(grouping: cards, by: identityKey)
            .map { key, printings in
                let sorted = printings.sorted {
                    ($0.releasedAt ?? "").localizedStandardCompare($1.releasedAt ?? "") == .orderedAscending
                }
                let values = printings.compactMap { card in
                    card.price.map { $0 * Double(max(0, card.quantity)) }
                }
                return CollectionIdentityGroup(
                    id: key,
                    name: sorted.first?.name ?? "Unknown card",
                    tcg: sorted.first?.tcg ?? "",
                    totalQuantity: printings.reduce(0) { $0 + max(0, $1.quantity) },
                    totalValue: values.isEmpty ? nil : values.reduce(0, +),
                    printings: sorted
                )
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private static func identityKey(for card: CollectionCard) -> String {
        let functionalKey: String?
        if let identity = card.functionalIdentity,
           case .object(let value) = identity,
           case .string(let key) = value["key"] {
            functionalKey = key
        } else {
            functionalKey = nil
        }
        let fallbackName = card.name
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .filter { $0.isLetter || $0.isNumber }
        return "\(card.tcg.lowercased()):\(card.baseExternalId ?? functionalKey ?? card.externalId ?? fallbackName)"
    }
}

enum CollectionFacetSelection: Hashable, Sendable {
    case options(Set<String>)
    case text(String)
    case range(minimum: String, maximum: String)

    var isActive: Bool {
        switch self {
        case .options(let values): return !values.isEmpty
        case .text(let value): return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .range(let minimum, let maximum):
            return !minimum.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                !maximum.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
}

enum GameCollectionDefinitions {
    private static let physicalFacets = [
        CollectionFacetDefinition(id: "language", label: "Language", property: .copyLanguage, kind: .options()),
        CollectionFacetDefinition(id: "edition", label: "Edition", property: .copyEdition, kind: .options()),
        CollectionFacetDefinition(id: "owned-quantity", label: "Owned Quantity", property: .quantity, kind: .numberRange(minimum: 0, maximum: 999, step: 1))
    ]

    static let all: [TCGGame: GameCollectionDefinition] = [
        .yugioh: GameCollectionDefinition(
            game: .yugioh,
            supportsConsolidatedIdentity: true,
            facets: [
                CollectionFacetDefinition(id: "card-type", label: "Card Type", property: .attribute("type"), kind: .options()),
                CollectionFacetDefinition(id: "attribute", label: "Attribute", property: .attribute("attribute"), kind: .options(staticValues: ["DARK", "DIVINE", "EARTH", "FIRE", "LIGHT", "WATER", "WIND"])),
                CollectionFacetDefinition(id: "race", label: "Race", property: .attribute("race"), kind: .options()),
                CollectionFacetDefinition(id: "level", label: "Level / Rank / Link", property: .attribute("level"), kind: .numberRange(minimum: 0, maximum: 13, step: 1)),
                CollectionFacetDefinition(id: "archetype", label: "Archetype", property: .attribute("archetype"), kind: .text),
                CollectionFacetDefinition(id: "atk", label: "ATK", property: .attribute("atk"), kind: .numberRange(minimum: 0, maximum: 99_999, step: 100)),
                CollectionFacetDefinition(id: "def", label: "DEF", property: .attribute("def"), kind: .numberRange(minimum: 0, maximum: 99_999, step: 100))
            ] + physicalFacets
        ),
        .magic: GameCollectionDefinition(
            game: .magic,
            supportsConsolidatedIdentity: true,
            facets: [
                CollectionFacetDefinition(id: "colors", label: "Colors", property: .attribute("colors"), kind: .options(staticValues: ["W", "U", "B", "R", "G"])),
                CollectionFacetDefinition(id: "type-line", label: "Type Line", property: .attribute("type_line"), kind: .text),
                CollectionFacetDefinition(id: "mana-cost", label: "Mana Cost", property: .attribute("mana_cost"), kind: .text),
                CollectionFacetDefinition(id: "artist", label: "Artist", property: .attribute("artist"), kind: .text)
            ] + physicalFacets
        ),
        .pokemon: GameCollectionDefinition(
            game: .pokemon,
            supportsConsolidatedIdentity: true,
            facets: [
                CollectionFacetDefinition(id: "types", label: "Types", property: .attribute("types"), kind: .options()),
                CollectionFacetDefinition(id: "hp", label: "HP", property: .attribute("hp"), kind: .numberRange(minimum: 0, maximum: 1_000, step: 10)),
                CollectionFacetDefinition(id: "artist", label: "Illustrator", property: .attribute("artist"), kind: .text),
                CollectionFacetDefinition(id: "finish", label: "Finish", property: .copyFinish, kind: .options())
            ] + physicalFacets
        ),
        .onepiece: GameCollectionDefinition(
            game: .onepiece,
            supportsConsolidatedIdentity: true,
            facets: [
                CollectionFacetDefinition(id: "color", label: "Color", property: .attribute("color"), kind: .options()),
                CollectionFacetDefinition(id: "card-type", label: "Card Type", property: .attribute("type"), kind: .options()),
                CollectionFacetDefinition(id: "attribute", label: "Attribute", property: .attribute("attribute"), kind: .options()),
                CollectionFacetDefinition(id: "cost", label: "Cost", property: .attribute("cost"), kind: .numberRange(minimum: 0, maximum: 20, step: 1)),
                CollectionFacetDefinition(id: "power", label: "Power", property: .attribute("power"), kind: .numberRange(minimum: 0, maximum: 20_000, step: 1_000))
            ] + physicalFacets
        ),
        .lorcana: GameCollectionDefinition(
            game: .lorcana,
            supportsConsolidatedIdentity: true,
            facets: [
                CollectionFacetDefinition(id: "ink", label: "Ink", property: .attribute("ink"), kind: .options()),
                CollectionFacetDefinition(id: "card-type", label: "Card Type", property: .attribute("type"), kind: .options()),
                CollectionFacetDefinition(id: "classification", label: "Classification", property: .attribute("classifications"), kind: .options()),
                CollectionFacetDefinition(id: "cost", label: "Cost", property: .attribute("cost"), kind: .numberRange(minimum: 0, maximum: 20, step: 1)),
                CollectionFacetDefinition(id: "lore", label: "Lore", property: .attribute("lore"), kind: .numberRange(minimum: 0, maximum: 10, step: 1))
            ] + physicalFacets
        ),
        .dragonball: GameCollectionDefinition(
            game: .dragonball,
            supportsConsolidatedIdentity: true,
            facets: [
                CollectionFacetDefinition(id: "color", label: "Color", property: .attribute("color"), kind: .options()),
                CollectionFacetDefinition(id: "card-type", label: "Card Type", property: .attribute("type"), kind: .options()),
                CollectionFacetDefinition(id: "character", label: "Character", property: .attribute("character"), kind: .text),
                CollectionFacetDefinition(id: "era", label: "Era", property: .attribute("era"), kind: .options()),
                CollectionFacetDefinition(id: "energy", label: "Energy", property: .attribute("energy"), kind: .numberRange(minimum: 0, maximum: 20, step: 1)),
                CollectionFacetDefinition(id: "power", label: "Power", property: .attribute("power"), kind: .numberRange(minimum: 0, maximum: 100_000, step: 1_000))
            ] + physicalFacets
        )
    ]

    static func definition(for game: TCGGame?) -> GameCollectionDefinition? {
        guard let game, game != .all else { return nil }
        return all[game]
    }
}

enum CollectionFacetEngine {
    static func matches(
        card: CollectionCard,
        definition: GameCollectionDefinition,
        selections: [String: CollectionFacetSelection]
    ) -> Bool {
        definition.facets.allSatisfy { facet in
            guard let selection = selections[facet.id], selection.isActive else { return true }
            let values = values(for: facet.property, card: card)
            switch selection {
            case .options(let wanted):
                let normalizedWanted = Set(wanted.map(normalize))
                return !normalizedWanted.isDisjoint(with: Set(values.compactMap(\.textValue).map(normalize)))
            case .text(let query):
                let normalizedQuery = normalize(query)
                return values.compactMap(\.textValue).contains { normalize($0).contains(normalizedQuery) }
            case .range(let minimum, let maximum):
                let lower = Double(minimum.trimmingCharacters(in: .whitespacesAndNewlines))
                let upper = Double(maximum.trimmingCharacters(in: .whitespacesAndNewlines))
                return values.compactMap(\.numberValue).contains { value in
                    (lower == nil || value >= lower!) && (upper == nil || value <= upper!)
                }
            }
        }
    }

    static func options(
        for facet: CollectionFacetDefinition,
        cards: [CollectionCard]
    ) -> [String] {
        let staticValues: [String]
        if case .options(let values) = facet.kind { staticValues = values } else { staticValues = [] }
        let discovered = cards
            .flatMap { values(for: facet.property, card: $0) }
            .compactMap(\.textValue)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return Array(Set(staticValues + discovered)).sorted {
            $0.localizedStandardCompare($1) == .orderedAscending
        }
    }

    private static func values(for property: CollectionFacetProperty, card: CollectionCard) -> [JSONValue] {
        switch property {
        case .attribute(let key):
            guard let value = card.attributes?[key] else { return [] }
            if case .array(let values) = value { return values }
            return [value]
        case .copyLanguage:
            return (card.copies.compactMap(\.language) + [card.language].compactMap { $0 }).map(JSONValue.string)
        case .copyEdition:
            return card.copies.compactMap(\.edition).map(JSONValue.string)
        case .copyFinish:
            return card.copies.compactMap { $0.finishLabel ?? $0.finishCode }.map(JSONValue.string)
        case .quantity:
            return [.number(Double(card.quantity))]
        }
    }

    nonisolated private static func normalize(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }
}

private extension JSONValue {
    var textValue: String? {
        switch self {
        case .string(let value): return value
        case .number(let value): return value.formatted(.number.precision(.fractionLength(0...2)))
        case .bool(let value): return value ? "Yes" : "No"
        default: return nil
        }
    }

    var numberValue: Double? {
        switch self {
        case .number(let value): return value
        case .string(let value): return Double(value)
        default: return nil
        }
    }
}
