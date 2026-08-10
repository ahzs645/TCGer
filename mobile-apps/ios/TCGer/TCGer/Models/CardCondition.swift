import Foundation

/// Canonical card conditions used everywhere a condition is written or picked.
/// The raw value is the canonical stored spelling — always use these instead of
/// hand-rolled string lists so every screen stores the same casing.
nonisolated enum CardCondition: String, CaseIterable, Identifiable, Sendable {
    case mint = "Mint"
    case nearMint = "Near Mint"
    case excellent = "Excellent"
    case good = "Good"
    case lightPlayed = "Light Played"
    case played = "Played"
    case poor = "Poor"

    var id: String { rawValue }

    static let displayNames = allCases.map(\.rawValue)

    /// Uppercased condition spellings in best-to-worst order, including
    /// abbreviations and legacy spellings found in stored data (CSV imports,
    /// older builds that wrote uppercase, grading terms).
    private static let sortOrder: [String] = [
        "GEM MINT", "MINT",
        "NEAR MINT", "NM",
        "EXCELLENT", "EX",
        "LIGHTLY PLAYED", "LIGHT PLAYED", "LP",
        "GOOD",
        "MODERATE PLAY", "MODERATELY PLAYED", "MP",
        "PLAYED",
        "HEAVY PLAY", "HEAVILY PLAYED", "HP",
        "POOR", "DAMAGED", "DMG"
    ]

    /// Maps a stored condition string to its canonical spelling when the value
    /// is recognized (any casing, plus common abbreviations). Returns the input
    /// unchanged when unknown so nothing is silently dropped.
    static func canonicalize(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let upper = trimmed.uppercased()
        if let match = allCases.first(where: { $0.rawValue.uppercased() == upper }) {
            return match.rawValue
        }
        switch upper {
        case "NM": return CardCondition.nearMint.rawValue
        case "EX": return CardCondition.excellent.rawValue
        case "LIGHTLY PLAYED", "LP": return CardCondition.lightPlayed.rawValue
        default: return trimmed
        }
    }

    /// Short trade abbreviation (NM, LP, …) for a stored condition string, for
    /// compact chips. Unknown values pass through unchanged so nothing is
    /// silently dropped.
    static func shortCode(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        switch trimmed.uppercased() {
        case "GEM MINT": return "GM"
        case "MINT": return "M"
        case "NEAR MINT", "NM": return "NM"
        case "EXCELLENT", "EX": return "EX"
        case "LIGHTLY PLAYED", "LIGHT PLAYED", "LP": return "LP"
        case "GOOD": return "GD"
        case "MODERATE PLAY", "MODERATELY PLAYED", "MP": return "MP"
        case "PLAYED": return "PL"
        case "HEAVY PLAY", "HEAVILY PLAYED", "HP": return "HP"
        case "POOR": return "PR"
        case "DAMAGED", "DMG": return "DMG"
        default: return trimmed
        }
    }

    /// Rank for sorting arbitrary stored condition strings best-first.
    /// Unknown values sort after all known ones.
    static func sortRank(_ value: String) -> Int {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return sortOrder.firstIndex(of: normalized) ?? sortOrder.count
    }

    /// Sorts condition strings best-first, falling back to alphabetical for
    /// unknown values so the order is stable.
    static func sorted(_ values: some Sequence<String>) -> [String] {
        values.sorted { lhs, rhs in
            let leftIndex = sortRank(lhs)
            let rightIndex = sortRank(rhs)
            if leftIndex == rightIndex {
                return lhs < rhs
            }
            return leftIndex < rightIndex
        }
    }
}
