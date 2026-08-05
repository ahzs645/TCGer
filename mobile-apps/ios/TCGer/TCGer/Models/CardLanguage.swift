import Foundation

/// Maps stored language names ("English", "Japanese", …) to the short codes
/// shown on card row chips. Lives here so every screen renders the same code
/// for the same stored value.
enum CardLanguage {
    private static let codes: [String: String] = [
        "english": "EN",
        "japanese": "JP",
        "german": "DE",
        "french": "FR",
        "italian": "IT",
        "spanish": "ES",
        "portuguese": "PT",
        "korean": "KO",
        "chinese": "ZH"
    ]

    /// Short chip code for a stored language name. Unknown values fall back to
    /// the first two letters; empty input returns nil.
    static func code(for language: String) -> String? {
        let trimmed = language.trimmingCharacters(in: .whitespacesAndNewlines)
        if let mapped = codes[trimmed.lowercased()] {
            return mapped
        }

        let compact = trimmed
            .components(separatedBy: CharacterSet.letters.inverted)
            .joined()
            .uppercased()

        if compact.count >= 2 {
            return String(compact.prefix(2))
        }
        return compact.isEmpty ? nil : compact
    }
}
