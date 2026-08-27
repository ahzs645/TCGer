import Foundation

/// A destination that can appear in the bottom tab bar. The order and which
/// ones are shown are user preferences — see `EnvironmentStore.tabOrder` and
/// `hiddenTabs`.
enum AppTab: String, CaseIterable, Identifiable, Codable, Sendable {
    case home
    case collections
    case sets
    case pokedex
    case decks
    case wishlists
    case guides
    case sealed
    case onlineCodes
    case prices
    case analytics
    case trades
    case activity
    case scan
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .collections: return "Collections"
        case .sets: return "Sets"
        case .pokedex: return "Pokédex"
        case .decks: return "Decks"
        case .wishlists: return "Wishlists"
        case .guides: return "Guides"
        case .sealed: return "Sealed"
        case .onlineCodes: return "Code Vault"
        case .prices: return "Prices"
        case .analytics: return "Analytics"
        case .trades: return "Trades"
        case .activity: return "Activity"
        case .scan: return "Scan"
        case .settings: return "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house.fill"
        case .collections: return "folder.fill"
        case .sets: return "square.stack.3d.up"
        case .pokedex: return "square.grid.3x3.fill"
        case .decks: return "rectangle.stack.fill"
        case .wishlists: return "heart.fill"
        case .guides: return "sparkles.rectangle.stack.fill"
        case .sealed: return "shippingbox.fill"
        case .onlineCodes: return "qrcode.viewfinder"
        case .prices: return "dollarsign.circle.fill"
        case .analytics: return "chart.xyaxis.line"
        case .trades: return "arrow.left.arrow.right"
        case .activity: return "bell.fill"
        case .scan: return "camera.viewfinder"
        case .settings: return "gearshape.fill"
        }
    }

    var subtitle: String {
        switch self {
        case .home: return "Dashboard, stats, and recent cards"
        case .collections: return "Binders, smart folders, and CSV import"
        case .sets: return "Browse sets and track set completion"
        case .pokedex: return "Track Pokémon species across your collection"
        case .decks: return "Build, validate, import, and export decks"
        case .wishlists: return "Cards you're hunting for"
        case .guides: return "Curated card collections to follow"
        case .sealed: return "Sealed boxes, packs, and openings"
        case .onlineCodes: return "Scan and track online redemption codes"
        case .prices: return "Track collection value and card prices"
        case .analytics: return "Explore value history and collection trends"
        case .trades: return "Propose and manage collector trades"
        case .activity: return "Trade requests, price alerts, and account updates"
        case .scan: return "Identify cards with the camera"
        case .settings: return "Preferences and app configuration"
        }
    }

    /// Settings stays in the bar so the customization screen is always
    /// reachable, whatever else the user hides.
    var isPinned: Bool {
        self == .settings
    }

    /// Destinations that do not have an on-device data implementation yet.
    /// Keep this separate from server feature flags: a connected server can
    /// support a feature even though phone-only mode cannot provide it.
    var requiresServerConnection: Bool {
        switch self {
        case .decks, .trades, .activity:
            return true
        default:
            return false
        }
    }

    func isSupported(by features: ServerFeatures) -> Bool {
        switch self {
        case .decks:
            return features.decks
        case .sealed:
            return features.sealed
        case .onlineCodes:
            return features.onlineCodes
        case .prices:
            return features.prices
        case .analytics:
            return features.analytics
        case .trades:
            return features.trades
        case .activity:
            return features.notifications
        default:
            return true
        }
    }

    static let defaultOrder: [AppTab] = allCases

    /// Rebuild a stored order into a valid one: drop anything unrecognized and
    /// append tabs added by a newer build so they are not silently missing.
    static func normalizedOrder(from rawValues: [String]) -> [AppTab] {
        var order = rawValues.compactMap(AppTab.init(rawValue:))
        var seen = Set<AppTab>()
        order = order.filter { seen.insert($0).inserted }
        for tab in defaultOrder where !seen.contains(tab) {
            order.append(tab)
        }
        return order
    }

    var parityFeatureID: ParityFeatureID {
        switch self {
        case .home: return .homeDashboard
        case .collections: return .collectionsBrowse
        case .sets: return .setsBrowse
        case .pokedex: return .pokedexBrowse
        case .decks: return .decksBrowse
        case .wishlists: return .wishlistsBrowse
        case .guides: return .guidesBrowse
        case .sealed: return .sealedInventory
        case .onlineCodes: return .codesVault
        case .prices: return .pricesBrowse
        case .analytics: return .analyticsBrowse
        case .trades: return .tradesBrowse
        case .activity: return .activityBrowse
        case .scan: return .scannerIdentify
        case .settings: return .settingsBrowse
        }
    }
}

enum AppDeepLinkDestination: Equatable, Sendable {
    case tab(AppTab)
    case scan(game: String?)
    case search(query: String?)
    case binder(id: String)
    case wishlist(id: String)

    var tab: AppTab? {
        switch self {
        case .tab(let tab): return tab
        case .scan: return .scan
        case .search: return nil
        case .binder: return .collections
        case .wishlist: return .wishlists
        }
    }
}

struct AppDeepLinkRequest: Identifiable, Equatable, Sendable {
    let id: UUID
    let destination: AppDeepLinkDestination

    init(id: UUID = UUID(), destination: AppDeepLinkDestination) {
        self.id = id
        self.destination = destination
    }
}

enum AppDeepLinkConsumer: Hashable, Sendable {
    case appShell
    case collections
    case wishlists
}

enum AppTabPresentation: Equatable, Sendable {
    case primary(AppTab)
    case more(AppTab)
    case unavailable
}

struct AppTabLayout: Equatable, Sendable {
    let primaryTabs: [AppTab]
    let overflowTabs: [AppTab]

    init(tabs: [AppTab]) {
        if tabs.count > 5 {
            primaryTabs = Array(tabs.prefix(4))
            overflowTabs = Array(tabs.dropFirst(4))
        } else {
            primaryTabs = tabs
            overflowTabs = []
        }
    }

    func presentation(for tab: AppTab) -> AppTabPresentation {
        if primaryTabs.contains(tab) { return .primary(tab) }
        if overflowTabs.contains(tab) { return .more(tab) }
        return .unavailable
    }
}
