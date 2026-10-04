import SwiftUI
import CryptoKit

struct MarketPricedSearchResultCell: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @StateObject private var request = CardSearchPriceRequest()
    let card: Card
    let showPricing: Bool
    let showCardNumbers: Bool
    var quantity: Int? = nil
    let api: APIService

    private var context: String {
        // Credentials stay in memory and never enter selectors, logs or filenames.
        let identity = [environmentStore.serverConfiguration.baseURL,
                        environmentStore.authToken ?? "",
                        environmentStore.pricingSource.rawValue,
                        environmentStore.gamePricingSources.keys.sorted().map { "\($0):\(environmentStore.gamePricingSources[$0]!.rawValue)" }.joined(separator: ","),
                        environmentStore.justTCGConditionPreference,
                        environmentStore.justTCGLanguagePreference,
                        String(environmentStore.offlineModeEnabled), String(showPricing),
                        String(describing: card)]
            .joined(separator: "\u{0}")
        return SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    var body: some View {
        let identity = context
        CardSearchResultCell(
            card: card, showPricing: showPricing, showCardNumbers: showCardNumbers,
            quantity: quantity, marketEstimate: request.value(for: identity),
            showsEstimateSource: true
        )
        .task(id: identity) {
            let config = environmentStore.serverConfiguration
            let token = environmentStore.authToken ?? ""
            let enabled = showPricing && config.isOnDevice && !environmentStore.offlineModeEnabled
            await request.load(context: identity) {
                guard enabled else { return nil }
                return try await api.searchMarketEstimate(for: card, config: config, token: token)
            }
        }
        .onDisappear { request.cancel() }
    }
}
