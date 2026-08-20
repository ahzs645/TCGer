import Foundation

extension Double {
    /// The one way to render a price for display. Stored market prices remain
    /// in their source currency; `CurrencyDisplayState` applies the user's
    /// cached reference rate and Foundation localizes the resulting amount.
    var priceText: String {
        CurrencyDisplayState.shared.formatted(self)
    }

    func priceText(currency: String) -> String {
        CurrencyDisplayState.shared.formatted(self, sourceCurrency: currency)
    }
}
