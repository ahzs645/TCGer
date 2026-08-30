import Foundation

extension APIService {
    func getCurrentYugiohBanlist(
        config: ServerConfiguration,
        token: String,
        format: String = "tcg"
    ) async throws -> YugiohBanlistSnapshot? {
        guard !config.isOnDevice else { return nil }
        let (data, response) = try await makeRequest(
            config: config,
            path: "banlists/current",
            queryItems: [URLQueryItem(name: "format", value: format)],
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        if data == Data("null".utf8) { return nil }
        guard let snapshot = try? JSONDecoder().decode(YugiohBanlistSnapshot.self, from: data) else {
            throw APIError.decodingError
        }
        return snapshot
    }
}
