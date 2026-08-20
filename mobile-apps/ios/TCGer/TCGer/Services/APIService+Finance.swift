import Foundation

extension APIService {

    private struct CreateTransactionRequest: Encodable {
        let type: String
        let collectionEntryId: String?
        let cardId: String?
        let externalId: String?
        let cardName: String?
        let tcg: String?
        let quantity: Int?
        let amount: Double
        let currency: String?
        let platform: String?
        let sourceUrl: String?
        let costBasis: Double?
        let fees: Double?
        let shippingCost: Double?
        let acquiredAt: String?
        let notes: String?
        let date: String?
    }

    private struct UpdateTransactionRequest: Encodable {
        let collectionEntryId: String?
        let cardId: String?
        let externalId: String?
        let tcg: String?
        let cardName: String?
        let quantity: Int
        let amount: Double
        let currency: String
        let platform: String?
        let sourceUrl: String?
        let notes: String?
        let date: String

        private enum CodingKeys: String, CodingKey {
            case collectionEntryId
            case cardId
            case externalId
            case tcg
            case cardName
            case quantity
            case amount
            case currency
            case platform
            case sourceUrl
            case notes
            case date
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            // These fields deliberately encode nil as JSON null so clearing an
            // optional value in Purchase Details also clears it on the server.
            try container.encode(collectionEntryId, forKey: .collectionEntryId)
            try container.encode(cardId, forKey: .cardId)
            try container.encode(externalId, forKey: .externalId)
            try container.encode(tcg, forKey: .tcg)
            try container.encode(cardName, forKey: .cardName)
            try container.encode(quantity, forKey: .quantity)
            try container.encode(amount, forKey: .amount)
            try container.encode(currency, forKey: .currency)
            try container.encode(platform, forKey: .platform)
            try container.encode(sourceUrl, forKey: .sourceUrl)
            try container.encode(notes, forKey: .notes)
            try container.encode(date, forKey: .date)
        }
    }

    func getTransactions(
        config: ServerConfiguration,
        token: String,
        collectionEntryId: String? = nil
    ) async throws -> [Transaction] {
        if config.isOnDevice {
            return LocalStore.shared.getTransactions(collectionEntryId: collectionEntryId)
        }
        let queryItems = collectionEntryId.map {
            [URLQueryItem(name: "collectionEntryId", value: $0)]
        } ?? []
        let (data, response) = try await makeRequest(
            config: config,
            path: "finance/transactions",
            queryItems: queryItems,
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let txns = try? JSONDecoder().decode([Transaction].self, from: data) else {
            throw APIError.decodingError
        }
        return txns
    }

    func createTransaction(
        config: ServerConfiguration,
        token: String,
        type: String,
        collectionEntryId: String? = nil,
        cardId: String? = nil,
        externalId: String? = nil,
        cardName: String? = nil,
        tcg: String? = nil,
        quantity: Int? = nil,
        amount: Double,
        currency: String? = nil,
        platform: String? = nil,
        sourceUrl: String? = nil,
        costBasis: Double? = nil,
        fees: Double? = nil,
        shippingCost: Double? = nil,
        acquiredAt: String? = nil,
        notes: String? = nil,
        date: String? = nil
    ) async throws -> Transaction {
        if config.isOnDevice {
            let transaction = LocalStore.shared.createTransaction(
                type: type, collectionEntryId: collectionEntryId, cardId: cardId,
                externalId: externalId, cardName: cardName, tcg: tcg,
                quantity: quantity ?? 1, amount: amount, currency: currency ?? "USD",
                platform: platform, sourceUrl: sourceUrl, costBasis: costBasis, fees: fees,
                shippingCost: shippingCost, acquiredAt: acquiredAt, notes: notes, date: date
            )
            try LocalStore.shared.requireLatestMutationPersisted()
            return transaction
        }
        let body = CreateTransactionRequest(
            type: type, collectionEntryId: collectionEntryId, cardId: cardId,
            externalId: externalId, cardName: cardName, tcg: tcg, quantity: quantity,
            amount: amount, currency: currency, platform: platform,
            sourceUrl: sourceUrl,
            costBasis: costBasis, fees: fees, shippingCost: shippingCost,
            acquiredAt: acquiredAt, notes: notes, date: date
        )
        let (data, response) = try await makeRequest(
            config: config, path: "finance/transactions", method: "POST", token: token, body: body
        )

        guard response.statusCode == 201 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let txn = try? JSONDecoder().decode(Transaction.self, from: data) else {
            throw APIError.decodingError
        }
        return txn
    }

    func updateTransaction(
        config: ServerConfiguration,
        token: String,
        transactionId: String,
        collectionEntryId: String?,
        cardId: String?,
        externalId: String?,
        cardName: String?,
        tcg: String?,
        quantity: Int,
        amount: Double,
        currency: String,
        platform: String?,
        sourceUrl: String?,
        notes: String?,
        date: String
    ) async throws -> Transaction {
        if config.isOnDevice {
            let transaction = try LocalStore.shared.updateTransaction(
                id: transactionId,
                collectionEntryId: collectionEntryId,
                cardId: cardId,
                externalId: externalId,
                cardName: cardName,
                tcg: tcg,
                quantity: quantity,
                amount: amount,
                currency: currency,
                platform: platform,
                sourceUrl: sourceUrl,
                notes: notes,
                date: date
            )
            try LocalStore.shared.requireLatestMutationPersisted()
            return transaction
        }
        let body = UpdateTransactionRequest(
            collectionEntryId: collectionEntryId,
            cardId: cardId,
            externalId: externalId,
            tcg: tcg,
            cardName: cardName,
            quantity: quantity,
            amount: amount,
            currency: currency,
            platform: platform,
            sourceUrl: sourceUrl,
            notes: notes,
            date: date
        )
        let (data, response) = try await makeRequest(
            config: config,
            path: "finance/transactions/\(transactionId)",
            method: "PATCH",
            token: token,
            body: body
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(
                status: response.statusCode,
                message: parseServerMessage(from: data)
            )
        }
        guard let transaction = try? JSONDecoder().decode(Transaction.self, from: data) else {
            throw APIError.decodingError
        }
        return transaction
    }

    func deleteTransaction(
        config: ServerConfiguration,
        token: String,
        transactionId: String
    ) async throws {
        if config.isOnDevice {
            LocalStore.shared.deleteTransaction(id: transactionId)
            try LocalStore.shared.requireLatestMutationPersisted()
            return
        }
        let (data, response) = try await makeRequest(
            config: config, path: "finance/transactions/\(transactionId)", method: "DELETE", token: token
        )

        guard response.statusCode == 200 || response.statusCode == 204 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
    }

    func getFinanceSummary(
        config: ServerConfiguration,
        token: String
    ) async throws -> FinanceSummary {
        if config.isOnDevice { return LocalStore.shared.getFinanceSummary() }
        let (data, response) = try await makeRequest(config: config, path: "finance/summary", token: token)

        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        guard let summary = try? JSONDecoder().decode(FinanceSummary.self, from: data) else {
            throw APIError.decodingError
        }
        return summary
    }

    func getRealizedPerformance(
        config: ServerConfiguration,
        token: String
    ) async throws -> RealizedPerformance {
        if config.isOnDevice { return LocalStore.shared.getRealizedPerformance() }
        let (data, response) = try await makeRequest(
            config: config, path: "finance/realized-performance", token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let performance = try? JSONDecoder().decode(RealizedPerformance.self, from: data) else {
            throw APIError.decodingError
        }
        return performance
    }
}
