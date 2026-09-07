import Foundation

/// Formats free-form catalog rarity values for presentation without changing
/// the source value used by filtering, sorting, imports, or exports.
nonisolated enum CardRarityDisplay {
    static func name(for rarity: String) -> String {
        rarity
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "_", with: " ")
            .split(whereSeparator: \Character.isWhitespace)
            .map(capitalizingLeadingLowercaseLetter)
            .joined(separator: " ")
    }

    private static func capitalizingLeadingLowercaseLetter(_ word: Substring) -> String {
        guard let first = word.first, first.isLowercase else {
            return String(word)
        }

        return first.uppercased() + String(word.dropFirst())
    }
}
