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
}
