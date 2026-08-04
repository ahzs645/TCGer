import Foundation

/// Approximate scarcity ordering for the free-form `rarity` strings the catalog
/// returns. Every game names its tiers differently (and inconsistently within a
/// game), so this matches on keywords rather than exact values.
///
/// Higher rank == scarcer. Unknown or missing rarities sort below `common` so
/// they collect at the bottom of a rarest-first list instead of on top.
nonisolated enum CardRarityRank {
    static let unknown = -1

    /// Ordered most-specific first: several tiers are substrings of others
    /// ("uncommon" contains "common", "ultra rare" contains "rare"), so the first
    /// match wins and the generic buckets must come last.
    private static let tiers: [(keyword: String, rank: Int)] = [
        // One-of-a-kind / chase pulls
        ("starlight", 100),
        ("quarter century", 100),
        ("ghost rare", 100),
        ("enchanted", 100),
        ("rainbow", 100),
        ("hyper rare", 100),
        ("special illustration", 100),
        // Secrets
        ("secret", 90),
        ("collector", 88),
        ("ultimate", 85),
        ("illustration rare", 82),
        ("legendary", 80),
        ("radiant", 78),
        ("amazing", 78),
        ("ace spec", 78),
        // Ultra / super tiers
        ("ultra", 70),
        ("mythic", 68),
        ("super rare", 66),
        ("double rare", 64),
        ("special", 62),
        // Foil / holo variants of ordinary rares
        ("shiny", 58),
        ("holo", 56),
        ("foil", 56),
        ("prime", 56),
        ("break", 56),
        ("legend", 56),
        ("star", 54),
        // Base tiers — keep last, they are substrings of the above
        ("rare", 50),
        ("uncommon", 30),
        ("promo", 20),
        ("common", 10),
        ("land", 5),
        ("token", 5),
        ("energy", 5)
    ]

    static func rank(for rarity: String?) -> Int {
        guard let normalized = rarity?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased(),
            !normalized.isEmpty else {
            return unknown
        }

        for tier in tiers where normalized.contains(tier.keyword) {
            return tier.rank
        }
        return unknown
    }
}
