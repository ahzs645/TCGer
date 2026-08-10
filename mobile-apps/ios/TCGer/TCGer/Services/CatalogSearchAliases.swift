import Foundation

/// Curated printed identifiers that upstream catalog packs do not currently
/// carry. Entries are keyed by canonical catalog card ID so aliases remain
/// explicit, reviewable provenance rather than broad search heuristics.
nonisolated enum CatalogSearchAliases {
    private static let aliasesByCardID: [String: [String]] = [
        "tk-dp-l-3": ["DPBP#506"]
    ]

    static func normalizedAliases(forCardID cardID: String) -> [String] {
        aliasesByCardID[cardID, default: []]
            .map(SearchTextNormalizer.key)
            .filter { !$0.isEmpty }
    }
}
