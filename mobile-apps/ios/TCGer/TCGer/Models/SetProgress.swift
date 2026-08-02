import Foundation

enum SetCompletionMode: String, CaseIterable, Codable, Identifiable, Sendable {
    case standard
    case master

    var id: String { rawValue }

    var title: String {
        switch self {
        case .standard: return "Standard set"
        case .master: return "Master set"
        }
    }

    var description: String {
        switch self {
        case .standard:
            return "Numbered cards in the official checklist"
        case .master:
            return "Every cataloged card, including secrets and alternates"
        }
    }
}

enum SetBrowserSort: String, CaseIterable, Codable, Identifiable, Sendable {
    case newest
    case name
    case completion
    case closest

    var id: String { rawValue }

    var title: String {
        switch self {
        case .newest: return "Newest"
        case .name: return "Name"
        case .completion: return "Most complete"
        case .closest: return "Closest to completion"
        }
    }
}

enum SetProgressCalculator {
    static func total(for set: TcgSet, mode: SetCompletionMode) -> Int {
        switch mode {
        case .standard:
            return max(0, set.standardCards ?? set.totalCards ?? 0)
        case .master:
            return max(0, set.totalCards ?? set.standardCards ?? 0)
        }
    }

    static func includes(_ card: Card, in set: TcgSet, mode: SetCompletionMode) -> Bool {
        includes(
            collectorNumber: card.collectorNumber,
            tcg: set.tcg,
            standardLimit: set.standardCards,
            mode: mode
        )
    }

    static func includes(
        collectorNumber: String?,
        tcg: String,
        standardLimit: Int?,
        mode: SetCompletionMode
    ) -> Bool {
        guard mode == .standard,
              tcg.caseInsensitiveCompare("pokemon") == .orderedSame,
              let limit = standardLimit,
              limit > 0,
              let collectorNumber else { return true }

        let leadingDigits = collectorNumber.prefix { $0.isNumber }
        guard let number = Int(leadingDigits) else { return true }
        return number <= limit
    }

    static func progress(owned: Int, total: Int) -> Double {
        guard total > 0 else { return 0 }
        return min(1, Double(owned) / Double(total))
    }
}

enum FocusedSetOrder {
    static func normalized(_ values: [String], maximum: Int = 100) -> [String] {
        var seen = Set<String>()
        return values.compactMap { value in
            let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !normalized.isEmpty, seen.insert(normalized).inserted else { return nil }
            return normalized
        }
        .prefix(maximum)
        .map { $0 }
    }
}
