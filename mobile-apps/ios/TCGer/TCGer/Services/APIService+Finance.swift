import Foundation

extension APIService {

    private struct CreateTransactionRequest: Encodable {
        let type: String
        let cardName: String?
        let tcg: String?
        let quantity: Int?
        let amount: Double
        let currency: String?
        let platform: String?
        let costBasis: Double?
        let fees: Double?
        let shippingCost: Double?
        let acquiredAt: String?
        let notes: String?
        let date: String?
    }

    func getTransactions(
        config: ServerConfiguration,
        token: String
    ) async throws -> [Transaction] {
        if config.isOnDevice { return LocalStore.shared.getTransactions() }
        let (data, response) = try await makeRequest(config: config, path: "finance/transactions", token: token)

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
        cardName: String? = nil,
        tcg: String? = nil,
        quantity: Int? = nil,
        amount: Double,
        currency: String? = nil,
        platform: String? = nil,
        costBasis: Double? = nil,
        fees: Double? = nil,
        shippingCost: Double? = nil,
        acquiredAt: String? = nil,
        notes: String? = nil,
        date: String? = nil
    ) async throws -> Transaction {
        if config.isOnDevice {
            let transaction = LocalStore.shared.createTransaction(
                type: type, cardName: cardName, tcg: tcg, quantity: quantity ?? 1,
                amount: amount, platform: platform, costBasis: costBasis, fees: fees,
                shippingCost: shippingCost, acquiredAt: acquiredAt, notes: notes
            )
            try LocalStore.shared.requireLatestMutationPersisted()
            return transaction
        }
        let body = CreateTransactionRequest(
            type: type, cardName: cardName, tcg: tcg, quantity: quantity,
            amount: amount, currency: currency, platform: platform,
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
