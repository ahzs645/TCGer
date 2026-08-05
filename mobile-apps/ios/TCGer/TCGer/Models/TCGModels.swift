import Foundation

enum JSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else { self = .array(try container.decode([JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

// MARK: - Pokemon TCG Enums

/// Pokemon TCG tournament format legality
enum PokemonCardFormat: String, Codable, CaseIterable, Sendable {
    case standard = "Standard"
    case expanded = "Expanded"
    case unlimited = "Unlimited"
}

/// Pokemon TCG card supertype
enum PokemonCardSupertype: String, Codable, CaseIterable, Sendable {
    case pokemon = "Pokémon"
    case trainer = "Trainer"
    case energy = "Energy"

    var displayName: String { rawValue }
}

/// Pokemon TCG energy types
enum PokemonEnergyType: String, Codable, CaseIterable, Sendable {
    case grass = "Grass"
    case fire = "Fire"
    case water = "Water"
    case lightning = "Lightning"
    case psychic = "Psychic"
    case fighting = "Fighting"
    case darkness = "Darkness"
    case metal = "Metal"
    case fairy = "Fairy"
    case dragon = "Dragon"
    case colorless = "Colorless"

    /// Single-letter energy symbol code
    var code: Character {
        switch self {
        case .grass: return "G"
        case .fire: return "R"
        case .water: return "W"
        case .lightning: return "L"
        case .psychic: return "P"
        case .fighting: return "F"
        case .darkness: return "D"
        case .metal: return "M"
        case .fairy: return "Y"
        case .dragon: return "N"
        case .colorless: return "C"
        }
    }

    static func fromCode(_ code: Character) -> PokemonEnergyType? {
        allCases.first { $0.code == code }
    }
}

/// Pokemon TCG regulation marks (A–K)
enum PokemonRegulationMark: String, Codable, CaseIterable, Sendable {
    case a = "A", b = "B", c = "C", d = "D", e = "E"
    case f = "F", g = "G", h = "H", i = "I", j = "J", k = "K"
}

/// Pokemon TCG card language
enum PokemonCardLanguage: String, Codable, CaseIterable, Sendable {
    case english = "English"
    case japanese = "Japanese"
    case french = "French"
    case german = "German"
    case italian = "Italian"
    case spanish = "Spanish"
    case portuguese = "Portuguese"
    case korean = "Korean"
    case chineseSimplified = "Chinese (S)"
    case chineseTraditional = "Chinese (T)"
    case dutch = "Dutch"
    case polish = "Polish"
    case russian = "Russian"
    case indonesian = "Indonesian"
    case thai = "Thai"
    case spanishMexican = "Spanish (MX)"

    var code: String {
        switch self {
        case .english: return "EN"
        case .japanese: return "JP"
        case .french: return "FR"
        case .german: return "DE"
        case .italian: return "IT"
        case .spanish: return "ES"
        case .portuguese: return "PT"
        case .korean: return "KO"
        case .chineseSimplified: return "ZH-S"
        case .chineseTraditional: return "ZH-T"
        case .dutch: return "NL"
        case .polish: return "PL"
        case .russian: return "RU"
        case .indonesian: return "ID"
        case .thai: return "TH"
        case .spanishMexican: return "ES-MX"
        }
    }

    static func fromCode(_ code: String) -> PokemonCardLanguage? {
        allCases.first { $0.code.uppercased() == code.uppercased() }
    }
}

/// Pokemon TCG regional market
enum PokemonTcgRegion: String, Codable, CaseIterable, Sendable {
    case international = "International"
    case japan = "Japan"
    case china = "China"
    case taiwanAndHongKong = "Taiwan & Hong Kong"
    case korea = "Korea"
    case thailand = "Thailand"
    case indonesia = "Indonesia"
}

// MARK: - Pokemon Format Legality
struct PokemonFormatLegality: Codable, Hashable, Sendable {
    let standard: Bool?
    let expanded: Bool?

    var legalFormats: [PokemonCardFormat] {
        var formats: [PokemonCardFormat] = []
        if standard == true { formats.append(.standard) }
        if expanded == true { formats.append(.expanded) }
        return formats
    }
}

// MARK: - Pokedex Entry
struct PokedexEntry: Codable, Hashable, Sendable, Comparable {
    let number: Int
    let name: String

    static func < (lhs: PokedexEntry, rhs: PokedexEntry) -> Bool {
        lhs.number < rhs.number
    }
}

struct PokemonVariantFlags: Codable, Hashable, Sendable {
    let normal: Bool?
    let reverse: Bool?
    let holo: Bool?
    let firstEdition: Bool?
}

struct PokemonPrintMetadata: Codable, Hashable, Sendable {
    let tcgdexId: String?
    let tcgdexImage: String?
    let variants: PokemonVariantFlags?
    let finishes: [String]?
    let category: String?
    let regulationMark: String?
    let language: String?
    let formatLegality: PokemonFormatLegality?
    let dexEntries: [PokedexEntry]?
    let region: String?
}

struct PokemonFinishOption: Identifiable, Hashable, Sendable {
    let code: String
    let label: String
    var id: String { code }

    static let catalog: [PokemonFinishOption] = [
        .init(code: "normal", label: "Non-Holo"),
        .init(code: "holo", label: "Holofoil"),
        .init(code: "reverse", label: "Reverse Holofoil"),
        .init(code: "cosmos", label: "Cosmos Holofoil"),
        .init(code: "crackedIce", label: "Cracked Ice Holofoil"),
        .init(code: "confetti", label: "Confetti Holofoil"),
        .init(code: "crosshatch", label: "Crosshatch Holofoil"),
        .init(code: "mirror", label: "Mirror Holofoil"),
        .init(code: "waterWeb", label: "Water Web Holofoil"),
        .init(code: "galaxy", label: "Galaxy Holofoil"),
        .init(code: "star", label: "Star Holofoil"),
        .init(code: "stardust", label: "Stardust Holofoil"),
        .init(code: "rainbow", label: "Rainbow Holofoil"),
        .init(code: "shattered", label: "Shattered Holofoil"),
        .init(code: "sunPillar", label: "Sun Pillar Holofoil"),
        .init(code: "line", label: "Line Holofoil"),
        .init(code: "vertical", label: "Vertical Holofoil"),
        .init(code: "dot", label: "Dot Holofoil"),
        .init(code: "pixel", label: "Pixel Holofoil"),
        .init(code: "parallel", label: "Parallel Holofoil"),
        .init(code: "pokeball", label: "Poké Ball Holofoil"),
        .init(code: "masterball", label: "Master Ball Holofoil"),
        .init(code: "etched", label: "Etched Foil"),
        .init(code: "textured", label: "Textured Holofoil"),
        .init(code: "glitter", label: "Glitter Holofoil")
    ]

    static func label(for code: String) -> String {
        if let known = catalog.first(where: {
            $0.code.caseInsensitiveCompare(code) == .orderedSame
        }) {
            return known.label
        }
        switch code.lowercased() {
        case "nonholo": return "Non-Holo"
        case "firstedition": return "1st Edition"
        case "foil": return "Foil"
        default:
            return code
                .replacingOccurrences(of: "_", with: " ")
                .replacingOccurrences(of: "-", with: " ")
                .capitalized
        }
    }

    static func options(for card: Card, includeCatalog: Bool = false) -> [PokemonFinishOption] {
        var options: [PokemonFinishOption] = []
        func append(_ code: String) {
            guard !options.contains(where: { $0.code.caseInsensitiveCompare(code) == .orderedSame }) else { return }
            options.append(.init(code: code, label: label(for: code)))
        }
        card.pokemonPrint?.finishes?.forEach(append)
        if card.pokemonPrint?.variants?.normal == true { append("normal") }
        if card.pokemonPrint?.variants?.reverse == true { append("reverse") }
        if card.pokemonPrint?.variants?.holo == true { append("holo") }
        if includeCatalog {
            catalog.forEach { append($0.code) }
        }
        return options
    }

    static func isFoil(_ code: String?) -> Bool {
        guard let normalized = code?.lowercased(), !normalized.isEmpty else { return false }
        return !["normal", "nonholo", "firstedition"].contains(normalized)
    }
}

struct CardCopyVariant: Codable, Hashable, Sendable {
    var finishCode: String?
    var finishLabel: String?
    var edition: String?
    var stamp: String?
    var isSealedPromo: Bool
    var isOversized: Bool
    var isPeelOff: Bool

    nonisolated static let empty = CardCopyVariant(
        finishCode: nil,
        finishLabel: nil,
        edition: nil,
        stamp: nil,
        isSealedPromo: false,
        isOversized: false,
        isPeelOff: false
    )

    var isFoil: Bool { PokemonFinishOption.isFoil(finishCode) }

    var labels: [String] {
        var values: [String] = []
        if let finishCode {
            values.append(finishLabel ?? PokemonFinishOption.label(for: finishCode))
        }
        if let edition, !edition.isEmpty { values.append(edition) }
        if let stamp, !stamp.isEmpty { values.append("\(stamp) stamp") }
        if isSealedPromo { values.append("Sealed promo") }
        if isOversized { values.append("Oversized") }
        if isPeelOff { values.append("Peel-off") }
        return values
    }
}

// MARK: - Card Number Parsing
struct CardNumberInfo: Sendable {
    let cardNumber: String
    let prefix: String?
    let number: Int?
    let suffix: String?
    let totalNumber: Int?
    let isSecretRare: Bool

    init(_ cardNumber: String) {
        self.cardNumber = cardNumber.trimmingCharacters(in: .whitespaces)

        let parts = self.cardNumber.split(separator: "/", maxSplits: 1)
        let leftStr = String(parts.first ?? "")

        let pattern = /^([A-Za-z]*)(\d+)([A-Za-z]*)$/
        if let match = leftStr.firstMatch(of: pattern) {
            self.prefix = match.output.1.isEmpty ? nil : String(match.output.1)
            self.number = Int(match.output.2)
            self.suffix = match.output.3.isEmpty ? nil : String(match.output.3)
        } else {
            self.prefix = leftStr
            self.number = nil
            self.suffix = nil
        }

        if parts.count > 1 {
            let rightStr = String(parts[1])
            let rightPattern = /^[A-Za-z]*(\d+)[A-Za-z]*$/
            if let rightMatch = rightStr.firstMatch(of: rightPattern) {
                self.totalNumber = Int(rightMatch.output.1)
            } else {
                self.totalNumber = nil
            }
        } else {
            self.totalNumber = nil
        }

        self.isSecretRare = (self.number ?? 0) > (self.totalNumber ?? Int.max)
    }

    /// Compare two card numbers for proper numeric sorting
    static func compare(_ a: String?, _ b: String?) -> ComparisonResult {
        guard let a = a, let b = b else {
            if a == nil && b == nil { return .orderedSame }
            return a == nil ? .orderedDescending : .orderedAscending
        }

        let infoA = CardNumberInfo(a)
        let infoB = CardNumberInfo(b)

        // Compare prefixes
        let prefA = infoA.prefix ?? ""
        let prefB = infoB.prefix ?? ""
        if prefA != prefB {
            return prefA < prefB ? .orderedAscending : .orderedDescending
        }

        // Compare numbers
        let numA = infoA.number ?? 0
        let numB = infoB.number ?? 0
        if numA != numB {
            return numA < numB ? .orderedAscending : .orderedDescending
        }

        // Compare suffixes
        let sufA = infoA.suffix ?? ""
        let sufB = infoB.suffix ?? ""
        if sufA != sufB {
            return sufA < sufB ? .orderedAscending : .orderedDescending
        }

        return .orderedSame
    }
}

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
    let formatLegality: PokemonFormatLegality?
    let dexEntries: [PokedexEntry]?
    let region: String?
    let setSymbolUrl: String?
    let setLogoUrl: String?
    let regulationMark: String?
    let language: String?
    let pokemonPrint: PokemonPrintMetadata?
    let attributes: [String: JSONValue]?
    let provenance: JSONValue?
    let legalityPeriods: [JSONValue]?
    let evolution: JSONValue?
    let functionalIdentity: JSONValue?
    let baseExternalId: String?
    let printingKey: String?
    let artworkId: String?

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
        types: [String]? = nil,
        formatLegality: PokemonFormatLegality? = nil,
        dexEntries: [PokedexEntry]? = nil,
        region: String? = nil,
        setSymbolUrl: String? = nil,
        setLogoUrl: String? = nil,
        regulationMark: String? = nil,
        language: String? = nil,
        pokemonPrint: PokemonPrintMetadata? = nil,
        attributes: [String: JSONValue]? = nil,
        provenance: JSONValue? = nil,
        legalityPeriods: [JSONValue]? = nil,
        evolution: JSONValue? = nil,
        functionalIdentity: JSONValue? = nil,
        baseExternalId: String? = nil,
        printingKey: String? = nil,
        artworkId: String? = nil
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
        self.formatLegality = formatLegality
        self.dexEntries = dexEntries
        self.region = region
        self.setSymbolUrl = setSymbolUrl
        self.setLogoUrl = setLogoUrl
        self.regulationMark = regulationMark
        self.language = language
        self.pokemonPrint = pokemonPrint
        self.attributes = attributes
        self.provenance = provenance
        self.legalityPeriods = legalityPeriods
        self.evolution = evolution
        self.functionalIdentity = functionalIdentity
        self.baseExternalId = baseExternalId
        self.printingKey = printingKey
        self.artworkId = artworkId
    }

    var displayName: String {
        if let setCode = setCode {
            return "\(name) (\(setCode))"
        }
        return name
    }

    var tcgDisplayName: String {
        TCGGame(rawValue: tcg)?.displayName ?? tcg.capitalized
    }

    var supportsPrintSelection: Bool {
        switch tcg.lowercased() {
        case "magic", "pokemon": return true
        default: return false
        }
    }

    /// Whether this card is legal in Standard format
    var isStandardLegal: Bool {
        formatLegality?.standard == true
    }

    /// Whether this card is legal in Expanded format
    var isExpandedLegal: Bool {
        formatLegality?.expanded == true
    }

    /// First Pokedex number, if available
    var pokedexNumber: Int? {
        dexEntries?.first?.number
    }

    /// Parsed card number info for numeric sorting
    var cardNumberInfo: CardNumberInfo? {
        guard let collectorNumber else { return nil }
        return CardNumberInfo(collectorNumber)
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

extension Array where Element == Collection {
    /// Canonical binder ordering for every screen that lists binders: the
    /// Unsorted Library first, then binders by most recent update. Pass
    /// `hidingEmptyUnsortedLibrary: true` on screens that only surface the
    /// library once it contains cards.
    func sortedForDisplay(hidingEmptyUnsortedLibrary: Bool = false) -> [Collection] {
        let ordered = sorted { lhs, rhs in
            if lhs.isUnsortedBinder != rhs.isUnsortedBinder {
                return lhs.isUnsortedBinder
            }
            return lhs.updatedAt > rhs.updatedAt
        }
        guard hidingEmptyUnsortedLibrary else { return ordered }
        return ordered.filter { !$0.isUnsortedBinder || !$0.cards.isEmpty }
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
    var releasedAt: String? = nil
    var setSymbolUrl: String? = nil
    var setLogoUrl: String? = nil
    var regulationMark: String? = nil
    var languageCode: String? = nil
    var supertype: String? = nil
    var formatLegality: PokemonFormatLegality? = nil
    var dexEntries: [PokedexEntry]? = nil
    var region: String? = nil
    var pokemonPrint: PokemonPrintMetadata? = nil
    var attributes: [String: JSONValue]? = nil
    var provenance: JSONValue? = nil
    var legalityPeriods: [JSONValue]? = nil
    var evolution: JSONValue? = nil
    var functionalIdentity: JSONValue? = nil
    var baseExternalId: String? = nil
    var printingKey: String? = nil
    var artworkId: String? = nil

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
    var finishCode: String? = nil
    var finishLabel: String? = nil
    var edition: String? = nil
    var stamp: String? = nil
    var isSealedPromo: Bool? = nil
    var isOversized: Bool? = nil
    var isPeelOff: Bool? = nil
    let isSigned: Bool?
    let isAltered: Bool?
    let imageUrls: [String]?
    let gradingCompany: String?
    let gradingScore: String?
    let certNumber: String?
    let storageLocation: String?
    let tags: [CollectionCardTag]

    var collectibleVariant: CardCopyVariant {
        CardCopyVariant(
            finishCode: finishCode ?? (isFoil == true ? "foil" : nil),
            finishLabel: finishLabel,
            edition: edition,
            stamp: stamp,
            isSealedPromo: isSealedPromo ?? false,
            isOversized: isOversized ?? false,
            isPeelOff: isPeelOff ?? false
        )
    }
}

extension CollectionCardCopy {
    /// Serial number when present, otherwise "Copy #n" for position `index`.
    func displayTitle(index: Int) -> String {
        if let serial = serialNumber?.trimmingCharacters(in: .whitespacesAndNewlines), !serial.isEmpty {
            return serial
        }
        return "Copy #\(index + 1)"
    }

    /// "Condition • Language" summary, nil when neither is set.
    var detailLine: String? {
        let parts = [condition, language].compactMap { value -> String? in
            guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
                return nil
            }
            return trimmed
        }
        return parts.isEmpty ? nil : parts.joined(separator: " • ")
    }

    /// Comma-separated tag labels, nil when there are none.
    var tagsLine: String? {
        let labels = tags.map(\.label).filter { !$0.isEmpty }
        return labels.isEmpty ? nil : labels.joined(separator: ", ")
    }

    /// Trimmed notes, nil when empty.
    var normalizedNotes: String? {
        guard let trimmed = notes?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
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
    let name: String?
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
    /// The numbered checklist total, excluding secret and alternate cards when known.
    let standardCards: Int?
    let iconUrl: String?
    var iconFallbackUrl: String? = nil
    let logoUrl: String?

    var id: String { "\(tcg)-\(code)" }

    /// A normalized identifier used for device-local set preferences.
    var focusID: String { "\(tcg.lowercased())::\(code.lowercased())" }

    var tcgDisplayName: String {
        TCGGame(rawValue: tcg)?.displayName ?? tcg.capitalized
    }

    var formattedReleaseDate: String? {
        guard let releaseDate else { return nil }
        let parser = Date.ISO8601FormatStyle(timeZone: .gmt)
            .year()
            .month()
            .day()
            .dateSeparator(.dash)
        guard let date = try? parser.parse(releaseDate) else { return releaseDate }
        return date.formatted(Date.FormatStyle(timeZone: .gmt).month(.abbreviated).year())
    }
}

// MARK: - Game Filter
nonisolated enum TCGGame: String, CaseIterable, Identifiable, Sendable {
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

    var shortName: String {
        switch self {
        case .all: return "All"
        case .yugioh: return "Yu-Gi-Oh!"
        case .magic: return "Magic"
        case .pokemon: return "Pokémon"
        case .onepiece: return "One Piece"
        case .lorcana: return "Lorcana"
        case .dragonball: return "Dragon Ball"
        }
    }

    var iconName: String? {
        switch self {
        case .all: return nil
        case .yugioh: return "YugiohIcon"
        case .magic: return "MTGIcon"
        case .pokemon: return "PokemonIcon"
        case .onepiece, .lorcana, .dragonball: return nil
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

// MARK: - Wishlist Models

struct Wishlist: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let name: String
    let description: String?
    let colorHex: String?
    let cards: [WishlistCard]
    let totalCards: Int
    let ownedCards: Int
    let completionPercent: Int
    let createdAt: String
    let updatedAt: String
    /// Optional so wishlists saved by older builds (and servers that predate
    /// smart wishlists) still decode.
    var rules: [WishlistRule]? = nil

    var expansionRules: [WishlistRule] { rules ?? [] }
}

/// A saved expansion rule: "every Darkrai", "everything in Prismatic
/// Evolutions". Re-running a rule pulls in printings that did not exist when
/// the wishlist was created.
struct WishlistRule: Identifiable, Codable, Hashable, Sendable {
    enum RuleType: String, Codable, Sendable {
        case name
        case set
    }

    let id: String
    let type: RuleType
    let tcg: String?
    let query: String?
    let setCode: String?
    let setName: String?
    let includeAllPrintings: Bool
    let autoSync: Bool
    let lastSyncedAt: String?
    let lastMatchCount: Int?
    let createdAt: String
    let updatedAt: String

    /// Human-readable summary, mirroring `describeWishlistRule` on the web.
    var summary: String {
        switch type {
        case .set:
            return "Every card in \(setName ?? setCode ?? "set")"
        case .name:
            let scope = includeAllPrintings ? "printing" : "card"
            return "Every \(scope) named \"\(query ?? "")\""
        }
    }
}

struct WishlistCard: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let externalId: String
    let tcg: String
    let name: String
    let setCode: String?
    let setName: String?
    let rarity: String?
    let imageUrl: String?
    let imageUrlSmall: String?
    let setSymbolUrl: String?
    let setLogoUrl: String?
    let collectorNumber: String?
    let notes: String?
    let owned: Bool
    let ownedQuantity: Int
    let createdAt: String
    var releasedAt: String? = nil
    var regulationMark: String? = nil
    var language: String? = nil
    var supertype: String? = nil
    var formatLegality: PokemonFormatLegality? = nil
    var dexEntries: [PokedexEntry]? = nil
    var region: String? = nil
    var pokemonPrint: PokemonPrintMetadata? = nil
    var attributes: [String: JSONValue]? = nil
    var provenance: JSONValue? = nil
    var legalityPeriods: [JSONValue]? = nil
    var evolution: JSONValue? = nil
    var functionalIdentity: JSONValue? = nil
    var baseExternalId: String? = nil
    var printingKey: String? = nil
    var artworkId: String? = nil
}

// MARK: - Sealed Products

struct SealedProduct: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let tcg: String
    let name: String
    let productType: String
    let setCode: String?
    let cardsPerPack: Int?
    let packsPerBox: Int?
    let releaseDate: String?
    let imageUrl: String?
    let msrp: Double?
    let upc: String?
}

struct SealedInventoryItem: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let product: SealedProduct
    let quantity: Int
    let purchasePrice: Double?
    let purchaseDate: String?
    let notes: String?
    let createdAt: String
}

struct SealedLedgerCard: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let collectionId: String?
    let externalId: String
    let tcg: String
    let cardName: String
    let quantity: Int
    let status: String
    let liveValue: Double
    let realizedProceeds: Double
    let soldAt: String?
}

struct SealedOpeningLedger: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let inventoryId: String
    let productName: String
    let openedQuantity: Int
    let openedAt: String
    let invested: Double
    let liveValue: Double
    let realizedProceeds: Double
    let profitLoss: Double
    let activeCopies: Int
    let soldCopies: Int
    let cards: [SealedLedgerCard]
}

// MARK: - Finance / Transactions

struct Transaction: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let type: String
    let cardName: String?
    let tcg: String?
    let quantity: Int
    let amount: Double
    let currency: String
    let platform: String?
    let notes: String?
    let date: String
}

struct FinanceSummary: Codable, Sendable {
    let totalSpent: Double
    let totalEarned: Double
    let profitLoss: Double
    let transactionCount: Int
}
