import Foundation

extension APIService {
    struct TrackedPriceItem: Codable, Hashable, Sendable {
        let tcg: String
        let externalId: String
        let finishCode: String?

        init(tcg: String, externalId: String, finishCode: String? = nil) {
            self.tcg = Self.normalized(tcg)
            self.externalId = Self.normalized(externalId)
            let normalizedFinish = Self.normalized(finishCode ?? "")
            self.finishCode = normalizedFinish.isEmpty ? nil : normalizedFinish
        }

        static func lookupKey(tcg: String, externalId: String) -> String {
            "\(normalized(tcg).lowercased()):\(normalized(externalId).lowercased())"
        }

        var lookupKey: String {
            Self.lookupKey(tcg: tcg, externalId: externalId)
        }

        var key: String {
            "\(Self.normalized(tcg).lowercased()):\(Self.normalized(externalId)):\(Self.normalized(finishCode ?? "").lowercased())"
        }

        private static func normalized(_ value: String) -> String {
            value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    struct TrackedPriceResult: Codable, Sendable {
        let key: String
        let tcg: String
        let externalId: String
        let finishCode: String?
        let price: Double?
        let currency: String?
        let source: String?
        let updatedAt: String?
        let cached: Bool
        let error: String?

        var lookupKey: String {
            TrackedPriceItem.lookupKey(tcg: tcg, externalId: externalId)
        }
    }

    struct TrackedPricesResponse: Codable, Sendable {
        let prices: [TrackedPriceResult]
        let refreshedAt: String
        let refreshAfter: String
    }

    private struct TrackedPricesRequest: Encodable {
        let items: [TrackedPriceItem]
        let force: Bool
        let source: String
    }

    func getTrackedPrices(
        config: ServerConfiguration,
        token: String,
        items: [TrackedPriceItem],
        force: Bool = false
    ) async throws -> TrackedPricesResponse {
        let uniqueItems = Array(Dictionary(
            items.map { ($0.key, $0) },
            uniquingKeysWith: { _, latest in latest }
        ).values)
            .sorted { $0.key < $1.key }
        guard !uniqueItems.isEmpty else {
            let now = ISO8601DateFormatter().string(from: Date())
            return TrackedPricesResponse(prices: [], refreshedAt: now, refreshAfter: now)
        }
        if config.isOnDevice {
            return try await getOnDeviceTrackedPrices(items: uniqueItems, force: force)
        }

        let selectedSource = PricingSource.selected()
        let serverSource = selectedSource.isServerSelectable ? selectedSource : .automatic

        var responses: [TrackedPricesResponse] = []
        for start in stride(from: 0, to: uniqueItems.count, by: 100) {
            let end = min(start + 100, uniqueItems.count)
            let (data, response) = try await makeRequest(
                config: config,
                path: "prices/tracked",
                method: "POST",
                token: token,
                body: TrackedPricesRequest(
                    items: Array(uniqueItems[start..<end]),
                    force: force,
                    source: serverSource.rawValue
                )
            )
            guard response.statusCode == 200 else {
                if response.statusCode == 401 { throw APIError.unauthorized }
                throw APIError.serverError(
                    status: response.statusCode,
                    message: parseServerMessage(from: data)
                )
            }
            guard let decoded = try? JSONDecoder().decode(TrackedPricesResponse.self, from: data) else {
                throw APIError.decodingError
            }
            responses.append(decoded)
        }
        return TrackedPricesResponse(
            prices: responses.flatMap(\.prices),
            refreshedAt: responses.last?.refreshedAt ?? ISO8601DateFormatter().string(from: Date()),
            refreshAfter: responses.map(\.refreshAfter).min() ?? ISO8601DateFormatter().string(from: Date())
        )
    }

    private func getOnDeviceTrackedPrices(
        items: [TrackedPriceItem],
        force: Bool
    ) async throws -> TrackedPricesResponse {
        let now = Date()
        let source = PricingSource.selected()
        var results: [TrackedPriceResult] = []
        for item in items {
            let cacheKey = "\(source.rawValue):\(item.key)"
            if let cached = await OnDeviceTrackedPriceCache.shared.result(for: cacheKey, force: force) {
                results.append(cached.withCached(true))
                continue
            }
            let quote = try await fetchOnDeviceTrackedPrice(item)
            let result = TrackedPriceResult(
                key: item.key,
                tcg: item.tcg,
                externalId: item.externalId,
                finishCode: item.finishCode,
                price: quote?.price,
                currency: quote?.currency,
                source: quote?.source,
                updatedAt: quote == nil ? nil : ISO8601DateFormatter().string(from: now),
                cached: false,
                error: quote == nil ? "No compatible on-device market quote is available" : nil
            )
            if quote != nil {
                await OnDeviceTrackedPriceCache.shared.save(result, for: cacheKey, forced: force)
            }
            results.append(result)
        }
        return TrackedPricesResponse(
            prices: results,
            refreshedAt: ISO8601DateFormatter().string(from: now),
            refreshAfter: ISO8601DateFormatter().string(from: now.addingTimeInterval(12 * 60 * 60))
        )
    }

    private func fetchOnDeviceTrackedPrice(_ item: TrackedPriceItem) async throws -> CardPriceQuote? {
        if PricingSource.selected() == .collectrPrivateTest,
           let configuration = try CollectrPrivateCredentialStore.load() {
            return try await CollectrTestPriceProvider(
                configuration: configuration,
                mappings: CollectrProductMappingStore().mappings
            ).fetchPrice(tcg: item.tcg, externalID: item.externalId)
        }
        guard item.tcg.lowercased() == "magic",
              let apiKey = try JustTCGCredentialStore.loadAPIKey(),
              var components = URLComponents(string: "https://api.justtcg.com/v1/cards") else {
            return nil
        }
        components.queryItems = [URLQueryItem(name: "scryfallId", value: item.externalId)]
        guard let url = components.url else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        let (data, response) = try await execute(request)
        guard response.statusCode == 200 else {
            if response.statusCode == 404 { return nil }
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
        guard let payload = try? JSONDecoder().decode(JustTcgCardsResponse.self, from: data) else {
            throw APIError.decodingError
        }
        let variants = payload.cards.first?.variants ?? []
        let nearMint = variants.filter {
            let condition = $0.condition?.lowercased()
            return condition == nil || condition == "near mint" || condition == "nm"
        }
        let candidates = nearMint.isEmpty ? variants : nearMint
        let regular = candidates.first { !($0.printing?.lowercased().contains("foil") ?? false) }
        let foil = candidates.first { $0.printing?.lowercased().contains("foil") ?? false }
        let price: Double?
        if item.finishCode?.lowercased().contains("foil") == true {
            price = foil?.price ?? regular?.price
        } else {
            price = regular?.price ?? foil?.price
        }
        return price.map { CardPriceQuote(source: "justtcg", price: $0, currency: "USD") }
    }

    private struct JustTcgCardsResponse: Decodable {
        let cards: [JustTcgCard]

        private enum CodingKeys: String, CodingKey { case data }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            if let cards = try? container.decode([JustTcgCard].self, forKey: .data) {
                self.cards = cards
            } else {
                self.cards = [try container.decode(JustTcgCard.self, forKey: .data)]
            }
        }
    }

    private struct JustTcgCard: Decodable {
        let variants: [JustTcgVariant]
    }

    private struct JustTcgVariant: Decodable {
        let condition: String?
        let printing: String?
        let price: Double?
    }

    private struct CreateDeckRequest: Encodable {
        let name: String
        let description: String?
        let tcg: String
        let format: String?
        let colorHex: String?
        let isPublic: Bool?
    }

    private struct UpdateDeckRequest: Encodable {
        let name: String?
        let description: String?
        let format: String?
        let colorHex: String?
        let isPublic: Bool?
    }

    private struct AddDeckCardRequest: Encodable {
        let externalId: String
        let tcg: String
        let name: String
        let quantity: Int
        let zone: String?
        let isCommander: Bool?
        let isSideboard: Bool?
        let imageUrl: String?
        let imageUrlSmall: String?
        let setCode: String?
        let setName: String?
    }

    private struct UpdateDeckCardRequest: Encodable {
        let quantity: Int?
        let zone: String?
        let isCommander: Bool?
        let isSideboard: Bool?
    }

    private struct ImportDeckRequest: Encodable {
        let source: String
        let data: String
        let name: String?
        let tcg: String?
        let format: String?
    }

    private struct ValidateDeckRequest: Encodable {
        let format: String?
    }

    private struct CreateTradeCardRequest: Encodable {
        let externalId: String
        let tcg: String
        let name: String
        let quantity: Int
        let imageUrl: String?
        let estimatedValue: Double?
    }

    private struct CreateTradeRequest: Encodable {
        let receiverId: String
        let message: String?
        let senderCards: [CreateTradeCardRequest]
        let receiverCards: [CreateTradeCardRequest]?
    }

    // MARK: Analytics and Prices

    func getCollectionValueHistory(
        config: ServerConfiguration,
        token: String,
        period: String = "30d"
    ) async throws -> CollectionValueHistory {
        if config.isOnDevice {
            let value = LocalStore.shared.getCollections().reduce(0) { $0 + $1.totalValue }
            if LocalStore.shared.isSampleDataLoaded, value > 0 {
                let history = LocalSampleAnalytics.history(currentValue: value, period: period)
                let startingValue = history.first?.value ?? value
                let changePercent = startingValue == 0
                    ? 0
                    : ((value - startingValue) / startingValue) * 100
                return CollectionValueHistory(
                    history: history,
                    currentValue: value,
                    changePercent: changePercent,
                    changePeriod: period
                )
            }
            return CollectionValueHistory(
                // Phone-only mode does not yet record historical price
                // snapshots. An empty series is honest and lets the UI show
                // its existing "More History Needed" state.
                history: [],
                currentValue: value,
                changePercent: 0,
                changePeriod: period
            )
        }
        return try await decodeResponse(
            config: config,
            path: "analytics/value",
            queryItems: [URLQueryItem(name: "period", value: period)],
            token: token,
            as: CollectionValueHistory.self
        )
    }

    func getCollectionValueBreakdown(
        config: ServerConfiguration,
        token: String
    ) async throws -> CollectionValueBreakdown {
        if config.isOnDevice {
            let collections = LocalStore.shared.getCollections()
            let allCards = collections.flatMap(\.cards)
            let games = Dictionary(grouping: allCards, by: { $0.tcg }).map { tcg, cards in
                CollectionValueBreakdown.GameValue(
                    tcg: tcg,
                    value: cards.reduce(0) { $0 + ($1.price ?? 0) * Double($1.quantity) },
                    cardCount: cards.reduce(0) { $0 + $1.quantity }
                )
            }.sorted { $0.value > $1.value }
            let binders = collections.map {
                CollectionValueBreakdown.BinderValue(
                    binderId: $0.id,
                    binderName: $0.name,
                    value: $0.totalValue,
                    cardCount: $0.totalCopies
                )
            }.sorted { $0.value > $1.value }
            var topCardsByPrinting: [String: CollectionValueBreakdown.TopCard] = [:]
            for card in allCards {
                let externalId = card.externalId ?? card.cardId
                let key = "\(card.tcg.lowercased()):\(externalId)"
                let existingValue = topCardsByPrinting[key]?.value ?? 0
                topCardsByPrinting[key] = CollectionValueBreakdown.TopCard(
                    externalId: externalId,
                    tcg: card.tcg,
                    name: card.name,
                    value: existingValue + (card.price ?? 0) * Double(card.quantity),
                    imageUrl: topCardsByPrinting[key]?.imageUrl ?? card.imageUrlSmall ?? card.imageUrl
                )
            }
            let topCards = topCardsByPrinting.values
                .sorted { $0.value > $1.value }
                .prefix(10)
            return CollectionValueBreakdown(byTcg: games, byBinder: binders, topCards: Array(topCards))
        }
        return try await decodeResponse(
            config: config,
            path: "analytics/value/breakdown",
            token: token,
            as: CollectionValueBreakdown.self
        )
    }

    func getCollectionDistribution(
        config: ServerConfiguration,
        token: String,
        dimension: String
    ) async throws -> CollectionDistribution {
        if config.isOnDevice {
            let cards = LocalStore.shared.getCollections().flatMap(\.cards)
            let labels: [String]
            switch dimension {
            case "rarity": labels = cards.map { $0.rarity ?? "Unknown" }
            case "set": labels = cards.map { $0.setName ?? $0.setCode ?? "Unknown" }
            default: labels = cards.map(\.tcg)
            }
            let total = labels.count
            let entries = Dictionary(grouping: labels, by: { $0 }).map { label, values in
                CollectionDistribution.Entry(
                    label: label,
                    count: values.count,
                    percentage: total == 0 ? 0 : Double(values.count) / Double(total) * 100
                )
            }.sorted { $0.count > $1.count }
            return CollectionDistribution(dimension: dimension, entries: entries, total: total)
        }
        return try await decodeResponse(
            config: config,
            path: "analytics/distribution",
            queryItems: [URLQueryItem(name: "by", value: dimension)],
            token: token,
            as: CollectionDistribution.self
        )
    }

    func getPriceMovers(
        config: ServerConfiguration,
        token: String,
        tcg: String? = nil,
        period: Int = 30
    ) async throws -> PriceAnalyticsMovers {
        if config.isOnDevice {
            if LocalStore.shared.isSampleDataLoaded {
                return LocalSampleAnalytics.movers(period: period)
            }
            // No local price-snapshot series means there is no defensible
            // change calculation. Never turn collection order into fabricated
            // market movement.
            return PriceAnalyticsMovers(gainers: [], losers: [])
        }
        var queryItems = [URLQueryItem(name: "period", value: String(period))]
        if let tcg { queryItems.append(URLQueryItem(name: "tcg", value: tcg)) }
        return try await decodeResponse(
            config: config,
            path: "prices/analytics/movers",
            queryItems: queryItems,
            token: token,
            as: PriceAnalyticsMovers.self
        )
    }

    // MARK: Decks

    func getDecks(config: ServerConfiguration, token: String) async throws -> [Deck] {
        try requireServer(config, feature: "Decks")
        return try await decodeResponse(config: config, path: "decks", token: token, as: [Deck].self)
    }

    func getDeck(config: ServerConfiguration, token: String, deckId: String) async throws -> Deck {
        try requireServer(config, feature: "Decks")
        return try await decodeResponse(
            config: config, path: "decks/\(deckId)", token: token, as: Deck.self
        )
    }

    func createDeck(
        config: ServerConfiguration,
        token: String,
        name: String,
        description: String?,
        tcg: String,
        format: String?,
        isPublic: Bool
    ) async throws -> Deck {
        try requireServer(config, feature: "Decks")
        let body = CreateDeckRequest(
            name: name,
            description: description,
            tcg: tcg,
            format: format,
            colorHex: nil,
            isPublic: isPublic
        )
        return try await decodeResponse(
            config: config, path: "decks", method: "POST", token: token, body: body,
            acceptedStatusCodes: [201], as: Deck.self
        )
    }

    func updateDeck(
        config: ServerConfiguration,
        token: String,
        deckId: String,
        name: String? = nil,
        description: String? = nil,
        format: String? = nil,
        isPublic: Bool? = nil
    ) async throws -> Deck {
        try requireServer(config, feature: "Decks")
        let body = UpdateDeckRequest(
            name: name,
            description: description,
            format: format,
            colorHex: nil,
            isPublic: isPublic
        )
        return try await decodeResponse(
            config: config, path: "decks/\(deckId)", method: "PATCH", token: token, body: body,
            as: Deck.self
        )
    }

    func deleteDeck(config: ServerConfiguration, token: String, deckId: String) async throws {
        try requireServer(config, feature: "Decks")
        try await deleteResponse(config: config, path: "decks/\(deckId)", token: token)
    }

    func addCardToDeck(
        config: ServerConfiguration,
        token: String,
        deckId: String,
        card: Card,
        quantity: Int,
        zone: String
    ) async throws -> DeckCard {
        try requireServer(config, feature: "Decks")
        let body = AddDeckCardRequest(
            externalId: card.id,
            tcg: card.tcg,
            name: card.name,
            quantity: quantity,
            zone: zone,
            isCommander: false,
            isSideboard: zone == "side",
            imageUrl: card.imageUrl,
            imageUrlSmall: card.imageUrlSmall,
            setCode: card.setCode,
            setName: card.setName
        )
        return try await decodeResponse(
            config: config, path: "decks/\(deckId)/cards", method: "POST", token: token, body: body,
            acceptedStatusCodes: [201], as: DeckCard.self
        )
    }

    func updateDeckCard(
        config: ServerConfiguration,
        token: String,
        deckId: String,
        cardId: String,
        quantity: Int,
        zone: String
    ) async throws -> DeckCard {
        let body = UpdateDeckCardRequest(
            quantity: quantity, zone: zone, isCommander: nil, isSideboard: zone == "side"
        )
        return try await decodeResponse(
            config: config, path: "decks/\(deckId)/cards/\(cardId)", method: "PATCH", token: token,
            body: body, as: DeckCard.self
        )
    }

    func removeDeckCard(config: ServerConfiguration, token: String, deckId: String, cardId: String) async throws {
        try await deleteResponse(config: config, path: "decks/\(deckId)/cards/\(cardId)", token: token)
    }

    func validateDeck(
        config: ServerConfiguration,
        token: String,
        deckId: String,
        format: String? = nil
    ) async throws -> DeckValidation {
        try await decodeResponse(
            config: config, path: "decks/\(deckId)/validate", method: "POST", token: token,
            body: ValidateDeckRequest(format: format), as: DeckValidation.self
        )
    }

    func getDeckOwnership(config: ServerConfiguration, token: String, deckId: String) async throws -> DeckOwnership {
        try await decodeResponse(
            config: config, path: "decks/\(deckId)/ownership", token: token, as: DeckOwnership.self
        )
    }

    func exportDeckYDK(config: ServerConfiguration, token: String, deckId: String) async throws -> DeckYDKExport {
        try await decodeResponse(
            config: config, path: "decks/\(deckId)/ydk", token: token, as: DeckYDKExport.self
        )
    }

    func importDeck(
        config: ServerConfiguration,
        token: String,
        source: String,
        data: String,
        name: String?,
        tcg: String?,
        format: String?
    ) async throws -> DeckImportResult {
        try requireServer(config, feature: "Decks")
        let body = ImportDeckRequest(source: source, data: data, name: name, tcg: tcg, format: format)
        return try await decodeResponse(
            config: config, path: "decks/import", method: "POST", token: token, body: body,
            acceptedStatusCodes: [201], as: DeckImportResult.self
        )
    }

    // MARK: Trades

    func getTrades(config: ServerConfiguration, token: String) async throws -> [Trade] {
        try requireServer(config, feature: "Trades")
        return try await decodeResponse(config: config, path: "trades", token: token, as: [Trade].self)
    }

    func getTradeMatches(config: ServerConfiguration, token: String) async throws -> [TradeMatch] {
        try requireServer(config, feature: "Trades")
        return try await decodeResponse(config: config, path: "trades/matches", token: token, as: [TradeMatch].self)
    }

    func createTrade(
        config: ServerConfiguration,
        token: String,
        match: TradeMatch,
        message: String?
    ) async throws -> Trade {
        try requireServer(config, feature: "Trades")
        func requestCard(_ card: TradeMatch.Card) -> CreateTradeCardRequest {
            CreateTradeCardRequest(
                externalId: card.externalId,
                tcg: card.tcg,
                name: card.name,
                quantity: 1,
                imageUrl: nil,
                estimatedValue: nil
            )
        }
        let body = CreateTradeRequest(
            receiverId: match.userId,
            message: message,
            senderCards: match.youHave.map(requestCard),
            receiverCards: match.theyHave.map(requestCard)
        )
        return try await decodeResponse(
            config: config, path: "trades", method: "POST", token: token, body: body,
            acceptedStatusCodes: [201], as: Trade.self
        )
    }

    func updateTradeStatus(
        config: ServerConfiguration,
        token: String,
        tradeId: String,
        action: String
    ) async throws -> Trade {
        try await decodeResponse(
            config: config, path: "trades/\(tradeId)/\(action)", method: "PATCH", token: token,
            as: Trade.self
        )
    }

    func deleteTrade(config: ServerConfiguration, token: String, tradeId: String) async throws {
        try await deleteResponse(config: config, path: "trades/\(tradeId)", token: token)
    }

    // MARK: Shared transport

    private func requireServer(_ config: ServerConfiguration, feature: String) throws {
        if config.isOnDevice {
            throw APIError.serverError(status: 501, message: "\(feature) require a connected TCGer server.")
        }
    }

    private func decodeResponse<Response: Decodable>(
        config: ServerConfiguration,
        path: String,
        queryItems: [URLQueryItem] = [],
        method: String = "GET",
        token: String,
        body: Encodable? = nil,
        acceptedStatusCodes: Set<Int> = [200],
        as type: Response.Type
    ) async throws -> Response {
        let (data, response) = try await makeRequest(
            config: config,
            path: path,
            queryItems: queryItems,
            method: method,
            token: token,
            body: body
        )
        guard acceptedStatusCodes.contains(response.statusCode) else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.decodingError
        }
    }

    private func deleteResponse(config: ServerConfiguration, path: String, token: String) async throws {
        let (data, response) = try await makeRequest(
            config: config, path: path, method: "DELETE", token: token
        )
        guard response.statusCode == 200 || response.statusCode == 204 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
    }
}

private extension APIService.TrackedPriceResult {
    func withCached(_ cached: Bool) -> Self {
        .init(
            key: key,
            tcg: tcg,
            externalId: externalId,
            finishCode: finishCode,
            price: price,
            currency: currency,
            source: source,
            updatedAt: updatedAt,
            cached: cached,
            error: error
        )
    }
}

private actor OnDeviceTrackedPriceCache {
    struct Entry {
        let result: APIService.TrackedPriceResult
        let savedAt: Date
        let lastForcedAt: Date?
    }

    static let shared = OnDeviceTrackedPriceCache()
    private var entries: [String: Entry] = [:]

    func result(for key: String, force: Bool) -> APIService.TrackedPriceResult? {
        guard let entry = entries[key] else { return nil }
        let now = Date()
        if force {
            if let lastForcedAt = entry.lastForcedAt,
               now.timeIntervalSince(lastForcedAt) < 5 * 60 {
                return entry.result
            }
            return nil
        }
        guard now.timeIntervalSince(entry.savedAt) < 12 * 60 * 60 else {
            entries.removeValue(forKey: key)
            return nil
        }
        return entry.result
    }

    func save(_ result: APIService.TrackedPriceResult, for key: String, forced: Bool) {
        entries[key] = Entry(
            result: result,
            savedAt: Date(),
            lastForcedAt: forced ? Date() : entries[key]?.lastForcedAt
        )
    }
}

/// Deterministic analytics fixtures used only when the optional Sample Data
/// collection is installed. Real phone-only collections continue to report no
/// history until local price snapshots are implemented.
private enum LocalSampleAnalytics {
    static func history(currentValue: Double, period: String) -> [CollectionValuePoint] {
        let days: Int
        switch period.lowercased() {
        case "7d": days = 7
        case "90d": days = 90
        case "1y": days = 365
        default: days = 30
        }

        let pointCount = min(days + 1, 16)
        let calendar = Calendar(identifier: .gregorian)
        let startOfToday = calendar.startOfDay(for: Date())
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"

        let waves = [0.000, 0.006, -0.004, 0.009, -0.003, 0.007, -0.002, 0.005]
        return (0..<pointCount).map { index in
            let progress = pointCount == 1 ? 1 : Double(index) / Double(pointCount - 1)
            let dayOffset = -days + Int((Double(days) * progress).rounded())
            let date = calendar.date(byAdding: .day, value: dayOffset, to: startOfToday) ?? startOfToday
            let trend = 0.91 + (0.09 * progress)
            let wave = index == pointCount - 1 ? 0 : waves[index % waves.count]
            return CollectionValuePoint(
                date: formatter.string(from: date),
                value: currentValue * (trend + wave)
            )
        }
    }

    static func movers(period: Int) -> PriceAnalyticsMovers {
        let scale = min(max(Double(period) / 30, 0.35), 2.5)

        func mover(
            externalId: String,
            tcg: String,
            name: String,
            currentPrice: Double,
            thirtyDayPercent: Double
        ) -> PriceMover {
            let percent = thirtyDayPercent * scale
            let previousPrice = currentPrice / (1 + (percent / 100))
            return PriceMover(
                externalId: externalId,
                tcg: tcg,
                name: name,
                priceChange: currentPrice - previousPrice,
                percentChange: percent,
                currentPrice: currentPrice
            )
        }

        return PriceAnalyticsMovers(
            gainers: [
                mover(
                    externalId: "sample-pokemon-charizard",
                    tcg: "pokemon",
                    name: "Charizard ex",
                    currentPrice: 33.40,
                    thirtyDayPercent: 8.6
                ),
                mover(
                    externalId: "sample-pokemon-pikachu-surging",
                    tcg: "pokemon",
                    name: "Pikachu",
                    currentPrice: 19.25,
                    thirtyDayPercent: 7.5
                ),
                mover(
                    externalId: "sample-magic-black-lotus",
                    tcg: "magic",
                    name: "Black Lotus",
                    currentPrice: 25_000,
                    thirtyDayPercent: 1.7
                )
            ],
            losers: [
                mover(
                    externalId: "sample-ygo-blue-eyes",
                    tcg: "yugioh",
                    name: "Blue-Eyes White Dragon",
                    currentPrice: 18.50,
                    thirtyDayPercent: -7.3
                ),
                mover(
                    externalId: "sample-pokemon-pikachu-base",
                    tcg: "pokemon",
                    name: "Pikachu Promo",
                    currentPrice: 6.75,
                    thirtyDayPercent: -7.0
                ),
                mover(
                    externalId: "sample-magic-lightning-bolt-2xm",
                    tcg: "magic",
                    name: "Lightning Bolt",
                    currentPrice: 3.75,
                    thirtyDayPercent: -5.5
                )
            ]
        )
    }
}
