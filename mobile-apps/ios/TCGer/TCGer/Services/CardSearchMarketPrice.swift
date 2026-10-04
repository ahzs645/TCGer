// @tcger-feature {"id":"cards.searchMarketPrices","platform":"ios","status":"implemented","limitation":"Phone-only Magic/Pokémon results load cached USD market references for visible cards. Other games, offline mode and unavailable quotes keep stored estimates. Search quotes do not rewrite owned copies; native/server/web search pricing is not equivalent.","modes":["local","demo"],"requires":["internet-for-market-refresh"]}
import Foundation
import Combine

struct CardSearchMarketEstimate: Equatable {
    let price: Double
    let source: String
    let cached: Bool

    var label: String {
        let provider = source == "scryfall" ? "Scryfall" : source == "tcgcsv" ? "TCGCSV" : source
        return "\(provider) · \(cached ? "cached" : "market") estimate"
    }
}

/// Quotes are presentation state. They must never update an owned copy or its cost.
extension APIService {
    func searchMarketEstimate(for card: Card, config: ServerConfiguration, token: String) async throws -> CardSearchMarketEstimate? {
        guard config.isOnDevice, ["magic", "pokemon"].contains(card.tcg.lowercased()) else { return nil }
        try Task.checkCancellation()
        let identifiers = card.justTCGIdentifiers
        let response = try await getTrackedPrices(
            config: config,
            token: token,
            items: [TrackedPriceItem(
                tcg: card.tcg,
                externalId: card.id,
                language: card.language,
                identifiers: identifiers,
                lookupHint: JustTCGCardLookupHint(name: card.name, setCode: card.setCode, setName: card.setName, collectorNumber: card.collectorNumber)
            )]
        )
        try Task.checkCancellation()
        guard let quote = response.prices.first,
              let price = quote.price, price.isFinite, price >= 0,
              quote.currency?.uppercased() == "USD", let source = quote.source else { return nil }
        return CardSearchMarketEstimate(price: price, source: source, cached: quote.cached)
    }
}

/// A source/session or card replacement owns a new generation, even if transport
/// ignores cancellation. The context also prevents displaying the old quote
/// during the frame before SwiftUI starts the replacement task.
@MainActor
final class CardSearchPriceRequest: ObservableObject {
    @Published private var estimate: CardSearchMarketEstimate?
    private var context: String?
    private var generation = 0

    func value(for context: String) -> CardSearchMarketEstimate? {
        self.context == context ? estimate : nil
    }

    func load(context: String, operation: () async throws -> CardSearchMarketEstimate?) async {
        generation += 1
        let request = generation
        self.context = context
        estimate = nil
        do {
            try Task.checkCancellation()
            let value = try await operation()
            guard request == generation, !Task.isCancelled else { return }
            estimate = value
        } catch {
            // Search and stored estimates remain usable during a provider outage.
        }
    }

    func cancel() {
        generation += 1
        context = nil
        estimate = nil
    }
}

/// Search APIs already select catalogs; owned and explicitly loaded demo cards
/// must remain visible even when that game's download is absent.
enum CardSearchResultGrouping {
    static func groups(cards: [Card], selectedGame: TCGGame, enabledGames: [TCGGame], includeUninstalled: Bool) -> [(String, [Card])] {
        if selectedGame != .all { return [(selectedGame.rawValue, cards)] }
        let allowed = Set(enabledGames.map(\.rawValue))
        let visible = includeUninstalled ? cards : cards.filter { allowed.contains($0.tcg) }
        return Dictionary(grouping: visible, by: \.tcg).sorted {
            gameSectionIsOrderedBefore($0.key, $1.key, enabledGames: enabledGames)
        }
    }
}
