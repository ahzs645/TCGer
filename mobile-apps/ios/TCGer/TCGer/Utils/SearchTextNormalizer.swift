import Foundation

/// Produces a comparison-only key for user-entered search text.
///
/// Display strings remain untouched. Case, diacritics, width variants,
/// punctuation, symbols, and whitespace are ignored so equivalent queries
/// such as "Mr. Mime", "mr mime", and "mr.mime" share one key.
nonisolated enum SearchTextNormalizer {
    static func key(_ value: String) -> String {
        value
            .folding(
                options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive],
                locale: nil
            )
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .joined()
    }

    static func contains(_ value: String?, queryKey: String) -> Bool {
        guard let value, !queryKey.isEmpty else { return false }
        return key(value).contains(queryKey)
    }

    /// Search terms split only at whitespace. Punctuation within a printed
    /// identifier stays meaningful, so `Lucario 3/11` becomes `lucario` and
    /// `311` rather than three unrelated numeric terms.
    static func termKeys(_ value: String) -> [String] {
        value
            .split(whereSeparator: { $0.isWhitespace })
            .map { key(String($0)) }
            .filter { !$0.isEmpty }
    }

    /// Word keys are used only for conservative spelling correction. Unlike
    /// `termKeys`, punctuation is a boundary here because a card-name word
    /// should never be compared with a collector-number fraction.
    static func wordKeys(_ value: String) -> [String] {
        value
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .map(key)
            .filter { !$0.isEmpty }
    }

    /// Returns true for exactly one insertion, deletion, or substitution.
    /// Callers intentionally gate this to long, single-word fallback queries.
    static func isSingleEditAway(_ lhs: String, _ rhs: String) -> Bool {
        let left = Array(lhs)
        let right = Array(rhs)
        guard left != right, abs(left.count - right.count) <= 1 else { return false }

        if left.count == right.count {
            return zip(left, right).reduce(into: 0) { differences, pair in
                if pair.0 != pair.1 { differences += 1 }
            } == 1
        }

        let shorter = left.count < right.count ? left : right
        let longer = left.count < right.count ? right : left
        var shortIndex = 0
        var longIndex = 0
        var skipped = false

        while shortIndex < shorter.count, longIndex < longer.count {
            if shorter[shortIndex] == longer[longIndex] {
                shortIndex += 1
                longIndex += 1
            } else if skipped {
                return false
            } else {
                skipped = true
                longIndex += 1
            }
        }
        return true
    }
}
