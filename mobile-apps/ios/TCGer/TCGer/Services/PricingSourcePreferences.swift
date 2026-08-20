import Foundation

/// Device-local per-game overrides for market-price selection.
///
/// The global source remains the fallback for games without an override. Keeping
/// this preference local also avoids putting API credentials or provider details
/// into collection exports and account preferences.
enum PricingSourcePreferences {
    static let storageKey = "tcg.pricing.gameSourcePriorities"

    static func load(from defaults: UserDefaults = .standard) -> [String: PricingSource] {
        guard let data = defaults.data(forKey: storageKey),
              let rawValues = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }

        return rawValues.reduce(into: [:]) { result, entry in
            let game = normalizedGame(entry.key)
            guard !game.isEmpty, let source = PricingSource(rawValue: entry.value) else { return }
            result[game] = source
        }
    }

    static func save(
        _ preferences: [String: PricingSource],
        to defaults: UserDefaults = .standard
    ) {
        let rawValues = preferences.reduce(into: [String: String]()) { result, entry in
            let game = normalizedGame(entry.key)
            guard !game.isEmpty else { return }
            result[game] = entry.value.rawValue
        }
        guard !rawValues.isEmpty else {
            defaults.removeObject(forKey: storageKey)
            return
        }
        if let data = try? JSONEncoder().encode(rawValues) {
            defaults.set(data, forKey: storageKey)
        }
    }

    static func preferredSource(
        for tcg: String,
        in defaults: UserDefaults = .standard
    ) -> PricingSource? {
        load(from: defaults)[normalizedGame(tcg)]
    }

    private static func normalizedGame(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

/// Device-local defaults used when choosing a JustTCG condition/language
/// variant. An empty value means "use the condition/language saved on the
/// collection copy", with the documented fallback used when that copy has no
/// value.
enum JustTCGPricingPreferences {
    static let conditionStorageKey = "tcg.pricing.justtcg.condition"
    static let languageStorageKey = "tcg.pricing.justtcg.language"

    static let matchCardValue = ""
    static let fallbackCondition = "Near Mint"
    static let fallbackLanguage = "English"

    static let conditions = [
        "Near Mint",
        "Lightly Played",
        "Moderately Played",
        "Heavily Played",
        "Damaged"
    ]

    static let languages = CardLanguage.supportedNames

    static func condition(in defaults: UserDefaults = .standard) -> String {
        defaults.string(forKey: conditionStorageKey) ?? matchCardValue
    }

    static func language(in defaults: UserDefaults = .standard) -> String {
        defaults.string(forKey: languageStorageKey) ?? matchCardValue
    }

    static func resolvedCondition(preference: String, cardValue: String?) -> String {
        let preferred = normalized(preference)
        if !preferred.isEmpty { return preferred }
        guard let cardValue, !normalized(cardValue).isEmpty else { return fallbackCondition }

        switch normalized(cardValue).lowercased() {
        case "mint", "near mint", "nm":
            return "Near Mint"
        case "excellent", "light played", "lightly played", "lp":
            return "Lightly Played"
        case "good", "moderate play", "moderately played", "mp":
            return "Moderately Played"
        case "played", "heavy play", "heavily played", "hp":
            return "Heavily Played"
        case "poor", "damaged", "dmg":
            return "Damaged"
        default:
            return normalized(cardValue)
        }
    }

    static func resolvedLanguage(preference: String, cardValue: String?) -> String {
        let preferred = normalized(preference)
        if !preferred.isEmpty { return preferred }
        let cardLanguage = normalized(cardValue ?? "")
        return cardLanguage.isEmpty ? fallbackLanguage : cardLanguage
    }

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
