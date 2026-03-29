import Foundation

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
        region: String? = nil
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
        default: return tcg.capitalized
        }
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
    let name: String?
    let username: String?
    let isAdmin: Bool
    let showCardNumbers: Bool?
    let showPricing: Bool?
    let enabledYugioh: Bool?
    let enabledMagic: Bool?
    let enabledPokemon: Bool?
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

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .all: return "All Games"
        case .yugioh: return "Yu-Gi-Oh!"
        case .magic: return "Magic: The Gathering"
        case .pokemon: return "Pokémon"
        }
    }

    var iconName: String? {
        switch self {
        case .all: return nil
        case .yugioh: return "YugiohIcon"
        case .magic: return "MTGIcon"
        case .pokemon: return "PokemonIcon"
        }
    }

    var systemIconName: String {
        switch self {
        case .all: return "square.grid.2x2"
        case .yugioh: return "suit.club.fill"
        case .magic: return "sparkles"
        case .pokemon: return "bolt.fill"
        }
    }
}
