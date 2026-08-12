import Foundation

extension APIService {
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
