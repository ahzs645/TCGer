import Foundation

nonisolated struct ScannerPriceQuote: Equatable, Sendable {
    let price: Double
    let currency: String

    init(price: Double, currency: String) {
        self.price = price
        self.currency = currency.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }
}

enum ScannerPriceModeSupport {
    static func selectedSource(
        for game: TCGGame,
        globalSource: PricingSource,
        gameSources: [String: PricingSource]
    ) -> PricingSource {
        let selected = gameSources[game.rawValue] ?? globalSource
        return selected.supports(tcg: game.rawValue) ? selected : .automatic
    }

    static func hasRemoteProvider(
        for game: TCGGame,
        selectedSource: PricingSource,
        sources: [APIService.PriceSourceOption]
    ) -> Bool {
        let effectiveSource = selectedSource.isServerSelectable ? selectedSource : .automatic
        if effectiveSource == .automatic {
            return sources.contains { option in
                option.id != .automatic && optionSupports(option, game: game)
            }
        }
        return sources.contains { option in
            option.id == effectiveSource && optionSupports(option, game: game)
        }
    }

    static func hasOnDeviceProvider(
        for game: TCGGame,
        selectedSource: PricingSource,
        hasJustTCGKey: Bool,
        hasCollectrConfiguration: Bool,
        collectrGames: Set<String>
    ) -> Bool {
        let effectiveSource: PricingSource
        if selectedSource.isAvailableOnDevice || selectedSource == .collectrPrivateTest {
            effectiveSource = selectedSource
        } else {
            effectiveSource = .automatic
        }

        switch effectiveSource {
        case .automatic:
            return hasJustTCGKey || game == .magic
        case .justTCG:
            return hasJustTCGKey
        case .scryfall:
            return game == .magic
        case .collectrPrivateTest:
            return hasCollectrConfiguration && collectrGames.contains(game.rawValue)
        default:
            return false
        }
    }

    static func totals(for quotes: [ScannerPriceQuote]) -> [(currency: String, amount: Double)] {
        let grouped = Dictionary(grouping: quotes, by: \ScannerPriceQuote.currency)
        return grouped.keys.sorted().map { currency in
            (
                currency: currency,
                amount: grouped[currency, default: []].reduce(0) { $0 + $1.price }
            )
        }
    }

    private static func optionSupports(
        _ option: APIService.PriceSourceOption,
        game: TCGGame
    ) -> Bool {
        option.games.isEmpty || option.games.contains {
            $0.caseInsensitiveCompare(game.rawValue) == .orderedSame
        }
    }
}
