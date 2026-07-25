import Foundation

/// A destination that can appear in the bottom tab bar. The order and which
/// ones are shown are user preferences — see `EnvironmentStore.tabOrder` and
/// `hiddenTabs`.
enum AppTab: String, CaseIterable, Identifiable, Codable, Sendable {
    case home
    case collections
    case sets
    case wishlists
    case sealed
    case scan
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .collections: return "Collections"
        case .sets: return "Sets"
        case .wishlists: return "Wishlists"
        case .sealed: return "Sealed"
        case .scan: return "Scan"
        case .settings: return "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house.fill"
        case .collections: return "folder.fill"
        case .sets: return "square.stack.3d.up"
        case .wishlists: return "heart.fill"
        case .sealed: return "shippingbox.fill"
        case .scan: return "camera.viewfinder"
        case .settings: return "gearshape.fill"
        }
    }

    var subtitle: String {
        switch self {
        case .home: return "Dashboard, stats, and recent cards"
        case .collections: return "Binders, smart folders, and CSV import"
        case .sets: return "Browse sets and track set completion"
        case .wishlists: return "Cards you're hunting for"
        case .sealed: return "Sealed boxes, packs, and openings"
        case .scan: return "Identify cards with the camera"
        case .settings: return "Preferences and app configuration"
        }
    }

    /// Settings stays in the bar so the customization screen is always
    /// reachable, whatever else the user hides.
    var isPinned: Bool {
        self == .settings
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
}
