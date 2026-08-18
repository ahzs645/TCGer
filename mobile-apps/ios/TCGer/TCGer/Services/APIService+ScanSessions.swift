import Foundation

extension APIService {
    private struct SharedScanItemRequest: Encodable {
        let code: String
        let clientEventId: String
        let tcg: String
        let externalId: String
        let name: String
        let setCode: String?
        let setName: String?
        let rarity: String?
        let imageUrl: String?
        let price: Double?
        let confidence: Double?
        let language: String
        let finishCode: String?
        let finishLabel: String?
    }

    private struct SharedScanItemResponse: Decodable {
        let id: String
    }

    func sendToSharedScanSession(
        config: ServerConfiguration,
        token: String?,
        code: String,
        result: CardScanResult,
        language: String,
        finishCode: String? = nil
    ) async throws {
        guard !config.isOnDevice else {
            throw APIError.serverError(
                status: 400,
                message: "Shared scan sessions require a configured TCGer server."
            )
        }
        guard let token else { throw APIError.unauthorized }
        let identity = result.primary.details.identity
        let body = SharedScanItemRequest(
            code: code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
            clientEventId: result.id.uuidString,
            tcg: identity.game.rawValue,
            externalId: identity.id,
            name: identity.name,
            setCode: identity.setCode,
            setName: identity.setName,
            rarity: result.primary.details.rarity,
            imageUrl: result.primary.details.imageURL?.absoluteString,
            price: result.primary.details.price,
            confidence: result.primary.confidence.score,
            language: language,
            finishCode: finishCode,
            finishLabel: finishCode.map(PokemonFinishOption.label(for:))
        )
        let (data, response) = try await makeRequest(
            config: config,
            path: "scan-sessions/items",
            method: "POST",
            token: token,
            body: body
        )
        guard response.statusCode == 200 || response.statusCode == 201 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard (try? JSONDecoder().decode(SharedScanItemResponse.self, from: data)) != nil else {
            throw APIError.decodingError
        }
    }
}
