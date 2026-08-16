import Foundation

extension Double {
    /// The one way to render a price for display. All market prices in the app
    /// are USD; going through `.currency` localizes symbol placement, grouping,
    /// and negative signs instead of hand-rolling "$" + "%.2f".
    var priceText: String {
        formatted(.currency(code: "USD"))
    }

    func priceText(currency: String) -> String {
        formatted(.currency(code: currency.uppercased()))
    }
}
