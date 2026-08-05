import AppIntents
import Foundation

enum ScannerWidgetGame: String, AppEnum {
    case all
    case pokemon
    case yugioh
    case mtg

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Game"
    static var caseDisplayRepresentations: [ScannerWidgetGame: DisplayRepresentation] = [
        .all: "All Games",
        .pokemon: "Pokémon",
        .yugioh: "Yu-Gi-Oh!",
        .mtg: "Magic: The Gathering",
    ]

    var displayName: String {
        switch self {
        case .all: return "Scan a Card"
        case .pokemon: return "Pokémon"
        case .yugioh: return "Yu-Gi-Oh!"
        case .mtg: return "Magic"
        }
    }

    var accentHex: String {
        switch self {
        case .all: return "#007AFF"
        case .pokemon: return "#FF3B30"
        case .yugioh: return "#AF52DE"
        case .mtg: return "#34C759"
        }
    }

    var deepLinkURL: URL {
        if self == .all {
            return URL(string: "tcger://scan")!
        }
        return URL(string: "tcger://scan?game=\(rawValue)")!
    }
}

struct ScannerShortcutConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Scanner Shortcut"
    static var description = IntentDescription("Choose which game the scanner should be ready for.")

    @Parameter(title: "Game", default: .all)
    var game: ScannerWidgetGame

    init() {}

    init(game: ScannerWidgetGame) {
        self.game = game
    }
}

struct WishlistEntity: AppEntity, Sendable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Wishlist"
    static var defaultQuery = WishlistEntityQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct WishlistEntityQuery: EntityQuery {
    func entities(for identifiers: [WishlistEntity.ID]) async throws -> [WishlistEntity] {
        let wanted = Set(identifiers)
        return SharedDataReader.wishlists
            .filter { wanted.contains($0.id) }
            .map { WishlistEntity(id: $0.id, name: $0.name) }
    }

    func suggestedEntities() async throws -> [WishlistEntity] {
        SharedDataReader.wishlists.map { WishlistEntity(id: $0.id, name: $0.name) }
    }
}

struct WishlistConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Wishlist"
    static var description = IntentDescription("Choose a wishlist to follow.")

    @Parameter(title: "Wishlist")
    var wishlist: WishlistEntity?

    init() {}
}

struct BinderEntity: AppEntity, Sendable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Binder"
    static var defaultQuery = BinderEntityQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct BinderEntityQuery: EntityQuery {
    func entities(for identifiers: [BinderEntity.ID]) async throws -> [BinderEntity] {
        let wanted = Set(identifiers)
        return SharedDataReader.binders
            .filter { wanted.contains($0.id) }
            .map { BinderEntity(id: $0.id, name: $0.name) }
    }

    func suggestedEntities() async throws -> [BinderEntity] {
        SharedDataReader.binders.map { BinderEntity(id: $0.id, name: $0.name) }
    }
}

struct BinderConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Binder"
    static var description = IntentDescription("Choose a binder to follow.")

    @Parameter(title: "Binder")
    var binder: BinderEntity?

    init() {}
}
